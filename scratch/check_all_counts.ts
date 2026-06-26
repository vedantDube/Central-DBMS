import { prisma, supabasePrisma } from "../src/prisma/client.js";

async function main() {
  console.log("=== Row Counts in DATABASE_URL ===");
  const mainTables = [
    'EasyEcomInventory', 'EasyEcomProductMaster', 'EasyEcomProductionOrder',
    'EasyEcomPurchaseOrder', 'ReportArtifact', 'ReturnPrimeReturn',
    'ShiprocketOrder', 'ShopifyInventoryItem', 'ShopifyInventoryLevel',
    'ShopifyOrder', 'ShopifyOrderLineItem', 'ShopifyReturn', 'ShopifyReturnLineItem'
  ];
  for (const table of mainTables) {
    try {
      const res = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::text as count FROM "${table}"`);
      console.log(`- ${table}: ${res[0].count} records`);
    } catch (err) {
      console.log(`- ${table}: Error (${(err as Error).message})`);
    }
  }

  if (supabasePrisma) {
    console.log("\n=== Row Counts in SUPABASE_DB_URL ===");
    const subTables = [
      'AmazonClaimsReimbursementsRow', 'AmazonFlatFileOpenListingsDataRow',
      'AmazonGstMonthlyB2bRow', 'AmazonGstMonthlyB2cRow', 'AmazonGstMonthlyStrRow',
      'AmazonLedgerSummaryRow', 'AmazonMtrRow', 'AmazonReturnsB2bOrderRow',
      'AmazonReturnsB2bRow', 'AmazonReturnsB2cRow', 'AmazonSalesAndTrafficRow',
      'AmazonV2SellerPerformanceRow', 'COD_ALL_Settlements', 'Electronics_all_statements'
    ];
    for (const table of subTables) {
      try {
        const res = await supabasePrisma.$queryRawUnsafe(`SELECT COUNT(*)::text as count FROM "${table}"`);
        console.log(`- ${table}: ${res[0].count} records`);
      } catch (err) {
        console.log(`- ${table}: Error (${(err as Error).message})`);
      }
    }
  }
}

main().finally(async () => {
  await prisma.$disconnect();
  if (supabasePrisma) {
    await supabasePrisma.$disconnect();
  }
});
