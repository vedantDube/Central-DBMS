import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma client is not configured!");
    return;
  }
  try {
    // Query for COD_ALL_Settlements (mapped to AmazonElectronicsSettlementRow)
    const electronicsStats = await supabasePrisma.$queryRawUnsafe(`
      SELECT 
        settlementid,
        MIN(settlementstartdate) as start_date,
        MAX(settlementenddate) as end_date,
        MIN(depositdate) as deposit_date,
        COUNT(*)::text as row_count,
        currency,
        SUM(CASE WHEN amount IS NOT NULL AND amount <> '' THEN amount::double precision ELSE 0 END) as total_amount_sum
      FROM "COD_ALL_Settlements"
      GROUP BY settlementid, currency
      ORDER BY deposit_date DESC
    `);

    // Query for Electronics_all_statements (mapped to AmazonCODSettlementRow)
    const codStats = await supabasePrisma.$queryRawUnsafe(`
      SELECT 
        settlementid,
        MIN(settlementstartdate) as start_date,
        MAX(settlementenddate) as end_date,
        MIN(depositdate) as deposit_date,
        COUNT(*)::text as row_count,
        currency,
        SUM(CASE WHEN amount IS NOT NULL AND amount <> '' THEN amount::double precision ELSE 0 END) as total_amount_sum
      FROM "Electronics_all_statements"
      GROUP BY settlementid, currency
      ORDER BY deposit_date DESC
    `);

    console.log("=== DATA IN COD_ALL_Settlements (Electronics Model) ===");
    console.log(JSON.stringify(electronicsStats, null, 2));

    console.log("\n=== DATA IN Electronics_all_statements (COD Model) ===");
    console.log(JSON.stringify(codStats, null, 2));

  } catch (err) {
    console.error("Error running query:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
