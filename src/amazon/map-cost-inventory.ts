import { prisma, supabasePrisma } from "../prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("supabasePrisma client is not initialized. Please ensure SUPABASE_DB_URL is set.");
    return;
  }

  console.log("=== Beginning Parallel Cost Mapping Process ===");

  // 1. Fetch all Marketplace Listings and cache them in memory
  console.log("Fetching EasyEcom Marketplace Listings...");
  const listings = await prisma.easyEcomMarketplaceListing.findMany({
    select: {
      sku: true,
      identifier: true,
      site_uid: true,
      MasterSKU: true
    }
  });
  console.log(`Loaded ${listings.length} marketplace listings.`);

  const listingsMap = new Map<string, string>(); // key: sku_asin, value: MasterSKU
  for (const list of listings) {
    if (list.sku && list.MasterSKU) {
      const skuKey = String(list.sku).trim().toLowerCase();
      
      // Match against site_uid (holds Amazon ASINs)
      if (list.site_uid) {
        const key = `${skuKey}_${String(list.site_uid).trim().toLowerCase()}`;
        listingsMap.set(key, String(list.MasterSKU).trim());
      }
      
      // Fallback match against identifier
      if (list.identifier) {
        const key = `${skuKey}_${String(list.identifier).trim().toLowerCase()}`;
        listingsMap.set(key, String(list.MasterSKU).trim());
      }
    }
  }

  // 2. Fetch all EasyEcom Inventory records and cache costs in memory
  console.log("Fetching EasyEcom Inventory...");
  const inventoryRecords = await prisma.easyEcomInventory.findMany({
    select: {
      sku: true,
      rawJson: true
    }
  });
  console.log(`Loaded ${inventoryRecords.length} inventory records.`);

  const inventoryCostMap = new Map<string, number>(); // key: sku, value: cost
  for (const inv of inventoryRecords) {
    if (inv.sku && inv.rawJson) {
      const raw = inv.rawJson as any;
      const cost = raw?.cost !== undefined && raw?.cost !== null ? Number(raw.cost) : null;
      if (cost !== null && !isNaN(cost)) {
        inventoryCostMap.set(String(inv.sku).trim(), cost);
      }
    }
  }

  // 3. Count Amazon GST Master rows
  const gstTotalCount = await supabasePrisma.amazonGstMasterRow.count();
  console.log(`Total rows in Amazon_GST_Master: ${gstTotalCount}`);

  if (gstTotalCount === 0) {
    console.log("No rows to update.");
    return;
  }

  // 4. Paginate and update Amazon GST Master rows
  const queryBatchSize = 2000;
  const writeConcurrencyLimit = 10; // pool size safety limit
  let offset = 0;
  let matchedCount = 0;
  let updatedCount = 0;

  console.log("Processing and updating rows in parallel...");

  while (offset < gstTotalCount) {
    const rows = await supabasePrisma.amazonGstMasterRow.findMany({
      skip: offset,
      take: queryBatchSize,
      select: {
        id: true,
        sku: true,
        asin: true
      }
    });

    if (rows.length === 0) break;

    // Build updates list for this query batch
    const updates = [];
    for (const row of rows) {
      if (!row.sku || !row.asin) continue;

      const lookupKey = `${String(row.sku).trim().toLowerCase()}_${String(row.asin).trim().toLowerCase()}`;
      const masterSku = listingsMap.get(lookupKey);

      if (masterSku) {
        const cost = inventoryCostMap.get(masterSku);
        if (cost !== undefined) {
          matchedCount++;
          updates.push({
            id: row.id,
            cost
          });
        }
      }
    }

    // Execute updates in parallel chunks
    if (updates.length > 0) {
      for (let i = 0; i < updates.length; i += writeConcurrencyLimit) {
        const chunk = updates.slice(i, i + writeConcurrencyLimit);
        await Promise.all(
          chunk.map(up =>
            supabasePrisma!.amazonGstMasterRow.update({
              where: { id: up.id },
              data: { cost_inventory: up.cost }
            })
          )
        );
      }
      updatedCount += updates.length;
    }

    offset += queryBatchSize;
    console.log(`Processed ${Math.min(offset, gstTotalCount)} / ${gstTotalCount} rows... (Updated: ${updatedCount})`);
  }

  console.log("\n=== Cost Mapping Complete ===");
  console.log(`Total GST Master Rows: ${gstTotalCount}`);
  console.log(`Matching Listings found: ${matchedCount}`);
  console.log(`Successfully Updated Rows: ${updatedCount}`);
}

main()
  .catch(err => {
    console.error("Fatal mapping error:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (supabasePrisma) {
      await supabasePrisma.$disconnect();
    }
  });
