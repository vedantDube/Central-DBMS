import { ingestFileToTable } from "./runner.js";
import path from "node:path";

async function main() {
  const file = path.join(
    process.cwd(),
    "downloads",
    "amazon",
    "mtr",
    `${new Date().toISOString().slice(0, 10)}.csv`,
  );
  console.log("Attempting to ingest", file);
  const res = await ingestFileToTable(file, "amazon_mtr");
  console.log("Ingest results:", res);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
