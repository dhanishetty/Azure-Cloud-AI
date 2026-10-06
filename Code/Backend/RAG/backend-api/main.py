import json
import os
import re
import uuid

from azure.core.exceptions import ResourceNotFoundError
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from azure.storage.blob import BlobServiceClient
from azure.storage.queue import QueueClient
from fastapi import FastAPI, File, HTTPException, UploadFile
from openai import AzureOpenAI, RateLimitError
from pydantic import BaseModel, Field

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
TOP_K = 5
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
RETRIEVAL_METHOD = "Hybrid search (vector + keyword, fused with RRF)"
DOC_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")

STORAGE_ACCOUNT_NAME = os.environ["STORAGE_ACCOUNT_NAME"]
BLOB_CONTAINER = os.environ.get("BLOB_CONTAINER", "documents")
QUEUE_NAME = os.environ.get("QUEUE_NAME", "ingest-jobs")
SEARCH_ENDPOINT = os.environ["SEARCH_ENDPOINT"]
SEARCH_INDEX = os.environ.get("SEARCH_INDEX", "documents-index")
OPENAI_ENDPOINT = os.environ["OPENAI_ENDPOINT"]
OPENAI_API_VERSION = os.environ.get("OPENAI_API_VERSION", "2025-04-01-preview")
CHAT_DEPLOYMENT = os.environ["OPENAI_CHAT_DEPLOYMENT"]
EMBED_DEPLOYMENT = os.environ["OPENAI_EMBED_DEPLOYMENT"]
EMBED_DIMENSIONS = os.environ.get("EMBED_DIMENSIONS", "1536")
CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", CHAT_DEPLOYMENT)
EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", EMBED_DEPLOYMENT)

# One identity for everything: workload identity on AKS, `az login` locally
credential = DefaultAzureCredential()
container = BlobServiceClient(f"https://{STORAGE_ACCOUNT_NAME}.blob.core.windows.net", credential).get_container_client(BLOB_CONTAINER)
queue = QueueClient(f"https://{STORAGE_ACCOUNT_NAME}.queue.core.windows.net", QUEUE_NAME, credential)
search = SearchClient(SEARCH_ENDPOINT, SEARCH_INDEX, credential)
openai = AzureOpenAI(
    azure_endpoint=OPENAI_ENDPOINT,
    azure_ad_token_provider=get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default"),
    api_version=OPENAI_API_VERSION,
)

SYSTEM_PROMPT = (
    "You answer questions about a single uploaded PDF using only the context excerpts provided. "
    "If the answer is not in the excerpts, say you could not find it in the document. "
    "Cite page numbers like Page-3 (not p. 3) when you use an excerpt."
)

app = FastAPI(title="RAG Q&A backend-api")


class AskRequest(BaseModel):
    doc_id: str
    question: str = Field(min_length=1, max_length=1000)


def check_doc_id(doc_id: str) -> None:
    if not DOC_ID_PATTERN.match(doc_id):
        raise HTTPException(status_code=400, detail="Invalid document id")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/info")
def info():
    return {
        "chat_model": CHAT_MODEL,
        "embedding_model": EMBED_MODEL,
        "embedding_dimensions": EMBED_DIMENSIONS,
        "vector_store": "Azure AI Search",
        "search_index": SEARCH_INDEX,
        "chunk_size": CHUNK_SIZE,
        "chunk_overlap": CHUNK_OVERLAP,
        "top_k": TOP_K,
        "retrieval_method": RETRIEVAL_METHOD,
    }


@app.post("/documents", status_code=202)
def upload_document(file: UploadFile = File(...)):
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF is larger than the 20 MB limit")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="File does not look like a valid PDF")

    doc_id = uuid.uuid4().hex
    blob_name = f"{doc_id}.pdf"
    safe_name = re.sub(r"[^A-Za-z0-9._ -]", "_", filename)[:100]

    container.upload_blob(blob_name, data, metadata={"status": "queued", "filename": safe_name})
    queue.send_message(json.dumps({"doc_id": doc_id, "blob_name": blob_name}))
    return {"doc_id": doc_id, "status": "queued", "filename": safe_name}


@app.get("/documents")
def list_documents():
    documents = []
    for blob in container.list_blobs(include=["metadata"]):
        metadata = blob.metadata or {}
        documents.append(
            {
                "doc_id": blob.name.removesuffix(".pdf"),
                "filename": metadata.get("filename", blob.name),
                "status": metadata.get("status", "unknown"),
                "error": metadata.get("error"),
                "uploaded_at": blob.last_modified.isoformat() if blob.last_modified else None,
            }
        )
    documents.sort(key=lambda d: d["uploaded_at"] or "", reverse=True)
    return {"documents": documents}


def delete_chunks(doc_id: str) -> None:
    while True:
        results = list(
            search.search(search_text="*", filter=f"doc_id eq '{doc_id}'", select=["id"], top=1000)
        )
        if not results:
            return
        search.delete_documents(documents=[{"id": r["id"]} for r in results])


@app.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str):
    check_doc_id(doc_id)
    blob = container.get_blob_client(f"{doc_id}.pdf")
    try:
        blob.get_blob_properties()
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Document not found")

    delete_chunks(doc_id)
    blob.delete_blob()


@app.get("/documents/{doc_id}/status")
def document_status(doc_id: str):
    check_doc_id(doc_id)
    try:
        props = container.get_blob_client(f"{doc_id}.pdf").get_blob_properties()
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Document not found")
    metadata = props.metadata or {}
    return {
        "doc_id": doc_id,
        "status": metadata.get("status", "unknown"),
        "filename": metadata.get("filename"),
        "error": metadata.get("error"),
    }


@app.post("/ask")
def ask(request: AskRequest):
    check_doc_id(request.doc_id)
    status = document_status(request.doc_id)["status"]
    if status != "ready":
        raise HTTPException(status_code=409, detail=f"Document is not ready yet (status: {status})")

    try:
        question_vector = openai.embeddings.create(model=EMBED_DEPLOYMENT, input=request.question).data[0].embedding
        results = search.search(
            search_text=request.question,
            vector_queries=[VectorizedQuery(vector=question_vector, k_nearest_neighbors=TOP_K, fields="content_vector")],
            filter=f"doc_id eq '{request.doc_id}'",
            select=["content", "page"],
            top=TOP_K,
        )
        chunks = [{"content": r["content"], "page": r["page"]} for r in results]
        if not chunks:
            return {"answer": "I could not find anything relevant in the document.", "sources": []}

        context = "\n\n".join(f"[Page {c['page']}] {c['content']}" for c in chunks)
        completion = openai.chat.completions.create(
            model=CHAT_DEPLOYMENT,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Context excerpts:\n{context}\n\nQuestion: {request.question}"},
            ],
        )
    except RateLimitError:
        raise HTTPException(status_code=429, detail="The model is busy, try again shortly", headers={"Retry-After": "10"})

    return {
        "answer": completion.choices[0].message.content,
        "sources": [{"page": c["page"], "snippet": c["content"][:200]} for c in chunks],
    }
