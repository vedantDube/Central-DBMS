import { spApiRequest } from "../src/amazon/sp-api.js";

async function main() {
  console.log("Listing generated settlement reports from SP-API with pageSize=100...");

  try {
    const reportType = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2";
    const querySince = new Date(Date.now() - 1000 * 60 * 60 * 24 * 75).toISOString();
    const path = `/reports/2021-06-30/reports?reportTypes=${reportType}&processingStatuses=DONE&createdSince=${querySince}&pageSize=100`;
    
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
      nextToken?: string;
    }>("GET", path);

    console.log(`Found ${response.reports.length} reports. NextToken: ${response.nextToken ? "Yes" : "No"}\n`);
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
