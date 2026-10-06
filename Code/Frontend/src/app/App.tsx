import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "@/app/Layout";

const RagChat = lazy(() => import("@/features/rag-chat/RagChatPage"));
const Sentiment = lazy(() => import("@/features/youtube-sentiment/SentimentPage"));
const Topics = lazy(() => import("@/features/topic-modeling/TopicsPage"));
const Architecture = lazy(() => import("@/features/architecture/ArchitecturePage"));

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Routes>
          <Route path="/" element={<Navigate to="/rag" replace />} />
          <Route path="/rag" element={<RagChat />} />
          <Route path="/sentiment" element={<Sentiment />} />
          <Route path="/topics" element={<Topics />} />
          <Route path="/architecture" element={<Architecture />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
