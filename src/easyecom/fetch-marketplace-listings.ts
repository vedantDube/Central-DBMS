import { config as loadEnv } from "dotenv";
import { prisma } from "../prisma/client.js";

loadEnv();

async function getEasyEcomToken(
  email: string,
  password: string,
  locationKey: string,
  apiKey: string
): Promise<string> {
  const res = await fetch("https://api.easyecom.io/access/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      email,
      password,
      location_key: locationKey
    })
  });

  if (!res.ok) {
    throw new Error(
      `Authentication failed: ${res.status} ${await res.text()}`
    );
  }

  const json = await res.json() as any;
  const token = json?.data?.token?.jwt_token;

  if (!token) {
    throw new Error(
      `Token missing in response: ${JSON.stringify(json)}`
    );
  }

  return token;
}

interface ActiveMarketplace {
  marketplace_name: string;
  marketplace_id: number;
  status: string;
}

async function getActiveMarketplaces(token: string, apiKey: string): Promise<ActiveMarketplace[]> {
  const url = "https://api.easyecom.io/current-channel-status";
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch channel status: HTTP ${res.status}`);
  }

  const json = await res.json() as any;
  const data = json?.data || [];
  return data.filter((m: any) => m.status === "Active" && m.marketplace_id);
}

async function fetchListingsPage(
  token: string,
  apiKey: string,
  marketplaceId: number,
  pageNumber: number,
  pageSize: number
): Promise<any[]> {
  const url = `https://api.easyecom.io/Listings/getMarketPlaceListing?marketPlaceID=${marketplaceId}&pageNumber=${pageNumber}&pageSize=${pageSize}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`Listings fetch failed: HTTP ${res.status}`);
  }

  const json = await res.json() as any;
  const listings = json?.data;

  if (!Array.isArray(listings)) {
    console.log(
      `Unexpected response structure or no listings returned for Marketplace ${marketplaceId}:`,
      JSON.stringify(json, null, 2)
    );
    return [];
  }

  return listings;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function saveBatch(records: any[]) {
  const chunks = chunkArray(records, 250);

  for (const chunk of chunks) {
    await prisma.$transaction(
      chunk.map((record) =>
        prisma.easyEcomMarketplaceListing.upsert({
          where: {
            marketplaceId_sku: {
              marketplaceId: record.marketplaceId,
              sku: record.sku
            }
          },
          update: record,
          create: record
        })
      )
    );
  }
}

async function main() {
  const email = process.env.EASY_ECOM_EMAIL;
  const password = process.env.EASY_ECOM_PASSWORD;
  const apiKey = process.env.EASY_ECOM_API_KEY;
  const locationKey = process.env.EASY_ECOM_LOCATION_KEY;

  if (!email || !password || !apiKey || !locationKey) {
    throw new Error("Missing EASY_ECOM credentials in .env");
  }

  console.log("Authenticating with EasyEcom...");
  const token = await getEasyEcomToken(email, password, locationKey, apiKey);
  console.log("Authentication successful.");

  console.log("Fetching active integrated marketplaces...");
  const activeMarketplaces = await getActiveMarketplaces(token, apiKey);
  console.log(`Found ${activeMarketplaces.length} active marketplaces:`, activeMarketplaces.map(m => `${m.marketplace_name} (${m.marketplace_id})`).join(", "));

  let totalSaved = 0;
  const pageSize = 1000;

  for (const marketplace of activeMarketplaces) {
    console.log(`\n=== Syncing Listings for ${marketplace.marketplace_name} (${marketplace.marketplace_id}) ===`);
    let page = 1;
    let marketplaceSaved = 0;
    const seenSkus = new Set<string>();

    while (true) {
      console.log(`Fetching page ${page} for ${marketplace.marketplace_name}...`);
      const items = await fetchListingsPage(token, apiKey, marketplace.marketplace_id, page, pageSize);

      if (items.length === 0) {
        console.log(`No more listings for ${marketplace.marketplace_name}.`);
        break;
      }

      let hasNewSku = false;
      for (const item of items) {
        if (item.sku) {
          const skuStr = String(item.sku);
          if (!seenSkus.has(skuStr)) {
            seenSkus.add(skuStr);
            hasNewSku = true;
          }
        }
      }

      if (!hasNewSku) {
        console.log("No new SKUs found on this page. Stopping pagination to prevent an infinite loop.");
        break;
      }

      console.log(`Received ${items.length} listing rows.`);

      const records = items
        .filter((item) => item.sku)
        .map((item) => ({
          marketplaceId: marketplace.marketplace_id,
          marketplaceName: marketplace.marketplace_name,
          name: item.name ? String(item.name) : null,
          sku: String(item.sku),
          MasterSKU: item.MasterSKU ? String(item.MasterSKU) : null,
          mrp: item.mrp !== undefined && item.mrp !== null ? Number(item.mrp) : null,
          site_uid: item.site_uid ? String(item.site_uid) : null,
          listing_ref_number: item.listing_ref_number ? String(item.listing_ref_number) : null,
          UID: item.UID ? String(item.UID) : null,
          identifier: item.identifier ? String(item.identifier) : null,
          title: item.title ? String(item.title) : null
        }));

      await saveBatch(records);
      marketplaceSaved += records.length;
      totalSaved += records.length;

      console.log(`Saved page ${page} for ${marketplace.marketplace_name}. Saved in this batch: ${records.length}. Total for channel: ${marketplaceSaved}`);

      if (items.length < pageSize) {
        console.log(`Fetched page of size ${items.length} which is less than pageSize ${pageSize}. Finished pagination.`);
        break;
      }

      page++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`\n=== Ingestion Completed successfully! Total Marketplace Listings Ingested: ${totalSaved} ===`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
