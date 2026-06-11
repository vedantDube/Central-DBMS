import path from "node:path";
import { env } from "../config.js";

export function getAmazonBrowserProfileDir(): string {
  return env.AMAZON_BROWSER_USER_DATA_DIR
    ? path.resolve(process.cwd(), env.AMAZON_BROWSER_USER_DATA_DIR)
    : path.join(process.cwd(), ".playwright", "amazon-browser");
}