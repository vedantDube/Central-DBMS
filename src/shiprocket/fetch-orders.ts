import { config as loadEnv } from "dotenv";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client.js";

loadEnv();

type ShiprocketOrderItem = {
  id?: number | string;
  channel_id?: number | string;
  channel_order_id?: string | number;
  status?: string;
  awb?: string | null;
  shipments?: Array<{
    id?: number | string;
    awb?: string | null;
    rto_awb?: string | null;
    return_awb?: string | null;
    etd?: string | null;
    rto_initiated_date?: string | null;
    items?: Array<{
      sku?: string | null;
      product_id?: string | number | null;
      product_name?: string | null;
      price?: string | number | null;
      package_id?: string | number | null;
    }>;
  }>;
  order_items?: Array<{
    sku?: string | null;
    price?: string | number | null;
    product_name?: string | null;
    product_id?: string | number | null;
    package_id?: string | number | null;
  }>;
};

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDecimalOrNull(value: unknown): Prisma.Decimal | null {
  if (value === undefined || value === null || value === "") return null;

  try {
    return new Prisma.Decimal(String(value));
  } catch {
    return null;
  }
}

function pickFirstShipment(item: ShiprocketOrderItem) {
  return item.shipments?.[0] ?? {};
}

function pickFirstOrderItem(
  item: ShiprocketOrderItem,
  shipment: ReturnType<typeof pickFirstShipment>,
) {
  return shipment.items?.[0] ?? item.order_items?.[0] ?? {};
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function getShiprocketToken(): Promise<string> {
  const envToken = process.env.SHIPROCKET_TOKEN;
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;

  function isJwtExpired(tokenStr: string): boolean {
    try {
      const parts = tokenStr.split(".");
      if (parts.length !== 3) return true;
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
      if (payload && typeof payload.exp === "number") {
        return payload.exp * 1000 < Date.now() + 60000;
      }
      return false;
    } catch {
      return true;
    }
  }

  if (envToken && !isJwtExpired(envToken)) {
    console.log("Using active SHIPROCKET_TOKEN from environment.");
    return envToken;
  }

  if (email && password) {
    console.log("SHIPROCKET_TOKEN is missing or expired. Authenticating via Shiprocket login API...");
    try {
      const response = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error(`Auth failed with status ${response.status}: ${await response.text()}`);
      }

      const body: any = await response.json();
      if (body && body.token) {
        console.log("Successfully retrieved a new Shiprocket authentication token!");
        return body.token;
      }
      throw new Error(`Unexpected login response format: ${JSON.stringify(body)}`);
    } catch (e) {
      console.error("Failed to automatically authenticate with Shiprocket API:", e);
      if (envToken) {
        console.log("Falling back to the expired/invalid environment SHIPROCKET_TOKEN.");
        return envToken;
      }
      throw e;
    }
  }

  if (!envToken) {
    throw new Error("Missing both SHIPROCKET_TOKEN and SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD credentials.");
  }

  console.log("Using existing SHIPROCKET_TOKEN (no email/password credentials provided for auto-refresh).");
  return envToken;
}

async function fetchAllOrders() {
  const token = await getShiprocketToken();

  const today = new Date();
  
  const daysStr = getArgValue("--days");
  const days = daysStr ? parseInt(daysStr, 10) : 75;

  const startDate = new Date(today);
  startDate.setDate(today.getDate() - days);

  let totalProcessed = 0;

  for (
    let chunkStart = new Date(startDate);
    chunkStart <= today;
    chunkStart.setDate(chunkStart.getDate() + 5)
  ) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 4);

    if (chunkEnd > today) {
      chunkEnd.setTime(today.getTime());
    }

    const from = chunkStart.toISOString().split("T")[0];
    const to = chunkEnd.toISOString().split("T")[0];

    console.log(`\n====================================`);
    console.log(`Fetching Range ${from} → ${to}`);
    console.log(`====================================`);

    let page = 1;

    while (true) {
      const url = new URL(
        "https://apiv2.shiprocket.in/v1/external/orders",
      );

      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
      url.searchParams.set("page", String(page));

      console.log(`Fetching page ${page}`);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 422) {
          console.log(
            `Hit Shiprocket limit on page ${page}. Moving to next date chunk.`,
          );
          break;
        }

        throw new Error(
          `Shiprocket request failed: ${response.status} ${errorText}`,
        );
      }

      const payload: any = await response.json();

      const records: ShiprocketOrderItem[] =
        payload?.data ?? payload?.orders ?? [];

      console.log(
        `Range ${from} → ${to} | Page ${page} | Orders: ${records.length}`,
      );

      if (records.length === 0) {
        break;
      }

      for (const item of records) {
        const shipment = pickFirstShipment(item);
        const orderItem = pickFirstOrderItem(item, shipment);

        const shiprocketOrderId =
          toStringOrNull(item.id) ??
          toStringOrNull(item.channel_order_id);

        if (!shiprocketOrderId) {
          continue;
        }

        const data = {
          channelId: toStringOrNull(item.channel_id),
          channelOrderId: toStringOrNull(item.channel_order_id),
          status: item.status ?? null,
          awb:
            toStringOrNull(item.awb) ??
            toStringOrNull(shipment.awb),
          productId: toStringOrNull(orderItem.product_id),
          productName: orderItem.product_name ?? null,
          price: toDecimalOrNull(orderItem.price),
          shipmentId: toStringOrNull(shipment.id),
          rtoAwb: toStringOrNull(shipment.rto_awb),
          returnAwb: toStringOrNull(shipment.return_awb),
          etd: toDateOrNull(shipment.etd),
          rtoInitiatedAt: toDateOrNull(
            shipment.rto_initiated_date,
          ),
          orderItemSku: orderItem.sku ?? null,
          packageId: toStringOrNull(orderItem.package_id),
          rawPayload: item,
          rawContent: JSON.stringify(item),
        };

        await prisma.shiprocketOrder.upsert({
          where: {
            shiprocketOrderId,
          },
          update: data,
          create: {
            shiprocketOrderId,
            ...data,
          },
        });

        totalProcessed++;
      }

      page++;
    }
  }

  console.log(
    `Finished. Synced ${totalProcessed} Shiprocket orders.`,
  );
}

fetchAllOrders()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
