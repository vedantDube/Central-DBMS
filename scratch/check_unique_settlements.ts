import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma client is not configured!");
    return;
  }
  try {
    const uniqueElecSettlements = await supabasePrisma.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT settlementid)::text as count FROM "COD_ALL_Settlements"`
    );
    const uniqueCodSettlements = await supabasePrisma.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT settlementid)::text as count FROM "Electronics_all_statements"`
    );
    
    console.log("Unique settlementid counts in Supabase:");
    console.log("Unique settlements in COD_ALL_Settlements (electronics model):", uniqueElecSettlements);
    console.log("Unique settlements in Electronics_all_statements (cod model):", uniqueCodSettlements);
    
    // Let's also see what the actual unique settlement IDs are
    const elecList = await supabasePrisma.$queryRawUnsafe(
      `SELECT DISTINCT settlementid, depositdate, currency FROM "COD_ALL_Settlements" ORDER BY depositdate DESC LIMIT 20`
    );
    const codList = await supabasePrisma.$queryRawUnsafe(
      `SELECT DISTINCT settlementid, depositdate, currency FROM "Electronics_all_statements" ORDER BY depositdate DESC LIMIT 20`
    );
    
    console.log("\nSample Electronics settlements in COD_ALL_Settlements table:");
    console.log(elecList);
    
    console.log("\nSample COD settlements in Electronics_all_statements table:");
    console.log(codList);
    
  } catch (err) {
    console.error("Error executing unique settlement query:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
