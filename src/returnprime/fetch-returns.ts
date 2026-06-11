import axios from "axios";
import { config as loadEnv } from "dotenv";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client.js";

loadEnv();

type ReturnPrimeItem = {
  id?: string | number;
  request_number?: string | number;
  request_type?: string;
  status?: string;
  channel?: string;
  order?: {
    id?: string | number;
    name?: string;
    created_at?: string;
    fulfillments?: Array<{
      id?: string | number;
      delivery_status?: string;
      delivery_date?: string;
    }>;
  };
  customer?: {
    email?: string;
    address?: {
      postal_code?: string;
    };
  };
  received?: { status?: boolean };
  inspected?: { status?: boolean };
  rejected?: { status?: boolean };
  archived?: { status?: boolean };
  approved?: { status?: boolean };
  line_items?: Array<{
    refund?: {
      status?: string;
      refunded_amount?: {
        shop_money?: {
          amount?: string | number;
        };
      };
    };
    original_product?: {
      product_id?: string | number;
      sku?: string;
      image?: {
        src?: string;
      };
    };
    shipping?: Array<{
      awb?: string;
    }>;
    quantity?: string | number;
    shop_price?: {
      actual_amount?: string | number;
    };
  }>;
};

function findArray(obj: unknown): unknown[] | null {
  if (Array.isArray(obj)) {
    return obj;
  }

  if (obj && typeof obj === "object") {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const result = findArray((obj as Record<string, unknown>)[key]);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toDecimal(value: string | number | undefined): Prisma.Decimal | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return new Prisma.Decimal(value);
}

function toInt(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function formatRecord(item: ReturnPrimeItem) {
  const lineItem = item.line_items?.[0] || {};
  const fulfillment = item.order?.fulfillments?.[0] || {};
  const shipping = lineItem.shipping?.[0] || {};

  return {
    returnPrimeId: item.id !== undefined ? String(item.id) : undefined,
    requestNumber:
      item.request_number !== undefined ? String(item.request_number) : undefined,
    requestType: item.request_type ?? null,
    status: item.status ?? null,
    channel: item.channel !== undefined && item.channel !== null ? Number(item.channel) : null,
    orderId: item.order?.id !== undefined ? String(item.order.id) : null,
    orderName: item.order?.name ?? null,
    orderCreatedAt: toDate(item.order?.created_at),
    fulfillmentId:
      fulfillment.id !== undefined ? String(fulfillment.id) : null,
    deliveryStatus: fulfillment.delivery_status ?? null,
    deliveryDate: toDate(fulfillment.delivery_date),
    customerEmail: item.customer?.email ?? null,
    postalCode: item.customer?.address?.postal_code ?? null,
    receivedStatus: item.received?.status ?? false,
    inspectedStatus: item.inspected?.status ?? false,
    rejectedStatus: item.rejected?.status ?? false,
    archivedStatus: item.archived?.status ?? false,
    refundStatus: lineItem.refund?.status ?? null,
    eligibleRefundStatus: item.approved?.status ?? false,
    refundedAmount: toDecimal(
      lineItem.refund?.refunded_amount?.shop_money?.amount,
    ),
    originalProductId:
      lineItem.original_product?.product_id !== undefined
        ? String(lineItem.original_product.product_id)
        : null,
    sku: lineItem.original_product?.sku ?? null,
    tracking: shipping.awb ?? null,
    quantity: toInt(lineItem.quantity),
    actualAmount: toDecimal(lineItem.shop_price?.actual_amount),
    imageSrc: lineItem.original_product?.image?.src ?? null,
    rawJson: item,
  };
}

async function fetchReturns() {
  const token = process.env.RP_TOKEN;

  if (!token) {
    throw new Error("Missing RP_TOKEN in environment");
  }

  let page = 1;
  let totalProcessed = 0;

  while (true) {
    console.log(`\nFetching page ${page}...`);

    const response = await axios({
      method: "get",
      maxBodyLength: Infinity,
      url: "https://admin.returnprime.com/return-exchange/v2/",
      headers: {
        "x-rp-token": token,
      },
      params: {
        page,
      },
    });

    const records = (findArray(response.data) || []) as ReturnPrimeItem[];

    console.log(
      `Records Found On Page ${page}: ${records.length}`,
    );

    if (records.length === 0) {
      console.log(
        `No records found on page ${page}. Stopping pagination.`,
      );
      break;
    }

    let pageProcessed = 0;

    for (const item of records) {
      const record = formatRecord(item);

      if (!record.returnPrimeId) {
        continue;
      }

      await prisma.returnPrimeReturn.upsert({
        where: {
          returnPrimeId: record.returnPrimeId,
        },
        update: record,
        create: record,
      });

      pageProcessed++;
      totalProcessed++;
    }

    console.log(
      `Saved ${pageProcessed} records from page ${page}`,
    );

    console.log(
      `Total processed so far: ${totalProcessed}`,
    );

    page++;
  }

  console.log("\n================================");
  console.log(`Pages fetched: ${page - 1}`);
  console.log(`Total records saved: ${totalProcessed}`);
  console.log("ReturnPrime sync completed");
  console.log("================================");

  await prisma.$disconnect();
}

fetchReturns().catch((error) => {
  console.log(JSON.stringify(error.response?.data || error.message, null, 2));
  process.exitCode = 1;
});