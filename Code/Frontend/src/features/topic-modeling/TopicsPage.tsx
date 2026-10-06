import { Shapes } from "lucide-react";
import ComingSoon from "@/components/ComingSoon";

export default function TopicsPage() {
  return (
    <ComingSoon
      icon={Shapes}
      title="Topic Modeling"
      description="Discover themes in a document set or comment stream and explore them interactively."
      azure={["Container Apps Jobs", "Service Bus", "Blob Storage"]}
      ai={["BERTopic", "Azure OpenAI embeddings", "Clustering"]}
    />
  );
}
