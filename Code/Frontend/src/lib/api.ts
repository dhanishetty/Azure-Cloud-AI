// All backend calls go through /api. nginx (prod) and the Vite proxy (dev) strip the prefix.
const API = "/api";

export type DocStatus = "queued" | "processing" | "ready" | "failed";

export interface DocumentItem {
  doc_id: string;
  filename: string;
  status: DocStatus;
}

export interface DocumentStatus extends DocumentItem {
  error?: string;
}

export interface AppInfo {
  chat_model: string;
  embedding_model: string;
  embedding_dimensions: number;
  vector_store: string;
  search_index: string;
  chunk_size: number;
  chunk_overlap: number;
  retrieval_method: string;
  top_k: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  info: () => request<AppInfo>("/info"),
  listDocuments: () => request<{ documents: DocumentItem[] }>("/documents"),
  documentStatus: (id: string) => request<DocumentStatus>(`/documents/${id}/status`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<DocumentItem>("/documents", { method: "POST", body: form });
  },
  deleteDocument: (id: string) => request<unknown>(`/documents/${id}`, { method: "DELETE" }),
  ask: (doc_id: string, question: string) =>
    request<{ answer: string }>("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id, question }),
    }),
};
