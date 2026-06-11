import { chromium, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

/**
 * Playwright script to log into the reporting portal and download a report.
 *
 * The script expects the following environment variables (you can add them to your .env file):
 *   REPORT_URL       – URL of the page that triggers the report download.
 *   REPORT_USERNAME  – Username for the portal login.
 *   REPORT_PASSWORD  – Password for the portal login.
 *   DOWNLOAD_DIR     – Directory where the report file will be saved.
 *
 * Example usage (add to package.json scripts):
 *   "download-report": "ts-node src/reports/download-report.ts"
 *
 * Run with:
 *   npm run download-report
 */
(async () => {
  const reportUrl = process.env.REPORT_URL;
  const username = process.env.REPORT_USERNAME;
  const password = process.env.REPORT_PASSWORD;
  const downloadDir = process.env.DOWNLOAD_DIR || path.resolve(__dirname, '../../downloads');

  if (!reportUrl || !username || !password) {
    console.error('Missing required environment variables. Please set REPORT_URL, REPORT_USERNAME, and REPORT_PASSWORD.');
    process.exit(1);
  }

  // Ensure download directory exists
  fs.mkdirSync(downloadDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    // Set the default download path – Playwright will respect this when a file is saved.
    downloadsPath: downloadDir,
  });
  const page = await context.newPage();

  try {
    // 1️⃣ Navigate to login page (assumes the login form is on the same URL as reportUrl before auth)
    await page.goto(reportUrl, { waitUntil: 'networkidle' });

    // 2️⃣ Perform login – adjust selectors to match the actual page.
    // The selectors below are generic placeholders; replace them with the real ones.
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('button[type="submit"]'),
    ]);

    // 3️⃣ After login, ensure we are on the report page. If the URL changes after auth, navigate again.
    if (page.url() !== reportUrl) {
      await page.goto(reportUrl, { waitUntil: 'networkidle' });
    }

    // 4️⃣ Trigger the download – adjust the selector to the actual "Download" button/link.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button#download-report'), // placeholder selector
    ]);

    // 5️⃣ Save the file to the desired location.
    const suggestedPath = await download.path();
    const fileName = download.suggestedFilename();
    const destination = path.join(downloadDir, fileName);
    await download.saveAs(destination);
    console.log(`Report downloaded to: ${destination}`);
  } catch (err) {
    console.error('Error during report download:', err);
  } finally {
    await context.close();
    await browser.close();
  }
})();
