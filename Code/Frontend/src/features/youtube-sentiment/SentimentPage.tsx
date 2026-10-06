import { Video } from "lucide-react";
import ComingSoon from "@/components/ComingSoon";

export default function SentimentPage() {
  return (
    <ComingSoon
      icon={Video}
      title="Live YouTube Sentiment"
      description="Stream live chat or comments from a YouTube video and watch sentiment shift in real time."
      azure={["Event Hubs", "Web PubSub", "Container Apps", "Application Insights"]}
      ai={["Azure AI Language", "Hugging Face sentiment model", "Streaming aggregation"]}
    />
  );
}
