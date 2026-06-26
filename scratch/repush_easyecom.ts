import { prisma } from "../src/prisma/client.js";
import { spawn } from "node:child_process";

async function runCommand(command: string, args: string[]): Promise<void> {
  console.log(`Executing: ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log("=== Purging EasyEcom Tables ===");

  console.log("Deleting all records from EasyEcomInventory...");
  const delInv = await prisma.easyEcomInventory.deleteMany();
  console.log(`Deleted ${delInv.count} records.`);

  console.log("Deleting all records from EasyEcomProductMaster...");
  const delProd = await prisma.easyEcomProductMaster.deleteMany();
  console.log(`Deleted ${delProd.count} records.`);

  console.log("Deleting all records from EasyEcomPurchaseOrder...");
  const delPo = await prisma.easyEcomPurchaseOrder.deleteMany();
  console.log(`Deleted ${delPo.count} records.`);

  console.log("Deleting all records from EasyEcomProductionOrder...");
  const delProdOrder = await prisma.easyEcomProductionOrder.deleteMany();
  console.log(`Deleted ${delProdOrder.count} records.`);

  console.log("Deleting all records from EasyEcomMarketplaceListing...");
  const delListing = await prisma.easyEcomMarketplaceListing.deleteMany();
  console.log(`Deleted ${delListing.count} records.`);

  console.log("\n=== Fetching and pushing fresh data ===");

  console.log("1. Ingesting Product Master...");
  await runCommand("npx", ["tsx", "src/easyecom/fetch-product-master.ts"]);

  console.log("\n2. Ingesting Purchase Orders...");
  await runCommand("npx", ["tsx", "src/easyecom/fetch-purchase-orders.ts"]);

  console.log("\n3. Ingesting Production Orders (last 60 days)...");
  await runCommand("npx", ["tsx", "src/easyecom/fetch-production-orders.ts"]);

  console.log("\n4. Ingesting Inventory...");
  await runCommand("npx", ["tsx", "src/easyecom/fetch-inventory.ts", "--snapshot", "Opening"]);

  console.log("\n5. Ingesting Marketplace Listings...");
  await runCommand("npx", ["tsx", "src/easyecom/fetch-marketplace-listings.ts"]);

  console.log("\n=== EasyEcom Fresh Ingestion Completed successfully! ===");
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
