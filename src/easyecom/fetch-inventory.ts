import { config as loadEnv } from "dotenv";
import { prisma } from "../prisma/client.js";

loadEnv();

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function getEasyEcomToken(
  email: string,
  password: string,
  locationKey: string
): Promise<string> {
  const res = await fetch("https://api.easyecom.io/access/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
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

  const json = await res.json();

  const token = json?.data?.token?.jwt_token;

  if (!token) {
    throw new Error(
      `Token missing in response: ${JSON.stringify(json)}`
    );
  }

  return token;
}

async function fetchInventoryPage(
  token: string,
  apiKey: string,
  page: number
): Promise<any[]> {
  const limit = 150;

  const url =
    `https://api.easyecom.io/getInventoryDetailsV3` +
    `?includeLocations=0&page=${page}&limit=${limit}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(
      `Inventory fetch failed. HTTP ${res.status}: ${await res.text()}`
    );
  }

  const json = await res.json();

  const inventoryData = json?.data?.inventoryData;

  if (!Array.isArray(inventoryData)) {
    console.log(
      "Unexpected response:",
      JSON.stringify(json, null, 2)
    );
    return [];
  }

  return inventoryData;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }

  return chunks;
}

async function saveBatch(records: any[]) {
  const chunks = chunkArray(records, 500);

  for (const chunk of chunks) {
    await prisma.$transaction(
      chunk.map((record) =>
        prisma.easyEcomInventory.upsert({
          where: {
            date_snapshotType_sku_warehouseId: {
              date: record.date,
              snapshotType: record.snapshotType,
              sku: record.sku,
              warehouseId: record.warehouseId
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
  const snapshotTypeInput = getArgValue("--snapshot");

  if (
    snapshotTypeInput !== "Opening" &&
    snapshotTypeInput !== "Closing"
  ) {
    console.error(
      "Usage: --snapshot Opening | Closing"
    );
    process.exit(1);
  }

  const snapshotType =
    snapshotTypeInput as "Opening" | "Closing";

  const email = process.env.EASY_ECOM_EMAIL;
  const password = process.env.EASY_ECOM_PASSWORD;
  const apiKey = process.env.EASY_ECOM_API_KEY;
  const locationKey = process.env.EASY_ECOM_LOCATION_KEY;

  if (!email || !password || !apiKey || !locationKey) {
    throw new Error(
      "Missing EASY_ECOM credentials in .env"
    );
  }

  console.log("Authenticating...");

  const token = await getEasyEcomToken(
    email,
    password,
    locationKey
  );

  console.log("Authentication successful.");

  const dateStr = new Date()
    .toISOString()
    .slice(0, 10);

  let page = 1;
  let totalSaved = 0;
  const seenSkus = new Set<string>();

  while (true) {
    console.log(`Fetching page ${page}...`);

    const items = await fetchInventoryPage(
      token,
      apiKey,
      page
    );

    if (items.length === 0) {
      console.log("No more inventory.");
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
      console.log(
        "No new SKUs found on this page. Stopping pagination to prevent an infinite loop."
      );
      break;
    }

    console.log(
      `Received ${items.length} inventory rows`
    );

    const records = items
      .filter((item) => item.sku)
      .map((item) => ({
        date: dateStr,
        snapshotType,

        companyId: null,
        skuId: null,

        name: item.productName ?? null,
        sku: String(item.sku),

        slug: null,

        modelNo: item.modelNo ?? null,
        color: item.color ?? null,
        size: item.size ?? null,
        brand: item.brand ?? null,

        quantity: Number(
          item.availableInventory ?? 0
        ),

        availableQty: Number(
          item.availableInventory ?? 0
        ),

        inventoryStatus:
          item.category ?? null,

        easyEcomUpdatedAt:
          item.lastUpdateDate ?? null,

        warehouseName:
          item.location_key ?? null,

        warehouseId: 0,

        subWarehouse: null,
        floor: null,
        zone: null,
        aisle: null,
        rack: null,
        shelf: null,
        bin: null,

        reservedQty: 0,
        bufferQuantity: 0,
        isActive: 1,
        thresholdQty: null,
        rank: null,

        rawJson: item
      }));

    await saveBatch(records);

    totalSaved += records.length;

    console.log(
      `Saved page ${page}. Total: ${totalSaved}`
    );

    page++;

    await new Promise((resolve) =>
      setTimeout(resolve, 500)
    );
  }

  console.log(
    `Finished. Saved ${totalSaved} inventory records.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });