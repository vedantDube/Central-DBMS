import fs from "node:fs/promises";
import path from "node:path";
import { parse as csvParse } from "csv-parse/sync";

async function main() {
  const filePath = path.join(process.cwd(), "api_electronics_60days.csv");
  const text = await fs.readFile(filePath, "utf8");

  // Parse using columns: true with fallback logic
  const records = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    delimiter: "\t",
    relax_column_count: true,
    relax_quotes: true,
  });

  const firstLine = text.split(/\r?\n/)[0] || "";
  const headers = csvParse(firstLine, {
    columns: false,
    delimiter: "\t",
    relax_quotes: true,
  })[0];

  console.log("Full headers length:", headers.length);
  console.log("Full headers:", headers);

  // Map rows using full headers
  const rows = records.map((r: any) =>
    headers.map((h: string) =>
      r[h] !== undefined && r[h] !== null ? String(r[h]) : ""
    )
  );

  console.log("\nRow 1 mapped using full headers (length = " + rows[0].length + "):", rows[0]);
  console.log("\nRow 2 mapped using full headers (length = " + rows[1].length + "):", rows[1]);
}

main();
