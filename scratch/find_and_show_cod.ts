import { spApiRequest, downloadDocument } from "../src/amazon/sp-api.js";
import { parseBuffer } from "../src/ingest/parser.js";

async function main() {
  console.log("Fetching settlement reports from SP-API to find a COD statement...");
  try {
    const reportListResponse = await spApiRequest<{
      reports: Array<{
        reportId: string;
        reportType: string;
        processingStatus: string;
        reportDocumentId?: string;
        createdTime: string;
      }>;
    }>("GET", "/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2");

    const reports = reportListResponse.reports || [];
    console.log(`Retrieved ${reports.length} reports total.`);

    // Sort by newest first
    reports.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());

    let foundCodReport = null;
    let codTable = null;
    let codResult = null;

    for (const report of reports) {
      if (report.processingStatus !== "DONE" || !report.reportDocumentId) {
        continue;
      }

      console.log(`Checking report ID: ${report.reportId} (Created: ${report.createdTime})...`);
      const result = await downloadDocument(report.reportDocumentId, "csv");
      const parsed = await parseBuffer(result.body, result.fileName);
      if (parsed.length === 0) continue;

      const table = parsed[0];
      const headers = table.headers;
      const rows = table.rows;

      // Check if it has COD characteristics: no Removal/Storage/Subscription and rows >= 4500
      let hasSpecialDescription = false;
      const descIdx = headers.indexOf("amount-description");
      if (descIdx !== -1) {
        for (const r of rows) {
          const desc = r[descIdx];
          if (desc && (desc.includes("Removal") || desc.includes("Storage") || desc.includes("Subscription"))) {
            hasSpecialDescription = true;
            break;
          }
        }
      }

      if (!hasSpecialDescription && rows.length >= 4500) {
        console.log(`Found COD Report! (Rows: ${rows.length})`);
        foundCodReport = report;
        codTable = table;
        codResult = result;
        break;
      } else {
        console.log(`  Not COD (Rows: ${rows.length}, Has Special Keywords: ${hasSpecialDescription})`);
      }
    }

    if (!foundCodReport || !codTable || !codResult) {
      console.log("No reports in the list matched the COD classification criteria.");
      return;
    }

    console.log("\n=== COD REPORT DETAILS ===");
    console.log(`Report ID: ${foundCodReport.reportId}`);
    console.log(`Created Time: ${foundCodReport.createdTime}`);
    console.log(`Document ID: ${foundCodReport.reportDocumentId}`);
    console.log(`Total Rows: ${codTable.rows.length}`);

    const textContent = codResult.body.toString("utf8");
    const lines = textContent.split("\n");

    console.log("\n=== COD RAW DATA PREVIEW (First 20 lines) ===");
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      console.log(`${i + 1}: ${lines[i]}`);
    }

  } catch (err) {
    console.error("❌ Error finding COD report:", err);
  }
}

main();
