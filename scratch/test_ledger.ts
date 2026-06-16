import { downloadSpApiReport } from "../src/amazon/sp-api.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function main() {
  const reportType = "GET_LEDGER_SUMMARY_VIEW_DATA";
  console.log(`Starting SP-API request for ${reportType} (single day)...`);

  // We set --days 60 in command line arguments temporarily so downloadSpApiReport uses 60 days.
  process.argv.push("--days", "60");

  try {
    const result = await downloadSpApiReport(reportType, "tsv");
    console.log("Report fetched successfully!");
    console.log("Filename:", result.fileName);
    console.log("ContentType:", result.contentType);
    console.log("Size in bytes:", result.body.length);

    const destDir = path.join(process.cwd(), "downloads", "amazon", "ledger");
    await fs.mkdir(destDir, { recursive: true });
    const destFile = path.join(destDir, result.fileName);
    await fs.writeFile(destFile, result.body);
    console.log(`Saved report to: ${destFile}`);

    // Print first few lines of the downloaded body to inspect its columns/data
    const text = result.body.toString("utf8");
    const lines = text.split("\n").slice(0, 10);
    console.log("\nFirst 10 lines of report:");
    console.log(lines.join("\n"));
  } catch (error) {
    console.error("Failed to fetch report:", error);
  }
}

main();
