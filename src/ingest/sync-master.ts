import { supabasePrisma } from "../prisma/client.js";

function parseFloatOrZero(val: string | null | undefined): number {
  if (!val) return 0;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
}

export async function syncGstMaster() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma client is not configured!");
    return;
  }

  console.log("=== Syncing Amazon GST Master Table ===");

  try {
    // 1. Clear step bypassed to support incremental upsert/append
    console.log("Proceeding with incremental sync for AmazonGstMasterRow...");

    const masterRowsToInsert: any[] = [];

    // 2. Fetch B2B records
    console.log("Fetching B2B GST records...");
    const b2bRows = await supabasePrisma.amazonGstMonthlyB2bRow.findMany();
    console.log(`Found ${b2bRows.length} B2B records to map.`);

    for (const b2b of b2bRows) {
      const shippingTax = (
        parseFloatOrZero(b2b.shipping_cgst_tax) +
        parseFloatOrZero(b2b.shipping_sgst_tax) +
        parseFloatOrZero(b2b.shipping_utgst_tax) +
        parseFloatOrZero(b2b.shipping_igst_tax) +
        parseFloatOrZero(b2b.shipping_cess_tax)
      );

      const giftWrapTax = (
        parseFloatOrZero(b2b.gift_wrap_cgst_tax) +
        parseFloatOrZero(b2b.gift_wrap_sgst_tax) +
        parseFloatOrZero(b2b.gift_wrap_utgst_tax) +
        parseFloatOrZero(b2b.gift_wrap_igst_tax) +
        parseFloatOrZero(b2b.gift_wrap_compensatory_cess_tax)
      );

      const tcsGst = (
        parseFloatOrZero(b2b.tcs_cgst_amount) +
        parseFloatOrZero(b2b.tcs_sgst_amount) +
        parseFloatOrZero(b2b.tcs_utgst_amount) +
        parseFloatOrZero(b2b.tcs_igst_amount)
      );

      masterRowsToInsert.push({
        reportKey: b2b.reportKey,
        flag: "B2B",
        seller_gstin: b2b.seller_gstin,
        transaction_type: b2b.transaction_type || "",
        order_id: b2b.order_id || "",
        order_date: b2b.order_date,
        quantity: b2b.quantity,
        asin: b2b.asin,
        hsnsac: b2b.hsnsac,
        sku: b2b.sku || "",
        invoice_amount: parseFloatOrZero(b2b.invoice_amount),
        tax_exclusive_gross: parseFloatOrZero(b2b.tax_exclusive_gross),
        total_tax_amount: parseFloatOrZero(b2b.total_tax_amount),
        shipping_amount: parseFloatOrZero(b2b.shipping_amount),
        shipping_amount_basis: parseFloatOrZero(b2b.shipping_amount_basis),
        shipping_tax: shippingTax,
        gift_wrap_amount: parseFloatOrZero(b2b.gift_wrap_amount),
        gift_wrap_tax: giftWrapTax,
        gift_wrap_basis: parseFloatOrZero(b2b.gift_wrap_amount) - giftWrapTax,
        item_promo_discount: parseFloatOrZero(b2b.item_promo_discount),
        item_promo_discount_basis: parseFloatOrZero(b2b.item_promo_discount_basis),
        item_promo_tax: parseFloatOrZero(b2b.item_promo_tax),
        shipping_promo_discount: parseFloatOrZero(b2b.shipping_promo_discount),
        shipping_promo_discount_basis: parseFloatOrZero(b2b.shipping_promo_discount_basis),
        shipping_promo_tax: parseFloatOrZero(b2b.shipping_promo_tax),
        gift_wrap_promo_discount: parseFloatOrZero(b2b.gift_wrap_promo_discount),
        gift_wrap_promo_discount_basis: parseFloatOrZero(b2b.gift_wrap_promo_discount_basis),
        gift_wrap_promo_tax: parseFloatOrZero(b2b.gift_wrap_promo_tax),
        tcs_gst: tcsGst,
        warehouse_id: b2b.warehouse_id,
        fulfillment_channel: b2b.fulfillment_channel,
      });
    }

    // 3. Fetch B2C records
    console.log("Fetching B2C GST records...");
    const b2cRows = await supabasePrisma.amazonGstMonthlyB2cRow.findMany();
    console.log(`Found ${b2cRows.length} B2C records to map.`);

    for (const b2c of b2cRows) {
      const shippingTax = (
        parseFloatOrZero(b2c.shipping_cgst_tax) +
        parseFloatOrZero(b2c.shipping_sgst_tax) +
        parseFloatOrZero(b2c.shipping_utgst_tax) +
        parseFloatOrZero(b2c.shipping_igst_tax) +
        parseFloatOrZero(b2c.shipping_cess_tax_amount)
      );

      const giftWrapTax = (
        parseFloatOrZero(b2c.gift_wrap_cgst_tax) +
        parseFloatOrZero(b2c.gift_wrap_sgst_tax) +
        parseFloatOrZero(b2c.gift_wrap_utgst_tax) +
        parseFloatOrZero(b2c.gift_wrap_igst_tax) +
        parseFloatOrZero(b2c.gift_wrap_compensatory_cess_tax)
      );

      const tcsGst = (
        parseFloatOrZero(b2c.tcs_cgst_amount) +
        parseFloatOrZero(b2c.tcs_sgst_amount) +
        parseFloatOrZero(b2c.tcs_utgst_amount) +
        parseFloatOrZero(b2c.tcs_igst_amount)
      );

      masterRowsToInsert.push({
        reportKey: b2c.reportKey,
        flag: "B2C",
        seller_gstin: b2c.seller_gstin,
        transaction_type: b2c.transaction_type || "",
        order_id: b2c.order_id || "",
        order_date: b2c.order_date,
        quantity: b2c.quantity,
        asin: b2c.asin,
        hsnsac: b2c.hsnsac,
        sku: b2c.sku || "",
        invoice_amount: parseFloatOrZero(b2c.invoice_amount),
        tax_exclusive_gross: parseFloatOrZero(b2c.tax_exclusive_gross),
        total_tax_amount: parseFloatOrZero(b2c.total_tax_amount),
        shipping_amount: parseFloatOrZero(b2c.shipping_amount),
        shipping_amount_basis: parseFloatOrZero(b2c.shipping_amount_basis),
        shipping_tax: shippingTax,
        gift_wrap_amount: parseFloatOrZero(b2c.gift_wrap_amount),
        gift_wrap_tax: giftWrapTax,
        gift_wrap_basis: parseFloatOrZero(b2c.gift_wrap_amount) - giftWrapTax,
        item_promo_discount: parseFloatOrZero(b2c.item_promo_discount),
        item_promo_discount_basis: parseFloatOrZero(b2c.item_promo_discount_basis),
        item_promo_tax: parseFloatOrZero(b2c.item_promo_tax),
        shipping_promo_discount: parseFloatOrZero(b2c.shipping_promo_discount),
        shipping_promo_discount_basis: parseFloatOrZero(b2c.shipping_promo_discount_basis),
        shipping_promo_tax: parseFloatOrZero(b2c.shipping_promo_tax),
        gift_wrap_promo_discount: parseFloatOrZero(b2c.gift_wrap_promo_discount),
        gift_wrap_promo_discount_basis: parseFloatOrZero(b2c.gift_wrap_promo_discount_basis),
        gift_wrap_promo_tax: parseFloatOrZero(b2c.gift_wrap_promo_tax),
        tcs_gst: tcsGst,
        warehouse_id: b2c.warehouse_id,
        fulfillment_channel: b2c.fulfillment_channel,
      });
    }

    // 4. Batch insert into the Master table (skipping duplicates)
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
      console.log("✅ Master table sync completed successfully.");
    } else {
      console.log("No B2B or B2C records found to sync.");
    }

  } catch (err) {
    console.error("❌ Error syncing Amazon Master GST table:", err);
  }
}

// Allow running directly if run via CLI
if (process.argv[1]?.includes("sync-master")) {
  syncGstMaster()
    .finally(async () => {
      if (supabasePrisma) {
        await supabasePrisma.$disconnect();
      }
    });
}
