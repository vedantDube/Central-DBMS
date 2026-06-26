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
    const token = await getEasyEcomToken();
    const url = "https://api.easyecom.io/Listings/getMarketPlaceListing?marketPlaceID=26&pageSize=10";
    console.log(`Fetching Shopify listings (marketPlaceID=26)...`);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      }
    });
    console.log("Listings HTTP:", res.status);
    const json = await res.json() as any;
    console.log("Listings Response Count:", json?.data?.length);
    if (json?.data && json.data.length > 0) {
      console.log("Sample Listing:", JSON.stringify(json.data[0], null, 2));
    } else {
      console.log("No listings returned. Full response:", JSON.stringify(json, null, 2));
    }

  } catch (err) {
    console.error("Error during API testing:", err);
  }
}

main();
