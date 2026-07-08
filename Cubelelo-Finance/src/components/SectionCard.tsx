import React, { type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SectionCardProps {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  headerExtra?: ReactNode;
  collapsed: boolean;
  onToggle: (id: string) => void;
  className?: string;
  bodyClassName?: string;
  dark?: boolean;
  children: ReactNode;
}

export default function SectionCard({
  id,
  title,
  subtitle,
  icon,
  badge,
  headerExtra,
  collapsed,
  onToggle,
  className = "",
  bodyClassName = "p-4",
  dark = false,
  children,
}: SectionCardProps) {
  return (
    <div
      className={`relative rounded-2xl shadow-sm border ${
        dark ? "bg-slate-900 border-slate-850" : "bg-white border-slate-200"
      } ${className}`}
    >
      <div
        className={`flex items-center gap-2 px-5 py-4 cursor-pointer select-none ${
          collapsed ? "" : dark ? "border-b border-slate-800" : "border-b border-slate-200/70"
        }`}
        onClick={() => onToggle(id)}
      >
        <button
          type="button"
          className={`transition-colors shrink-0 ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        {icon}
        <div className="flex flex-col min-w-0">
          <span className={`text-xs font-bold uppercase tracking-wider truncate ${dark ? "text-slate-400" : "text-slate-800"}`}>{title}</span>
          {subtitle && <span className={`text-[10px] font-sans font-normal normal-case mt-0.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>{subtitle}</span>}
        </div>
        {badge}
        {headerExtra && (
          <div className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
            {headerExtra}
          </div>
        )}
      </div>
      {!collapsed && <div className={bodyClassName}>{children}</div>}
    </div>
  );
}
