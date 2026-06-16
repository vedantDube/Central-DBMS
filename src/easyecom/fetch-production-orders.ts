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
  orders: any[];
  nextUrl: string | null;
}

async function fetchOrdersPage(
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
      `Orders fetch failed. HTTP ${res.status}: ${await res.text()}`
    );
  }

  const json = await res.json() as any;
  const orders = json?.data?.orders;
  const nextUrl = json?.data?.nextUrl ?? json?.nextUrl ?? null;

  if (!Array.isArray(orders)) {
    console.log(
      "Unexpected response structure or no orders returned:",
      JSON.stringify(json, null, 2)
    );
    return { orders: [], nextUrl: null };
  }

  return { orders, nextUrl };
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
        prisma.easyEcomProductionOrder.upsert({
          where: { invoice_id: record.invoice_id },
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

  let totalSaved = 0;

  // Query in 7-day windows back to 60 days
  const numChunks = Math.ceil(60 / 7);
  for (let i = 0; i < numChunks; i++) {
    const endDaysAgo = i * 7;
    const startDaysAgo = (i + 1) * 7;

    const endDateTime = new Date(Date.now() - endDaysAgo * 24 * 60 * 60 * 1000);
    const startDateTime = new Date(Date.now() - startDaysAgo * 24 * 60 * 60 * 1000);

    const endDate = endDateTime.toISOString().slice(0, 10) + " 23:59:59";
    const startDate = startDateTime.toISOString().slice(0, 10) + " 00:00:00";

    console.log(`--- Fetching orders from ${startDate} to ${endDate} ---`);

    let currentUrl = `https://api.easyecom.io/orders/V2/getAllOrders` +
      `?start_date=${encodeURIComponent(startDate)}` +
      `&end_date=${encodeURIComponent(endDate)}&limit=100`;

    let page = 1;
    while (currentUrl) {
      console.log(`Fetching orders page ${page} for range ${startDate} to ${endDate}...`);
      const { orders, nextUrl } = await fetchOrdersPage(token, apiKey, currentUrl);

      if (orders.length === 0) {
        console.log("No more orders found in this range.");
        break;
      }

      // Filter for production orders
      const productionOrders = orders.filter((o: any) => o.order_type_key === "productionorder");
      console.log(`Received ${orders.length} orders total. Filtered to ${productionOrders.length} production orders.`);

      if (productionOrders.length > 0) {
        const records = productionOrders
          .filter((o) => o.invoice_id)
          .map((o) => ({
            invoice_id: Number(o.invoice_id),
            order_id: Number(o.order_id),
            reference_code: o.reference_code ?? null,
            company_name: o.company_name ?? null,
            location_key: o.location_key ?? null,
            warehouseId: o.warehouseId ? Number(o.warehouseId) : null,
            import_warehouse_name: o.import_warehouse_name ?? null,
            order_type: o.order_type ?? null,
            order_type_key: o.order_type_key ?? null,
            marketplace: o.marketplace ?? null,
            order_date: o.order_date ?? null,
            invoice_date: o.invoice_date ?? null,
            last_update_date: o.last_update_date ?? null,
            invoice_number: o.invoice_number ?? null,
            order_status: o.order_status ?? null,
            order_status_id: o.order_status_id ? Number(o.order_status_id) : null,
            shipping_status: o.shipping_status ?? null,
            payment_mode: o.payment_mode ?? null,
            customer_name: o.customer_name ?? null,
            contact_num: o.contact_num ?? null,
            city: o.city ?? null,
            pin_code: o.pin_code ?? null,
            state: o.state ?? null,
            country: o.country ?? null,
            total_amount: o.total_amount ? Number(o.total_amount) : null,
            total_tax: o.total_tax ? Number(o.total_tax) : null,
            total_discount: o.total_discount ? Number(o.total_discount) : null,
            collectable_amount: o.collectable_amount ? Number(o.collectable_amount) : null,
            suborders: o.suborders ?? []
          }));

        await saveBatch(records);
        totalSaved += records.length;
        console.log(`Saved page ${page}. Total production orders saved: ${totalSaved}`);
      }

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
  }

  console.log(`Finished Production Order Ingestion. Total: ${totalSaved} records.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
