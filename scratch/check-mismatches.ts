import { PrismaClient } from "@prisma/client-amazon";

const p = new PrismaClient();

async function main() {
  // Get mismatched rows (matched but not reconciled)
  const mismatched = await p.amazonGstMasterRow.findMany({
    where: {
      reconciled: false,
      gross_diff: { not: null },
    },
    select: {
      order_id: true,
      sku: true,
      transaction_type: true,
      tax_exclusive_gross: true,
      total_tax_amount: true,
      invoice_amount: true,
      gross_diff: true,
      tax_diff: true,
      invoice_diff: true,
    },
    take: 30,
  });

  console.log(`=== Sample Mismatched Rows (${mismatched.length} shown) ===\n`);
  for (const row of mismatched) {
    console.log(`Order: ${row.order_id} | SKU: ${row.sku} | GST Type: ${row.transaction_type}`);
    console.log(`  GST:  gross=${row.tax_exclusive_gross}, tax=${row.total_tax_amount}, invoice=${row.invoice_amount}`);
    console.log(`  Diff: gross=${row.gross_diff}, tax=${row.tax_diff}, invoice=${row.invoice_diff}`);
    console.log();
  }

  // Look at 5 specific orders in detail
  const orderIds = [...new Set(mismatched.map(r => r.order_id))].slice(0, 5);
  console.log("=== Detailed Order Comparison ===\n");

  for (const orderId of orderIds) {
    const unified = await p.amazonUnifiedTransactionRow.findMany({
      where: { order_id: orderId },
      select: {
        type: true, sku: true,
        product_sales: true, shipping_credits: true,
        gift_wrap_credits: true, promotional_rebates: true,
        total_sales_tax_liablegst_before_adjusting_tcs: true,
      },
    });

    const gst = await p.amazonGstMasterRow.findMany({
      where: { order_id: orderId },
      select: {
        transaction_type: true, sku: true,
        tax_exclusive_gross: true, total_tax_amount: true, invoice_amount: true,
        reconciled: true, gross_diff: true,
      },
    });

    console.log(`--- Order: ${orderId} ---`);
    console.log("Unified:");
    for (const u of unified) {
      const ps = u.product_sales?.replace(/,/g, "") || "0";
      const sc = u.shipping_credits?.replace(/,/g, "") || "0";
      const gw = u.gift_wrap_credits?.replace(/,/g, "") || "0";
      const pr = u.promotional_rebates?.replace(/,/g, "") || "0";
      const tax = u.total_sales_tax_liablegst_before_adjusting_tcs?.replace(/,/g, "") || "0";
      const gross = parseFloat(ps) + parseFloat(sc) + parseFloat(gw) + parseFloat(pr);
      console.log(`  type=${u.type} sku=${u.sku} product_sales=${ps} shipping=${sc} giftwrap=${gw} promos=${pr} tax=${tax} → gross=${gross.toFixed(2)}`);
    }
    console.log("GST Master:");
    for (const g of gst) {
      console.log(`  type=${g.transaction_type} sku=${g.sku} gross=${g.tax_exclusive_gross} tax=${g.total_tax_amount} invoice=${g.invoice_amount} reconciled=${g.reconciled} gross_diff=${g.gross_diff}`);
    }
    console.log();
  }

  // Pattern analysis
  console.log("=== Mismatch Pattern Analysis ===\n");

  const patterns = await p.$queryRaw<any[]>`
    SELECT
      transaction_type,
      CASE
        WHEN ABS(gross_diff) >= 0.01 AND ABS(tax_diff) >= 0.01 THEN 'gross+tax'
        WHEN ABS(gross_diff) >= 0.01 THEN 'gross_only'
        WHEN ABS(tax_diff) >= 0.01 THEN 'tax_only'
        ELSE 'invoice_only'
      END as which_diff,
      COUNT(*)::int as cnt,
      ROUND(AVG(ABS(gross_diff))::numeric, 2) as avg_gross_diff,
      ROUND(AVG(ABS(tax_diff))::numeric, 2) as avg_tax_diff
    FROM "Amazon_GST_Master"
    WHERE reconciled = false AND gross_diff IS NOT NULL
    GROUP BY transaction_type, which_diff
    ORDER BY cnt DESC
  `;
  for (const p of patterns) {
    console.log(`  ${p.transaction_type} | ${p.which_diff}: ${p.cnt} rows (avg gross_diff=${p.avg_gross_diff}, avg tax_diff=${p.avg_tax_diff})`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
