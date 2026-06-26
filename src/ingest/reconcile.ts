import { supabasePrisma } from "../prisma/client.js";

function parseFloatOrZero(val: string | null | undefined): number {
  if (val === null || val === undefined || val === "") return 0;
  const cleaned = val.replace(/,/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapUnifiedTypeToGst(type: string): string | null {
  switch (type) {
    case "Order": return "Shipment";
    case "Refund": return "Refund";
    default: return null;
  }
}

type Amounts = {
  gross: number;
  tax: number;
  invoice: number;
};

type UpdateRow = {
  id: string;
  reconciled: boolean;
  gross_diff: number | null;
  tax_diff: number | null;
  invoice_diff: number | null;
};

export async function reconcilePayments() {
  if (!supabasePrisma) {
    throw new Error("SUPABASE_DB_URL is not configured.");
  }

  console.log("=== Payment Reconciliation (by order_id + sku + type) ===\n");

  console.log("Loading unified transaction amounts...");
  const unifiedRows = await supabasePrisma.amazonUnifiedTransactionRow.findMany({
    select: {
      order_id: true,
      sku: true,
      type: true,
      product_sales: true,
      shipping_credits: true,
      gift_wrap_credits: true,
      promotional_rebates: true,
      total_sales_tax_liablegst_before_adjusting_tcs: true,
    },
  });

  // Key: "order_id|sku|mapped_gst_type" → summed amounts
  const unifiedMap = new Map<string, Amounts>();
  let skippedTypes = 0;
  for (const row of unifiedRows) {
    if (!row.order_id) continue;
    const mappedType = mapUnifiedTypeToGst(row.type);
    if (!mappedType) { skippedTypes++; continue; }

    const key = `${row.order_id}|${row.sku}|${mappedType}`;
    const existing = unifiedMap.get(key) ?? { gross: 0, tax: 0, invoice: 0 };
    const gross = parseFloatOrZero(row.product_sales)
      + parseFloatOrZero(row.shipping_credits)
      + parseFloatOrZero(row.gift_wrap_credits)
      + parseFloatOrZero(row.promotional_rebates);
    const tax = parseFloatOrZero(row.total_sales_tax_liablegst_before_adjusting_tcs);
    existing.gross += gross;
    existing.tax += tax;
    existing.invoice += gross + tax;
    unifiedMap.set(key, existing);
  }
  console.log(`Loaded ${unifiedRows.length} unified rows → ${unifiedMap.size} unique keys (skipped ${skippedTypes} non-Order/Refund rows).\n`);

  console.log("Loading GST master rows...");
  const gstRows = await supabasePrisma.amazonGstMasterRow.findMany({
    select: {
      id: true,
      order_id: true,
      sku: true,
      transaction_type: true,
      tax_exclusive_gross: true,
      total_tax_amount: true,
      invoice_amount: true,
    },
  });
  console.log(`Found ${gstRows.length} GST master rows.\n`);

  let matched = 0;
  let unmatched = 0;
  let reconciled = 0;
  let mismatch = 0;
  let autoReconciledCancel = 0;

  const updates: UpdateRow[] = [];

  for (const row of gstRows) {
    const gstType = row.transaction_type;
    let lookupType = gstType;
    // FreeReplacement maps to Shipment (unified Order)
    if (gstType === "FreeReplacement") lookupType = "Shipment";

    const key = `${row.order_id}|${row.sku}|${lookupType}`;
    const unified = unifiedMap.get(key);

    // Cancel with zero amounts and no unified match → auto-reconcile
    if (gstType === "Cancel" && !unified) {
      const gstGross = row.tax_exclusive_gross ?? 0;
      const gstTax = row.total_tax_amount ?? 0;
      const gstInvoice = row.invoice_amount ?? 0;
      if (Math.abs(gstGross) < 0.01 && Math.abs(gstTax) < 0.01 && Math.abs(gstInvoice) < 0.01) {
        autoReconciledCancel++;
        updates.push({ id: row.id, reconciled: true, gross_diff: 0, tax_diff: 0, invoice_diff: 0 });
        continue;
      }
    }

    if (unified) {
      matched++;
      const grossDiff = round2(round2(unified.gross) - round2(row.tax_exclusive_gross ?? 0));
      const taxDiff = round2(round2(unified.tax) - round2(row.total_tax_amount ?? 0));
      const invoiceDiff = round2(round2(unified.invoice) - round2(row.invoice_amount ?? 0));

      const isReconciled =
        Math.abs(grossDiff) < 0.01 &&
        Math.abs(taxDiff) < 0.01 &&
        Math.abs(invoiceDiff) < 0.01;

      if (isReconciled) {
        reconciled++;
      } else {
        mismatch++;
      }

      updates.push({
        id: row.id,
        reconciled: isReconciled,
        gross_diff: grossDiff,
        tax_diff: taxDiff,
        invoice_diff: invoiceDiff,
      });
    } else {
      unmatched++;
      updates.push({
        id: row.id,
        reconciled: false,
        gross_diff: null,
        tax_diff: null,
        invoice_diff: null,
      });
    }
  }

  console.log("Reconciliation results:");
  console.log(`  Matched:              ${matched}`);
  console.log(`    Fully reconciled:    ${reconciled}`);
  console.log(`    With mismatch:       ${mismatch}`);
  console.log(`  Auto-reconciled Cancel: ${autoReconciledCancel}`);
  console.log(`  Unmatched:            ${unmatched}`);
  console.log(`  Total:                ${gstRows.length}\n`);

  console.log("Writing reconciliation flags to database (raw SQL batch)...");
  const batchSize = 500;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const ids = batch.map((u) => `'${u.id}'`).join(",");
    const reconciledCase = batch.map((u) => `WHEN id = '${u.id}' THEN ${u.reconciled}`).join(" ");
    const grossCase = batch.map((u) => `WHEN id = '${u.id}' THEN ${u.gross_diff ?? "NULL"}`).join(" ");
    const taxCase = batch.map((u) => `WHEN id = '${u.id}' THEN ${u.tax_diff ?? "NULL"}`).join(" ");
    const invoiceCase = batch.map((u) => `WHEN id = '${u.id}' THEN ${u.invoice_diff ?? "NULL"}`).join(" ");

    await supabasePrisma!.$executeRawUnsafe(`
      UPDATE "Amazon_GST_Master"
      SET
        reconciled = CASE ${reconciledCase} END,
        gross_diff = CASE ${grossCase} END,
        tax_diff = CASE ${taxCase} END,
        invoice_diff = CASE ${invoiceCase} END
      WHERE id IN (${ids})
    `);

    console.log(`  Updated ${Math.min(i + batchSize, updates.length)} / ${updates.length}`);
  }

  console.log("\nReconciliation complete.");
}

if (process.argv[1]?.includes("reconcile")) {
  reconcilePayments().catch((error) => {
    console.error("Reconciliation failed:", error);
    process.exitCode = 1;
  });
}
