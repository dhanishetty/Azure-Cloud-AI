import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Cloud } from "lucide-react";
import clsx from "clsx";
import { features } from "@/app/features";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Cloud className="text-azure" />
          <span className="gradient-text">AI on Azure</span>
        </div>
        <nav className="glass flex flex-wrap gap-1 p-1">
          {features.map(({ path, label, icon: Icon, ready }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                  isActive ? "bg-azure/20 text-white" : "text-muted hover:text-white",
                )
              }
            >
              <Icon size={16} />
              {label}
              {!ready && <span className="rounded bg-violet/20 px-1.5 text-[10px] text-violet">soon</span>}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
