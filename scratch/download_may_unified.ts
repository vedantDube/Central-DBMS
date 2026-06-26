import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { getAmazonBrowserProfileDir } from "../src/amazon/profile.js";

async function main() {
  const userDataDir = getAmazonBrowserProfileDir();
  console.log("====================================================");
  console.log("Starting May 2026 Unified Transaction Download Script");
  console.log(`Using Playwright Profile: ${userDataDir}`);
  console.log("====================================================\n");

  console.log("Launching browser (headless: false)...");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
  });

  const page = context.pages()[0] ?? (await context.newPage());

  // Setup download event listener
  page.on("download", async (download) => {
    console.log(`\n📥 Download intercepted! Filename: ${download.suggestedFilename()}`);
    const dest = path.join(process.cwd(), "2026MayMonthlyUnifiedTransaction.csv");
    
    try {
      await download.saveAs(dest);
      console.log(`\n====================================================`);
      console.log(`🎉 SUCCESS: May 2026 Unified Transaction report downloaded!`);
      console.log(`Saved to: ${dest}`);
      console.log(`File size: ${(fs.statSync(dest).size / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`====================================================\n`);
    } catch (err) {
      console.error("Error saving downloaded file:", err);
    }
  });

  try {
    console.log("Navigating to Reports Repository...");
    await page.goto("https://sellercentral.amazon.in/reports-repository", {
      waitUntil: "load",
      timeout: 60000,
    });

    console.log("Checking session status...");
    const url = page.url();
    if (url.includes("signin") || url.includes("/ap/")) {
      console.log("\n⚠️  NOT LOGGED IN: Please log in to your Amazon account in the browser window.");
      console.log("The script will wait for you to log in and return to the Reports Repository.\n");
      
      // Wait for navigation back to reports repository or home page
      await page.waitForURL((url) => url.toString().includes("reports-repository"), { timeout: 300000 });
      console.log("✅ Successfully logged in and navigated to Reports Repository!");
    }

    console.log("\n------------------ INSTRUCTIONS ------------------");
    console.log("1. In the open browser window, select report type: 'All (Unified Reports)'.");
    console.log("2. Set the Date Range to: May 1, 2026 - May 31, 2026.");
    console.log("3. Click 'Request Report' to generate it.");
    console.log("4. Once the report is generated (or if it is already in the list below),");
    console.log("   click the 'Download' button next to it.");
    console.log("5. The script will automatically catch the download and save it to the project root.");
    console.log("--------------------------------------------------\n");

    // Optional automation attempt: Try to click dropdown and fill dates
    try {
      console.log("Attempting automatic report type selection...");
      const reportTypeDropdown = page.locator(".kat-dropdown, select").first();
      if (await reportTypeDropdown.count() > 0) {
        await reportTypeDropdown.click();
        await page.waitForTimeout(1000);
        // Look for Unified Reports
        const unifiedOption = page.locator("kat-option, option").filter({ hasText: /Unified/i }).first();
        if (await unifiedOption.count() > 0) {
          await unifiedOption.click();
          console.log("Selected report type: All (Unified Reports)");
        }
      }
    } catch (e) {
      console.log("(Automatic report type selection skipped/not supported by current UI state)");
    }

    console.log("Waiting for download or browser close. Please interact with the browser window...");
    
    // Keep script running until the browser window is closed
    await new Promise<void>((resolve) => {
      context.once("close", () => resolve());
    });
    
    console.log("Browser window closed. Exiting script.");

  } catch (error) {
    console.error("An error occurred during execution:", error);
  } finally {
    if (!context.isClosed()) {
      await context.close();
    }
  }
}

main().catch(console.error);
