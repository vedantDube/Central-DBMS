import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import type { DownloadResult } from "../types.js";
import { env } from "../config.js";
import { getAmazonBrowserProfileDir } from "./profile.js";

export async function downloadBrowserReport(
  label: string,
  input?: {
    url?: string;
    downloadSelector?: string;
    waitBeforeDownloadMs?: number;
  },
): Promise<DownloadResult> {
  const url = input?.url;
  const downloadSelector = input?.downloadSelector;
  const waitBeforeDownloadMs = input?.waitBeforeDownloadMs ?? 0;

  if (!url || !downloadSelector) {
    throw new Error(`Browser download is not configured for ${label}`);
  }

  const userDataDir = getAmazonBrowserProfileDir();
  const headless = env.AMAZON_BROWSER_HEADLESS !== "false";
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless,
  });
  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto(url, {
      waitUntil: "networkidle",
    });

    if (waitBeforeDownloadMs > 0) {
      await page.waitForTimeout(waitBeforeDownloadMs);
    }

    const downloadPromise = page.waitForEvent("download");
    await page.click(downloadSelector);
    const download = await downloadPromise;

    const tempFile = path.join(os.tmpdir(), download.suggestedFilename());
    await download.saveAs(tempFile);
    const body = await readFile(tempFile);

    return {
      fileName: download.suggestedFilename(),
      contentType: "text/csv",
      body,
      source: "browser",
    };
  } finally {
    await browser.close();
  }
}
