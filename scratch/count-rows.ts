import { prisma, supabasePrisma } from "../src/prisma/client.js";

async function main() {
  console.log("Fetching row counts from the database...");
  try {
    const b2cCount = supabasePrisma ? await supabasePrisma.amazonGstMonthlyB2cRow.count() : 0;
    const shopifyOrderCount = await prisma.shopifyOrder.count();
    const strCount = supabasePrisma ? await supabasePrisma.amazonGstMonthlyStrRow.count() : 0;
    const mtrCount = supabasePrisma ? await supabasePrisma.amazonMtrRow.count() : 0;
    const shopifyLineItemCount = await prisma.shopifyOrderLineItem.count();

    console.log("\nResults:");
    console.log(`AmazonGstMonthlyB2cRow: ${b2cCount} rows`);
    console.log(`ShopifyOrder: ${shopifyOrderCount} rows`);
    console.log(`AmazonGstMonthlyStrRow: ${strCount} rows`);
    console.log(`AmazonMtrRow: ${mtrCount} rows`);
    console.log(`ShopifyOrderLineItem: ${shopifyLineItemCount} rows`);

    console.log("\nCalculating average row size based on screenshot:");
    if (b2cCount > 0) {
      console.log(`Average AmazonGstMonthlyB2cRow: ${(175.98 * 1024 / b2cCount).toFixed(2)} KB / row`);
    }
    if (shopifyOrderCount > 0) {
      console.log(`Average ShopifyOrder: ${(103.45 * 1024 / shopifyOrderCount).toFixed(2)} KB / row`);
    }
    if (strCount > 0) {
      console.log(`Average AmazonGstMonthlyStrRow: ${(25.81 * 1024 / strCount).toFixed(2)} KB / row`);
    }
    if (mtrCount > 0) {
      console.log(`Average AmazonMtrRow: ${(25.48 * 1024 / mtrCount).toFixed(2)} KB / row`);
    }
    if (shopifyLineItemCount > 0) {
      console.log(`Average ShopifyOrderLineItem: ${(19.95 * 1024 / shopifyLineItemCount).toFixed(2)} KB / row`);
    }
  } catch (error) {
    console.error("Error fetching counts:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
