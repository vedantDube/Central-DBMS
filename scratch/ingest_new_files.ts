import path from "node:path";
import { supabasePrisma } from "../src/prisma/client.js";
import { ingestFileToTable } from "../src/ingest/runner.js";

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

  // Define paths to new files
  const electronicsFile = path.join(process.cwd(), "Electronics_NewData.txt");
  const codFile = path.join(process.cwd(), "COD_newData.txt");

  console.log("\n=== Ingesting New Files ===");

  try {
    console.log(`Ingesting ${electronicsFile} as Electronics Settlement...`);
    const resElec = await ingestFileToTable(
      electronicsFile,
      "amazon_v2_settlement_report_data_flat_file_v2_electronics"
    );
    console.log("Electronics Ingest Results:", resElec);
  } catch (err) {
    console.error(`Failed to ingest Electronics file: ${(err as Error).message}`);
  }

  try {
    console.log(`Ingesting ${codFile} as COD Settlement...`);
    const resCod = await ingestFileToTable(
      codFile,
      "amazon_v2_settlement_report_data_flat_file_v2_cod"
    );
    console.log("COD Ingest Results:", resCod);
  } catch (err) {
    console.error(`Failed to ingest COD file: ${(err as Error).message}`);
  }

  console.log("=== Ingestion Completed! ===");
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
