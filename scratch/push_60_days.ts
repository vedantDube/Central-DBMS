import path from "node:path";
import { supabasePrisma } from "../src/prisma/client.js";
import { ingestFileToTable } from "../src/ingest/runner.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ SUPABASE_DB_URL is not configured.");
    process.exit(1);
  }

  console.log("=== Purging Existing Settlements in Supabase ===");

  console.log("Deleting all records from AmazonElectronicsSettlementRow (COD_ALL_Settlements)...");
  const delElec = await supabasePrisma.amazonElectronicsSettlementRow.deleteMany();
  console.log(`Deleted ${delElec.count} records.`);

  console.log("Deleting all records from AmazonCODSettlementRow (Electronics_all_statements)...");
  const delCod = await supabasePrisma.amazonCODSettlementRow.deleteMany();
  console.log(`Deleted ${delCod.count} records.`);

  // Define paths to 60-day files
  const electronics60d = path.join(process.cwd(), "api_electronics_60days.csv");
  const cod60d = path.join(process.cwd(), "api_cod_60days.csv");

  console.log("\n=== Ingesting 60-Day Settlement Data ===");

  try {
    console.log(`Ingesting Electronics 60-day data: ${electronics60d}...`);
    const resElec = await ingestFileToTable(
      electronics60d,
      "amazon_v2_settlement_report_data_flat_file_v2_electronics"
    );
    console.log("Electronics Sync Result:", resElec);
  } catch (err) {
    console.error(`Failed to ingest Electronics 60d data: ${(err as Error).message}`);
  }

  try {
    console.log(`Ingesting COD 60-day data: ${cod60d}...`);
    const resCod = await ingestFileToTable(
      cod60d,
      "amazon_v2_settlement_report_data_flat_file_v2_cod"
    );
    console.log("COD Sync Result:", resCod);
  } catch (err) {
    console.error(`Failed to ingest COD 60d data: ${(err as Error).message}`);
  }

  console.log("\n=== 60-Day Settlement Push Complete! ===");
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
