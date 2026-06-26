import { chromium } from "playwright";
import { getAmazonBrowserProfileDir } from "../src/amazon/profile.js";

async function main() {
  const userDataDir = getAmazonBrowserProfileDir();
  console.log("Launching browser in headless mode to list reports...");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    
    console.log("Navigating to Reports Repository...");
    await page.goto("https://sellercentral.amazon.in/reports-repository", {
      waitUntil: "networkidle",
    });

    console.log("Current URL:", page.url());
    
    // Wait for the table/list of reports to load
    await page.waitForTimeout(5000);

    // Let's dump text content of any tables or lists to find available reports
    const tableText = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table"));
      return tables.map((t, idx) => {
        return `Table ${idx}:\n` + (t.innerText || "");
      });
    });

    console.log("--- FOUND TABLES ---");
    console.log(tableText.join("\n\n"));

    // Also let's inspect the HTML of the main area if no tables are found
    if (tableText.length === 0) {
      console.log("No tables found. Let's dump some text blocks...");
      const mainText = await page.evaluate(() => {
        const main = document.querySelector("main") || document.body;
        return main.innerText || "";
      });
      console.log("Main text content:\n", mainText.slice(0, 2000));
    }

  } catch (error) {
    console.error("Error listing reports:", error);
  } finally {
    await context.close();
  }
}

main();
