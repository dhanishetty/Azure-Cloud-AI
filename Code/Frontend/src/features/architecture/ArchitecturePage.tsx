import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const flow = [
  { name: "React SPA", detail: "Static Web Apps / nginx" },
  { name: "Backend API", detail: "FastAPI on Container Apps" },
  { name: "Azure AI Search", detail: "Vector + hybrid retrieval" },
  { name: "Azure OpenAI", detail: "Embeddings + chat" },
];

export default function ArchitecturePage() {
  const { data, error } = useQuery({ queryKey: ["info"], queryFn: api.info });
  const rows: [string, string][] = data
    ? [
        ["Chat model", data.chat_model],
        ["Embedding model", `${data.embedding_model} (${data.embedding_dimensions}-dim)`],
        ["Vector store", `${data.vector_store} (index: ${data.search_index})`],
        ["Chunking", `${data.chunk_size} chars, ${data.chunk_overlap} overlap`],
        ["Retrieval", `${data.retrieval_method}, top ${data.top_k}`],
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="glass p-6">
        <h1 className="mb-4 text-xl font-semibold">Request flow</h1>
        <div className="flex flex-wrap items-center gap-3">
          {flow.map((s, i) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.12 }}
              className="flex items-center gap-3"
            >
              <div className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted">{s.detail}</div>
              </div>
              {i < flow.length - 1 && <span className="text-azure">→</span>}
            </motion.div>
          ))}
        </div>
      </div>
      <div className="glass p-6">
        <h2 className="mb-4 text-lg font-semibold">Live configuration</h2>
        {error && <p className="text-bad">Could not load info: {(error as Error).message}</p>}
        <dl className="grid gap-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wider text-muted">{k}</dt>
              <dd className="font-mono text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
