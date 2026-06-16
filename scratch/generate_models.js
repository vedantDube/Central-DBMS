import { normalizeHeader } from '../src/ingest/utils.ts';

const b2bHeaders = [
  "Seller Gstin",
  "Invoice Number",
  "Invoice Date",
  "Transaction Type",
  "Order Id",
  "Shipment Id",
  "Shipment Date",
  "Order Date",
  "Shipment Item Id",
  "Quantity",
  "Item Description",
  "Asin",
  "Hsn/sac",
  "Sku",
  "Product Tax Code",
  "Bill From City",
  "Bill From State",
  "Bill From Country",
  "Bill From Postal Code",
  "Ship From City",
  "Ship From State",
  "Ship From Country",
  "Ship From Postal Code",
  "Ship To City",
  "Ship To State",
  "Ship To Country",
  "Ship To Postal Code",
  "Invoice Amount",
  "Tax Exclusive Gross",
  "Total Tax Amount",
  "Cgst Rate",
  "Sgst Rate",
  "Utgst Rate",
  "Igst Rate",
  "Compensatory Cess Rate",
  "Principal Amount",
  "Principal Amount Basis",
  "Cgst Tax",
  "Sgst Tax",
  "Utgst Tax",
  "Igst Tax",
  "Compensatory Cess Tax",
  "Shipping Amount",
  "Shipping Amount Basis",
  "Shipping Cgst Tax",
  "Shipping Sgst Tax",
  "Shipping Utgst Tax",
  "Shipping Igst Tax",
  "Shipping Cess Tax",
  "Gift Wrap Amount",
  "Gift Wrap Amount Basis",
  "Gift Wrap Cgst Tax",
  "Gift Wrap Sgst Tax",
  "Gift Wrap Utgst Tax",
  "Gift Wrap Igst Tax",
  "Gift Wrap Compensatory Cess Tax",
  "Item Promo Discount",
  "Item Promo Discount Basis",
  "Item Promo Tax",
  "Shipping Promo Discount",
  "Shipping Promo Discount Basis",
  "Shipping Promo Tax",
  "Gift Wrap Promo Discount",
  "Gift Wrap Promo Discount Basis",
  "Gift Wrap Promo Tax",
  "Tcs Cgst Rate",
  "Tcs Cgst Amount",
  "Tcs Sgst Rate",
  "Tcs Sgst Amount",
  "Tcs Utgst Rate",
  "Tcs Utgst Amount",
  "Tcs Igst Rate",
  "Tcs Igst Amount",
  "Warehouse Id",
  "Fulfillment Channel",
  "Payment Method Code",
  "Bill To City",
  "Bill To State",
  "Bill To Country",
  "Bill To Postalcode",
  "Customer Bill To Gstid",
  "Customer Ship To Gstid",
  "Buyer Name",
  "Credit Note No",
  "Credit Note Date",
  "Irn Number",
  "Irn Filing Status",
  "Irn Date",
  "Irn Error Code"
];

const b2cHeaders = [
  "Seller Gstin",
  "Invoice Number",
  "Invoice Date",
  "Transaction Type",
  "Order Id",
  "Shipment Id",
  "Shipment Date",
  "Order Date",
  "Shipment Item Id",
  "Quantity",
  "Item Description",
  "Asin",
  "Hsn/sac",
  "Sku",
  "Product Tax Code",
  "Bill From City",
  "Bill From State",
  "Bill From Country",
  "Bill From Postal Code",
  "Ship From City",
  "Ship From State",
  "Ship From Country",
  "Ship From Postal Code",
  "Ship To City",
  "Ship To State",
  "Ship To Country",
  "Ship To Postal Code",
  "Invoice Amount",
  "Tax Exclusive Gross",
  "Total Tax Amount",
  "Cgst Rate",
  "Sgst Rate",
  "Utgst Rate",
  "Igst Rate",
  "Compensatory Cess Rate",
  "Principal Amount",
  "Principal Amount Basis",
  "Cgst Tax",
  "Sgst Tax",
  "Igst Tax",
  "Utgst Tax",
  "Compensatory Cess Tax",
  "Shipping Amount",
  "Shipping Amount Basis",
  "Shipping Cgst Tax",
  "Shipping Sgst Tax",
  "Shipping Utgst Tax",
  "Shipping Igst Tax",
  "Shipping Cess Tax Amount",
  "Gift Wrap Amount",
  "Gift Wrap Amount Basis",
  "Gift Wrap Cgst Tax",
  "Gift Wrap Sgst Tax",
  "Gift Wrap Utgst Tax",
  "Gift Wrap Igst Tax",
  "Gift Wrap Compensatory Cess Tax",
  "Item Promo Discount",
  "Item Promo Discount Basis",
  "Item Promo Tax",
  "Shipping Promo Discount",
  "Shipping Promo Discount Basis",
  "Shipping Promo Tax",
  "Gift Wrap Promo Discount",
  "Gift Wrap Promo Discount Basis",
  "Gift Wrap Promo Tax",
  "Tcs Cgst Rate",
  "Tcs Cgst Amount",
  "Tcs Sgst Rate",
  "Tcs Sgst Amount",
  "Tcs Utgst Rate",
  "Tcs Utgst Amount",
  "Tcs Igst Rate",
  "Tcs Igst Amount",
  "Warehouse Id",
  "Fulfillment Channel",
  "Payment Method Code",
  "Credit Note No",
  "Credit Note Date"
];

