import React, { type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SectionCardProps {
  id: string;
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  headerExtra?: ReactNode;
  collapsed: boolean;
  onToggle: (id: string) => void;
  className?: string;
  children: ReactNode;
}

export default function SectionCard({
  id,
  title,
  icon,
  badge,
  headerExtra,
  collapsed,
  onToggle,
  className = "",
  children,
}: SectionCardProps) {
  return (
    <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm ${className}`}>
      <div
        className={`flex items-center gap-2 px-4 py-3 cursor-pointer select-none ${
          collapsed ? "" : "border-b border-slate-200/70"
        }`}
        onClick={() => onToggle(id)}
      >
        <button
          type="button"
          className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
          aria-label={collapsed ? "Expand section" : "Collapse section"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        {icon}
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">{title}</span>
        {badge}
        {headerExtra && (
          <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
            {headerExtra}
          </div>
        )}
      </div>
      {!collapsed && <div className="p-4">{children}</div>}
    </div>
  );
}
