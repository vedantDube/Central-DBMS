import { chromium } from "playwright";
import { getAmazonBrowserProfileDir } from "./profile.js";

async function main() {
  const userDataDir = getAmazonBrowserProfileDir();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://sellercentral.amazon.in/ap/signin", {
      waitUntil: "networkidle",
    });

    console.log(
      `Playwright profile is open at ${userDataDir}. Sign in in the browser, then close the browser window to save the session.`,
    );
    await new Promise<void>((resolve) => {
      context.once("close", () => resolve());
    });
  } finally {
    if (!context.isClosed()) {
      await context.close();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});