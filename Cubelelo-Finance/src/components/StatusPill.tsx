import type { ReactNode } from "react";

type Tone = "success" | "warning" | "danger" | "neutral";

// Quiet icon+text status, not a solid colored pill -- reference dashboards (shadcn/ui, Tremor)
// reserve strong color fills for the one thing that actually needs attention ("danger" here);
// everything else is a small dot + normal-weight text so a table of 100 rows doesn't read as
// 100 alerts. Danger keeps bold/colored text since that's the state worth interrupting for.
const DOT_CLASSES: Record<Tone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-slate-300",
};

const TEXT_CLASSES: Record<Tone, string> = {
  success: "text-slate-700",
  warning: "text-slate-700",
  danger: "text-rose-800 font-semibold",
  neutral: "text-slate-400",
};

export default function StatusPill({ tone, children }: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASSES[tone]}`} />
      <span className={TEXT_CLASSES[tone]}>{children}</span>
    </span>
  );
}
