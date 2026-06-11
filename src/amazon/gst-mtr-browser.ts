import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import unzipper from "unzipper";
import { getAmazonBrowserProfileDir } from "./profile.js";

type GstMtrReport = {
  key: "gst-mtr-b2c" | "gst-mtr-b2b" | "gst-mtr-stock-transfer";
  label: string;
  matchText: RegExp;
};

const reports: GstMtrReport[] = [
  {
    key: "gst-mtr-b2c",
    label: "GST MTR B2C Report",
    matchText: /b2c/i,
  },
  {
    key: "gst-mtr-b2b",
    label: "GST MTR B2B Report",
    matchText: /b2b/i,
  },
  {
    key: "gst-mtr-stock-transfer",
    label: "GST MTR Stock Transfer Report",
    matchText: /stock transfer|str/i,
  },
];

const downloadRoot = path.join(process.cwd(), "downloads", "amazon", "tax", "gst-mtr");

async function ensureDir(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

async function requestReports(page: import("playwright").Page) {
  await page.goto("https://sellercentral.amazon.in/home", {
    waitUntil: "networkidle",
  });

  await page
    .locator("navigation-hamburger-menu")
    .getByRole("button")
    .filter({ hasText: /^$/ })
    .click();

  await page.getByRole("link", { name: "Tax Document Library" }).click();
  await page.getByText("Merchant Tax Report", { exact: true }).click();
  await page.getByRole("heading", { name: "GST On Demand Reports" }).click();
  await page.getByRole("button", { name: "Request Report" }).click();
  await page.locator("#katal-id-0").click();
  await page.getByRole("listbox").getByText("Exact Dates").click();

  // Try to fill in dates from April 1st, 2026 to today (June 8, 2026)
  try {
    const fromInput = page.locator('input[placeholder*="DD/MM/YYYY"], input[placeholder*="From"], input[name*="start"], input#start-date').first();
    const toInput = page.locator('input[placeholder*="DD/MM/YYYY"], input[placeholder*="To"], input[name*="end"], input#end-date').first();
    if (await fromInput.count() > 0) {
      await fromInput.fill("01/04/2026");
      await fromInput.press("Tab");
    }
    if (await toInput.count() > 0) {
      await toInput.fill("08/06/2026");
      await toInput.press("Tab");
    }
  } catch (e) {
    console.log("Could not fill exact dates dynamically:", e);
  }

  await page.getByText("Merchant Tax Report (MTR)").nth(1).click();
  await page.getByText("B2C").nth(1).click();
  await page.getByRole("button", { name: "Request Report" }).click();
  await page.getByText("B2B").nth(1).click();
  await page.getByRole("button", { name: "Request Report" }).click();
  await page.getByRole("radio", { name: "Stock Transfer Report (STR)" }).check();
  await page.locator("kat-radiobutton:nth-child(2) > .wrapper > .text").first().click();
  await page.getByRole("button", { name: "Request Report" }).click();
}

async function waitForReports(page: import("playwright").Page) {
  await page.waitForTimeout(120000);
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function findDownloadAction(page: import("playwright").Page, report: GstMtrReport) {
  const candidates = [
    page.getByRole("row", { name: report.matchText }).getByRole("button", { name: /download/i }),
    page.getByRole("row", { name: report.matchText }).getByRole("link", { name: /download/i }),
    page.locator("tr,kat-table-row,[role='row']").filter({ hasText: report.matchText }).getByRole("button", { name: /download/i }),
    page.locator("tr,kat-table-row,[role='row']").filter({ hasText: report.matchText }).getByRole("link", { name: /download/i }),
  ];

  for (const candidate of candidates) {
    try {
      if (await candidate.first().count()) {
        return candidate.first();
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

async function saveDownloadedFile(filePath: string, report: GstMtrReport) {
  const suggestedName = path.basename(filePath);
  const ext = path.extname(suggestedName).toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(downloadRoot, report.key, stamp);
  await ensureDir(reportDir);

  if (ext === ".zip") {
    const directory = await unzipper.Open.file(filePath);
    const pdfEntries = directory.files.filter(
      (entry: { path: string }) =>
        !entry.path.endsWith("/") && path.extname(entry.path).toLowerCase() === ".pdf",
    );

    for (const entry of pdfEntries) {
      const extracted = await entry.buffer();
      const target = path.join(reportDir, path.basename(entry.path));
      await writeFile(target, extracted);
      console.log(`Saved ${report.label} PDF: ${target}`);
    }

    const targetZip = path.join(reportDir, suggestedName);
    await writeFile(targetZip, await readFile(filePath));
    console.log(`Saved ${report.label} ZIP: ${targetZip}`);
    return;
  }

  const target = path.join(reportDir, suggestedName.endsWith(ext) ? suggestedName : `${report.key}${ext || ".pdf"}`);
  await writeFile(target, await readFile(filePath));
  console.log(`Saved ${report.label}: ${target}`);
}

async function downloadReport(page: import("playwright").Page, report: GstMtrReport) {
  const downloadAction = await findDownloadAction(page, report);

  if (!downloadAction) {
    console.log(`No download control found for ${report.label}`);
    return;
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await downloadAction.click();
  const download = await downloadPromise;

  const tempPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(tempPath);
  await saveDownloadedFile(tempPath, report);
}

async function main() {
  await ensureDir(downloadRoot);

  const userDataDir = getAmazonBrowserProfileDir();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.AMAZON_BROWSER_HEADLESS !== "false",
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    await requestReports(page);
    await waitForReports(page);

    for (const report of reports) {
      await downloadReport(page, report);
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});