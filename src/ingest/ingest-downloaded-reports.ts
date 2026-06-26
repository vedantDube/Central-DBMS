import fs from "node:fs/promises";
import path from "node:path";
import { ingestFileToTable } from "./runner.js";
import { syncGstMaster } from "./sync-master.js";
import { reconcilePayments } from "./reconcile.js";
import { parseBuffer } from "./parser.js";

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
    folder: "amazon/ledger",
    reportKey: "amazon_ledger_summary",
  },
  {
    folder: "amazon/seller-performance/v2",
    reportKey: "amazon_v2_seller_performance",
  },
  {
    folder: "amazon/tax/monthly-b2b",
    reportKey: "amazon_gst_monthly_b2b",
  },
  {
    folder: "amazon/tax/monthly-b2c",
    reportKey: "amazon_gst_monthly_b2c",
  },
  {
    folder: "amazon/tax/monthly-str",
    reportKey: "amazon_gst_monthly_str",
  },
  {
    folder: "amazon/payments/transactions",
    reportKey: "amazon_unified_transaction",
  },
  {
    folder: "amazon/payment-statements/v2",
    reportKey: "amazon_v2_settlement_report_data_flat_file_v2",
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

    if (entry.isFile() && /\.(csv|tsv|txt)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function classifySettlementFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const parsed = await parseBuffer(buf, path.basename(filePath));
  if (parsed.length === 0) {
    throw new Error(`Could not parse settlement file: ${filePath}`);
  }
  const table = parsed[0];
  const headers = table.headers;
  const rows = table.rows;

  const descIdx = headers.indexOf("amount-description");
  if (descIdx !== -1) {
    for (const r of rows) {
      const desc = r[descIdx];
      if (desc && (desc.includes("Removal") || desc.includes("Storage") || desc.includes("Subscription"))) {
        return "amazon_v2_settlement_report_data_flat_file_v2_electronics";
      }
    }
  }

  if (rows.length < 4500) {
    return "amazon_v2_settlement_report_data_flat_file_v2_electronics";
  }

  return "amazon_v2_settlement_report_data_flat_file_v2_cod";
}

export async function ingestDownloadedReports(targetReportKey?: string) {
  const downloadsRoot = path.join(process.cwd(), "downloads");

  const filteredFolders = targetReportKey
    ? reportFolders.filter((rf) => rf.reportKey === targetReportKey)
    : reportFolders;

  for (const { folder, reportKey } of filteredFolders) {
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
        let activeReportKey = reportKey;
        if (reportKey === "amazon_v2_settlement_report_data_flat_file_v2") {
          activeReportKey = await classifySettlementFile(file);
          console.log(`Classified ${path.basename(file)} as ${activeReportKey}`);
        }

        console.log(`Ingesting ${path.relative(process.cwd(), file)} ...`);
        const result = await ingestFileToTable(file, activeReportKey);
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
  
  // Update the master GST table after all reports are ingested
  await syncGstMaster();

  // Reconcile unified transaction payments against GST master
  await reconcilePayments();
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
