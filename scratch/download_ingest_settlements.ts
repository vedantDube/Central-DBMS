import fs from "node:fs/promises";
import path from "node:path";
import { spApiRequest, downloadDocument } from "../src/amazon/sp-api.js";
import { ingestFileToTable } from "../src/ingest/runner.js";
import { parseBuffer } from "../src/ingest/parser.js";

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
      if (
        desc &&
        (desc.includes("Removal") ||
          desc.includes("Storage") ||
          desc.includes("Subscription"))
      ) {
        return "amazon_v2_settlement_report_data_flat_file_v2_electronics";
      }
    }
  }

  if (rows.length < 4500) {
    return "amazon_v2_settlement_report_data_flat_file_v2_electronics";
  }

  return "amazon_v2_settlement_report_data_flat_file_v2_cod";
}

async function main() {
  const days = 60;
  const createdSince = new Date(
    Date.now() - 1000 * 60 * 60 * 24 * days,
  ).toISOString();
  console.log(`Searching for settlement reports generated since: ${createdSince}`);

  const reportsPath = `/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2,GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE&createdSince=${encodeURIComponent(createdSince)}`;
  
  const response = await spApiRequest<{
    reports: Array<{
      reportId: string;
      reportType: string;
      createdTime: string;
      reportDocumentId?: string;
    }>;
  }>("GET", reportsPath);

  const reports = response.reports || [];
  console.log(`Found ${reports.length} settlement reports.`);

  const outDir = path.join(process.cwd(), "downloads", "amazon/payment-statements/v2");
  await fs.mkdir(outDir, { recursive: true });

  for (const report of reports) {
    if (!report.reportDocumentId) {
      console.log(`Skipping report ${report.reportId} (no document ID)`);
      continue;
    }

    try {
      console.log(`Downloading report ${report.reportId} (type: ${report.reportType})...`);
      const result = await downloadDocument(report.reportDocumentId, "csv");
      const filePath = path.join(outDir, `${report.reportId}.csv`);
      await fs.writeFile(filePath, result.body);
      console.log(`Saved report to ${filePath}`);

      const activeReportKey = await classifySettlementFile(filePath);
      console.log(`Classified ${report.reportId} as ${activeReportKey}`);

      console.log(`Ingesting ${report.reportId} into Supabase...`);
      const ingestResult = await ingestFileToTable(filePath, activeReportKey);
      console.log(`Ingested ${report.reportId}:`, ingestResult);
    } catch (err) {
      console.error(`Failed to process report ${report.reportId}:`, err);
    }
  }

  console.log("Settlement processing completed successfully!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
