import fs from "node:fs/promises";
import path from "node:path";
import { parseBuffer } from "../src/ingest/parser.js";

async function main() {
  const filePath = path.join(process.cwd(), "api_electronics_60days.csv");
  const buf = await fs.readFile(filePath);
  const parsed = await parseBuffer(buf, path.basename(filePath));

  if (parsed.length === 0) {
    console.log("No table parsed.");
    return;
  }

  const table = parsed[0];
  console.log("--- PARSER HEADERS ---");
  console.log(table.headers);

  console.log("\n--- PARSER FIRST ROW ---");
  console.log(table.rows[0]);

  console.log("\n--- PARSER SECOND ROW ---");
  console.log(table.rows[1]);
}

main();
