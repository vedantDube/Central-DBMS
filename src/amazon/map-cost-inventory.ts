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

  // 2. Fetch all EasyEcom Inventory records and build a per-SKU, date-ordered cost history.
  // A SKU can have a different cost recorded on different days (e.g. a new purchase order landing at a
  // different rate) -- previously this loaded a plain sku->cost map with no ordering, so it landed on
  // whichever row Postgres happened to return last for that SKU (arbitrary, not date-matched to the
  // order). Now each GST Master row is matched to whatever cost was in effect ON OR BEFORE its own
  // order date, which is the correct "cost at time of sale" semantics.
  console.log("Fetching EasyEcom Inventory...");
  const inventoryRecords = await prisma.easyEcomInventory.findMany({
    select: {
      sku: true,
      date: true,
      rawJson: true
    },
    orderBy: { date: "asc" }
  });
  console.log(`Loaded ${inventoryRecords.length} inventory records.`);

  const inventoryCostHistory = new Map<string, { date: string; cost: number }[]>(); // key: sku, value: date-ascending cost history
  for (const inv of inventoryRecords) {
    if (inv.sku && inv.rawJson && inv.date) {
      const raw = inv.rawJson as any;
      const cost = raw?.cost !== undefined && raw?.cost !== null ? Number(raw.cost) : null;
      if (cost !== null && !isNaN(cost)) {
        const sku = String(inv.sku).trim();
        if (!inventoryCostHistory.has(sku)) inventoryCostHistory.set(sku, []);
        inventoryCostHistory.get(sku)!.push({ date: inv.date, cost });
      }
    }
  }

  // Binary search for the latest history entry with date <= targetDate; falls back to the earliest
  // known cost if the order predates every recorded snapshot (best available data on record).
  function costAsOf(history: { date: string; cost: number }[], targetDate: string): number | undefined {
    if (history.length === 0) return undefined;
    let lo = 0, hi = history.length - 1, result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (history[mid].date <= targetDate) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result === -1 ? history[0].cost : history[result].cost;
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
        asin: true,
        order_date: true
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
        const history = inventoryCostHistory.get(masterSku);
        const orderDate = (row.order_date || "").slice(0, 10); // YYYY-MM-DD portion
        const cost = history && orderDate ? costAsOf(history, orderDate) : undefined;
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
