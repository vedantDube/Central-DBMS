import { useEffect, useRef, useState } from "react";
import { Columns3 } from "lucide-react";

export interface ColumnOption {
  key: string;
  label: string;
}

// Lets a user hide columns on a wide table instead of always showing all of them --
// dense-but-fixed is worse than dense-but-adjustable (the pattern shadcn's own dashboard
// example uses on its widest table). `visible[key] === false` hides a column; anything
// not in the map (or explicitly true) shows.
export default function ColumnPicker({
  columns,
  visible,
  onToggle,
}: {
  columns: ColumnOption[];
  visible: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const hiddenCount = columns.filter((c) => visible[c.key] === false).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <Columns3 size={13} />
        Columns{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-30 w-56 bg-white border border-slate-200 rounded-xl shadow-lg p-2 max-h-72 overflow-y-auto">
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-xs text-slate-700"
            >
              <input
                type="checkbox"
                checked={visible[col.key] !== false}
                onChange={() => onToggle(col.key)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
