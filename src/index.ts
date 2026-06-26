import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { amazonReports, getAmazonReport } from "./amazon/reports.js";
import { downloadBrowserReport } from "./amazon/browser.js";
import { downloadSpApiReport } from "./amazon/sp-api.js";
import { saveReportArtifact } from "./supabase/storage.js";
import { ingestDownloadedReports } from "./ingest/ingest-downloaded-reports.js";
import type { AmazonReportKey, ReportSource } from "./types.js";

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

async function resolveDownload(
  reportKey: AmazonReportKey,
  source: ReportSource,
) {
  const report = getAmazonReport(reportKey);
  const effectiveSource =
    source === "auto"
      ? report.reportTypeId
        ? "sp-api"
        : report.preferredSource
      : source;

  if (effectiveSource === "sp-api") {
    if (!report.reportTypeId) {
      throw new Error(`Missing SP-API report type id for ${report.label}`);
    }

    return downloadSpApiReport(report.reportTypeId, report.fileExtension);
  }

  return downloadBrowserReport(report.label, {
    url: report.browserUrl,
    downloadSelector: report.browserDownloadSelector,
    waitBeforeDownloadMs: report.browserWaitBeforeDownloadMs,
  });
}

async function ingestReport(reportKey: AmazonReportKey, source: ReportSource) {
  const report = getAmazonReport(reportKey);
  const result = await resolveDownload(reportKey, source);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const localDir = path.join(process.cwd(), "downloads", report.storagePath);
  await mkdir(localDir, { recursive: true });

  const localPath = path.join(localDir, `${dateStamp}.${report.fileExtension}`);
  await writeFile(localPath, result.body);

  const rawContent = result.body.toString("utf8");
  const remotePath = `${report.storagePath}/${dateStamp}.${report.fileExtension}`;
  await saveReportArtifact({
    reportKey: report.key,
    reportLabel: report.label,
    storagePath: report.storagePath,
    fileName: `${dateStamp}.${report.fileExtension}`,
    contentType: result.contentType,
    source: result.source,
    rawContent,
  });

  console.log(
    `Saved ${report.label} from ${result.source} to Supabase table as ${remotePath}`,
  );
}

async function main() {
  const reportKey = getArgValue("--report");
  const source =
    (getArgValue("--source") as ReportSource | undefined) ?? "auto";

  const selectedReports = reportKey
    ? [getAmazonReport(reportKey)]
    : amazonReports;
  for (const report of selectedReports) {
    try {
      await ingestReport(report.key, source);
    } catch (error) {
      console.error(
        `Skipping ${report.label}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  await ingestDownloadedReports(reportKey?.replace(/-/g, "_"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
