import { chromium } from "playwright";
import { getAmazonBrowserProfileDir } from "../src/amazon/profile.js";

async function main() {
  const userDataDir = getAmazonBrowserProfileDir();
  console.log("Checking Amazon Seller Central session using profile:", userDataDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    console.log("Navigating to home page...");
    await page.goto("https://sellercentral.amazon.in/home", {
      waitUntil: "networkidle",
    });

    const url = page.url();
    console.log("Current URL:", url);

    if (url.includes("signin") || url.includes("/ap/")) {
      console.log("❌ SESSION EXPIRED: The browser was redirected to the sign-in page.");
    } else {
      console.log("✅ SESSION ACTIVE: Successfully accessed the home page without redirecting to login.");
    }
  } catch (error) {
    console.error("Error checking session:", error);
  } finally {
    await context.close();
  }
}

main();
