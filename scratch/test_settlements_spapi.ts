import { spApiRequest } from "../src/amazon/sp-api.js";
import { env } from "../src/config.js";

async function main() {
  const days = 60;
  const createdSince = new Date(Date.now() - 1000 * 60 * 60 * 24 * days).toISOString();
  console.log(`Searching for settlement reports generated since: ${createdSince}`);

  const path = `/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2,GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE&createdSince=${encodeURIComponent(createdSince)}`;
  
  try {
    const response = await spApiRequest<{
      reports: Array<{
        reportId: string;
        reportType: string;
        createdTime: string;
        reportDocumentId?: string;
      }>;
    }>("GET", path);

    console.log("Successfully fetched reports list!");
    console.log(`Found ${response.reports?.length ?? 0} reports.`);
    console.log(JSON.stringify(response.reports, null, 2));
  } catch (error) {
    console.error("Error fetching reports:", error);
  }
}

main();
