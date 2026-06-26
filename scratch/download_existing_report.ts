import { downloadDocument } from "../src/amazon/sp-api.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  const documentId = "amzn1.spdoc.1.4.eu.1b0431a8-a2f4-40a8-85bd-dcf21a938c43.T2NM7JGSWAH695.1202";
  const dest = path.join(process.cwd(), "2026MayMonthlyUnifiedTransaction.csv");

  console.log(`Downloading document ${documentId} via SP-API...`);
  
  try {
    const downloadResult = await downloadDocument(documentId, "csv");
    await fs.promises.writeFile(dest, downloadResult.body);

    console.log(`\n====================================================`);
    console.log(`🎉 SUCCESS: May 2026 Unified Transaction report downloaded!`);
    console.log(`Saved to: ${dest}`);
    console.log(`File size: ${(downloadResult.body.length / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`====================================================\n`);
  } catch (error) {
    console.error("Error downloading document:", error);
  }
}

main().catch(console.error);
