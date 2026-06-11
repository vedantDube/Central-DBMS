import { prisma } from "../prisma/client.js";
import { sqlTypeFor } from "./utils.js";

export async function ensureTable(
  tableName: string,
  columns: { name: string; type: string }[],
) {
  const check = await prisma.$queryRawUnsafe(
    `select to_regclass('public."${tableName}"')::text as reg`,
  );
  const exists =
    Array.isArray(check) && check[0] && (check[0] as any).reg !== null;
  const createCols = columns.map((c) => `"${c.name}" ${c.type}`).join(", ");
  if (!exists) {
    const createColsSql = createCols ? `, ${createCols}` : "";
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${tableName}" (id SERIAL PRIMARY KEY${createColsSql}, created_at timestamptz DEFAULT now())`,
    );
    return;
  }

  for (const c of columns) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${c.name}" ${c.type}`,
    );
  }
}

export async function insertRows(
  tableName: string,
  columns: string[],
  rows: (string | null)[][],
) {
  if (rows.length === 0) return;
  // Build parameterized bulk inserts
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const valuePlaceholders = rows
    .map((r, i) => `(${r.map((_, j) => `$${i * r.length + j + 1}`).join(",")})`)
    .join(",");
  const flat = rows.flat().map((v) => (v === undefined ? null : v));
  const query = `INSERT INTO "${tableName}" (${colList}) VALUES ${valuePlaceholders}`;
  await prisma.$executeRawUnsafe(query, ...flat);
}
