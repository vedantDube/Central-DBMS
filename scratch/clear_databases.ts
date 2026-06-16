import { prisma, supabasePrisma } from "../src/prisma/client.js";

async function main() {
  console.log("=== Purging Default Database (DATABASE_URL) ===");
  try {
    // Delete in dependency order to prevent foreign key errors
    console.log("Deleting ShopifyInventoryLevel records...");
    await prisma.shopifyInventoryLevel.deleteMany();
    console.log("Deleting ShopifyInventoryItem records...");
    await prisma.shopifyInventoryItem.deleteMany();
    console.log("Deleting ShopifyReturnLineItem records...");
    await prisma.shopifyReturnLineItem.deleteMany();
    console.log("Deleting ShopifyReturn records...");
    await prisma.shopifyReturn.deleteMany();
    console.log("Deleting ShopifyOrderLineItem records...");
    await prisma.shopifyOrderLineItem.deleteMany();
    console.log("Deleting ShopifyOrder records...");
    await prisma.shopifyOrder.deleteMany();
    console.log("Deleting EasyEcomInventory records...");
    await prisma.easyEcomInventory.deleteMany();
    console.log("Deleting ShiprocketOrder records...");
    await prisma.shiprocketOrder.deleteMany();
    console.log("Deleting ReturnPrimeReturn records...");
    await prisma.returnPrimeReturn.deleteMany();
    console.log("Deleting ReportArtifact records...");
    await prisma.reportArtifact.deleteMany();
    console.log("✅ Default database purged successfully.");
  } catch (error) {
    console.error("❌ Failed to purge default database:", error);
  }

  if (supabasePrisma) {
    console.log("\n=== Purging Amazon Database (SUPABASE_DB_URL) ===");
    try {
      console.log("Deleting AmazonMtrRow records...");
      await supabasePrisma.amazonMtrRow.deleteMany();
      console.log("Deleting AmazonClaimsReimbursementsRow records...");
      await supabasePrisma.amazonClaimsReimbursementsRow.deleteMany();
      console.log("Deleting AmazonReturnsB2bRow records...");
      await supabasePrisma.amazonReturnsB2bRow.deleteMany();
      console.log("Deleting AmazonReturnsB2cRow records...");
      await supabasePrisma.amazonReturnsB2cRow.deleteMany();
      console.log("Deleting AmazonReturnsB2bOrderRow records...");
      await supabasePrisma.amazonReturnsB2bOrderRow.deleteMany();
      console.log("Deleting AmazonSalesAndTrafficRow records...");
      await supabasePrisma.amazonSalesAndTrafficRow.deleteMany();
      console.log("Deleting AmazonFlatFileOpenListingsDataRow records...");
      await supabasePrisma.amazonFlatFileOpenListingsDataRow.deleteMany();
      console.log("Deleting AmazonLedgerSummaryRow records...");
      await supabasePrisma.amazonLedgerSummaryRow.deleteMany();
      console.log("Deleting AmazonV2SellerPerformanceRow records...");
      await supabasePrisma.amazonV2SellerPerformanceRow.deleteMany();
      console.log("Deleting AmazonGstMonthlyB2bRow records...");
      await supabasePrisma.amazonGstMonthlyB2bRow.deleteMany();
      console.log("Deleting AmazonGstMonthlyB2cRow records...");
      await supabasePrisma.amazonGstMonthlyB2cRow.deleteMany();
      console.log("Deleting AmazonGstMonthlyStrRow records...");
      await supabasePrisma.amazonGstMonthlyStrRow.deleteMany();
      console.log("Deleting AmazonElectronicsSettlementRow records...");
      await supabasePrisma.amazonElectronicsSettlementRow.deleteMany();
      console.log("Deleting AmazonCODSettlementRow records...");
      await supabasePrisma.amazonCODSettlementRow.deleteMany();
      console.log("✅ Amazon database purged successfully.");
    } catch (error) {
      console.error("❌ Failed to purge Amazon database:", error);
    }
  }

  await prisma.$disconnect();
  if (supabasePrisma) {
    await supabasePrisma.$disconnect();
  }
}

main();
