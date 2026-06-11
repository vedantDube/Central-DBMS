// src/reports/download-reports.ts

import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

/**
 * This script demonstrates how to download three next‑day reports using Playwright.
 *
 * The three reports are:
 *   1️⃣ All unified payment reports
 *   2️⃣ All statements of a single day (COD)
 *   3️⃣ All statements of a single day (Electronics transaction)
 *
 * The portal makes the reports available **the day after** they are requested.
 * The script will:
 *   • Log in to the reporting portal (username/password from env variables).
 *   • Navigate to each report page (URL placeholders – replace with real URLs).
 *   • Select tomorrow’s date (date‑picker selector placeholder).
 *   • Trigger the download (button/link selector placeholders).
 *   • Save the files to the configured DOWNLOAD_DIR with clear naming.
 *
 * You should replace the placeholder selectors and URLs with the actual values from the UI.
 */

// ---------------------------------------------------------------
// Configuration – set these in your .env file
// ---------------------------------------------------------------
const REPORT_LOGIN_URL = process.env.REPORT_LOGIN_URL || "https://example.com/login"; // login page URL
const REPORT_USERNAME = process.env.REPORT_USERNAME || "YOUR_USERNAME";
const REPORT_PASSWORD = process.env.REPORT_PASSWORD || "YOUR_PASSWORD";
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.resolve(__dirname, "../../downloads");

// Report‑specific URLs – replace with the real endpoints
const UNIFIED_PAYMENT_URL = process.env.UNIFIED_PAYMENT_URL || "https://example.com/reports/unified-payment";
const COD_STATEMENT_URL = process.env.COD_STATEMENT_URL || "https://example.com/reports/cod-statement";
const ELECTRONICS_STATEMENT_URL = process.env.ELECTRONICS_STATEMENT_URL || "https://example.com/reports/electronics-statement";

// ---------------------------------------------------------------
// Helper: login once and return a logged‑in `Page`
// ---------------------------------------------------------------
async function login(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(REPORT_LOGIN_URL, { waitUntil: "networkidle" });
  // ----> Replace selectors below with the actual login form fields
  await page.fill('input[name="username"]', REPORT_USERNAME);
  await page.fill('input[name="password"]', REPORT_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    page.click('button[type="submit"]'), // login button selector
  ]);
  return page;
}

// ---------------------------------------------------------------
// Helper: download a single report
// ---------------------------------------------------------------
async function downloadReport(
  page: Page,
  reportUrl: string,
  downloadButtonSelector: string,
  fileNamePrefix: string,
  datePickerSelector?: string
) {
  // Navigate to the report page (may already be logged‑in)
  await page.goto(reportUrl, { waitUntil: "networkidle" });

  // If a date picker is needed, select tomorrow’s date
  if (datePickerSelector) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const formatted = tomorrow.toISOString().split('T')[0]; // e.g., 2026-06-02
    // ----> Adjust the date‑picker interaction to match the UI
    await page.fill(datePickerSelector, formatted);
    // Some UIs require pressing Enter or clicking a confirm button – add if needed
    await page.keyboard.press('Enter');
    // Wait for the report list to refresh
    await page.waitForLoadState('networkidle');
  }

  // Initiate the download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click(downloadButtonSelector), // download button selector
  ]);

  const suggested = await download.path(); // temporary path
  const ext = path.extname(download.suggestedFilename()) || ".csv";
  const dest = path.join(DOWNLOAD_DIR, `${fileNamePrefix}-${new Date().toISOString().split('T')[0]}${ext}`);
  await download.saveAs(dest);
  console.log(`✅ ${fileNamePrefix} saved to ${dest}`);
}

// ---------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------
(async () => {
  // Ensure download folder exists
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, downloadsPath: DOWNLOAD_DIR });

  try {
    const page = await login(context);

    // 1️⃣ Unified payment report – replace selector & URL if needed
    await downloadReport(
      page,
      UNIFIED_PAYMENT_URL,
      'button#download-unified', // <--- replace with actual selector
      'unified-payment'
    );

    // 2️⃣ COD statement – replace selector & URL if needed
    await downloadReport(
      page,
      COD_STATEMENT_URL,
      'button#download-cod', // <--- replace with actual selector
      'cod-statement',
      'input[name="report-date"]' // <--- date‑picker selector (if required)
    );

    // 3️⃣ Electronics transaction statement – replace selector & URL if needed
    await downloadReport(
      page,
      ELECTRONICS_STATEMENT_URL,
      'button#download-electronics', // <--- replace with actual selector
      'electronics-statement',
      'input[name="report-date"]'
    );

    console.log('🎉 All reports downloaded successfully');
  } catch (err) {
    console.error('❌ Error during report download:', err);
  } finally {
    await context.close();
    await browser.close();
  }
})();
