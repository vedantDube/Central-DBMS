import fs from "node:fs/promises";
import path from "node:path";
import { ingestFileToTable } from "./runner.js";

type ReportFolder = {
  folder: string;
  reportKey: string;
};

const reportFolders: ReportFolder[] = [
  { folder: "amazon/mtr", reportKey: "amazon_mtr" },
  {
    folder: "amazon/claims-reimbursements",
    reportKey: "amazon_claims_reimbursements",
  },
  { folder: "amazon/fba/removal-shipment-detail", reportKey: "amazon_fba_removal_shipment_detail" },
  { folder: "amazon/fba/customer-returns", reportKey: "amazon_fba_customer_returns" },
  { folder: "amazon/fba/removal-order-detail", reportKey: "amazon_fba_removal_order_detail" },
  { folder: "amazon/sales-and-traffic", reportKey: "amazon_sales_and_traffic" },
  {
    folder: "amazon/listings/open-listings-data",
    reportKey: "amazon_flat_file_open_listings_data",
  },
  {
    folder: "amazon/listings/merchant-listings-all",
    reportKey: "amazon_merchant_listings_all",
  },
  {
    folder: "amazon/seller-performance/v2",
    reportKey: "amazon_v2_seller_performance",
  },
];

async function listReportFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listReportFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && /\.(csv|tsv)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function ingestDownloadedReports() {
  const downloadsRoot = path.join(process.cwd(), "downloads");

  for (const { folder, reportKey } of reportFolders) {
    const folderPath = path.join(downloadsRoot, folder);
    try {
      await fs.access(folderPath);
    } catch {
      console.log(`Skipping missing folder ${folder}`);
      continue;
    }

    const files = await listReportFiles(folderPath);
    if (files.length === 0) {
      console.log(`No files found in ${folder}`);
      continue;
    }

    for (const file of files) {
      try {
        console.log(`Ingesting ${path.relative(process.cwd(), file)} ...`);
        const result = await ingestFileToTable(file, reportKey);
        console.log(
          `Ingested ${path.relative(process.cwd(), file)} ->`,
          result,
        );
      } catch (error) {
        console.error(
          `Failed to ingest ${path.relative(process.cwd(), file)}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}

async function main() {
  await ingestDownloadedReports();
}

if (process.argv[1]?.includes("ingest-downloaded-reports")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
