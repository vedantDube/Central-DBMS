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

interface FetchProductsResult {
  products: any[];
  nextUrl: string | null;
}

async function fetchProductsPage(
  token: string,
  apiKey: string,
  targetUrl: string
): Promise<FetchProductsResult> {
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
      `Product fetch failed. HTTP ${res.status}: ${await res.text()}`
    );
  }

  const json = await res.json() as any;
  const products = json?.data;
  const nextUrl = json?.nextUrl ?? null;

  if (!Array.isArray(products)) {
    console.log(
      "Unexpected response structure or no products returned:",
      JSON.stringify(json, null, 2)
    );
    return { products: [], nextUrl: null };
  }

  return { products, nextUrl };
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
        prisma.easyEcomProductMaster.upsert({
          where: { cp_id: record.cp_id },
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

  let page = 1;
  let totalSaved = 0;
  const seenCpIds = new Set<number>();
  let currentUrl = "https://api.easyecom.io/Products/GetProductMaster?custom_fields=1&limit=150";

  while (currentUrl) {
    console.log(`Fetching Product Master page ${page}...`);
    const { products: items, nextUrl } = await fetchProductsPage(token, apiKey, currentUrl);

    if (items.length === 0) {
      console.log("No more products found.");
      break;
    }

    let hasNewItem = false;
    for (const item of items) {
      if (item.cp_id) {
        const cpIdNum = Number(item.cp_id);
        if (!seenCpIds.has(cpIdNum)) {
          seenCpIds.add(cpIdNum);
          hasNewItem = true;
        }
      }
    }

    if (!hasNewItem) {
      console.log("No new product cp_ids found on this page. Stopping pagination.");
      break;
    }

    console.log(`Received ${items.length} product rows.`);

    const records = items
      .filter((item) => item.cp_id)
      .map((item) => ({
        cp_id: Number(item.cp_id),
        product_id: Number(item.product_id),
        sku: String(item.sku),
        product_name: item.product_name ? String(item.product_name) : null,
        description: item.description ? String(item.description) : null,
        active: item.active !== null && item.active !== undefined ? String(item.active) : null,
        created_at: item.created_at ? String(item.created_at) : null,
        updated_at: item.updated_at ? String(item.updated_at) : null,
        inventory: item.inventory !== undefined && item.inventory !== null ? Number(item.inventory) : null,
        product_type: item.product_type ? String(item.product_type) : null,
        brand: item.brand ? String(item.brand) : null,
        colour: item.colour ? String(item.colour) : null,
        category_id: item.category_id ? Number(item.category_id) : null,
        brand_id: item.brand_id ? Number(item.brand_id) : null,
        accounting_sku: item.accounting_sku ? String(item.accounting_sku) : null,
        accounting_unit: item.accounting_unit ? String(item.accounting_unit) : null,
        category_name: item.category_name ? String(item.category_name) : null,
        expiry_type: item.expiry_type !== null && item.expiry_type !== undefined ? String(item.expiry_type) : null,
        category_shelf_life: item.category_shelf_life ? Number(item.category_shelf_life) : null,
        category_shelf_life_percentage: item.category_shelf_life_percentage ? Number(item.category_shelf_life_percentage) : null,
        company_name: item.company_name ? String(item.company_name) : null,
        c_id: item.c_id ? Number(item.c_id) : null,
        height: item.height !== null && item.height !== undefined ? String(item.height) : null,
        length: item.length !== null && item.length !== undefined ? String(item.length) : null,
        width: item.width !== null && item.width !== undefined ? String(item.width) : null,
        weight: item.weight !== null && item.weight !== undefined ? String(item.weight) : null,
        cost: item.cost ? Number(item.cost) : null,
        mrp: item.mrp ? Number(item.mrp) : null,
        size: item.size ? String(item.size) : null,
        cp_sub_products_count: item.cp_sub_products_count ? Number(item.cp_sub_products_count) : null,
        model_no: item.model_no ? String(item.model_no) : null,
        EANUPC: item.EANUPC ? String(item.EANUPC) : null,
        hsn_code: item.hsn_code ? String(item.hsn_code) : null,
        product_image_url: item.product_image_url ? String(item.product_image_url) : null,
        cp_inventory: item.cp_inventory ? Number(item.cp_inventory) : null,
        tax_rule_name: item.tax_rule_name ? String(item.tax_rule_name) : null,
        tax_rate: item.tax_rate ? Number(item.tax_rate) : null,
        vendor_code: item.vendor_code && item.vendor_code.length > 0 ? String(item.vendor_code) : null
      }));

    await saveBatch(records);
    totalSaved += records.length;
    console.log(`Saved Product Master page ${page}. Total saved: ${totalSaved}`);

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

  console.log(`Finished Product Master Ingestion. Total: ${totalSaved} records.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
