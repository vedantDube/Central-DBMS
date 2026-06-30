import { ingestFileToTable } from "../src/ingest/runner.js";

async function main() {
  console.log("Ingesting advertising spend CSV...");
  const res = await ingestFileToTable("downloads/amazon/ads-campaign/Advertising spend.csv", "amazon_ads_campaign");
  console.log("Result:", JSON.stringify(res));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
