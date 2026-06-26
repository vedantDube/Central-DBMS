import { spApiRequest, downloadDocument } from "../src/amazon/sp-api.js";

async function main() {
  console.log("Fetching existing settlement reports from SP-API...");
  try {
    // Query the list of existing GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2 reports
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
    console.log(`Found ${reports.length} reports.`);

    if (reports.length === 0) {
      console.log("No settlement reports found in the retrieved list.");
      return;
    }

    // Sort by createdTime desc to get the newest first
    reports.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());

    const latestReport = reports.find(r => r.processingStatus === "DONE" && r.reportDocumentId);

    if (!latestReport || !latestReport.reportDocumentId) {
      console.log("No completed reports with a valid document ID found.");
      return;
    }

    console.log("\n=== LATEST REPORT DETAILS ===");
    console.log(`Report ID: ${latestReport.reportId}`);
    console.log(`Created Time: ${latestReport.createdTime}`);
    console.log(`Document ID: ${latestReport.reportDocumentId}`);

    console.log("\nDownloading report document...");
    const result = await downloadDocument(latestReport.reportDocumentId, "csv");

    console.log("\n=== DOWNLOAD SUCCESSFUL ===");
    console.log(`Filename: ${result.fileName}`);
    console.log(`Size: ${result.body.length} bytes`);

    const textContent = result.body.toString("utf8");
    const lines = textContent.split("\n");

    console.log("\n=== RAW DATA PREVIEW (First 20 lines) ===");
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      console.log(`${i + 1}: ${lines[i]}`);
    }

  } catch (err) {
    console.error("❌ Error fetching/downloading from SP-API:", err);
  }
}

main();
