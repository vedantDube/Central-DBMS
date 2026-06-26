import { prisma } from "../src/prisma/client.js";

async function main() {
  console.log("=== Verifying EasyEcom Tables in DATABASE_URL ===");
  try {
    const invCount = await prisma.easyEcomInventory.count();
    const pmCount = await prisma.easyEcomProductMaster.count();
    const poCount = await prisma.easyEcomPurchaseOrder.count();
    const prodCount = await prisma.easyEcomProductionOrder.count();
    const listingCount = await prisma.easyEcomMarketplaceListing.count();

    console.log(`- EasyEcomInventory: ${invCount} records`);
    console.log(`- EasyEcomProductMaster: ${pmCount} records`);
    console.log(`- EasyEcomPurchaseOrder: ${poCount} records`);
    console.log(`- EasyEcomProductionOrder: ${prodCount} records`);
    console.log(`- EasyEcomMarketplaceListing: ${listingCount} records`);

    if (listingCount > 0) {
      console.log("\n--- Sample Marketplace Listing Record ---");
      const sample = await prisma.easyEcomMarketplaceListing.findFirst();
      console.log(JSON.stringify(sample, null, 2));

      console.log("\n--- Listings count by Marketplace ---");
      const grouped = await prisma.easyEcomMarketplaceListing.groupBy({
        by: ['marketplaceName', 'marketplaceId'],
        _count: {
          sku: true
        }
      });
      grouped.forEach((g) => {
        console.log(`  * ${g.marketplaceName} (ID: ${g.marketplaceId}): ${g._count.sku} listings`);
      });
    } else {
      console.log("\n❌ No marketplace listings found in the database.");
    }
  } catch (err) {
    console.error("Verification failed with error:", err);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
