import fs from "node:fs/promises";
import path from "node:path";
import { parse as csvParse } from "csv-parse/sync";

async function main() {
  const filePath = path.join(process.cwd(), "api_electronics_60days.csv");
  const text = await fs.readFile(filePath, "utf8");

  // Parse with columns: false
  const records = csvParse(text, {
    columns: false,
    skip_empty_lines: true,
    delimiter: "\t",
    relax_column_count: true,
    relax_quotes: true,
  });

  console.log("Number of records parsed:", records.length);
  const headers = records[0];
  console.log("Headers:", headers);
  console.log("Row 1 (summary):", records[1]);
  console.log("Row 2 (first transaction):", records[2]);
}

main();
