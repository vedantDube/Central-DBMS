import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadSpApiReport } from "../amazon/sp-api.js";

type ReportRequest = {
  id: string;
  dir: string;
  ext: "csv" | "tsv";
};

const items: ReportRequest[] = [
  { id: "GET_SALES_AND_TRAFFIC_REPORT", dir: "amazon/sales-and-traffic", ext: "csv" },
  {
    id: "GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT",
    dir: "amazon/brand-analytics/search-catalog-performance",
    ext: "csv",
  },
  {
    id: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT",
    dir: "amazon/brand-analytics/search-query-performance",
    ext: "csv",
  },
  { id: "GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT", dir: "amazon/brand-analytics/market-basket", ext: "csv" },
  { id: "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT", dir: "amazon/brand-analytics/search-terms", ext: "csv" },
  { id: "GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT", dir: "amazon/brand-analytics/repeat-purchase", ext: "csv" },
  { id: "GET_FLAT_FILE_OPEN_LISTINGS_DATA", dir: "amazon/listings/open-listings-data", ext: "csv" },
  { id: "GET_LEDGER_SUMMARY_VIEW_DATA", dir: "amazon/ledger", ext: "tsv" },
  { id: "GET_DATE_RANGE_FINANCIAL_HOLDS_DATA", dir: "amazon/payments/financial-holds", ext: "csv" },
  { id: "GET_V2_SELLER_PERFORMANCE_REPORT", dir: "amazon/seller-performance/v2", ext: "csv" },
  { id: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", dir: "amazon/payment-statements/v2", ext: "csv" },
];

async function main() {
  for (const item of items) {
    try {
      const result = await downloadSpApiReport(item.id, item.ext);
      const outDir = path.join(process.cwd(), "downloads", item.dir);
      await mkdir(outDir, { recursive: true });
      const filePath = path.join(outDir, `${Date.now()}.${item.ext}`);
      await writeFile(filePath, result.body);
      console.log(`saved ${item.id} -> ${filePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`failed ${item.id} -> ${message}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});