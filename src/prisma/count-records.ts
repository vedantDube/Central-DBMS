import { prisma, supabasePrisma } from "./client.js";

async function main() {
  console.log("=== Database Record Counts ===");
  try {
    const shopifyOrders = await prisma.shopifyOrder.count();
    console.log(`Shopify Orders: ${shopifyOrders}`);

    const shopifyReturns = await prisma.shopifyReturn.count();
    console.log(`Shopify Returns: ${shopifyReturns}`);

    const returnPrimeReturns = await prisma.returnPrimeReturn.count();
    console.log(`ReturnPrime Returns: ${returnPrimeReturns}`);

    const shiprocketOrders = await prisma.shiprocketOrder.count();
    console.log(`Shiprocket Orders: ${shiprocketOrders}`);

    const easyEcomInventory = await prisma.easyEcomInventory.count();
    console.log(`EasyEcom Inventory: ${easyEcomInventory}`);

    const shopifyInventoryItems = await prisma.shopifyInventoryItem.count();
    console.log(`Shopify Inventory Items: ${shopifyInventoryItems}`);

    const shopifyInventoryLevels = await prisma.shopifyInventoryLevel.count();
    console.log(`Shopify Inventory Levels: ${shopifyInventoryLevels}`);

    if (supabasePrisma) {
      const mtrRows = await supabasePrisma.amazonMtrRow.count();
      console.log(`Amazon MTR Rows: ${mtrRows}`);

      const claims = await supabasePrisma.amazonClaimsReimbursementsRow.count();
      console.log(`Amazon Claims & Reimbursements: ${claims}`);

      const returnsB2b = await supabasePrisma.amazonReturnsB2bRow.count();
      console.log(`Amazon B2B Returns: ${returnsB2b}`);

      const returnsB2bOrder = await supabasePrisma.amazonReturnsB2bOrderRow.count();
      console.log(`Amazon B2B Removal Orders: ${returnsB2bOrder}`);

      const returnsB2c = await supabasePrisma.amazonReturnsB2cRow.count();
      console.log(`Amazon B2C Returns: ${returnsB2c}`);

      const salesTraffic = await supabasePrisma.amazonSalesAndTrafficRow.count();
      console.log(`Amazon Sales and Traffic: ${salesTraffic}`);

      const flatListings = await supabasePrisma.amazonFlatFileOpenListingsDataRow.count();
      console.log(`Amazon Flat File Open Listings: ${flatListings}`);

      const ledgerSummary = await supabasePrisma.amazonLedgerSummaryRow.count();
      console.log(`Amazon Ledger Summary: ${ledgerSummary}`);

      const sellerPerformance = await supabasePrisma.amazonV2SellerPerformanceRow.count();
      console.log(`Amazon V2 Seller Performance: ${sellerPerformance}`);

      const gstB2b = await supabasePrisma.amazonGstMonthlyB2bRow.count();
      console.log(`Amazon GST Monthly B2B: ${gstB2b}`);

      const gstB2c = await supabasePrisma.amazonGstMonthlyB2cRow.count();
      console.log(`Amazon GST Monthly B2C: ${gstB2c}`);

      const gstStr = await supabasePrisma.amazonGstMonthlyStrRow.count();
      console.log(`Amazon GST Monthly STR: ${gstStr}`);

      const elecSettlement = await supabasePrisma.amazonElectronicsSettlementRow.count();
      console.log(`Amazon Electronics Settlements: ${elecSettlement}`);

      const codSettlement = await supabasePrisma.amazonCODSettlementRow.count();
      console.log(`Amazon COD Settlements: ${codSettlement}`);
    } else {
      console.log("Supabase DB not configured (SUPABASE_DB_URL missing). Skipping Amazon counts.");
    }
  } catch (error) {
    console.error("Error fetching counts:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
