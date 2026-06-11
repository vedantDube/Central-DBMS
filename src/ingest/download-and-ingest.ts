import fs from "node:fs/promises";
import path from "node:path";
import { amazonReports } from "../amazon/reports.js";
import { downloadSpApiReport } from "../amazon/sp-api.js";
import { ingestFileToTable } from "./runner.js";
import { env } from "../config.js";

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function saveDownload(
  storagePath: string,
  fileName: string,
  body: Buffer,
) {
  const dir = path.join(process.cwd(), "downloads", storagePath);
  await ensureDir(dir);
  const out = path.join(dir, fileName);
  await fs.writeFile(out, body);
  return out;
}

async function run() {
  for (const report of amazonReports) {
    console.log("Processing", report.key, report.label);
    if (!report.reportTypeId) {
      console.log("  skipping: no reportTypeId configured");
      continue;
    }

    if (report.preferredSource === "browser") {
      console.log(
        "  preferred source is browser; skipping SP-API download for now",
      );
      continue;
    }

    try {
      const dl = await downloadWithRetry(
        report.reportTypeId,
        report.fileExtension || "csv",
      );
      const saved = await saveDownload(
        report.storagePath,
        dl.fileName,
        dl.body,
      );
      console.log("  saved to", saved);
      try {
        const res = await ingestFileToTable(
          saved,
          report.key.replace(/-/g, "_"),
        );
        console.log("  ingest result:", res);
      } catch (e) {
        console.error("  ingest failed:", e);
        // continue to next report
      }
    } catch (e) {
      console.error("  download failed:", e);
    }
    // wait between requests to avoid hitting quotas
    const interRequestDelay =
      Number(env.AMAZON_INTER_REQUEST_DELAY_MS) || 60000;
    await sleep(interRequestDelay);
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadWithRetry(
  reportTypeId: string,
  fileExtension: "csv" | "tsv",
) {
  const maxAttempts = Number(env.AMAZON_MAX_RETRIES) || 8;
  const baseDelay = Number(env.AMAZON_BASE_BACKOFF_MS) || 5000; // 5s
  const maxBackoff = Number(env.AMAZON_MAX_BACKOFF_MS) || 120000; // 2min
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await downloadSpApiReport(reportTypeId, fileExtension);
    } catch (err: any) {
      const msg = String(err && err.message ? err.message : err);
      const isQuota = msg.includes("429") || msg.includes("QuotaExceeded");
      if (!isQuota) throw err;
      if (attempt === maxAttempts) throw err;
      const jitter = Math.floor(Math.random() * 2000);
      const wait =
        Math.min(maxBackoff, baseDelay * Math.pow(2, attempt - 1)) + jitter;
      console.log(
        `  quota hit; retrying in ${wait}ms (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(wait);
    }
  }
  throw new Error("Failed to download after retries");
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
