import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma is not configured/initialized.");
    return;
  }
  
  console.log("=== Finding and removing duplicate records in Amazon tables ===");

  const deduplications = [
    {
      table: "AmazonMtrRow",
      cols: ["sellersku"]
    },
    {
      table: "AmazonClaimsReimbursementsRow",
      cols: ["reimbursementid"]
    },
    {
      table: "AmazonReturnsB2bRow",
      cols: ["orderid", "sku", "fnsku", "disposition"]
    },
    {
      table: "AmazonReturnsB2cRow",
      cols: ["orderid", "sku", "returndate", "licenseplatenumber"]
    },
    {
      table: "AmazonReturnsB2bOrderRow",
      cols: ["orderid", "sku", "fnsku", "disposition"]
    },
    {
      table: "AmazonSalesAndTrafficRow",
      cols: ["type", "date", "parentAsin"]
    },
    {
      table: "AmazonFlatFileOpenListingsDataRow",
      cols: ["sku"]
    },
    {
      table: "AmazonLedgerSummaryRow",
      cols: ["date", "fnsku", "disposition", "location"]
    },
    {
      table: "AmazonV2SellerPerformanceRow",
      cols: ["marketplaceId"]
    },
    {
      table: "AmazonGstMonthlyB2bRow",
      cols: ["order_id", "sku", "shipment_item_id", "transaction_type"]
    },
    {
      table: "AmazonGstMonthlyB2cRow",
      cols: ["order_id", "sku", "shipment_item_id", "transaction_type"]
    },
    {
      table: "AmazonGstMonthlyStrRow",
      cols: ["invoice_number", "transaction_id", "sku"]
    },
    {
      table: "COD_ALL_Settlements",
      cols: ["settlementid", "orderid", "sku", "transactiontype", "amounttype", "amountdescription", "posteddatetime", "orderitemcode"]
    },
    {
      table: "Electronics_all_statements",
      cols: ["settlementid", "orderid", "sku", "transactiontype", "amounttype", "amountdescription", "posteddatetime", "orderitemcode"]
    },
    {
      table: "Amazon_GST_Master",
      cols: ["flag", "order_id", "sku", "transaction_type"]
    }
  ];

  for (const { table, cols } of deduplications) {
    try {
      console.log(`Deduplicating "${table}" based on [${cols.join(", ")}]...`);
      const joinConditions = cols.map(col => `a."${col}" = b."${col}"`).join(" AND ");
      const query = `
        DELETE FROM "${table}" a
        USING "${table}" b
        WHERE a.id > b.id AND ${joinConditions};
      `;
      const deletedRows = await supabasePrisma.$executeRawUnsafe(query);
      console.log(`Removed ${deletedRows} duplicate rows from "${table}".`);
    } catch (err) {
      console.warn(`⚠️ Warning: Could not deduplicate "${table}":`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log("✅ Deduplication process complete!");
}

main()
  .catch(console.error)
  .finally(async () => {
    if (supabasePrisma) {
      await supabasePrisma.$disconnect();
    }
  });
