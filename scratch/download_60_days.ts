import fs from "node:fs/promises";
import path from "node:path";
import { spApiRequest, downloadDocument } from "../src/amazon/sp-api.js";
import { parseBuffer } from "../src/ingest/parser.js";

async function main() {
  const sixtyDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString();
  console.log(`Fetching settlement reports created since: ${sixtyDaysAgo}`);

  try {
    const reportListResponse = await spApiRequest<{
      reports: Array<{
        reportId: string;
        reportType: string;
        processingStatus: string;
        reportDocumentId?: string;
        createdTime: string;
      }>;
    }>("GET", `/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2&createdSince=${sixtyDaysAgo}`);

    const reports = reportListResponse.reports || [];
    console.log(`Found ${reports.length} reports in the last 60 days.`);

    let electronicsHeader: string | null = null;
    const electronicsRows: string[] = [];

    let codHeader: string | null = null;
    const codRows: string[] = [];

    for (const report of reports) {
      if (report.processingStatus !== "DONE" || !report.reportDocumentId) {
        console.log(`Skipping report ${report.reportId} (Status: ${report.processingStatus})`);
        continue;
      }

      console.log(`Downloading report ${report.reportId} (Created: ${report.createdTime})...`);
      const result = await downloadDocument(report.reportDocumentId, "csv");
      
      const fileText = result.body.toString("utf8").trim();
      const lines = fileText.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      const header = lines[0];
      const dataLines = lines.slice(1);

      // Simple classification check based on row counts & keywords
      const parsed = await parseBuffer(result.body, result.fileName);
      if (parsed.length === 0) continue;
      const table = parsed[0];
      const headers = table.headers;
      const rows = table.rows;

      let isElectronics = false;
      const descIdx = headers.indexOf("amount-description");
      if (descIdx !== -1) {
        for (const r of rows) {
          const desc = r[descIdx];
          if (desc && (desc.includes("Removal") || desc.includes("Storage") || desc.includes("Subscription"))) {
            isElectronics = true;
            break;
          }
        }
      }
      if (rows.length < 4500) {
        isElectronics = true;
      }

      if (isElectronics) {
        console.log(`-> Classified as Electronics (${rows.length} rows)`);
        if (!electronicsHeader) {
          electronicsHeader = header;
        }
        electronicsRows.push(...dataLines);
      } else {
        console.log(`-> Classified as COD (${rows.length} rows)`);
        if (!codHeader) {
          codHeader = header;
        }
        codRows.push(...dataLines);
      }
    }

    if (electronicsHeader && electronicsRows.length > 0) {
      const fullElectronicsContent = [electronicsHeader, ...electronicsRows].join("\n");
      const elecPath = path.join(process.cwd(), "api_electronics_60days.csv");
      await fs.writeFile(elecPath, fullElectronicsContent, "utf8");
      console.log(`\nSaved ${electronicsRows.length} Electronics rows to: ${elecPath}`);
    } else {
      console.log("\nNo Electronics data found for the period.");
    }

    if (codHeader && codRows.length > 0) {
      const fullCodContent = [codHeader, ...codRows].join("\n");
      const codPath = path.join(process.cwd(), "api_cod_60days.csv");
      await fs.writeFile(codPath, fullCodContent, "utf8");
      console.log(`Saved ${codRows.length} COD rows to: ${codPath}`);
    } else {
      console.log("\nNo COD data found for the period.");
    }

    console.log("\n=== 60-day historical download complete! ===");

  } catch (err) {
    console.error("❌ Error downloading 60 days of data:", err);
  }
}

main();
