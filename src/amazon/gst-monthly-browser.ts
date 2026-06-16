import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, Page, Download } from "playwright";
import unzipper from "unzipper";
import { getAmazonBrowserProfileDir } from "./profile.js";
import { getAmazonReport } from "./reports.js";
import { saveReportArtifact } from "../supabase/storage.js";
import { ingestFileToTable } from "../ingest/runner.js";
import { env } from "../config.js";

type MonthlyReportItem = {
  key: "amazon-gst-monthly-b2b" | "amazon-gst-monthly-b2c" | "amazon-gst-monthly-str";
  radioName: string;
};

const reportItems: MonthlyReportItem[] = [
  {
    key: "amazon-gst-monthly-b2c",
    radioName: "B2C",
  },
  {
    key: "amazon-gst-monthly-b2b",
    radioName: "B2B",
  },
  {
    key: "amazon-gst-monthly-str",
    radioName: "Stock Transfer Report (STR)",
  },
];

async function selectMonthAndYear(page: Page, targetMonth: string, targetYear: string) {
  const dropdowns = page.locator("kat-dropdown");
  const count = await dropdowns.count();
  console.log(`Found ${count} dropdowns in the monthly modal`);

  for (let i = 0; i < count; i++) {
    const dropdown = dropdowns.nth(i);
    
    // Check if the dropdown already shows the target value
    const currentText = (await dropdown.innerText()) || "";
    console.log(`Dropdown ${i} current selection text: "${currentText.trim()}"`);
    
    if (currentText.toLowerCase().includes(targetMonth.toLowerCase()) || currentText.includes(targetYear)) {
      console.log(`Dropdown ${i} already shows "${targetMonth}" or "${targetYear}". Skipping selection.`);
      continue;
    }
    
    // Click to open options list
    await dropdown.click();
    await page.waitForTimeout(1000); // wait for options list to render
    
    // Find options relative to this dropdown only
    const options = dropdown.locator("kat-option");
    const optionCount = await options.count();
    const optionTexts: string[] = [];
    for (let j = 0; j < optionCount; j++) {
      const text = await options.nth(j).innerText();
      if (text) optionTexts.push(text.trim());
    }
    
    console.log(`Dropdown ${i} options found:`, optionTexts);
    
    const isMonthDropdown = optionTexts.some(opt => 
      /january|february|march|april|may|june|july|august|september|october|november|december/i.test(opt) ||
      /jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec/i.test(opt)
    );
    
    const isYearDropdown = optionTexts.some(opt => /^\d{4}$/.test(opt));
    
    if (isMonthDropdown) {
      console.log(`Identified dropdown ${i} as Month dropdown. Selecting "${targetMonth}"`);
      const monthOption = options.filter({ hasText: new RegExp(`^${targetMonth}$`, "i") });
      if (await monthOption.count() > 0) {
        await monthOption.first().click();
      } else {
        await options.filter({ hasText: targetMonth }).first().click();
      }
    } else if (isYearDropdown) {
      console.log(`Identified dropdown ${i} as Year dropdown. Selecting "${targetYear}"`);
      const yearOption = options.filter({ hasText: new RegExp(`^${targetYear}$`, "i") });
      if (await yearOption.count() > 0) {
        await yearOption.first().click();
      } else {
        await options.filter({ hasText: targetYear }).first().click();
      }
    } else {
      // Click again to close it if not identified
      await dropdown.click();
    }
    await page.waitForTimeout(1000);
  }
}

