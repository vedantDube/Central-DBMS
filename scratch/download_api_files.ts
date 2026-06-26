import fs from "node:fs/promises";
import path from "node:path";
import { downloadDocument } from "../src/amazon/sp-api.js";

async function main() {
  const electronicsDocId = "amzn1.spdoc.1.4.eu.a31933d7-06fc-41de-803f-120081980b3a.T234KC5XKVQGTK.1118";
  const codDocId = "amzn1.spdoc.1.4.eu.f8e35511-79b0-44e7-9abc-19d71857ec44.TQHSN7OVQ8GRN.1118";

  try {
    console.log("Downloading Electronics report from Amazon SP-API...");
    const elecResult = await downloadDocument(electronicsDocId, "csv");
    const elecPath = path.join(process.cwd(), "api_electronics_settlement.csv");
    await fs.writeFile(elecPath, elecResult.body);
    console.log(`Saved Electronics data successfully to: ${elecPath}`);

    console.log("Downloading COD report from Amazon SP-API...");
    const codResult = await downloadDocument(codDocId, "csv");
    const codPath = path.join(process.cwd(), "api_cod_settlement.csv");
    await fs.writeFile(codPath, codResult.body);
    console.log(`Saved COD data successfully to: ${codPath}`);

    console.log("\nDownload complete!");

  } catch (err) {
    console.error("Error during download from SP-API:", err);
  }
}

main();
