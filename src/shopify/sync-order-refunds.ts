import { prisma } from "../prisma/client.js";

type ShopifyRefundLineItem = {
  id?: number | string;
  quantity?: number;
  subtotal?: number | string;
  total_tax?: number | string;
  line_item_id?: number | string;
  location_id?: number | string | null;
  restock_type?: string;
  line_item?: { sku?: string | null };
};

type ShopifyRefund = {
  id?: number | string;
  note?: string | null;
  restock?: boolean;
  created_at?: string;
  processed_at?: string;
  transactions?: unknown;
  total_duties_set?: unknown;
  order_adjustments?: unknown;
  refund_line_items?: ShopifyRefundLineItem[];
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

function toDecimalOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

async function main() {
  console.log("=== Syncing Shopify order-level refunds (order.refunds JSON -> ShopifyOrderRefund) ===");

  const orders = await prisma.shopifyOrder.findMany({
    where: { refunds: { not: undefined } },
    select: { id: true, refunds: true },
  });

  let ordersWithRefunds = 0;
  let refundsSaved = 0;
  let lineItemsSaved = 0;

  for (const order of orders) {
    const refunds = order.refunds as ShopifyRefund[] | null;
    if (!Array.isArray(refunds) || refunds.length === 0) continue;
    ordersWithRefunds++;

    for (const refund of refunds) {
      const refundId = toStringOrNull(refund.id);
      if (!refundId) continue;

      await prisma.$transaction(async (tx) => {
        await tx.shopifyOrderRefund.upsert({
          where: { id: refundId },
          update: {
            orderId: order.id,
            note: refund.note ?? null,
            restock: refund.restock ?? null,
            createdAt: toDateOrNull(refund.created_at),
            processedAt: toDateOrNull(refund.processed_at),
            transactions: refund.transactions ?? undefined,
            totalDutiesSet: refund.total_duties_set ?? undefined,
            orderAdjustments: refund.order_adjustments ?? undefined,
          },
          create: {
            id: refundId,
            orderId: order.id,
            note: refund.note ?? null,
            restock: refund.restock ?? null,
            createdAt: toDateOrNull(refund.created_at),
            processedAt: toDateOrNull(refund.processed_at),
            transactions: refund.transactions ?? undefined,
            totalDutiesSet: refund.total_duties_set ?? undefined,
            orderAdjustments: refund.order_adjustments ?? undefined,
          },
        });

        // Refund line items don't carry a stable natural key in Shopify's payload beyond their own
        // `id`, so we delete-and-recreate per refund on each sync to avoid drifting duplicates.
        await tx.shopifyOrderRefundLineItem.deleteMany({ where: { refundId } });

        const lineItems = refund.refund_line_items ?? [];
        for (const item of lineItems) {
          await tx.shopifyOrderRefundLineItem.create({
            data: {
              refundId,
              lineItemId: toStringOrNull(item.line_item_id),
              sku: item.line_item?.sku ?? null,
              quantity: item.quantity ?? null,
              subtotal: toDecimalOrNull(item.subtotal),
              totalTax: toDecimalOrNull(item.total_tax),
              restockType: item.restock_type ?? null,
              locationId: toStringOrNull(item.location_id),
            },
          });
          lineItemsSaved++;
        }
      }, { timeout: 30000 });

      refundsSaved++;
    }
  }

  console.log(`Orders with refunds: ${ordersWithRefunds}`);
  console.log(`Refunds synced: ${refundsSaved}`);
  console.log(`Refund line items synced: ${lineItemsSaved}`);
}

main()
  .catch((error) => {
    console.error("Execution failed:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
