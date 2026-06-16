import fs from "node:fs/promises";
import path from "node:path";
import { supabasePrisma } from "../src/prisma/client.js";
import { ingestFileToTable } from "../src/ingest/runner.js";
import { parseBuffer } from "../src/ingest/parser.js";

async function classifySettlementFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const parsed = await parseBuffer(buf, path.basename(filePath));
  if (parsed.length === 0) {
    throw new Error(`Could not parse settlement file: ${filePath}`);
  }
  const table = parsed[0];
  const headers = table.headers;
  const rows = table.rows;

  const descIdx = headers.indexOf("amount-description");
  if (descIdx !== -1) {
    for (const r of rows) {
      const desc = r[descIdx];
      if (
        desc &&
        (desc.includes("Removal") ||
          desc.includes("Storage") ||
          desc.includes("Subscription"))
      ) {
        return "amazon_v2_settlement_report_data_flat_file_v2_electronics";
      }
    }
  }

  if (rows.length < 4500) {
    return "amazon_v2_settlement_report_data_flat_file_v2_electronics";
  }

  return "amazon_v2_settlement_report_data_flat_file_v2_cod";
}

async function main() {
  if (!supabasePrisma) {
    console.error("❌ SUPABASE_DB_URL is not configured.");
    process.exit(1);
  }

  console.log("=== Purging Settlement Tables ===");
  
  console.log("Deleting all records from AmazonElectronicsSettlementRow (COD_ALL_Settlements)...");
  const delElec = await supabasePrisma.amazonElectronicsSettlementRow.deleteMany();
  console.log(`Deleted ${delElec.count} records.`);

  console.log("Deleting all records from AmazonCODSettlementRow (Electronics_all_statements)...");
  const delCod = await supabasePrisma.amazonCODSettlementRow.deleteMany();
  console.log(`Deleted ${delCod.count} records.`);

  const folderPath = path.join(process.cwd(), "downloads", "amazon/payment-statements/v2");
  console.log(`Scanning directory: ${folderPath}`);

  let files: string[] = [];
  try {
    const entries = await fs.readdir(folderPath);
    files = entries
      .filter((file) => /\.(csv|tsv|txt)$/i.test(file))
      .map((file) => path.join(folderPath, file));
  } catch (err) {
    console.error(`Error reading settlement folder: ${(err as Error).message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No settlement files found to ingest.");
    return;
  }

  console.log(`Found ${files.length} settlement files to ingest.`);

  for (const file of files) {
    try {
      const activeReportKey = await classifySettlementFile(file);
      console.log(`Classified ${path.basename(file)} as ${activeReportKey}`);
      console.log(`Ingesting ${path.basename(file)} into database...`);
      const res = await ingestFileToTable(file, activeReportKey);
      console.log(`Successfully ingested ${path.basename(file)}:`, res);
    } catch (err) {
      console.error(`Failed to ingest ${path.basename(file)}:`, err);
    }
  }

  console.log("=== Re-push / Ingestion of Settlements Completed! ===");
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    if (supabasePrisma) {
      await supabasePrisma.$disconnect();
    }
  });
