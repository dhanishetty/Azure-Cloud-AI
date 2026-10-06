import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  azure: string[];
  ai: string[];
}

export default function ComingSoon({ icon: Icon, title, description, azure, ai }: Props) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass p-8">
      <Icon className="mb-4 text-violet" size={36} />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-2xl text-muted">{description}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Tags heading="Azure services" items={azure} color="text-azure" />
        <Tags heading="AI techniques" items={ai} color="text-violet" />
      </div>
    </motion.div>
  );
}

function Tags({ heading, items, color }: { heading: string; items: string[]; color: string }) {
  return (
    <div>
      <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wider ${color}`}>{heading}</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <span key={i} className="rounded-full border border-border px-3 py-1 text-sm text-muted">{i}</span>
        ))}
      </div>
    </div>
  );
}
