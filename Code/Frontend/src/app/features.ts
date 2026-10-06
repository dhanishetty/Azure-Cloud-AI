import { MessageSquareText, Video, Shapes, Network, type LucideIcon } from "lucide-react";

// Add a feature = add an entry here + a folder under src/features + a route in App.tsx.
export interface Feature {
  path: string;
  label: string;
  icon: LucideIcon;
  ready: boolean;
}

export const features: Feature[] = [
  { path: "/rag", label: "RAG Chat", icon: MessageSquareText, ready: true },
  { path: "/sentiment", label: "YouTube Sentiment", icon: Video, ready: false },
  { path: "/topics", label: "Topic Modeling", icon: Shapes, ready: false },
  { path: "/architecture", label: "Architecture", icon: Network, ready: true },
];
