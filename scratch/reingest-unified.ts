import { ingestFileToTable } from "../src/ingest/runner.js";

async function main() {
  console.log("Ingesting April unified transaction...");
  const r1 = await ingestFileToTable("downloads/amazon/payments/transactions/2026-april-unified-transaction.csv", "amazon_unified_transaction");
  console.log("April:", JSON.stringify(r1));

  console.log("Ingesting May unified transaction...");
  const r2 = await ingestFileToTable("downloads/amazon/payments/transactions/2026-may-unified-transaction.csv", "amazon_unified_transaction");
  console.log("May:", JSON.stringify(r2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
