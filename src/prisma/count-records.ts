import { prisma } from "./client.js";

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

    const mtrRows = await prisma.amazonMtrRow.count();
    console.log(`Amazon MTR Rows: ${mtrRows}`);

    const claims = await prisma.amazonClaimsReimbursementsRow.count();
    console.log(`Amazon Claims & Reimbursements: ${claims}`);

    const returnsB2b = await prisma.amazonReturnsB2bRow.count();
    console.log(`Amazon B2B Returns: ${returnsB2b}`);

    const returnsB2bOrder = await prisma.amazonReturnsB2bOrderRow.count();
    console.log(`Amazon B2B Removal Orders: ${returnsB2bOrder}`);

    const returnsB2c = await prisma.amazonReturnsB2cRow.count();
    console.log(`Amazon B2C Returns: ${returnsB2c}`);

    const salesTraffic = await prisma.amazonSalesAndTrafficRow.count();
    console.log(`Amazon Sales and Traffic: ${salesTraffic}`);

    const flatListings = await prisma.amazonFlatFileOpenListingsDataRow.count();
    console.log(`Amazon Flat File Open Listings: ${flatListings}`);

    const merchantListings = await prisma.amazonMerchantListingsAllRow.count();
    console.log(`Amazon Merchant Listings All: ${merchantListings}`);

    const sellerPerformance = await prisma.amazonV2SellerPerformanceRow.count();
    console.log(`Amazon V2 Seller Performance: ${sellerPerformance}`);
  } catch (error) {
    console.error("Error fetching counts:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
