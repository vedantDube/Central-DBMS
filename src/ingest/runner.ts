import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeHeader,
  inferTypeForValue,
  mergeTypes,
  sqlTypeFor,
} from "./utils.js";
import { parseBuffer } from "./parser.js";
import { prisma } from "../prisma/client.js";

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
    | "amazonMerchantListingsAllRow"
    | "amazonV2SellerPerformanceRow";
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
  amazon_merchant_listings_all: {
    tableName: "AmazonMerchantListingsAllRow",
    delegateName: "amazonMerchantListingsAllRow",
  },
  amazon_v2_seller_performance: {
    tableName: "AmazonV2SellerPerformanceRow",
    delegateName: "amazonV2SellerPerformanceRow",
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
  amazon_merchant_listings_all: [
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
};

let amazonTablesEnsured = false;

async function ensureAmazonTables() {
  if (amazonTablesEnsured) {
    return;
  }

  for (const config of Object.values(amazonReportTableConfigs)) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${config.tableName}" (
        id text PRIMARY KEY,
        "reportKey" text NOT NULL,
        "fileName" text NOT NULL,
        "sourceName" text NULL,
        "rowIndex" integer NOT NULL,
        data jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );
    `);

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${config.tableName}_reportKey_fileName_sourceName_rowIndex_key" ON "${config.tableName}" ("reportKey", "fileName", "sourceName", "rowIndex")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${config.tableName}_reportKey_createdAt_idx" ON "${config.tableName}" ("reportKey", "createdAt")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${config.tableName}_fileName_createdAt_idx" ON "${config.tableName}" ("fileName", "createdAt")`,
    );
  }

  amazonTablesEnsured = true;
}

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
  await ensureAmazonTables();

  const buf = await fs.readFile(filePath);
  const parsed = await parseBuffer(buf, path.basename(filePath));
  const results: any[] = [];

  for (const table of parsed) {
    const rawHeaders = table.headers;
    const headers = rawHeaders.map(normalizeHeader);

    const fileName = path.basename(filePath);
    const sourceName = table.sourceName ?? fileName;

    const items = table.jsonRows || table.rows;
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
        fileName,
        sourceName,
        rowIndex,
        data,
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

      return rowObj;
    });

    const tableConfig = amazonReportTableConfigs[reportKey];

    if (!tableConfig) {
      throw new Error(`Unknown Amazon report key: ${reportKey}`);
    }

    const delegate = (prisma as any)[tableConfig.delegateName] as {
      deleteMany: (args: {
        where: { reportKey: string; fileName: string; sourceName: string };
      }) => Promise<unknown>;
      createMany: (args: {
        data: any[];
      }) => Promise<unknown>;
    };

    await delegate.deleteMany({
      where: {
        reportKey,
        fileName,
        sourceName,
      },
    });

    if (rowsToInsert.length > 0) {
      await delegate.createMany({
        data: rowsToInsert,
      });
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
