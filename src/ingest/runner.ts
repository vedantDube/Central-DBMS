import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeHeader,
  inferTypeForValue,
  mergeTypes,
  sqlTypeFor,
} from "./utils.js";
import { parseBuffer } from "./parser.js";
import { prisma, supabasePrisma } from "../prisma/client.js";

function parseLedgerDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  
  // 1. Check YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  
  // 2. Check MM/DD/YYYY or DD/MM/YYYY
  const parts = s.split("/");
  if (parts.length === 3) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);
    if (p2 > 1000) {
      const year = p2;
      const month = p0 - 1; // 0-indexed month
      const day = p1;
      const d = new Date(Date.UTC(year, month, day));
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 3. Check MM/YYYY
  if (parts.length === 2) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    if (p1 > 1000 && p0 >= 1 && p0 <= 12) {
      const year = p1;
      const month = p0 - 1;
      const d = new Date(Date.UTC(year, month, 1));
      if (!isNaN(d.getTime())) return d;
    }
  }
  
  // 4. Fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

type AmazonReportTableConfig = {
  tableName: string;
  delegateName:
    | "amazonMtrRow"
    | "amazonClaimsReimbursementsRow"
    | "amazonReturnsB2bRow"
    | "amazonReturnsB2cRow"
    | "amazonReturnsB2bOrderRow"
    | "amazonSalesAndTrafficRow"
    | "amazonFlatFileOpenListingsDataRow"
    | "amazonLedgerSummaryRow"
    | "amazonV2SellerPerformanceRow"
    | "amazonGstMonthlyB2bRow"
    | "amazonGstMonthlyB2cRow"
    | "amazonGstMonthlyStrRow"
    | "amazonUnifiedTransactionRow"
    | "amazonCODSettlementRow"
    | "amazonElectronicsSettlementRow";
};

const amazonReportTableConfigs: Record<string, AmazonReportTableConfig> = {
  amazon_mtr: {
    tableName: "AmazonMtrRow",
    delegateName: "amazonMtrRow",
  },
  amazon_claims_reimbursements: {
    tableName: "AmazonClaimsReimbursementsRow",
    delegateName: "amazonClaimsReimbursementsRow",
  },
  amazon_fba_removal_shipment_detail: {
    tableName: "AmazonReturnsB2bRow",
    delegateName: "amazonReturnsB2bRow",
  },
  amazon_fba_customer_returns: {
    tableName: "AmazonReturnsB2cRow",
    delegateName: "amazonReturnsB2cRow",
  },
  amazon_fba_removal_order_detail: {
    tableName: "AmazonReturnsB2bOrderRow",
    delegateName: "amazonReturnsB2bOrderRow",
  },
  amazon_sales_and_traffic: {
    tableName: "AmazonSalesAndTrafficRow",
    delegateName: "amazonSalesAndTrafficRow",
  },
  amazon_flat_file_open_listings_data: {
    tableName: "AmazonFlatFileOpenListingsDataRow",
    delegateName: "amazonFlatFileOpenListingsDataRow",
  },
  amazon_ledger_summary: {
    tableName: "AmazonLedgerSummaryRow",
    delegateName: "amazonLedgerSummaryRow",
  },
  amazon_v2_seller_performance: {
    tableName: "AmazonV2SellerPerformanceRow",
    delegateName: "amazonV2SellerPerformanceRow",
  },
  amazon_gst_monthly_b2b: {
    tableName: "AmazonGstMonthlyB2bRow",
    delegateName: "amazonGstMonthlyB2bRow",
  },
  amazon_gst_monthly_b2c: {
    tableName: "AmazonGstMonthlyB2cRow",
    delegateName: "amazonGstMonthlyB2cRow",
  },
  amazon_gst_monthly_str: {
    tableName: "AmazonGstMonthlyStrRow",
    delegateName: "amazonGstMonthlyStrRow",
  },
  amazon_unified_transaction: {
    tableName: "AmazonUnifiedTransactionRow",
    delegateName: "amazonUnifiedTransactionRow",
  },
  amazon_v2_settlement_report_data_flat_file_v2_cod: {
    tableName: "AmazonCODSettlementRow",
    delegateName: "amazonCODSettlementRow",
  },
  amazon_v2_settlement_report_data_flat_file_v2_electronics: {
    tableName: "AmazonElectronicsSettlementRow",
    delegateName: "amazonElectronicsSettlementRow",
  },
};

