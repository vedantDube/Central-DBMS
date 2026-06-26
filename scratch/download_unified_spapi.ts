import { spApiRequest, downloadDocument } from "../src/amazon/sp-api.js";
import { env } from "../src/config.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  console.log("====================================================");
  console.log("Downloading May 2026 Unified Transactions via SP-API");
  console.log("====================================================\n");

  const reportType = "GET_DATE_RANGE_FINANCIAL_TRANSACTION_DATA";
  
  // May 1, 2026 to May 31, 2026 UTC
  const startTime = "2026-05-01T00:00:00Z";
  const endTime = "2026-05-31T23:59:59Z";

  try {
    console.log(`Requesting report type: ${reportType}`);
    console.log(`Date Range: ${startTime} to ${endTime}`);
    console.log(`Marketplace ID: ${env.MARKETPLACE_ID}`);

    const createResponse = await spApiRequest<{ reportId: string }>(
      "POST",
      "/reports/2021-06-30/reports",
      {
        reportType,
        marketplaceIds: [env.MARKETPLACE_ID],
        dataStartTime: startTime,
        dataEndTime: endTime,
      }
    );

    const reportId = createResponse.reportId;
    console.log(`Report requested successfully! Report ID: ${reportId}`);
    console.log("Waiting for processing (this might take a few minutes)...");

    let status = "";
    let documentId = "";
    const maxAttempts = 60; // 5 minutes max wait
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Checking status (Attempt ${attempt}/${maxAttempts})...`);
      
      const report = await spApiRequest<{
        processingStatus: string;
        reportDocumentId?: string;
      }>("GET", `/reports/2021-06-30/reports/${reportId}`);

      status = report.processingStatus;
      console.log(`Processing Status: ${status}`);

      if (status === "DONE" && report.reportDocumentId) {
        documentId = report.reportDocumentId;
        break;
      }

      if (status === "CANCELLED" || status === "FATAL") {
        throw new Error(`Report generation failed with status: ${status}`);
      }

      // Wait 10 seconds between polls
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    if (!documentId) {
      throw new Error("Timed out waiting for report generation.");
    }

    console.log(`Report is ready! Document ID: ${documentId}`);
    console.log("Downloading document content...");

    const downloadResult = await downloadDocument(documentId, "csv");
    const dest = path.join(process.cwd(), "2026MayMonthlyUnifiedTransaction.csv");
    
    await fs.promises.writeFile(dest, downloadResult.body);
    
    console.log(`\n====================================================`);
    console.log(`🎉 SUCCESS: May 2026 Unified Transaction report downloaded!`);
    console.log(`Saved to: ${dest}`);
    console.log(`File size: ${(downloadResult.body.length / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`====================================================\n`);

  } catch (error) {
    console.error("\n❌ Error downloading report via SP-API:");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
  }
}

main().catch(console.error);
