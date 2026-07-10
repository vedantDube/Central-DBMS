import type { ReactNode } from "react";

type Tone = "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  warning: "bg-amber-100 text-amber-800 border border-amber-200",
  danger: "bg-rose-100 text-rose-800 border border-rose-200",
};

// Shared 3-tier status badge (success/warning/danger) used across the profitability, SKU,
// and reconciliation tables -- previously each table re-declared its own emerald/amber/rose
// className string inline, which is how the invalid shade typos (e.g. rose-805) spread.
export default function StatusPill({ tone, children, rounded = "full" }: {
  tone: Tone;
  children: ReactNode;
  rounded?: "full" | "md";
}) {
  return (
    <span
      className={`text-[11px] px-2 py-0.5 font-bold inline-block ${rounded === "full" ? "rounded-full" : "rounded"} ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