const amazonReportFields: Record<string, string[]> = {
  amazon_mtr: [
    "itemname",
    "itemdescription",
    "listingid",
    "sellersku",
    "price",
    "quantity",
    "opendate",
    "imageurl",
    "itemismarketplace",
    "productidtype",
    "zshopshippingfee",
    "itemnote",
    "itemcondition",
    "zshopcategory1",
    "zshopbrowsepath",
    "zshopstorefrontfeature",
    "asin1",
    "asin2",
    "asin3",
    "willshipinternationally",
    "expeditedshipping",
    "zshopboldface",
    "productid",
    "bidforfeaturedplacement",
    "adddelete",
    "pendingquantity",
    "fulfillmentchannel",
    "optionalpaymenttypeexclusion",
    "merchantshippinggroup",
    "status",
    "maximumretailprice",
  ],
  amazon_ledger_summary: [
    "date",
    "fnsku",
    "asin",
    "msku",
    "title",
    "disposition",
    "starting_warehouse_balance",
    "in_transit_between_warehouses",
    "receipts",
    "customer_shipments",
    "customer_returns",
    "vendor_returns",
    "warehouse_transfer_in_out",
    "found",
    "lost",
    "damaged",
    "disposed",
    "other_events",
    "ending_warehouse_balance",
    "unknown_events",
    "location",
  ],
  amazon_claims_reimbursements: [
    "approvaldate",
    "reimbursementid",
    "caseid",
    "amazonorderid",
    "reason",
    "sku",
    "fnsku",
    "asin",
    "productname",
    "condition",
    "currencyunit",
    "amountperunit",
    "amounttotal",
    "quantityreimbursedcash",
    "quantityreimbursedinventory",
    "quantityreimbursedtotal",
    "originalreimbursementid",
    "originalreimbursementtype",
  ],
  amazon_fba_customer_returns: [
    "returndate",
    "orderid",
    "sku",
    "asin",
    "fnsku",
    "productname",
    "quantity",
    "fulfillmentcenterid",
    "detaileddisposition",
    "reason",
    "licenseplatenumber",
    "customercomments",
  ],
  amazon_fba_removal_shipment_detail: [
    "requestdate",
    "orderid",
    "shipmentdate",
    "sku",
    "fnsku",
    "disposition",
    "shippedquantity",
    "carrier",
    "trackingnumber",
    "shipmentstatus",
    "removalordertype",
  ],
  amazon_fba_removal_order_detail: [
    "requestdate",
    "orderid",
    "ordersource",
    "ordertype",
    "servicespeed",
    "orderstatus",
    "lastupdateddate",
    "sku",
    "fnsku",
    "disposition",
    "requestedquantity",
    "cancelledquantity",
    "disposedquantity",
    "shippedquantity",
    "inprocessquantity",
    "removalfee",
    "currency",
  ],
  amazon_sales_and_traffic: [
    "type",
    "date",
    "parentAsin",
    "orderedProductSalesAmount",
    "orderedProductSalesCurrency",
    "unitsOrdered",
    "pageViews",
    "sessions",
  ],
  amazon_v2_seller_performance: [
    "ahrStatus",
    "ahrScore",
    "status",
    "marketplaceId",
  ],
  amazon_flat_file_open_listings_data: [
    "sku",
    "asin",
    "price",
    "quantity",
    "business_price",
    "quantity_price_type",
    "quantity_lower_bound_1",
    "quantity_price_1",
    "quantity_lower_bound_2",
    "quantity_price_2",
    "quantity_lower_bound_3",
    "quantity_price_3",
    "quantity_lower_bound_4",
    "quantity_price_4",
    "quantity_lower_bound_5",
    "quantity_price_5",
    "progressive_price_type",
    "progressive_lower_bound_1",
    "progressive_price_1",
    "progressive_lower_bound_2",
    "progressive_price_2",
    "progressive_lower_bound_3",
    "progressive_price_3",
  ],
  amazon_gst_monthly_b2b: [
    "seller_gstin",
    "invoice_number",
    "invoice_date",
    "transaction_type",
    "order_id",
    "shipment_id",
    "shipment_date",
    "order_date",
    "shipment_item_id",
    "quantity",
    "item_description",
    "asin",
    "hsnsac",
    "sku",
    "product_tax_code",
    "ship_from_city",
    "ship_from_state",
    "ship_from_postal_code",
    "ship_to_city",
    "ship_to_state",
    "ship_to_postal_code",
    "invoice_amount",
    "tax_exclusive_gross",
    "total_tax_amount",
    "cgst_rate",
    "sgst_rate",
    "utgst_rate",
    "igst_rate",
    "compensatory_cess_rate",
    "principal_amount",
    "principal_amount_basis",
    "cgst_tax",
    "sgst_tax",
    "utgst_tax",
    "igst_tax",
    "compensatory_cess_tax",
    "shipping_amount",
    "shipping_amount_basis",
    "shipping_cgst_tax",
    "shipping_sgst_tax",
    "shipping_utgst_tax",
    "shipping_igst_tax",
    "shipping_cess_tax",
    "gift_wrap_amount",
    "gift_wrap_cgst_tax",
    "gift_wrap_sgst_tax",
    "gift_wrap_utgst_tax",
    "gift_wrap_igst_tax",
    "gift_wrap_compensatory_cess_tax",
    "item_promo_discount",
    "item_promo_discount_basis",
    "item_promo_tax",
    "shipping_promo_discount",
    "shipping_promo_discount_basis",
    "shipping_promo_tax",
    "gift_wrap_promo_discount",
    "gift_wrap_promo_discount_basis",
    "gift_wrap_promo_tax",
    "tcs_cgst_rate",
    "tcs_cgst_amount",
    "tcs_sgst_rate",
    "tcs_sgst_amount",
    "tcs_utgst_amount",
    "tcs_igst_rate",
    "tcs_igst_amount",
    "warehouse_id",
    "fulfillment_channel",
    "customer_bill_to_gstid",
    "buyer_name",
    "irn_number",
    "irn_filing_status",
    "irn_date",
    "irn_error_code",
  ],
  amazon_gst_monthly_b2c: [
    "seller_gstin",
    "invoice_number",
    "invoice_date",
    "transaction_type",
    "order_id",
    "shipment_id",
    "shipment_date",
    "order_date",
    "shipment_item_id",
    "quantity",
    "item_description",
    "asin",
    "hsnsac",
    "sku",
    "product_tax_code",
    "ship_from_city",
    "ship_from_state",
    "ship_from_postal_code",
    "ship_to_city",
    "ship_to_state",
    "ship_to_postal_code",
    "invoice_amount",
    "tax_exclusive_gross",
    "total_tax_amount",
    "cgst_rate",
    "sgst_rate",
    "utgst_rate",
    "igst_rate",
    "compensatory_cess_rate",
    "principal_amount",
    "principal_amount_basis",
    "cgst_tax",
    "sgst_tax",
    "utgst_tax",
    "igst_tax",
    "compensatory_cess_tax",
    "shipping_amount",
    "shipping_amount_basis",
    "shipping_cgst_tax",
    "shipping_sgst_tax",
    "shipping_utgst_tax",
    "shipping_igst_tax",
    "shipping_cess_tax_amount",
    "gift_wrap_amount",
    "gift_wrap_cgst_tax",
    "gift_wrap_sgst_tax",
    "gift_wrap_utgst_tax",
    "gift_wrap_igst_tax",
    "gift_wrap_compensatory_cess_tax",
    "item_promo_discount",
    "item_promo_discount_basis",
    "item_promo_tax",
    "shipping_promo_discount",
    "shipping_promo_discount_basis",
    "shipping_promo_tax",
    "gift_wrap_promo_discount",
    "gift_wrap_promo_discount_basis",
    "gift_wrap_promo_tax",
    "tcs_cgst_rate",
    "tcs_cgst_amount",
    "tcs_sgst_rate",
    "tcs_sgst_amount",
    "tcs_utgst_amount",
    "tcs_igst_rate",
    "tcs_igst_amount",
    "warehouse_id",
    "fulfillment_channel",
    "credit_note_no",
    "credit_note_date",
  ],
  amazon_gst_monthly_str: [
    "gstin_of_receiver",
    "transaction_type",
    "transaction_id",
    "order_id",
    "ship_from_fc",
    "ship_from_city",
    "ship_from_state",
    "ship_from_country",
    "ship_from_postal_code",
    "ship_to_fc",
    "ship_to_city",
    "ship_to_state",
    "ship_to_country",
    "ship_to_postal_code",
    "invoice_number",
    "invoice_date",
    "invoice_value",
    "asin",
    "sku",
    "quantity",
    "hsn_code",
    "taxable_value",
    "igst_rate",
    "igst_amount",
    "sgst_rate",
    "sgst_amount",
    "utgst_rate",
    "utgst_amount",
    "cgst_rate",
    "cgst_amount",
    "compensatory_cess_rate",
    "compensatory_cess_amount",
    "gstin_of_supplier",
    "irn_number",
    "irn_filing_status",
    "irn_date",
    "irn_error_code",
  ],
  amazon_unified_transaction: [
    "datetime",
    "settlement_id",
    "type",
    "order_id",
    "sku",
    "description",
    "quantity",
    "marketplace",
    "account_type",
    "fulfillment",
    "order_city",
    "order_state",
    "order_postal",
    "product_sales",
    "shipping_credits",
    "gift_wrap_credits",
    "promotional_rebates",
    "total_sales_tax_liablegst_before_adjusting_tcs",
    "tcscgst",
    "tcssgst",
    "tcsigst",
    "tds_section_194o",
    "selling_fees",
    "fba_fees",
    "other_transaction_fees",
    "other",
    "total",
    "transaction_status",
    "transaction_release_date",
  ],
  amazon_v2_settlement_report_data_flat_file_v2_cod: [
    "settlementid",
    "settlementstartdate",
    "settlementenddate",
    "depositdate",
    "totalamount",
    "currency",
    "transactiontype",
    "orderid",
    "merchantorderid",
    "adjustmentid",
    "shipmentid",
    "marketplacename",
    "amounttype",
    "amountdescription",
    "amount",
    "fulfillmentid",
    "posteddate",
    "posteddatetime",
    "orderitemcode",
    "merchantorderitemid",
    "merchantadjustmentitemid",
    "sku",
    "quantitypurchased",
    "promotionid",
  ],
  amazon_v2_settlement_report_data_flat_file_v2_electronics: [
    "settlementid",
    "settlementstartdate",
    "settlementenddate",
    "depositdate",
    "totalamount",
    "currency",
    "transactiontype",
    "orderid",
    "merchantorderid",
    "adjustmentid",
    "shipmentid",
    "marketplacename",
    "amounttype",
    "amountdescription",
    "amount",
    "fulfillmentid",
    "posteddate",
    "posteddatetime",
    "orderitemcode",
    "merchantorderitemid",
    "merchantadjustmentitemid",
    "sku",
    "quantitypurchased",
    "promotionid",
  ],
};

