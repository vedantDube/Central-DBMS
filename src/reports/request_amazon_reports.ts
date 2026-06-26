// src/reports/request-and-download-amazon-reports.ts

import { chromium, BrowserContext, Page, Download } from 'playwright';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

/* -----------------------------------------------------------------
   Helpers
----------------------------------------------------------------- */

/**
 * Returns tomorrow’s parts – useful for date‑picker interaction.
 */
function tomorrowParts() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = monthNames[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  return { month, day, year };
}

/**
 * Launches a **persistent** context that re‑uses the saved Amazon profile.
 */
async function launchWithProfile(): Promise<BrowserContext> {
  const userDataDir = path.resolve(process.cwd(), '.playwright', 'amazon-browser');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    acceptDownloads: true,
    // All downloads will land in this folder – you can change it via .env
    downloadsPath: process.env.AMAZON_REPORTS_DIR || path.resolve(__dirname, '../../reports'),
  });
  return context;
}

/**
 * Clicks the “Download” button for a report (if it exists) and saves the file.
 */
async function downloadIfReady(
  page: Page,
  downloadBtnSelector: string,
  prefix: string
) {
  // Does the button exist and is visible?
  const downloadButton = await page.$(downloadBtnSelector);
  if (!downloadButton) {
    console.log(`⏳ ${prefix} – not ready yet. Will be available tomorrow.`);
    return;
  }

  // Initiate the download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadButton.click(),
  ]);

  const suggested = download.suggestedFilename();
  const ext = path.extname(suggested) || '.csv';
  const dest = path.join(
    (process.env.AMAZON_REPORTS_DIR ||
      path.resolve(__dirname, '../../reports')),
    `${prefix}-${new Date().toISOString().split('T')[0]}${ext}`
  );
  await download.saveAs(dest);
  console.log(`✅ ${prefix} downloaded → ${dest}`);
}

/**
 * Generic helper that runs a list of navigation steps (the same you recorded
 * with Playwright codegen) and finishes with a “Request” / “Search” click.
 */
async function requestReport(
  page: Page,
  stepName: string,
  navigationSteps: (() => Promise<void>)[],
) {
  console.log(`🚀 Requesting: ${stepName}`);
  for (const step of navigationSteps) {
    await step();
  }
  console.log(`✅ ${stepName} request submitted – ready tomorrow`);
}

/* -----------------------------------------------------------------
   Main flow
----------------------------------------------------------------- */
(async () => {
  // -----------------------------------------------------------------
  // 0️⃣  Prepare download folder & launch the browser with the saved profile
  // -----------------------------------------------------------------
  const downloadRoot = process.env.AMAZON_REPORTS_DIR ||
    path.resolve(__dirname, '../../reports');
  fs.mkdirSync(downloadRoot, { recursive: true });

  const context = await launchWithProfile();
  const page = await context.newPage();

  // -----------------------------------------------------------------
  // 1️⃣ Open Seller Central – the profile should already be logged‑in
  // -----------------------------------------------------------------
  await page.goto('https://sellercentral.amazon.in/home', {
    waitUntil: 'networkidle',
  });

  // -----------------------------------------------------------------
  // 2️⃣ All Unified Reports
  // -----------------------------------------------------------------
  await requestReport(page, 'All Unified Reports', [
    async () => {
      await page
        .locator('navigation-hamburger-menu')
        .getByRole('button')
        .filter({ hasText: /^$/ })
        .click();
    },
    async () => {
      await page.getByRole('link', { name: 'Reports Repository' }).click();
    },
    async () => {
      await page.getByTitle('All (Unified Reports)').click();
    },
    async () => {
      await page
        .getByRole('listbox')
        .locator('div')
        .filter({ hasText: /^All \(Unified Reports\)$/ })
        .click();
    },
    async () => {
      const { month, day } = tomorrowParts();
      await page.getByRole('textbox', { name: 'From' }).click();
      await page.getByRole('button', { name: month }).first().click();
      await page.getByRole('button', { name: `${day} ${month}` }).click();
    },
    async () => {
      const { month, day } = tomorrowParts();
      await page.getByRole('textbox', { name: 'To' }).click();
      await page.getByRole('button', { name: `${day} ${month}` }).click();
    },
    async () => {
      await page.getByRole('button', { name: 'Request Report' }).click();
    },
  ]);

  // -----------------------------------------------------------------
  // 3️⃣ After request, attempt to download if the report is already ready.
  // -----------------------------------------------------------------
  console.log('\n🔎 Checking for ready‑to‑download reports...');

  await downloadIfReady(page, 'button#download-unified', 'unified-payment');

  console.log('\n✅ Script finished.');
  await context.close();
})();
