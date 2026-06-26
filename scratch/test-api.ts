import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
loadEnv();

const ENDPOINT = "https://sellingpartnerapi-eu.amazon.com";

async function getLwaAccessToken(): Promise<string> {
  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.SP_REFRESH_TOKEN!,
      client_id: process.env.SP_CLIENT_ID!,
      client_secret: process.env.SP_CLIENT_SECRET!,
    }),
  });
  const payload = (await response.json()) as { access_token: string };
  return payload.access_token;
}

async function main() {
  const token = await getLwaAccessToken();
  console.log("Token obtained.\n");

  // From the previous run we saw report 882794020574 with data 2026-03-31 to 2026-04-30 (April IST)
  // It was created 2026-05-01. Let's fetch it directly.

  console.log("=== Fetching report 882794020574 directly ===\n");
  const reportResponse = await fetch(`${ENDPOINT}/reports/2021-06-30/reports/882794020574`, {
    headers: { "x-amz-access-token": token },
  });
  const report = await reportResponse.json() as any;
  console.log("Report details:", JSON.stringify(report, null, 2));

  if (report.reportDocumentId) {
    console.log(`\nDownloading document: ${report.reportDocumentId}`);

    const docResponse = await fetch(`${ENDPOINT}/reports/2021-06-30/documents/${report.reportDocumentId}`, {
      headers: { "x-amz-access-token": token },
    });
    const docData = (await docResponse.json()) as { url: string; compressionAlgorithm?: string };

    const fileResponse = await fetch(docData.url);
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    const content = docData.compressionAlgorithm === "GZIP" ? gunzipSync(bytes) : bytes;

    const downloadDir = path.join(process.cwd(), "downloads", "amazon", "payments", "transactions");
    await mkdir(downloadDir, { recursive: true });

    const outPath = path.join(downloadDir, "2026-april-unified-transaction.csv");
    await writeFile(outPath, content);

    console.log(`\nDownloaded successfully!`);
    console.log(`File: ${outPath}`);
    console.log(`Size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Lines: ${content.toString("utf8").split("\n").length}`);
  } else {
    console.log("No document ID found for this report.");
    console.log("Error details:", JSON.stringify(report, null, 2));
  }
}

main().catch(console.error);
