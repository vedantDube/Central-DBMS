// Downloads ALL settlement reports from the SP-API (paginated), skips any
// whose reportDocumentId is already saved on disk, then ingests new files.

import { mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spApiRequest, downloadDocument } from "../amazon/sp-api.js";
import { ingestFileToTable } from "./runner.js";
import { classifyAndIngestSettlement } from "./ingest-downloaded-reports.js";

const OUT_DIR = path.join(process.cwd(), "downloads", "amazon", "payment-statements", "v2");

async function getAlreadyDownloadedDocIds(): Promise<Set<string>> {
  try {
    const files = await readdir(OUT_DIR);
    // Files are named <docId>.csv — extract the stem
    return new Set(files.map((f) => path.basename(f, path.extname(f))));
  } catch {
    return new Set();
  }
}

interface SettlementReport {
  reportId: string;
  reportType: string;
  processingStatus: string;
  reportDocumentId?: string;
  createdTime: string;
  dataStartTime?: string;
  dataEndTime?: string;
}

async function spApiRequestWithRetry<T>(url: string, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await spApiRequest<T>("GET", url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("QuotaExceeded")) {
        const delay = 10000 * Math.pow(2, attempt); // 10s, 20s, 40s...
        console.log(`  rate limited, waiting ${delay / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Exceeded max retries for ${url}`);
}

async function fetchAllSettlementReports(): Promise<SettlementReport[]> {
  const all: SettlementReport[] = [];
  // Go back 90 days (SP-API maximum); this covers all of May 2026 from June 30
  const createdSince = new Date(Date.now() - 1000 * 60 * 60 * 24 * 89).toISOString();
  let nextToken: string | undefined;

  do {
    // SP-API: nextToken must be the ONLY parameter when paginating
    const url = nextToken
      ? `/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`
      : `/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2&processingStatuses=DONE&createdSince=${createdSince}`;

    const res = await spApiRequestWithRetry<{ reports: SettlementReport[]; nextToken?: string }>(url);
    all.push(...(res.reports || []));
    nextToken = res.nextToken;
    if (nextToken) {
      console.log(`  paginating... ${all.length} so far`);
      // Pause between pages to stay within rate limits
      await new Promise((r) => setTimeout(r, 3000));
    }
  } while (nextToken);

  return all;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("Fetching list of all settlement reports from SP-API...");
  const reports = await fetchAllSettlementReports();
  console.log(`Found ${reports.length} completed settlement reports`);

  const alreadyDownloaded = await getAlreadyDownloadedDocIds();
  console.log(`Already on disk: ${alreadyDownloaded.size} files`);

  const toDownload = reports.filter(
    (r) => r.reportDocumentId && !alreadyDownloaded.has(r.reportDocumentId),
  );
  console.log(`New to download: ${toDownload.length} files\n`);

  let successCount = 0;
  let failCount = 0;

  for (const report of toDownload) {
    const docId = report.reportDocumentId!;
    const label = `${report.reportId} (created ${report.createdTime}, data ${report.dataStartTime ?? "?"} → ${report.dataEndTime ?? "?"})`;
    try {
      console.log(`Downloading ${label}...`);

      // Retry downloadDocument on 429
      let result: Awaited<ReturnType<typeof downloadDocument>> | undefined;
      for (let attempt = 0; attempt <= 6; attempt++) {
        try {
          result = await downloadDocument(docId, "csv");
          break;
        } catch (dlErr) {
          const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr);
          if ((dlMsg.includes("429") || dlMsg.includes("QuotaExceeded")) && attempt < 6) {
            const delay = 15000 * Math.pow(2, attempt); // 15s, 30s, 60s, 120s...
            console.log(`  rate limited on download, waiting ${delay / 1000}s (retry ${attempt + 1}/6)...`);
            await new Promise((r) => setTimeout(r, delay));
          } else {
            throw dlErr;
          }
        }
      }

      const filePath = path.join(OUT_DIR, `${docId}.csv`);
      await writeFile(filePath, result!.body);
      console.log(`  saved → ${path.basename(filePath)}`);

      // Ingest immediately
      const reportKey = await classifyAndIngestSettlement(filePath);
      console.log(`  ingested as ${reportKey}\n`);
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED ${label}: ${msg}\n`);
      failCount++;
    }

    // 5-second pause between downloads to stay within rate limits
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log(`\nDone. Downloaded+ingested: ${successCount}, failed: ${failCount}`);
  if (alreadyDownloaded.size > 0) {
    console.log(`Skipped ${alreadyDownloaded.size} already-on-disk files (already ingested).`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
