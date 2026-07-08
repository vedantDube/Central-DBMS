import { prisma, supabasePrisma } from "../prisma/client.js";

const REPORT_KEY = "shopify_orders";

// Shiprocket statuses that mean the shipment did not complete as a sale (RTO / cancelled / lost)
// -- observed via `groupBy` on ShiprocketOrder.status in the ingested data.
const NON_COMPLETED_STATUSES = new Set([
  "RTO DELIVERED",
  "RTO INITIATED",
  "RTO IN TRANSIT",
  "RTO OFD",
  "RTO NDR",
  "CANCELED",
  "CANCELLATION REQUESTED",
  "LOST",
  "DESTROYED",
  "UNTRACEABLE",
]);

type ShopifyTaxLine = {
  title?: string;
  price?: string;
  rate?: number;
};

type ShopifyShippingLine = {
  price?: string;
  tax_lines?: ShopifyTaxLine[];
};

function parseFloatOrZero(val: string | number | null | undefined): number {
  if (val === null || val === undefined || val === "") return 0;
  const parsed = typeof val === "number" ? val : parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
}

function sumTaxLines(taxLines: unknown): number {
  if (!Array.isArray(taxLines)) return 0;
  return (taxLines as ShopifyTaxLine[]).reduce(
    (sum, line) => sum + parseFloatOrZero(line.price),
    0,
  );
}

export async function syncShopifyGstMaster() {
  console.log("=== Syncing Shopify orders into Amazon GST Master Table ===");

  console.log("Loading Shiprocket orders for RTO/cancellation filtering...");
  const shiprocketOrders = await prisma.shiprocketOrder.findMany({
    select: { channelOrderId: true, status: true },
  });
  const shiprocketStatusByOrder = new Map<string, string | null>();
  for (const sr of shiprocketOrders) {
    if (sr.channelOrderId) {
      shiprocketStatusByOrder.set(sr.channelOrderId, sr.status);
    }
  }
  console.log(`Loaded ${shiprocketOrders.length} Shiprocket orders.`);

  console.log("Loading Shopify orders...");
  const orders = await prisma.shopifyOrder.findMany({
    include: {
      lineItems: true,
      orderRefunds: { include: { lineItems: true } },
    },
  });
  console.log(`Found ${orders.length} Shopify orders to map.`);

  const masterRowsToInsert: any[] = [];
  let skippedNonCompleted = 0;

  for (const order of orders) {
    const orderId = order.name?.replace(/^#/, "") || order.shopifyOrderId;
    const shiprocketStatus = shiprocketStatusByOrder.get(orderId);

    if (shiprocketStatus && NON_COMPLETED_STATUSES.has(shiprocketStatus)) {
      skippedNonCompleted++;
      continue;
    }

    const orderDate = order.createdAt ? order.createdAt.toISOString() : null;

    for (const item of order.lineItems) {
      const quantity = item.quantity ?? 0;
      const price = parseFloatOrZero(item.price?.toString());
      const totalDiscount = parseFloatOrZero(item.totalDiscount?.toString());
      const totalTaxAmount = sumTaxLines(item.taxLines);
      const invoiceAmount = price * quantity - totalDiscount + totalTaxAmount;
      const taxExclusiveGross = invoiceAmount - totalTaxAmount;

      masterRowsToInsert.push({
        reportKey: REPORT_KEY,
        flag: "Shopify",
        transaction_type: "Shipment",
        order_id: orderId,
        order_date: orderDate,
        quantity: String(quantity),
        sku: item.sku || "",
        invoice_amount: invoiceAmount,
        tax_exclusive_gross: taxExclusiveGross,
        total_tax_amount: totalTaxAmount,
      });
    }

    // Shipping/COD charges are order-level, not per-line-item -- attribute them to a single
    // dedicated pseudo-row per order (empty sku) rather than allocating proportionally across
    // line items, to avoid arbitrary allocation math.
    const shippingLines = (order.shippingLines as ShopifyShippingLine[] | null) ?? [];
    if (shippingLines.length > 0) {
      const shippingAmount = shippingLines.reduce(
        (sum, line) => sum + parseFloatOrZero(line.price),
        0,
      );
      const shippingTax = shippingLines.reduce(
        (sum, line) => sum + sumTaxLines(line.tax_lines),
        0,
      );

      if (shippingAmount !== 0 || shippingTax !== 0) {
        masterRowsToInsert.push({
          reportKey: REPORT_KEY,
          flag: "Shopify",
          transaction_type: "Shipment",
          order_id: orderId,
          order_date: orderDate,
          quantity: "0",
          sku: "",
          invoice_amount: shippingAmount + shippingTax,
          tax_exclusive_gross: shippingAmount,
          total_tax_amount: shippingTax,
          shipping_amount: shippingAmount,
          shipping_tax: shippingTax,
        });
      }
    }

    // Order-level refunds (issued directly via payment gateway, without a formal Shopify "Return"
    // object) carry their own per-line subtotal/tax -- emit as "Refund" rows so GST reconciliation
    // reflects money actually returned to customers, same as Amazon's "Refund" transaction_type.
    for (const refund of order.orderRefunds) {
      const refundDate = refund.createdAt ? refund.createdAt.toISOString() : orderDate;

      for (const item of refund.lineItems) {
        const subtotal = parseFloatOrZero(item.subtotal?.toString());
        const totalTax = parseFloatOrZero(item.totalTax?.toString());

        masterRowsToInsert.push({
          reportKey: REPORT_KEY,
          flag: "Shopify",
          // The master table's unique key is [flag, order_id, sku, transaction_type] -- it has no
          // separate "event id" dimension the way Amazon's raw GST tables have shipment_item_id, so
          // a second refund on the same order+sku would silently collide and get skipped. Folding
          // the refund id into transaction_type keeps each refund event distinct.
          transaction_type: `Refund-${refund.id}`,
          order_id: orderId,
          order_date: refundDate,
          quantity: String(item.quantity ?? 0),
          sku: item.sku || "",
          invoice_amount: subtotal + totalTax,
          tax_exclusive_gross: subtotal,
          total_tax_amount: totalTax,
        });
      }
    }
  }

  console.log(`Skipped ${skippedNonCompleted} orders due to RTO/cancelled Shiprocket status.`);

  if (masterRowsToInsert.length > 0) {
    console.log(`Inserting/merging ${masterRowsToInsert.length} records into Master table...`);
    const batchSize = 1000;
    for (let i = 0; i < masterRowsToInsert.length; i += batchSize) {
      const batch = masterRowsToInsert.slice(i, i + batchSize);
      await supabasePrisma.amazonGstMasterRow.createMany({
        data: batch,
        skipDuplicates: true,
      });
      console.log(`Synced batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(masterRowsToInsert.length / batchSize)}`);
    }
    console.log("Shopify GST Master sync completed successfully.");
  } else {
    console.log("No Shopify records found to sync.");
  }
}

if (process.argv[1]?.includes("sync-gst-master")) {
  syncShopifyGstMaster()
    .catch((err) => {
      console.error("Error syncing Shopify GST Master:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