async function processDownloadedFile(
  download: Download,
  reportKey: "amazon-gst-monthly-b2b" | "amazon-gst-monthly-b2c" | "amazon-gst-monthly-str",
  dateStamp: string
) {
  const report = getAmazonReport(reportKey);
  const tempPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(tempPath);
  
  const ext = path.extname(download.suggestedFilename()).toLowerCase();
  const downloadDir = path.join(process.cwd(), "downloads", report.storagePath);
  await mkdir(downloadDir, { recursive: true });
  
  let csvPath = "";
  let csvContent = "";
  
  if (ext === ".zip") {
    console.log(`Extracting downloaded ZIP: ${tempPath}`);
    const directory = await unzipper.Open.file(tempPath);
    const csvEntries = directory.files.filter(
      (entry: { path: string }) => !entry.path.endsWith("/") && path.extname(entry.path).toLowerCase() === ".csv"
    );
    
    if (csvEntries.length === 0) {
      throw new Error(`No CSV file found inside downloaded ZIP for ${report.label}`);
    }
    
    const entry = csvEntries[0];
    const extractedBuffer = await entry.buffer();
    csvPath = path.join(downloadDir, `${dateStamp}.csv`);
    await writeFile(csvPath, extractedBuffer);
    csvContent = extractedBuffer.toString("utf8");
    console.log(`Saved extracted CSV to: ${csvPath}`);
    
    // Also save the original zip file
    const zipPath = path.join(downloadDir, `${dateStamp}.zip`);
    await writeFile(zipPath, await readFile(tempPath));
    console.log(`Saved original ZIP to: ${zipPath}`);
  } else {
    csvPath = path.join(downloadDir, `${dateStamp}.csv`);
    const buffer = await readFile(tempPath);
    await writeFile(csvPath, buffer);
    csvContent = buffer.toString("utf8");
    console.log(`Saved CSV to: ${csvPath}`);
  }
  
  // Save to ReportArtifact in database
  await saveReportArtifact({
    reportKey: report.key,
    reportLabel: report.label,
    storagePath: report.storagePath,
    fileName: `${dateStamp}.csv`,
    contentType: "text/csv",
    source: "browser",
    rawContent: csvContent,
  });
  console.log(`Saved metadata and raw content of ${report.label} to ReportArtifact table.`);
  
  // Ingest data to database table column-by-column
  console.log(`Ingesting data from ${csvPath} into PostgreSQL table...`);
  const dbReportKey = report.key.replace(/-/g, "_");
  const ingestResult = await ingestFileToTable(csvPath, dbReportKey);
  console.log(`Successfully ingested ${report.label}:`, ingestResult);
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const customMonth = getArgValue("--month"); // e.g., "May"
  const customYear = getArgValue("--year"); // e.g., "2026"
  
  let targetMonth = customMonth;
  let targetYear = customYear;
  
  if (!targetMonth || !targetYear) {
    const now = new Date();
    // Default to the previous calendar month
    const targetMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    targetMonth = targetMonth || monthNames[targetMonthDate.getMonth()];
    targetYear = targetYear || targetMonthDate.getFullYear().toString();
  }
  
  console.log(`Targeting GST Monthly reports for: ${targetMonth} ${targetYear}`);
  
  const userDataDir = getAmazonBrowserProfileDir();
  const headless = env.AMAZON_BROWSER_HEADLESS !== "false";
  console.log(`Launching Chromium using user-data-dir: ${userDataDir} (headless: ${headless})`);
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    acceptDownloads: true,
  });
  
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    
    console.log("Navigating to Amazon Seller Central home...");
    await page.goto("https://sellercentral.amazon.in/home", {
      waitUntil: "networkidle",
    });
    
    console.log("Navigating through menu to Tax Document Library...");
    await page.locator("navigation-hamburger-menu").getByRole("button").filter({ hasText: /^$/ }).click();
    await page.getByText("Reports", { exact: true }).click();
    await page.getByRole("link", { name: "Tax Document Library" }).waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("link", { name: "Tax Document Library" }).click();
    
    console.log("Clicking Merchant Tax Report tab...");
    await page.getByText("Merchant Tax Report", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.getByText("Merchant Tax Report", { exact: true }).click();
    await page.waitForLoadState("networkidle");
    
    console.log("Opening Monthly Report Download Dialog...");
    const monthlyBtn = page.getByTestId("monthly-button").getByRole("button", { name: "Download Report" });
    await monthlyBtn.waitFor({ state: "visible", timeout: 30000 });
    await monthlyBtn.click();
    await page.waitForTimeout(2000);
    
    console.log("Selecting Merchant Tax Report (MTR) radio inside modal...");
    await page.getByText("Merchant Tax Report (MTR)").nth(1).click();
    await page.waitForTimeout(1000);
    
    console.log("Selecting B2C radio...");
    await page.getByRole("radio", { name: "B2C" }).check({ force: true });
    await page.waitForTimeout(1000);
    
    // Select custom month and year
    await selectMonthAndYear(page, targetMonth, targetYear);
    
    const dateStamp = `${targetYear}-${targetMonth.toLowerCase()}`;
    
    // 1️⃣ Download B2C via "Download Report" button click
    console.log("Downloading Monthly B2C Report...");
    const b2cPromise = page.waitForEvent("download", { timeout: 45000 });
    await page.getByRole("button", { name: "Download Report" }).click();
    const b2cDownload = await b2cPromise;
    await processDownloadedFile(b2cDownload, "amazon-gst-monthly-b2c", dateStamp);
    await page.waitForTimeout(3000);
    
    // 2️⃣ Download B2B via "Download Report" button click
    console.log("Selecting B2B radio...");
    await page.getByRole("radio", { name: "B2B" }).check({ force: true });
    await page.waitForTimeout(1000);
    
    console.log("Downloading Monthly B2B Report...");
    const b2bPromise = page.waitForEvent("download", { timeout: 45000 });
    await page.getByRole("button", { name: "Download Report" }).click();
    const b2bDownload = await b2bPromise;
    await processDownloadedFile(b2bDownload, "amazon-gst-monthly-b2b", dateStamp);
    await page.waitForTimeout(3000);
    
    // 3️⃣ Download STR via "Download Report" button click
    console.log("Selecting Stock Transfer Report (STR) radio...");
    await page.getByRole("radio", { name: "Stock Transfer Report (STR)" }).check({ force: true });
    await page.waitForTimeout(1000);
    
    console.log("Downloading Monthly STR Report...");
    const strPromise = page.waitForEvent("download", { timeout: 45000 });
    await page.getByRole("button", { name: "Download Report" }).click();
    const strDownload = await strPromise;
    await processDownloadedFile(strDownload, "amazon-gst-monthly-str", dateStamp);
    
    console.log("🎉 Monthly GST Reports browser sync completed successfully!");
  } catch (err) {
    console.error("Error during browser sync:", err);
    try {
      const page = context.pages()[0];
      if (page) {
        await page.screenshot({ path: path.join(process.cwd(), "scratch", "error.png") });
        console.log("Saved error screenshot to scratch/error.png");
      }
    } catch (e) {
      console.error("Could not save screenshot:", e);
    }
    throw err;
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error("Fatal error during monthly GST browser sync:", error);
  process.exitCode = 1;
});
