import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const schema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_DB_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_BUCKET: z.string().default("amazon-raw"),
  SP_REFRESH_TOKEN: z.string().optional(),
  SP_CLIENT_ID: z.string().optional(),
  SP_CLIENT_SECRET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  MARKETPLACE_ID: z.string().default("A21TJRUUN4KGV"),
  REGION: z.enum(["eu", "na", "fe"]).default("eu"),
  AMAZON_MTR_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_GST_MTR_B2B_BROWSER_URL: z.string().optional(),
  AMAZON_GST_MTR_B2B_BROWSER_DOWNLOAD_SELECTOR: z.string().optional(),
  AMAZON_GST_MTR_B2C_BROWSER_URL: z.string().optional(),
  AMAZON_GST_MTR_B2C_BROWSER_DOWNLOAD_SELECTOR: z.string().optional(),
  AMAZON_GST_MTR_STOCK_TRANSFER_BROWSER_URL: z.string().optional(),
  AMAZON_GST_MTR_STOCK_TRANSFER_BROWSER_DOWNLOAD_SELECTOR: z
    .string()
    .optional(),
  AMAZON_BROWSER_USER_DATA_DIR: z.string().optional(),
  AMAZON_BROWSER_HEADLESS: z.string().optional(),
  AMAZON_RETURNS_B2C_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_RETURNS_B2B_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_PAYMENT_TRANSACTION_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_CLAIMS_REIMBURSEMENTS_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_FBA_CUSTOMER_RETURNS_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_FBA_REMOVAL_SHIPMENT_DETAIL_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_FBA_REMOVAL_ORDER_DETAIL_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_AFN_INVENTORY_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_SALES_AND_TRAFFIC_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT_TYPE_ID: z
    .string()
    .optional(),
  AMAZON_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT_TYPE_ID: z
    .string()
    .optional(),
  AMAZON_BRAND_ANALYTICS_SEARCH_TERMS_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_FLAT_FILE_OPEN_LISTINGS_DATA_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_V2_SELLER_PERFORMANCE_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2_REPORT_TYPE_ID: z
    .string()
    .optional(),
  AMAZON_DAY_LEVEL_INVENTORY_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_ADS_CAMPAIGN_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_LIS_DATA_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_PAYMENT_STATEMENTS_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_LEDGER_SUMMARY_REPORT_TYPE_ID: z.string().optional(),
  AMAZON_BROWSER_REPORT_URL: z.string().optional(),
  AMAZON_BROWSER_DOWNLOAD_SELECTOR: z.string().optional(),
  AMAZON_INTER_REQUEST_DELAY_MS: z.string().optional(),
  AMAZON_MAX_RETRIES: z.string().optional(),
  AMAZON_BASE_BACKOFF_MS: z.string().optional(),
  AMAZON_MAX_BACKOFF_MS: z.string().optional(),
  RP_TOKEN: z.string().optional(),
  SHIPROCKET_TOKEN: z.string().optional(),
  SHIPROCKET_EMAIL: z.string().optional(),
  SHIPROCKET_PASSWORD: z.string().optional(),
  EASY_ECOM_EMAIL: z.string().optional(),
  EASY_ECOM_PASSWORD: z.string().optional(),
  EASY_ECOM_API_KEY: z.string().optional(),
  EASY_ECOM_LOCATION_KEY: z.string().optional(),
  SHOPIFY_DOMAIN: z.string().default("cubelelo-cube-store.myshopify.com"),
  SHOPIFY_ACCESS_TOKEN: z.string().default("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"),
  SHOPIFY_API_VERSION: z.string().default("2024-01"),
});

export const env = schema.parse(process.env);
