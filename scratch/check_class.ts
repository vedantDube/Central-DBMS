import { spApiRequest, downloadDocument } from "../src/amazon/sp-api.js";
import { parseBuffer } from "../src/ingest/parser.js";

async function main() {
  const documentId = "amzn1.spdoc.1.4.eu.a31933d7-06fc-41de-803f-120081980b3a.T234KC5XKVQGTK.1118";
  try {
    const result = await downloadDocument(documentId, "csv");
    const parsed = await parseBuffer(result.body, result.fileName);
    if (parsed.length === 0) {
      console.log("Could not parse settlement file");
      return;
    }
    
    const table = parsed[0];
    const headers = table.headers;
    const rows = table.rows;

    console.log(`Total Rows in Report: ${rows.length}`);

    let hasSpecialDescription = false;
    const descIdx = headers.indexOf("amount-description");
    if (descIdx !== -1) {
      for (const r of rows) {
        const desc = r[descIdx];
        if (desc && (desc.includes("Removal") || desc.includes("Storage") || desc.includes("Subscription"))) {
          console.log(`Found special description: "${desc}"`);
          hasSpecialDescription = true;
          break;
        }
      }
    }

    // Classification logic
    let classification = "";
    if (hasSpecialDescription) {
      classification = "Electronics (due to Removal/Storage/Subscription description)";
    } else if (rows.length < 4500) {
      classification = "Electronics (due to row count < 4500)";
    } else {
      classification = "COD (row count >= 4500 and no special descriptions)";
    }

    console.log(`\nClassification result: ${classification}`);

  } catch (err) {
    console.error("Error classifying document:", err);
  }
}

main();
