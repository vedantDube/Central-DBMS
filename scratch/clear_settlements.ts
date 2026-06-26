import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("Supabase client is not available.");
    return;
  }
  
  console.log("=== Purging Settlement Tables in Supabase ===");
  const delCod = await supabasePrisma.amazonCODSettlementRow.deleteMany();
  console.log(`Deleted all ${delCod.count} records from AmazonCODSettlementRow (now mapped to COD_ALL_Settlements)`);
  
  const delElec = await supabasePrisma.amazonElectronicsSettlementRow.deleteMany();
  console.log(`Deleted all ${delElec.count} records from AmazonElectronicsSettlementRow (now mapped to Electronics_all_statements)`);
}

main().catch(console.error);
