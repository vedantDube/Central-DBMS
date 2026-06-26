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

interface FetchResult {
  poList: any[];
  nextUrl: string | null;
}

async function fetchPOPage(
  token: string,
  apiKey: string,
  targetUrl: string
): Promise<FetchResult> {
  const res = await fetch(targetUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(
      `Purchase Order fetch failed. HTTP ${res.status}: ${await res.text()}`
    );
  }

  const json = await res.json() as any;
  const poList = json?.data;
  const nextUrl = json?.nextUrl ?? null;

  if (!Array.isArray(poList)) {
    console.log(
      "Unexpected response structure or no POs returned:",
      JSON.stringify(json, null, 2)
    );
    return { poList: [], nextUrl: null };
  }

  return { poList, nextUrl };
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
        prisma.easyEcomPurchaseOrder.upsert({
          where: { po_id: record.po_id },
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

  const createdAfter = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + " 00:00:00";
  let currentUrl = `https://api.easyecom.io/wms/V2/getPurchaseOrderDetails?created_after=${encodeURIComponent(createdAfter)}&limit=10`;
  let totalSaved = 0;
  let page = 1;

  while (currentUrl) {
    console.log(`Fetching Purchase Orders page ${page}...`);
    const { poList, nextUrl } = await fetchPOPage(token, apiKey, currentUrl);

    if (poList.length === 0) {
      console.log("No more purchase orders found.");
      break;
    }

    console.log(`Received ${poList.length} PO rows.`);

    const records = poList
      .filter((po) => po.po_id)
      .map((po) => ({
        po_id: Number(po.po_id),
        total_po_value: po.total_po_value !== null && po.total_po_value !== undefined ? String(po.total_po_value) : null,
        po_number: po.po_number ? Number(po.po_number) : null,
        po_ref_num: po.po_ref_num ?? null,
        po_status_id: po.po_status_id ? Number(po.po_status_id) : null,
        po_created_date: po.po_created_date ?? null,
        po_updated_date: po.po_updated_date ?? null,
        po_created_warehouse: po.po_created_warehouse ?? null,
        po_created_location_key: po.po_created_location_key ?? null,
        vendor_name: po.vendor_name ?? null,
        vendor_c_id: po.vendor_c_id ? Number(po.vendor_c_id) : null,
        vendor_code: po.vendor_code ?? null,
        vendor_location_key: po.vendor_location_key ?? null,
        items: po.po_items ?? []
      }));

    await saveBatch(records);
    totalSaved += records.length;
    console.log(`Saved page ${page}. Total saved: ${totalSaved}`);

    if (nextUrl) {
      if (nextUrl.startsWith("http")) {
        currentUrl = nextUrl;
      } else {
        currentUrl = `https://api.easyecom.io${nextUrl.startsWith("/") ? "" : "/"}${nextUrl}`;
      }
      page++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      currentUrl = "";
    }
  }

  console.log(`Finished Purchase Order Ingestion. Total: ${totalSaved} records.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
