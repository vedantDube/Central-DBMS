export type ReportSource = "auto" | "sp-api" | "browser";

export type AmazonReportKey =
  | "amazon-mtr"
  | "amazon-gst-mtr-b2b"
  | "amazon-gst-mtr-b2c"
  | "amazon-gst-mtr-stock-transfer"
  | "amazon-gst-monthly-b2b"
  | "amazon-gst-monthly-b2c"
  | "amazon-gst-monthly-str"
  | "amazon-returns-b2c"
  | "amazon-returns-b2b"
  | "amazon-payment-transaction"
  | "amazon-claims-reimbursements"
  | "amazon-fba-customer-returns"
  | "amazon-fba-removal-shipment-detail"
  | "amazon-fba-removal-order-detail"
  | "amazon-afn-inventory"
  | "amazon-sales-and-traffic"
  | "amazon-brand-analytics-search-catalog-performance"
  | "amazon-brand-analytics-search-query-performance"
  | "amazon-brand-analytics-search-terms"
  | "amazon-brand-analytics-repeat-purchase"
  | "amazon-flat-file-open-listings-data"
  | "amazon-v2-seller-performance"
  | "amazon-v2-settlement-report-data-flat-file-v2"
  | "amazon-day-level-inventory"
  | "amazon-ads-campaign"
  | "amazon-lis-data"
  | "amazon-payment-statements"
  | "amazon-ledger-summary";

export type AmazonReportDefinition = {
  key: AmazonReportKey;
  label: string;
  storagePath: string;
  reportTypeId?: string;
  preferredSource: Exclude<ReportSource, "auto">;
  fileExtension: "csv" | "tsv";
  browserUrl?: string;
  browserDownloadSelector?: string;
  browserWaitBeforeDownloadMs?: number;
};

export type DownloadResult = {
  fileName: string;
  contentType: string;
  body: Buffer;
  source: "sp-api" | "browser";
};