const strHeaders = [
  "Gstin Of Receiver",
  "Transaction Type",
  "Transaction Id",
  "Order Id",
  "Ship From Fc",
  "Ship From City",
  "Ship From State",
  "Ship From Country",
  "Ship From Postal Code",
  "Ship To Fc",
  "Ship To City",
  "Ship To State",
  "Ship To Country",
  "Ship To Postal Code",
  "Invoice Number",
  "Invoice Date",
  "Invoice Value",
  "Asin",
  "Sku",
  "Quantity",
  "Hsn Code",
  "Taxable Value",
  "Igst Rate",
  "Igst Amount",
  "Sgst Rate",
  "Sgst Amount",
  "Utgst Rate",
  "Utgst Amount",
  "Cgst Rate",
  "Cgst Amount",
  "Compensatory Cess Rate",
  "Compensatory Cess Amount",
  "Gstin Of Supplier",
  "Irn Number",
  "Irn Filing Status",
  "Irn Date",
  "Irn Error Code"
];

function generatePrismaModel(modelName, headers) {
  let out = `model ${modelName} {\n`;
  out += `  id         String   @id @default(cuid())\n`;
  out += `  reportKey  String\n`;
  out += `  fileName   String\n`;
  out += `  sourceName String?\n`;
  out += `  rowIndex   Int\n`;
  out += `  data       Json\n`;
  out += `  createdAt  DateTime @default(now())\n\n`;
  out += `  // CSV Columns\n`;
  
  const seen = new Set();
  for (const h of headers) {
    const norm = normalizeHeader(h);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out += `  ${norm.padEnd(28)} String?\n`;
  }
  
  out += `\n`;
  out += `  @@unique([reportKey, fileName, sourceName, rowIndex])\n`;
  out += `  @@index([reportKey, createdAt])\n`;
  out += `  @@index([fileName, createdAt])\n`;
  out += `}\n`;
  return out;
}

function generateFieldList(headers) {
  const seen = new Set();
  const list = [];
  for (const h of headers) {
    const norm = normalizeHeader(h);
    if (seen.has(norm)) continue;
    seen.add(norm);
    list.push(norm);
  }
  return list;
}

import fsPromises from 'node:fs/promises';

async function run() {
  let finalOut = "";
  finalOut += "=== PRISMA MODELS ===\n";
  finalOut += generatePrismaModel("AmazonGstMonthlyB2bRow", b2bHeaders) + "\n";
  finalOut += generatePrismaModel("AmazonGstMonthlyB2cRow", b2cHeaders) + "\n";
  finalOut += generatePrismaModel("AmazonGstMonthlyStrRow", strHeaders) + "\n";

  finalOut += "=== FIELD LISTS FOR runner.ts ===\n";
  finalOut += `amazon_gst_monthly_b2b: ${JSON.stringify(generateFieldList(b2bHeaders), null, 2)},\n`;
  finalOut += `amazon_gst_monthly_b2c: ${JSON.stringify(generateFieldList(b2cHeaders), null, 2)},\n`;
  finalOut += `amazon_gst_monthly_str: ${JSON.stringify(generateFieldList(strHeaders), null, 2)},\n`;

  await fsPromises.writeFile('./scratch/models_output.txt', finalOut);
  console.log("Done writing scratch/models_output.txt");
}

run();

