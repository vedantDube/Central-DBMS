import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma client is not configured!");
    return;
  }
  try {
    const withDepositDate = await supabasePrisma.$queryRawUnsafe(
      `SELECT COUNT(*)::text as count FROM "COD_ALL_Settlements" 
       WHERE settlementid = '27316828802' AND depositdate IS NOT NULL AND depositdate <> ''`
    );

    const withTotalAmount = await supabasePrisma.$queryRawUnsafe(
      `SELECT COUNT(*)::text as count FROM "COD_ALL_Settlements" 
       WHERE settlementid = '27316828802' AND totalamount IS NOT NULL AND totalamount <> ''`
    );

    const sampleHeaderRows = await supabasePrisma.$queryRawUnsafe(
      `SELECT * FROM "COD_ALL_Settlements" 
       WHERE settlementid = '27316828802' AND (depositdate <> '' OR totalamount <> '')`
    );

    console.log("Database entries for settlement '27316828802' with deposit date or total amount:");
    console.log(`- Row count with non-empty depositdate: ${withDepositDate[0].count}`);
    console.log(`- Row count with non-empty totalamount: ${withTotalAmount[0].count}`);
    console.log("Sample of those rows:", JSON.stringify(sampleHeaderRows, null, 2));

  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
