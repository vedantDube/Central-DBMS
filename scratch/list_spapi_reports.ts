import { spApiRequest } from "../src/amazon/sp-api.js";

async function main() {
  console.log("Listing generated reports from SP-API...");

  try {
    const reportType = "GET_DATE_RANGE_FINANCIAL_TRANSACTION_DATA";
    const path = `/reports/2021-06-30/reports?reportTypes=${reportType}&processingStatuses=DONE`;
    
    console.log(`Calling path: ${path}`);
    const response = await spApiRequest<{
      reports: Array<{
        reportId: string;
        reportType: string;
        dataStartTime: string;
        dataEndTime: string;
        reportDocumentId?: string;
        createdTime: string;
        processingStatus: string;
      }>;
    }>("GET", path);

    console.log(`Found ${response.reports.length} reports:\n`);
    for (const report of response.reports) {
      console.log(`- Report ID: ${report.reportId}`);
      console.log(`  Created: ${report.createdTime}`);
      console.log(`  Date Range: ${report.dataStartTime} to ${report.dataEndTime}`);
      console.log(`  Document ID: ${report.reportDocumentId}`);
      console.log(`  Status: ${report.processingStatus}`);
      console.log("");
    }
  } catch (error) {
    console.error("Error listing reports:", error);
  }
}

main().catch(console.error);