export function getJsonFieldVal(row: any, reportKey: string, field: string): string | null {
  if (row[field] !== undefined && row[field] !== null) {
    return String(row[field]);
  }

  // Handle nested properties for specific reports
  if (reportKey === "amazon_sales_and_traffic") {
    if (field === "orderedProductSalesAmount") {
      const val = row.salesByDate?.orderedProductSales?.amount ?? row.salesByAsin?.orderedProductSales?.amount;
      return val !== undefined && val !== null ? String(val) : null;
    }
    if (field === "orderedProductSalesCurrency") {
      const val = row.salesByDate?.orderedProductSales?.currencyCode ?? row.salesByAsin?.orderedProductSales?.currencyCode;
      return val !== undefined && val !== null ? String(val) : null;
    }
    if (field === "unitsOrdered") {
      const val = row.salesByDate?.unitsOrdered ?? row.salesByAsin?.unitsOrdered;
      return val !== undefined && val !== null ? String(val) : null;
    }
    if (field === "pageViews") {
      const val = row.trafficByDate?.pageViews ?? row.trafficByAsin?.pageViews;
      return val !== undefined && val !== null ? String(val) : null;
    }
    if (field === "sessions") {
      const val = row.trafficByDate?.sessions ?? row.trafficByAsin?.sessions;
      return val !== undefined && val !== null ? String(val) : null;
    }
  }

  if (reportKey === "amazon_v2_seller_performance") {
    if (field === "ahrStatus") {
      const val = row.accountHealthRating?.ahrStatus;
      return val !== undefined && val !== null ? String(val) : null;
    }
    if (field === "ahrScore") {
      const val = row.accountHealthRating?.ahrScore;
      return val !== undefined && val !== null ? String(val) : null;
    }
    if (field === "status") {
      const val = row.accountStatuses?.[0]?.status;
      return val !== undefined && val !== null ? String(val) : null;
    }
    if (field === "marketplaceId") {
      const val = row.accountStatuses?.[0]?.marketplaceId;
      return val !== undefined && val !== null ? String(val) : null;
    }
  }

  return null;
}

