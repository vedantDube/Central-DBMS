import crypto from "node:crypto";

export function normalizeHeader(h: string): string {
  return (
    h
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/__+/g, "_")
      .replace(/^_+|_+$/g, "") || "col"
  );
}

export type BasicType = "integer" | "float" | "boolean" | "date" | "text";

export function inferTypeForValue(v: string): BasicType {
  if (v === null || v === undefined) return "text";
  const s = String(v).trim();
  if (s.length === 0) return "text";
  const lower = s.toLowerCase();
  if (lower === "true" || lower === "false") return "boolean";
  if (/^-?\d+$/.test(s)) return "integer";
  if (/^-?\d+\.\d+$/.test(s)) return "float";
  // date-ish: ISO or common formats
  const d = Date.parse(s);
  if (!Number.isNaN(d) && s.match(/\d{4}-\d{2}-\d{2}/)) return "date";
  return "text";
}

export function mergeTypes(a: BasicType, b: BasicType): BasicType {
  if (a === b) return a;
  const order: BasicType[] = ["integer", "float", "boolean", "date", "text"];
  // prefer numeric widening, otherwise text
  if (a === "integer" && b === "float") return "float";
  if (a === "float" && b === "integer") return "float";
  if (a === "boolean" && (b === "integer" || b === "float")) return "text";
  if (b === "text" || a === "text") return "text";
  return "text";
}

export function sqlTypeFor(t: BasicType): string {
  switch (t) {
    case "integer":
      return "integer";
    case "float":
      return "double precision";
    case "boolean":
      return "boolean";
    case "date":
      return "timestamp with time zone";
    default:
      return "text";
  }
}

export function rowHash(values: string[]): string {
  return crypto.createHash("sha256").update(values.join("|")).digest("hex");
}
