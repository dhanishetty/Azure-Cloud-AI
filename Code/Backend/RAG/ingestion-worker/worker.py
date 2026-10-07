import io
import json
import logging
import os
import re
import signal
import time

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    HnswAlgorithmConfiguration,
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SearchIndex,
    SimpleField,
    VectorSearch,
    VectorSearchProfile,
)
from azure.storage.blob import BlobServiceClient
from azure.storage.queue import QueueClient
from langchain_text_splitters import RecursiveCharacterTextSplitter
from openai import AzureOpenAI
from pypdf import PdfReader

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ingestion-worker")

# The Azure SDK logs every HTTP request at INFO; keep that out of the logs (and out of the bill)
logging.getLogger("azure").setLevel(logging.WARNING)

# Application Insights telemetry. Runs after basicConfig, otherwise the log format and level would be ignored.
# Skipped when the connection string is not set (for example, local runs).
if os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING"):
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor()

STORAGE_ACCOUNT_NAME = os.environ["STORAGE_ACCOUNT_NAME"]
BLOB_CONTAINER = os.environ.get("BLOB_CONTAINER", "documents")
QUEUE_NAME = os.environ.get("QUEUE_NAME", "ingest-jobs")
SEARCH_ENDPOINT = os.environ["SEARCH_ENDPOINT"]
SEARCH_INDEX = os.environ.get("SEARCH_INDEX", "documents-index")
OPENAI_ENDPOINT = os.environ["OPENAI_ENDPOINT"]
OPENAI_API_VERSION = os.environ.get("OPENAI_API_VERSION", "2024-10-21")
EMBED_DEPLOYMENT = os.environ["OPENAI_EMBED_DEPLOYMENT"]
EMBED_DIMENSIONS = int(os.environ.get("EMBED_DIMENSIONS", "1536"))

EMBED_BATCH_SIZE = 16
UPLOAD_BATCH_SIZE = 100
VISIBILITY_TIMEOUT_SECONDS = 600
MAX_ATTEMPTS = 3
IDLE_POLL_SECONDS = 5

# One identity for everything: workload identity on AKS, `az login` locally
credential = DefaultAzureCredential()
container = BlobServiceClient(f"https://{STORAGE_ACCOUNT_NAME}.blob.core.windows.net", credential).get_container_client(BLOB_CONTAINER)
queue = QueueClient(f"https://{STORAGE_ACCOUNT_NAME}.queue.core.windows.net", QUEUE_NAME, credential)
index_client = SearchIndexClient(SEARCH_ENDPOINT, credential)
search = SearchClient(SEARCH_ENDPOINT, SEARCH_INDEX, credential)
openai = AzureOpenAI(
    azure_endpoint=OPENAI_ENDPOINT,
    azure_ad_token_provider=get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default"),
    api_version=OPENAI_API_VERSION,
)
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)

stop_requested = False


def request_stop(signum, frame):
    global stop_requested
    stop_requested = True


def ensure_index() -> None:
    index = SearchIndex(
        name=SEARCH_INDEX,
        fields=[
            SimpleField(name="id", type=SearchFieldDataType.String, key=True),
            SimpleField(name="doc_id", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="page", type=SearchFieldDataType.Int32, filterable=True),
            SearchableField(name="content", type=SearchFieldDataType.String),
            SearchField(
                name="content_vector",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                searchable=True,
                vector_search_dimensions=EMBED_DIMENSIONS,
                vector_search_profile_name="vec-profile",
            ),
        ],
        vector_search=VectorSearch(
            algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
            profiles=[VectorSearchProfile(name="vec-profile", algorithm_configuration_name="hnsw")],
        ),
    )
    index_client.create_or_update_index(index)
    log.info("Search index '%s' is ready", SEARCH_INDEX)


def set_status(blob_name: str, status: str, error: str | None = None) -> None:
    blob = container.get_blob_client(blob_name)
    metadata = dict(blob.get_blob_properties().metadata or {})
    metadata["status"] = status
    if error:
        metadata["error"] = re.sub(r"[^\x20-\x7E]", " ", error)[:200]
    else:
        metadata.pop("error", None)
    blob.set_blob_metadata(metadata)


def extract_chunks(pdf_bytes: bytes) -> list[tuple[int, str]]:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    chunks: list[tuple[int, str]] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            chunks.extend((page_number, piece) for piece in splitter.split_text(text))
    return chunks


def process(doc_id: str, blob_name: str) -> None:
    set_status(blob_name, "processing")
    pdf_bytes = container.get_blob_client(blob_name).download_blob().readall()

    chunks = extract_chunks(pdf_bytes)
    if not chunks:
        raise ValueError("No extractable text found (scanned or image-only PDF?)")

    documents = []
    for start in range(0, len(chunks), EMBED_BATCH_SIZE):
        batch = chunks[start : start + EMBED_BATCH_SIZE]
        response = openai.embeddings.create(model=EMBED_DEPLOYMENT, input=[text for _, text in batch])
        for offset, (page_number, text) in enumerate(batch):
            documents.append(
                {
                    "id": f"{doc_id}-{start + offset}",
                    "doc_id": doc_id,
                    "page": page_number,
                    "content": text,
                    "content_vector": response.data[offset].embedding,
                }
            )

    for start in range(0, len(documents), UPLOAD_BATCH_SIZE):
        search.upload_documents(documents[start : start + UPLOAD_BATCH_SIZE])

    set_status(blob_name, "ready")
    log.info("Indexed %d chunks for document %s", len(documents), doc_id)


def handle_message(message) -> None:
    try:
        payload = json.loads(message.content)
        doc_id, blob_name = payload["doc_id"], payload["blob_name"]
    except (ValueError, KeyError):
        log.error("Dropping malformed message: %r", message.content)
        queue.delete_message(message)
        return

    try:
        process(doc_id, blob_name)
        queue.delete_message(message)
    except Exception as exc:
        log.exception("Attempt %d failed for document %s", message.dequeue_count, doc_id)
        if message.dequeue_count >= MAX_ATTEMPTS:
            try:
                set_status(blob_name, "failed", str(exc))
            finally:
                queue.delete_message(message)


def main() -> None:
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    ensure_index()
    log.info("Waiting for messages on queue '%s'", QUEUE_NAME)

    while not stop_requested:
        messages = list(queue.receive_messages(max_messages=1, visibility_timeout=VISIBILITY_TIMEOUT_SECONDS))
        if not messages:
            time.sleep(IDLE_POLL_SECONDS)
            continue
        handle_message(messages[0])


if __name__ == "__main__":
    main()
