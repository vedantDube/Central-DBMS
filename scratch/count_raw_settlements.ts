import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma client is not configured!");
    return;
  }
  try {
    const rawCodCount = await supabasePrisma.$queryRawUnsafe(`SELECT COUNT(*)::text as count FROM "COD_ALL_Settlements"`);
    const rawElecCount = await supabasePrisma.$queryRawUnsafe(`SELECT COUNT(*)::text as count FROM "Electronics_all_statements"`);
    
    console.log("Raw SQL Counts:");
    console.log(`"COD_ALL_Settlements" table count:`, rawCodCount);
    console.log(`"Electronics_all_statements" table count:`, rawElecCount);
  } catch (err) {
    console.error("Error executing raw queries:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
