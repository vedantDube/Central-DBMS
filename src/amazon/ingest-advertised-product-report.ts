import { config as loadEnv } from "dotenv";
import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { prisma } from "../prisma/client.js";

loadEnv();

// One-off ingestion for Amazon Ads' "Advertised Product" report (Sponsored Products) -- a manually
// exported CSV, not part of the automated SP-API pipeline. Per-SKU-within-campaign granularity, includes
// Detail Page Views / Purchase Rate -- the data needed to complete Ads Performance's per-campaign
// Glance Views / Conversion Rate, which no other ingested source provides.

// Amazon's export wraps some ID columns as an Excel formula guard, e.g. ="422466067749037" (to stop
// Excel from mangling long numeric IDs into scientific notation) -- strip that back to the raw string.
function stripExcelGuard(value: string): string {
  const match = value.match(/^="(.*)"$/);
  return match ? match[1] : value;
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const filePath = getArgValue("--file") || "Advertised_product_-_07_04_2026T15_26_38.csv";
  console.log(`Reading ${filePath}...`);
  const text = readFileSync(filePath, "utf8");
  const rows: string[][] = parse(text, { columns: false, skip_empty_lines: true, relax_column_count: true, bom: true });

  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  const col = {
    dateRange: idx("Date range"),
    campaignId: idx("Campaign ID"),
    campaignName: idx("Campaign name"),
    adGroupId: idx("Ad group ID"),
    adGroupName: idx("Ad group name"),
    productId: idx("Advertised product ID"),
    productName: idx("Advertised product name"),
    sku: idx("Advertised product SKU"),
    impressions: idx("Impressions"),
    clicks: idx("Clicks"),
    ctr: idx("CTR"),
    totalCost: idx("Total cost"),
    purchases: idx("Purchases"),
    sales: idx("Sales"),
    unitsSold: idx("Units sold"),
    purchaseRate: idx("Purchase rate"),
    roas: idx("ROAS"),
    detailPageViews: idx("Detail page views"),
    detailPageViewRate: idx("Detail page view rate"),
  };

  const reportKey = `advertised_product_${Date.now()}`;
  const records = rows.slice(1).map((r) => ({
    reportKey,
    dateRange: r[col.dateRange] || "",
    campaignId: stripExcelGuard(r[col.campaignId] || ""),
    campaignName: r[col.campaignName] || null,
    adGroupId: stripExcelGuard(r[col.adGroupId] || "") || null,
    adGroupName: r[col.adGroupName] || null,
    advertisedProductId: r[col.productId] || null,
    advertisedProductName: r[col.productName] || null,
    advertisedProductSku: r[col.sku] || "",
    impressions: r[col.impressions] || null,
    clicks: r[col.clicks] || null,
    ctr: r[col.ctr] || null,
    totalCost: r[col.totalCost] || null,
    purchases: r[col.purchases] || null,
    sales: r[col.sales] || null,
    unitsSold: r[col.unitsSold] || null,
    purchaseRate: r[col.purchaseRate] || null,
    roas: r[col.roas] || null,
    detailPageViews: r[col.detailPageViews] || null,
    detailPageViewRate: r[col.detailPageViewRate] || null,
  })).filter((r) => r.campaignId && r.advertisedProductSku);

  console.log(`Parsed ${records.length} rows. Upserting...`);

  const chunkSize = 500;
  let upserted = 0;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((r) =>
        prisma.amazonAdvertisedProductRow.upsert({
          where: {
            dateRange_campaignId_advertisedProductSku: {
              dateRange: r.dateRange,
              campaignId: r.campaignId,
              advertisedProductSku: r.advertisedProductSku,
            },
          },
          update: r,
          create: r,
        })
      )
    );
    upserted += chunk.length;
    console.log(`Upserted ${upserted}/${records.length}`);
  }

  console.log(`Finished. Upserted ${upserted} rows.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
