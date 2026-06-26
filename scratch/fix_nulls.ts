import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma is not configured/initialized.");
    return;
  }
  
  console.log("=== Replacing NULL values with empty strings in Amazon tables ===");

  const updates = [
    { table: "AmazonMtrRow", cols: ["sellersku"] },
    { table: "AmazonClaimsReimbursementsRow", cols: ["reimbursementid"] },
    { table: "AmazonReturnsB2bRow", cols: ["orderid", "sku", "fnsku", "disposition"] },
    { table: "AmazonReturnsB2cRow", cols: ["orderid", "sku", "returndate", "licenseplatenumber"] },
    { table: "AmazonReturnsB2bOrderRow", cols: ["orderid", "sku", "fnsku", "disposition"] },
    { table: "AmazonSalesAndTrafficRow", cols: ["type", "date", "parentAsin"] },
    { table: "AmazonFlatFileOpenListingsDataRow", cols: ["sku"] },
    { table: "AmazonLedgerSummaryRow", cols: ["date", "fnsku", "disposition", "location"] },
    { table: "AmazonV2SellerPerformanceRow", cols: ["marketplaceId"] },
    { table: "AmazonGstMonthlyB2bRow", cols: ["order_id", "sku", "shipment_item_id", "transaction_type"] },
    { table: "AmazonGstMonthlyB2cRow", cols: ["order_id", "sku", "shipment_item_id", "transaction_type"] },
    { table: "AmazonGstMonthlyStrRow", cols: ["invoice_number", "transaction_id", "sku"] },
    { table: "COD_ALL_Settlements", cols: ["settlementid", "orderid", "sku", "transactiontype", "amounttype", "amountdescription", "posteddatetime", "orderitemcode"] },
    { table: "Electronics_all_statements", cols: ["settlementid", "orderid", "sku", "transactiontype", "amounttype", "amountdescription", "posteddatetime", "orderitemcode"] },
    { table: "Amazon_GST_Master", cols: ["order_id", "sku", "transaction_type"] }
  ];

  for (const { table, cols } of updates) {
    for (const col of cols) {
      try {
        console.log(`Updating "${table}"."${col}" null values to ''...`);
        const result = await supabasePrisma.$executeRawUnsafe(
          `UPDATE "${table}" SET "${col}" = '' WHERE "${col}" IS NULL;`
        );
        console.log(`Updated rows in ${table}.${col}: ${result}`);
      } catch (err) {
        console.warn(`⚠️ Warning: Could not update ${table}.${col} (table might not exist yet):`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  console.log("✅ All existing null values replaced successfully!");
}

main()
  .catch(console.error)
  .finally(async () => {
    if (supabasePrisma) {
      await supabasePrisma.$disconnect();
    }
  });
