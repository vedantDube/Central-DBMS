import fs from "node:fs/promises";
import path from "node:path";
import { spApiRequest, downloadDocument } from "../src/amazon/sp-api.js";
import { parseBuffer } from "../src/ingest/parser.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const sixtyDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString();
  console.log(`Fetching all settlement reports created since: ${sixtyDaysAgo}`);

  const allReports: any[] = [];
  let nextToken: string | undefined = undefined;

  try {
    do {
      const url = nextToken 
        ? `/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`
        : `/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2&createdSince=${sixtyDaysAgo}&pageSize=100`;

      console.log(`Querying page from SP-API...`);
      const response = await spApiRequest<{
        reports: any[];
        nextToken?: string;
      }>("GET", url);

      if (response.reports && response.reports.length > 0) {
        allReports.push(...response.reports);
      }
      nextToken = response.nextToken;
      await sleep(1000);
    } while (nextToken);

    console.log(`Retrieved ${allReports.length} reports in total from the last 60 days.`);

    if (allReports.length === 0) {
      console.log("No reports found.");
      return;
    }

    allReports.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());

    let electronicsHeader: string | null = null;
    const electronicsRows: string[] = [];

    let codHeader: string | null = null;
    const codRows: string[] = [];

    for (const report of allReports) {
      if (report.processingStatus !== "DONE" || !report.reportDocumentId) {
        continue;
      }

      console.log(`Downloading report ${report.reportId} (Created: ${report.createdTime})...`);
      await sleep(2500);

      try {
        const result = await downloadDocument(report.reportDocumentId, "csv");
        
        const fileText = result.body.toString("utf8");
        // Split by newlines only - keep trailing tabs intact
        const lines = fileText.split(/\r?\n/).filter(line => line.length > 0);
        if (lines.length === 0) continue;

        const header = lines[0];
        const dataLines = lines.slice(1);

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
      } catch (innerErr) {
        console.error(`Failed downloading document for report ${report.reportId}:`, innerErr);
        await sleep(5000);
      }
    }

    if (electronicsHeader && electronicsRows.length > 0) {
      const elecContent = [electronicsHeader, ...electronicsRows].join("\n");
      const elecPath = path.join(process.cwd(), "api_electronics_60days.csv");
      await fs.writeFile(elecPath, elecContent, "utf8");
      console.log(`\nSaved ${electronicsRows.length} Electronics rows to: ${elecPath}`);
    }

    if (codHeader && codRows.length > 0) {
      const codContent = [codHeader, ...codRows].join("\n");
      const codPath = path.join(process.cwd(), "api_cod_60days.csv");
      await fs.writeFile(codPath, codContent, "utf8");
      console.log(`Saved ${codRows.length} COD rows to: ${codPath}`);
    }

    console.log("\n=== Complete 60-day historical download completed with pagination! ===");

  } catch (err) {
    console.error("❌ Error during paginated download:", err);
  }
}

main();
