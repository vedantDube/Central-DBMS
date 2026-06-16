import "dotenv/config";
import { fetchAllInventory } from "./fetchAllInventory.js";

(async () => {
  try {
    // Acquire EasyEcom JWT token using credentials from environment
    const email = process.env.EASY_ECOM_EMAIL;
    const password = process.env.EASY_ECOM_PASSWORD;
    const locationKey = process.env.EASY_ECOM_LOCATION_KEY;
    if (!email || !password || !process.env.EASY_ECOM_API_KEY || !locationKey) {
      throw new Error("Missing EasyEcom credentials in .env");
    }
    const tokenRes = await fetch("https://api.easyecom.io/access/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, location_key: locationKey })
    });
    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      throw new Error(`Failed to obtain token: HTTP ${tokenRes.status} ${txt}`);
    }
    const tokenData = await tokenRes.json() as any;
    const token = tokenData?.data?.token?.jwt_token;
    if (!token) throw new Error("Token not found in response");
    // Export token to env variable used by fetchAllInventory
    process.env.EASYECOM_TOKEN = token;

    const data = await fetchAllInventory(token, process.env.EASY_ECOM_API_KEY!);
    console.log(`Fetched ${data.length} inventory records`);
    console.dir(data.slice(0, 5)); // show first few
  } catch (error) {
    console.error("Error while fetching inventory:", error);
  }
})();