export async function ingestFileToTable(filePath: string, reportKey: string) {
  if (!supabasePrisma) {
    throw new Error(`SUPABASE_DB_URL is not configured. Cannot ingest Amazon report ${reportKey} without a valid Supabase database URL.`);
  }

  const buf = await fs.readFile(filePath);
  const parsed = await parseBuffer(buf, path.basename(filePath));
  const results: any[] = [];

  for (const table of parsed) {
    const rawHeaders = table.headers;
    const headers = rawHeaders.map(normalizeHeader);

    const fileName = path.basename(filePath);
    const sourceName = table.sourceName ?? fileName;

    const items = table.jsonRows || table.rows;

    function normalizeIdentifyingFields(rowObj: Record<string, any>, reportKey: string) {
      const fieldsToNormalize: Record<string, string[]> = {
        amazon_mtr: ["sellersku"],
        amazon_claims_reimbursements: ["reimbursementid"],
        amazon_fba_removal_shipment_detail: ["orderid", "sku", "fnsku", "disposition"],
        amazon_fba_customer_returns: ["orderid", "sku", "returndate", "licenseplatenumber"],
        amazon_fba_removal_order_detail: ["orderid", "sku", "fnsku", "disposition"],
        amazon_sales_and_traffic: ["type", "date", "parentAsin"],
        amazon_flat_file_open_listings_data: ["sku"],
        amazon_ledger_summary: ["date", "fnsku", "disposition", "location"],
        amazon_v2_seller_performance: ["marketplaceId"],
        amazon_gst_monthly_b2b: ["order_id", "sku", "shipment_item_id", "transaction_type"],
        amazon_gst_monthly_b2c: ["order_id", "sku", "shipment_item_id", "transaction_type"],
        amazon_gst_monthly_str: ["invoice_number", "transaction_id", "sku"],
        amazon_unified_transaction: ["datetime", "order_id", "sku", "type", "account_type"],
      };

      const cols = fieldsToNormalize[reportKey];
      if (cols) {
        for (const col of cols) {
          if (rowObj[col] === null || rowObj[col] === undefined) {
            rowObj[col] = "";
          }
        }
      }
    }

    const rowsToInsert = items.map((row: any, rowIndex: number) => {
      let data: any;
      if (table.jsonRows) {
        data = row;
      } else {
        data = headers.reduce<Record<string, string | null>>(
          (accumulator, header, columnIndex) => {
            accumulator[header] =
              row[columnIndex] !== undefined && row[columnIndex] !== null
                ? String(row[columnIndex])
                : null;
            return accumulator;
          },
          {},
        );
      }

      const rowObj: Record<string, any> = {
        reportKey,
      };

      const allowedFields = amazonReportFields[reportKey] || [];
      allowedFields.forEach((field) => {
        if (table.jsonRows) {
          rowObj[field] = getJsonFieldVal(row, reportKey, field);
        } else {
          const colIdx = headers.indexOf(field);
          if (colIdx !== -1) {
            rowObj[field] =
              row[colIdx] !== undefined && row[colIdx] !== null
                ? String(row[colIdx])
                : null;
          } else {
            rowObj[field] = null;
          }
        }
      });

      if (reportKey === "amazon_ledger_summary") {
        rowObj.parsedDate = parseLedgerDate(rowObj.date);
      }

      normalizeIdentifyingFields(rowObj, reportKey);

      return rowObj;
    });

    const tableConfig = amazonReportTableConfigs[reportKey];

    if (!tableConfig) {
      throw new Error(`Unknown Amazon report key: ${reportKey}`);
    }

    const supabaseDelegate = (supabasePrisma as any)[tableConfig.delegateName] as {
      deleteMany: (args: any) => Promise<unknown>;
      createMany: (args: {
        data: any[];
        skipDuplicates?: boolean;
      }) => Promise<unknown>;
    };

    console.log(`Syncing ${rowsToInsert.length} rows to Supabase DB for ${reportKey}...`);

    if (rowsToInsert.length > 0) {
      if (
        reportKey === "amazon_v2_settlement_report_data_flat_file_v2_cod" ||
        reportKey === "amazon_v2_settlement_report_data_flat_file_v2_electronics"
      ) {
        const uniqueSettlements = Array.from(
          new Set(
            rowsToInsert
              .map((r) => r.settlementid)
              .filter((s): s is string => typeof s === "string" && s.length > 0)
          )
        );
        if (uniqueSettlements.length > 0) {
          await supabaseDelegate.deleteMany({
            where: {
              reportKey,
              settlementid: { in: uniqueSettlements },
            },
          });
        }
      }

      if (reportKey === "amazon_mtr") {
        for (const row of rowsToInsert) {
          await (supabasePrisma as any).amazonMtrRow.upsert({
            where: { sellersku: row.sellersku },
            update: row,
            create: row,
          });
        }
      } else if (reportKey === "amazon_flat_file_open_listings_data") {
        for (const row of rowsToInsert) {
          await (supabasePrisma as any).amazonFlatFileOpenListingsDataRow.upsert({
            where: { sku: row.sku },
            update: row,
            create: row,
          });
        }
      } else if (reportKey === "amazon_v2_seller_performance") {
        for (const row of rowsToInsert) {
          await (supabasePrisma as any).amazonV2SellerPerformanceRow.upsert({
            where: { marketplaceId: row.marketplaceId },
            update: row,
            create: row,
          });
        }
      } else {
        const batchSize = 1000;
        for (let i = 0; i < rowsToInsert.length; i += batchSize) {
          const batch = rowsToInsert.slice(i, i + batchSize);
          await supabaseDelegate.createMany({
            data: batch,
            skipDuplicates: true,
          });
        }
      }
    }
    console.log(`Synced ${rowsToInsert.length} rows to Supabase DB for ${reportKey}.`);

    if (reportKey === "amazon_ledger_summary") {
      const daysIndex = process.argv.indexOf("--days");
      let daysLimit = 60; // Default to 60 days
      if (daysIndex !== -1 && process.argv[daysIndex + 1]) {
        const parsedDays = parseInt(process.argv[daysIndex + 1], 10);
        if (!isNaN(parsedDays)) {
          daysLimit = parsedDays;
        }
      }
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - daysLimit);
      try {
        await supabaseDelegate.deleteMany({
          where: {
            reportKey,
            parsedDate: { lt: limitDate },
          },
        });
        console.log(`Pruned ledger records older than ${daysLimit} days.`);
      } catch (pruneErr) {
        console.error("Failed to prune old ledger records:", pruneErr);
      }
    }

    results.push({
      tableName: tableConfig.tableName,
      inserted: rowsToInsert.length,
    });
  }

  return results;
}

if (
  process.argv[1] &&
  process.argv[2] &&
  process.argv[2].endsWith(".js") === false
) {
  // allow direct run: node -r tsx/register src/ingest/runner.ts <file> <reportKey>
}
