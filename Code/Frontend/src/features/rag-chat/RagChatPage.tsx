import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import Markdown from "react-markdown";
import clsx from "clsx";
import { FileText, Loader2, Send, Trash2, UploadCloud, CheckCircle2, AlertCircle } from "lucide-react";
import { api, type DocumentItem } from "@/lib/api";

const STORAGE_KEY = "rag-qa-doc-id";

interface Message {
  role: "user" | "assistant" | "error";
  text: string;
}

function loadSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveDocId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export default function RagChatPage() {
  const [docId, setDocId] = useState<string | null>(loadSaved);

  const select = (id: string | null) => {
    setDocId(id);
    saveDocId(id);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <DocumentsPanel docId={docId} onSelect={select} />
      <ChatPanel docId={docId} />
    </div>
  );
}

function DocumentsPanel({ docId, onSelect }: { docId: string | null; onSelect: (id: string | null) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll while any document is still being processed.
  const { data } = useQuery({
    queryKey: ["documents"],
    queryFn: api.listDocuments,
    refetchInterval: (q) =>
      q.state.data?.documents.some((d) => d.status === "queued" || d.status === "processing") ? 3000 : 15000,
  });
  const documents = data?.documents ?? [];

  // Drop a saved selection that no longer exists on the server.
  useEffect(() => {
    if (data && docId && !documents.some((d) => d.doc_id === docId)) onSelect(null);
  }, [data, docId, documents, onSelect]);

  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: (doc) => {
      onSelect(doc.doc_id);
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteDocument,
    onSuccess: (_r, id) => {
      if (id === docId) onSelect(null);
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  return (
    <section className="glass p-5">
      <h2 className="mb-4 text-lg font-semibold">Documents</h2>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={upload.isPending}
        className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-azure/40 bg-azure/5 px-4 py-6 text-sm text-muted transition hover:border-azure hover:text-white disabled:opacity-60"
      >
        {upload.isPending ? <Loader2 className="animate-spin text-azure" /> : <UploadCloud className="text-azure" />}
        {upload.isPending ? "Uploading…" : "Upload a PDF"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
      {upload.error && <p className="mt-2 text-sm text-bad">{(upload.error as Error).message}</p>}
      {remove.error && <p className="mt-2 text-sm text-bad">{(remove.error as Error).message}</p>}

      <ul className="mt-4 space-y-2">
        {documents.length === 0 && <li className="text-sm text-muted">No documents uploaded yet.</li>}
        {documents.map((d) => (
          <DocRow
            key={d.doc_id}
            doc={d}
            selected={d.doc_id === docId}
            onSelect={() => onSelect(d.doc_id)}
            onDelete={() => {
              if (confirm(`Delete "${d.filename}"? This removes it from storage and the search index.`)) {
                remove.mutate(d.doc_id);
              }
            }}
          />
        ))}
      </ul>
    </section>
  );
}

const statusStyle: Record<DocumentItem["status"], string> = {
  queued: "text-warn",
  processing: "text-warn",
  ready: "text-ok",
  failed: "text-bad",
};

function DocRow({ doc, selected, onSelect, onDelete }: { doc: DocumentItem; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  const ready = doc.status === "ready";
  const busy = doc.status === "queued" || doc.status === "processing";
  return (
    <li
      className={clsx(
        "flex items-center gap-3 rounded-xl border px-3 py-2 transition",
        selected ? "border-azure bg-azure/10" : "border-border bg-surface/50",
      )}
    >
      <button type="button" disabled={!ready} onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
        <FileText size={16} className="shrink-0 text-muted" />
        <span className="min-w-0">
          <span className="block truncate text-sm">{doc.filename || doc.doc_id}</span>
          <span className={clsx("flex items-center gap-1 text-xs capitalize", statusStyle[doc.status])}>
            {busy && <Loader2 size={11} className="animate-spin" />}
            {doc.status}
          </span>
        </span>
      </button>
      <button type="button" onClick={onDelete} aria-label="Delete document" className="text-muted transition hover:text-bad">
        <Trash2 size={16} />
      </button>
    </li>
  );
}

function ChatPanel({ docId }: { docId: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // A new document starts a fresh conversation.
  useEffect(() => {
    setMessages([]);
  }, [docId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ask = useMutation({
    mutationFn: ({ id, q }: { id: string; q: string }) => api.ask(id, q),
    onSuccess: (r) => setMessages((m) => [...m, { role: "assistant", text: r.answer }]),
    onError: (e: Error) => setMessages((m) => [...m, { role: "error", text: e.message }]),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || !docId || ask.isPending) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    ask.mutate({ id: docId, q });
  };

  return (
    <section className="glass flex min-h-[28rem] flex-col p-5">
      <h2 className="mb-4 text-lg font-semibold">Ask your document</h2>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-sm text-muted">{docId ? "Ask something about the selected document." : "Upload or select a ready PDF to start."}</p>
        )}
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={clsx(
                "max-w-[85%] rounded-2xl px-4 py-2 text-sm",
                m.role === "user" && "ml-auto bg-azure/20",
                m.role === "assistant" && "prose-chat border border-border bg-surface",
                m.role === "error" && "flex gap-2 border border-bad/40 bg-bad/10 text-bad",
              )}
            >
              {m.role === "error" && <AlertCircle size={16} className="mt-0.5 shrink-0" />}
              {m.role === "assistant" ? <Markdown>{m.text}</Markdown> : m.text}
            </motion.div>
          ))}
        </AnimatePresence>
        {ask.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={1000}
          disabled={!docId}
          placeholder={docId ? "Ask something about the document" : "Select a document first"}
          className="flex-1 rounded-xl border border-border bg-surface px-4 py-2 text-sm outline-none transition focus:border-azure disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!docId || ask.isPending || !question.trim()}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-azure to-violet px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          <Send size={14} /> Ask
        </button>
      </form>
      {docId && (
        <p className="mt-2 flex items-center gap-1 text-xs text-ok">
          <CheckCircle2 size={12} /> Document selected
        </p>
      )}
    </section>
  );
}
