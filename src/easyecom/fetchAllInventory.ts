import axios from "axios";

interface EasyEcomInventoryItem {
  sku: string;
  productName?: string;
  availableInventory?: number;
  accountingUnit?: number;
  productUniqueCode?: string;
  length?: number;
  width?: number;
  height?: number;
}

interface InventoryRecord {
  sku: string;
  name: string;
  inventory: number;
  ean: string;
  mrp: number;
  size: string;
}

const easyEcomApiKey = process.env.EASYECOM_API_KEY!;
const EASYECOM_TOKEN = process.env.EASYECOM_TOKEN!;

export async function fetchAllInventory(easyEcomToken: string, easyEcomApiKey: string): Promise<InventoryRecord[]> {
  const allInventory: InventoryRecord[] = [];

  let page = 1;
  const limit = 150;
  let hasMore = true;

  const maxPages = 300;
  while (hasMore && page <= maxPages) {
    const url =
      `https://api.easyecom.io/getInventoryDetailsV3` +
      `?includeLocations=0&page=${page}&limit=${limit}`;

    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${easyEcomToken}`,
          "x-api-key": easyEcomApiKey,
        },
        timeout: 60000,
      });

      const inventoryData = response.data?.data?.inventoryData || [];

      if (!inventoryData.length) {
        break;
      }

      for (const item of inventoryData as EasyEcomInventoryItem[]) {
        const length = item.length || "";
        const width = item.width || "";
        const height = item.height || "";

        allInventory.push({
          sku: item.sku || "",
          name: item.productName || "",
          inventory: item.availableInventory || 0,
          ean: item.productUniqueCode || "",
          mrp: item.accountingUnit || 0,
          size:
            length && width && height
              ? `${length}x${width}x${height}`
              : "",
        });
      }

      console.log(`Page ${page}: fetched ${inventoryData.length} SKUs`);

      if (inventoryData.length < limit) {
        hasMore = false;
      } else {
        page++;
      }
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 502) {
        const retryAfter = parseInt(error?.response?.headers?.['retry-after'] || '60', 10) * 1000;
        console.warn(`Got 502 Bad Gateway on page ${page}. Retrying after ${retryAfter / 1000}s...`);
        await new Promise(r => setTimeout(r, retryAfter));
        // keep same page, continue loop
        continue;
      }
      console.error(`Inventory fetch failed on page ${page}:`, error.response?.data || error.message);
      throw error;
    }
    // throttle between pages
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`Completed. Total of ${allInventory.length} SKUs fetched.`);
  return allInventory;
}
