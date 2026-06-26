import 'dotenv/config';

const email = process.env.EASY_ECOM_EMAIL;
const password = process.env.EASY_ECOM_PASSWORD;
const apiKey = process.env.EASY_ECOM_API_KEY;
const locationKey = process.env.EASY_ECOM_LOCATION_KEY;

async function getEasyEcomToken(): Promise<string> {
  const res = await fetch("https://api.easyecom.io/access/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey!
    },
    body: JSON.stringify({ email, password, location_key: locationKey })
  });
  if (!res.ok) {
    throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json() as any;
  return json?.data?.token?.jwt_token;
}

async function main() {
  if (!email || !password || !apiKey || !locationKey) {
    console.error("Missing EasyEcom credentials in .env");
    return;
  }

  try {
    console.log("Authenticating...");
    const token = await getEasyEcomToken();
    console.log("Authenticated successfully.");

    // Fetch Marketplace List
    console.log("\n--- Fetching Integrated Marketplaces ---");
    const mktUrl = "https://api.easyecom.io/marketplaces/list";
    const mktRes = await fetch(mktUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      }
    });
    console.log("Marketplace List Status:", mktRes.status);
    const mktJson = await mktRes.json() as any;
    console.log("Marketplace List Response:", JSON.stringify(mktJson, null, 2));

  } catch (err) {
    console.error("Error during API testing:", err);
  }
}

main();
