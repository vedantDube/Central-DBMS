import "dotenv/config";
import express from "express";
import path from "path";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import pg from "pg";

const { Pool } = pg;

// "Beyond Ads" is billed at a fixed 10% of Amazon-billed ad spend (finance-confirmed constant, not user-editable)
const BEYOND_ADS_MULTIPLIER = 0.10;

// Custom connection string parser to handle special characters (like @, /, or :) in passwords
export function parseConnectionString(uri: string) {
  try {
    const cleanUri = uri.trim();
    if (!cleanUri) return null;
    
    let remaining = cleanUri;
    let protocol = "postgresql";
    if (remaining.toLowerCase().startsWith("postgresql://")) {
      protocol = "postgresql";
      remaining = remaining.substring("postgresql://".length);
    } else if (remaining.toLowerCase().startsWith("postgres://")) {
      protocol = "postgres";
      remaining = remaining.substring("postgres://".length);
    } else {
      return null;
    }
    
    // Find last '@' to isolate host details from credentials
    const lastAtIndex = remaining.lastIndexOf("@");
    if (lastAtIndex === -1) {
      return null;
    }
    
    const credentialsPart = remaining.substring(0, lastAtIndex);
    const hostPart = remaining.substring(lastAtIndex + 1);
    
    let user = "postgres";
    let password = "";
    const firstColIdx = credentialsPart.indexOf(":");
    if (firstColIdx !== -1) {
      user = credentialsPart.substring(0, firstColIdx);
      password = credentialsPart.substring(firstColIdx + 1);
    } else {
      user = credentialsPart;
    }
    
    const firstSlashIdx = hostPart.indexOf("/");
    let hostPortStr = hostPart;
    let database = "postgres";
    
    if (firstSlashIdx !== -1) {
      hostPortStr = hostPart.substring(0, firstSlashIdx);
      const queryParamsIdx = hostPart.indexOf("?", firstSlashIdx);
      if (queryParamsIdx !== -1) {
        database = hostPart.substring(firstSlashIdx + 1, queryParamsIdx);
      } else {
        database = hostPart.substring(firstSlashIdx + 1);
      }
    }
    
    let host = hostPortStr;
    let port = 5432;
    const lastColonIdx = hostPortStr.lastIndexOf(":");
    if (lastColonIdx !== -1) {
      const hasBrackets = hostPortStr.includes("]") && lastColonIdx < hostPortStr.lastIndexOf("]");
      if (!hasBrackets) {
        host = hostPortStr.substring(0, lastColonIdx);
        const parsedPort = parseInt(hostPortStr.substring(lastColonIdx + 1), 10);
        if (!isNaN(parsedPort)) {
          port = parsedPort;
        }
      }
    }
    
    const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
    return {
      user: safeDecode(user),
      password: safeDecode(password),
      host: host,
      port: port,
      database: safeDecode(database)
    };
  } catch (err) {
    console.error("Custom connection string parser error:", err);
    return null;
  }
}

// Initialize Database connection pool lazily & dynamically detect URL updates
let dbPool: pg.Pool | null = null;
let activeDbUrl: string | null = null;

const getDbPool = () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.includes("[YOUR-PASSWORD]") || dbUrl.trim() === "") {
    throw new Error("DATABASE_URL is not configured or contains placeholder [YOUR-PASSWORD]. Please open Settings (Gear icon) -> Secrets in the developer workspace, add DATABASE_URL, and insert your real connection URI.");
  }

  // If pool already exists and is for the same DATABASE_URL, return cached instance
  if (dbPool && activeDbUrl === dbUrl) {
    return dbPool;
  }

  // Connection string updated or newly launched: rebuild pool
  if (dbPool) {
    dbPool.end().catch(() => {});
  }

  activeDbUrl = dbUrl;
  const parsed = parseConnectionString(dbUrl);

  if (parsed) {
    dbPool = new Pool({
      host: parsed.host,
      port: parsed.port,
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
      ssl: {
        rejectUnauthorized: false
      }
    });
  } else {
    // Fallback to default raw parser if custom regex parse fails
    dbPool = new Pool({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }

  return dbPool;
};

// Mask sensitive passwords in connection URI for debugging reports
const getRedactedDbUrl = () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return "NOT_SET";
  if (dbUrl.includes("[YOUR-PASSWORD]")) return "CONTAINS_PLACEHOLDER_PASSWORD";
  
  const parsed = parseConnectionString(dbUrl);
  if (parsed) {
    return `postgresql://${parsed.user}:********@${parsed.host}:${parsed.port}/${parsed.database}`;
  }
  return "CONFIGURED";
};

// Initialize Gemini SDK with runtime key
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // API Status Endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  // 1. Check database URL status
  app.get("/api/amazon/db-status", (req, res) => {
    try {
      const redactedUrl = getRedactedDbUrl();
      const dbUrl = process.env.DATABASE_URL;
      const isSet = !!dbUrl && dbUrl.trim() !== "" && !dbUrl.includes("[YOUR-PASSWORD]");
      
      let debugInfo = null;
      if (dbUrl) {
        const parsed = parseConnectionString(dbUrl);
        debugInfo = {
          parsedReady: !!parsed,
          parsedHost: parsed?.host || null,
          parsedPort: parsed?.port || null,
          parsedDatabase: parsed?.database || null,
          parsedUser: parsed?.user || null,
          systemPgHost: process.env.PGHOST || "NOT_SET",
          systemPgPort: process.env.PGPORT || "NOT_SET",
          systemPgUser: process.env.PGUSER || "NOT_SET",
          systemPgDatabase: process.env.PGDATABASE || "NOT_SET"
        };
      }

      res.json({
        success: true,
        isConfigured: isSet,
        redactedUrl,
        debugInfo,
        message: isSet 
          ? "Database connection URL is registered system-wide. Attempt schema probe to verify credentials." 
          : "DATABASE_URL is not configured yet or has a placeholder."
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  // 2. Schema Probe & Row Pull for AmazonGstMonthlyB2cRow
  app.get("/api/amazon/b2c-schema", async (req, res) => {
    let client;
    try {
      const redactedUrl = getRedactedDbUrl();
      const pool = getDbPool();
      client = await pool.connect();

      // Retrieve public schema tables to locate case matching
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      const availableTables = tablesResult.rows.map((r: any) => r.table_name);

      // Check if table name is in list
      const targetTable = availableTables.find(
        (t: string) => t.toLowerCase() === "amazongstmonthlyb2crow"
      ) || "AmazonGstMonthlyB2cRow";

      // Query table column details
      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE LOWER(table_name) = LOWER($1)
        ORDER BY ordinal_position;
      `, [targetTable]);

      const columns = columnsResult.rows.map((col: any) => ({
        columnName: col.column_name,
        dataType: col.data_type,
        isNullable: col.is_nullable,
        specs: col.character_maximum_length 
          ? `VARCHAR(${col.character_maximum_length})` 
          : col.numeric_precision 
            ? `NUMERIC(${col.numeric_precision}, ${col.numeric_scale || 0})` 
            : col.data_type
      }));

      // Pull row count check
      let rowCount = 0;
      try {
        const countRes = await client.query(`SELECT COUNT(*) as count FROM "${targetTable}"`);
        rowCount = parseInt(countRes.rows[0]?.count || "0", 10);
      } catch (countError: any) {
        // Fallback without double quotes if failed
        const countRes = await client.query(`SELECT COUNT(*) as count FROM ${targetTable}`);
        rowCount = parseInt(countRes.rows[0]?.count || "0", 10);
      }

      // Pull sample rows (up to 25 rows)
      let sampleRows: any[] = [];
      try {
        const sampleRes = await client.query(`SELECT * FROM "${targetTable}" LIMIT 25`);
        sampleRows = sampleRes.rows;
      } catch (sampleErr: any) {
        const sampleRes = await client.query(`SELECT * FROM ${targetTable} LIMIT 25`);
        sampleRows = sampleRes.rows;
      }

      res.json({
        success: true,
        redactedUrl,
        tableNameFound: targetTable,
        rowCount,
        columns,
        sampleRows,
        availableTables,
      });

    } catch (err: any) {
      console.error("Database connection probe failed:", err);
      const errMsg = err?.message || String(err);
      
      let suggestion = "Please verify that your Supabase instance is online, does not block connection with firewall rules, and that database credentials are correct.";
      
      if (errMsg.includes("EAI_AGAIN") || errMsg.includes("ENOTFOUND")) {
        suggestion = "Supabase Direct connections use IPv6 address space by default. Because Cloud Run sandboxes typically run in IPv4-only networks, trying to resolve IPv6 addresses directly results in lookup timeouts (EAI_AGAIN/ENOTFOUND).\n\n" +
          "👉 SOLUTION: In your Supabase Dashboard, click \"Connect to your project\" (top right), switch the Connection Method from \"Direct connection\" to \"Transaction pooler\" (or \"Session pooler\"), then copy that pooled URI and update your DATABASE_URL secret. This uses a standard IPv4 pooler address on port 6543 (or 5432) which will connect instantly!";
      } else if (errMsg.includes("password auth failed") || errMsg.includes("authentication failed")) {
        suggestion = "The database password you entered is incorrect.\n\n" +
          "👉 SOLUTION: Please verify your Supabase database password (usually set when creating the project). If you forgot it, go to your Supabase Project Settings -> Database -> and click 'Reset password' to input a new password. Make sure to update the DATABASE_URL secret with the new password!";
      }

      res.json({
        success: false,
        redactedUrl: getRedactedDbUrl(),
        error: errMsg,
        suggestion,
        helpText: "Ensure your DATABASE_URL in the Secrets panel has the format: postgresql://postgres:YOUR_PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  });

  // Diagnostic: check date formats in Amazon tables
  app.get("/api/amazon/date-samples", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();
      const [gstDates, utDates, returnDates, claimDates, ledgerDates, mtrCount, returnsCount, claimsCount, ledgerCount] = await Promise.all([
        client.query(`SELECT DISTINCT order_date FROM "Amazon_GST_Master" WHERE order_date IS NOT NULL LIMIT 10`),
        client.query(`SELECT DISTINCT datetime FROM "Amazon_Unified_Transactions" WHERE datetime IS NOT NULL LIMIT 10`),
        client.query(`SELECT DISTINCT returndate FROM "AmazonReturnsB2cRow" WHERE returndate IS NOT NULL LIMIT 10`),
        client.query(`SELECT DISTINCT approvaldate FROM "AmazonClaimsReimbursementsRow" WHERE approvaldate IS NOT NULL LIMIT 10`),
        client.query(`SELECT DISTINCT date FROM "AmazonLedgerSummaryRow" WHERE date IS NOT NULL LIMIT 10`),
        client.query(`SELECT COUNT(*) as c FROM "AmazonMtrRow"`),
        client.query(`SELECT COUNT(*) as c FROM "AmazonReturnsB2cRow"`),
        client.query(`SELECT COUNT(*) as c FROM "AmazonClaimsReimbursementsRow"`),
        client.query(`SELECT COUNT(*) as c FROM "AmazonLedgerSummaryRow"`),
      ]);
      res.json({
        gstMasterDates: gstDates.rows.map((r: any) => r.order_date),
        unifiedTransactionDates: utDates.rows.map((r: any) => r.datetime),
        returnDates: returnDates.rows.map((r: any) => r.returndate),
        claimDates: claimDates.rows.map((r: any) => r.approvaldate),
        ledgerDates: ledgerDates.rows.map((r: any) => r.date),
        rowCounts: {
          mtr: parseInt(mtrCount.rows[0].c),
          returns: parseInt(returnsCount.rows[0].c),
          claims: parseInt(claimsCount.rows[0].c),
          ledger: parseInt(ledgerCount.rows[0].c),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    } finally {
      if (client) client.release();
    }
  });

  // Amazon SKU Profitability Endpoint
  app.get("/api/amazon/sku-profitability", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;
      const gstMode = (req.query.gstMode as string) === "inclusive" ? "inclusive" : "exclusive";
      const revenueCol = gstMode === "inclusive" ? "invoice_amount" : "tax_exclusive_gross";

      let gstDateFilter = "";
      let returnDateFilter = "";
      let utDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND order_date >= $1 AND order_date <= $2`;
        returnDateFilter = `AND returndate >= $1 AND returndate <= $2`;
        utDateFilter = `AND TO_DATE(datetime, 'DD Mon YYYY') >= $1::date AND TO_DATE(datetime, 'DD Mon YYYY') <= $2::date`;
      }

      const [gstResult, feesResult, returnsResult, productsResult, trafficResult] = await Promise.all([
        client.query(`
          SELECT sku,
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS units_sold,
            COALESCE(SUM(cost_inventory), 0) AS cogs
          FROM "Amazon_GST_Master"
          WHERE 1=1 ${gstDateFilter}
          GROUP BY sku
        `, params),
        client.query(`
          SELECT sku,
            COALESCE(ABS(SUM(CAST(NULLIF(REPLACE(fba_fees, ',', ''), '') AS numeric))), 0) AS fba_fees,
            COALESCE(ABS(SUM(CAST(NULLIF(REPLACE(selling_fees, ',', ''), '') AS numeric))), 0) AS selling_fees,
            COALESCE(ABS(SUM(CAST(NULLIF(REPLACE(other_transaction_fees, ',', ''), '') AS numeric))), 0) AS other_fees
          FROM "Amazon_Unified_Transactions"
          WHERE 1=1 ${utDateFilter}
          GROUP BY sku
        `, params),
        client.query(`
          SELECT sku, COALESCE(SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)), 0) AS returned_qty
          FROM "AmazonReturnsB2cRow"
          WHERE 1=1 ${returnDateFilter}
          GROUP BY sku
        `, params),
        client.query(`SELECT sku, product_name, category_name, brand FROM "EasyEcomProductMaster"`),
        // Glance Views / Conversion Rate: real data from the Sales & Traffic report, joined SKU -> ASIN -> traffic.
        // NOTE: AmazonSalesAndTrafficRow "asin" rows carry no date (lifetime totals per ASIN), so this is NOT
        // date-range filterable -- it reflects all-time traffic for the ASIN, not the selected period.
        client.query(`
          SELECT m.sellersku AS sku,
            SUM(CAST(NULLIF(t."pageViews", '') AS numeric)) AS glance_views,
            SUM(CAST(NULLIF(t.sessions, '') AS numeric)) AS sessions,
            SUM(CAST(NULLIF(t."unitsOrdered", '') AS numeric)) AS units_ordered
          FROM "AmazonMtrRow" m
          JOIN "AmazonSalesAndTrafficRow" t ON t."parentAsin" = m.asin1 AND t.type = 'asin'
          WHERE m.asin1 IS NOT NULL AND m.asin1 != ''
          GROUP BY m.sellersku
        `),
      ]);

      const feesMap: Record<string, { fba: number; selling: number; other: number }> = {};
      for (const row of feesResult.rows) {
        feesMap[row.sku] = {
          fba: parseFloat(row.fba_fees),
          selling: parseFloat(row.selling_fees),
          other: parseFloat(row.other_fees),
        };
      }

      const returnsMap: Record<string, number> = {};
      for (const row of returnsResult.rows) {
        returnsMap[row.sku] = parseFloat(row.returned_qty);
      }

      const productMap: Record<string, { name: string; category: string }> = {};
      for (const row of productsResult.rows) {
        productMap[row.sku] = {
          name: row.product_name || row.sku,
          category: row.category_name || "Uncategorized",
        };
      }

      const trafficMap: Record<string, { glanceViews: number; sessions: number; unitsOrdered: number }> = {};
      for (const row of trafficResult.rows) {
        trafficMap[row.sku] = {
          glanceViews: parseFloat(row.glance_views),
          sessions: parseFloat(row.sessions),
          unitsOrdered: parseFloat(row.units_ordered),
        };
      }

      const skus = gstResult.rows
        .map((row: any) => {
          const sku = row.sku;
          const revenue = parseFloat(row.revenue);
          const unitsSold = parseFloat(row.units_sold);
          const cogs = parseFloat(row.cogs);
          const fees = feesMap[sku] || { fba: 0, selling: 0, other: 0 };
          const marketplaceFees = fees.fba + fees.selling + fees.other;
          const returnedQty = returnsMap[sku] || 0;
          const returnLoss = unitsSold > 0 ? (returnedQty / unitsSold) * revenue * 0.5 : 0;
          const cm1 = revenue - cogs - marketplaceFees - returnLoss;
          const product = productMap[sku];
          const traffic = trafficMap[sku];

          let status: "Profitable" | "Borderline" | "Loss Making" = "Profitable";
          if (cm1 < 0) status = "Loss Making";
          else if (revenue > 0 && cm1 < revenue * 0.08) status = "Borderline";

          return {
            sku,
            name: product?.name || sku,
            category: product?.category || "Uncategorized",
            unitsSold,
            revenue: Math.round(revenue * 100) / 100,
            landingCost: Math.round(cogs * 100) / 100,
            marketplaceFees: Math.round(marketplaceFees * 100) / 100,
            packagingCost: 0,
            shippingCost: 0,
            returnLoss: Math.round(returnLoss * 100) / 100,
            adsSpend: 0,
            netProfit: Math.round(cm1 * 100) / 100,
            contributionMargin1: Math.round(cm1 * 100) / 100,
            contributionMargin2: Math.round(cm1 * 100) / 100,
            status,
            // Lifetime (not period-filtered) real traffic data via Sales & Traffic report -- null if no ASIN match
            glanceViews: traffic ? traffic.glanceViews : null,
            conversionRate: traffic && traffic.sessions > 0 ? Math.round((traffic.unitsOrdered / traffic.sessions) * 10000) / 100 : null,
            // Logic undefined -- stub until a real "Mover & Shaker" definition is confirmed
            moverShaker: false,
          };
        })
        .filter((s: any) => s.revenue > 0)
        .sort((a: any, b: any) => b.revenue - a.revenue);

      res.json({ success: true, data: skus, gstMode });
    } catch (err: any) {
      console.error("Amazon SKU profitability query failed:", err);
      res.status(500).json({ success: false, error: err?.message || String(err) });
    } finally {
      if (client) client.release();
    }
  });

  // Amazon Anomaly Detection Endpoint
  app.get("/api/amazon/anomalies", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;

      let gstDateFilter = "";
      let returnDateFilter = "";
      let utDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND order_date >= $1 AND order_date <= $2`;
        returnDateFilter = `AND returndate >= $1 AND returndate <= $2`;
        utDateFilter = `AND TO_DATE(datetime, 'DD Mon YYYY') >= $1::date AND TO_DATE(datetime, 'DD Mon YYYY') <= $2::date`;
      }

      const [unreconciledResult, highReturnResult, feeOverchargeResult] = await Promise.all([
        client.query(`
          SELECT order_id, sku, invoice_amount, gross_diff, tax_diff, invoice_diff
          FROM "Amazon_GST_Master"
          WHERE reconciled = false
            AND (
              (gross_diff IS NOT NULL AND gross_diff != 0)
              OR (tax_diff IS NOT NULL AND tax_diff != 0)
              OR (invoice_diff IS NOT NULL AND invoice_diff != 0)
            )
            ${gstDateFilter}
          ORDER BY ABS(COALESCE(invoice_diff, 0)) DESC
          LIMIT 10
        `, params),

        client.query(`
          SELECT g.sku,
            COALESCE(SUM(CASE WHEN g.transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(g.quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS shipped,
            COALESCE(r.returned, 0) AS returned
          FROM "Amazon_GST_Master" g
          LEFT JOIN (
            SELECT sku, SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) AS returned
            FROM "AmazonReturnsB2cRow"
            WHERE 1=1 ${returnDateFilter}
            GROUP BY sku
          ) r ON g.sku = r.sku
          WHERE g.transaction_type = 'Shipment' ${gstDateFilter}
          GROUP BY g.sku, r.returned
          HAVING COALESCE(r.returned, 0) > 0
            AND COALESCE(r.returned, 0) / NULLIF(SUM(CASE WHEN g.transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(g.quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) > 0.15
          ORDER BY COALESCE(r.returned, 0) / NULLIF(SUM(CASE WHEN g.transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(g.quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) DESC
          LIMIT 10
        `, params),

        client.query(`
          SELECT order_id, sku,
            CAST(NULLIF(REPLACE(product_sales, ',', ''), '') AS numeric) AS sales,
            ABS(CAST(NULLIF(REPLACE(fba_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(selling_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(other_transaction_fees, ',', ''), '') AS numeric)) AS total_fees
          FROM "Amazon_Unified_Transactions"
          WHERE CAST(NULLIF(REPLACE(product_sales, ',', ''), '') AS numeric) > 100
            ${utDateFilter}
            AND (
              ABS(CAST(NULLIF(REPLACE(fba_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(selling_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(other_transaction_fees, ',', ''), '') AS numeric))
            ) / CAST(NULLIF(REPLACE(product_sales, ',', ''), '') AS numeric) > 0.40
          ORDER BY (
              ABS(CAST(NULLIF(REPLACE(fba_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(selling_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(other_transaction_fees, ',', ''), '') AS numeric))
            ) / CAST(NULLIF(REPLACE(product_sales, ',', ''), '') AS numeric) DESC
          LIMIT 10
        `, params),
      ]);

      const unreconciledOrders = unreconciledResult.rows.map((r: any) => ({
        orderId: r.order_id,
        sku: r.sku,
        invoiceAmount: parseFloat(r.invoice_amount) || 0,
        grossDiff: parseFloat(r.gross_diff) || 0,
        taxDiff: parseFloat(r.tax_diff) || 0,
        invoiceDiff: parseFloat(r.invoice_diff) || 0,
      }));

      const highReturnSkus = highReturnResult.rows.map((r: any) => {
        const shipped = parseFloat(r.shipped);
        const returned = parseFloat(r.returned);
        return {
          sku: r.sku,
          shipped,
          returned,
          returnRate: shipped > 0 ? Math.round((returned / shipped) * 10000) / 100 : 0,
        };
      });

      const feeOvercharges = feeOverchargeResult.rows.map((r: any) => {
        const sales = parseFloat(r.sales);
        const totalFees = parseFloat(r.total_fees);
        return {
          orderId: r.order_id,
          sku: r.sku,
          sales: Math.round(sales * 100) / 100,
          totalFees: Math.round(totalFees * 100) / 100,
          feeRatio: sales > 0 ? Math.round((totalFees / sales) * 10000) / 100 : 0,
        };
      });

      res.json({
        success: true,
        data: { unreconciledOrders, highReturnSkus, feeOvercharges },
      });
    } catch (err: any) {
      console.error("Amazon anomalies query failed:", err);
      res.status(500).json({ success: false, error: err?.message || String(err) });
    } finally {
      if (client) client.release();
    }
  });

  // Amazon Anomalies CSV Download
  app.get("/api/amazon/anomalies/csv", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;
      const type = (req.query.type as string) || "unreconciled";

      let gstDateFilter = "";
      let returnDateFilter = "";
      let utDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND order_date >= $1 AND order_date <= $2`;
        returnDateFilter = `AND returndate >= $1 AND returndate <= $2`;
        utDateFilter = `AND TO_DATE(datetime, 'DD Mon YYYY') >= $1::date AND TO_DATE(datetime, 'DD Mon YYYY') <= $2::date`;
      }

      let rows: any[] = [];
      let headers: string[] = [];
      let filename = "anomalies.csv";

      if (type === "unreconciled") {
        const result = await client.query(`
          SELECT order_id, sku, invoice_amount, gross_diff, tax_diff, invoice_diff
          FROM "Amazon_GST_Master"
          WHERE reconciled = false
            AND ((gross_diff IS NOT NULL AND gross_diff != 0)
              OR (tax_diff IS NOT NULL AND tax_diff != 0)
              OR (invoice_diff IS NOT NULL AND invoice_diff != 0))
            ${gstDateFilter}
          ORDER BY ABS(COALESCE(invoice_diff, 0)) DESC
        `, params);
        headers = ["Order ID", "SKU", "Invoice Amount", "Gross Diff", "Tax Diff", "Invoice Diff"];
        rows = result.rows.map((r: any) => [r.order_id, r.sku, r.invoice_amount, r.gross_diff, r.tax_diff, r.invoice_diff]);
        filename = "unreconciled_discrepancies.csv";

      } else if (type === "highReturns") {
        const result = await client.query(`
          SELECT g.sku,
            COALESCE(SUM(CASE WHEN g.transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(g.quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS shipped,
            COALESCE(r.returned, 0) AS returned
          FROM "Amazon_GST_Master" g
          LEFT JOIN (
            SELECT sku, SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) AS returned
            FROM "AmazonReturnsB2cRow" WHERE 1=1 ${returnDateFilter} GROUP BY sku
          ) r ON g.sku = r.sku
          WHERE g.transaction_type = 'Shipment' ${gstDateFilter}
          GROUP BY g.sku, r.returned
          HAVING COALESCE(r.returned, 0) > 0
            AND COALESCE(r.returned, 0) / NULLIF(SUM(CASE WHEN g.transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(g.quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) > 0.15
          ORDER BY COALESCE(r.returned, 0) / NULLIF(SUM(CASE WHEN g.transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(g.quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) DESC
        `, params);
        headers = ["SKU", "Units Shipped", "Units Returned", "Return Rate %"];
        rows = result.rows.map((r: any) => {
          const shipped = parseFloat(r.shipped);
          const returned = parseFloat(r.returned);
          return [r.sku, shipped, returned, shipped > 0 ? Math.round((returned / shipped) * 10000) / 100 : 0];
        });
        filename = "high_return_skus.csv";

      } else if (type === "feeOvercharges") {
        const result = await client.query(`
          SELECT order_id, sku,
            CAST(NULLIF(REPLACE(product_sales, ',', ''), '') AS numeric) AS sales,
            ABS(CAST(NULLIF(REPLACE(fba_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(selling_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(other_transaction_fees, ',', ''), '') AS numeric)) AS total_fees
          FROM "Amazon_Unified_Transactions"
          WHERE CAST(NULLIF(REPLACE(product_sales, ',', ''), '') AS numeric) > 100
            ${utDateFilter}
            AND (ABS(CAST(NULLIF(REPLACE(fba_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(selling_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(other_transaction_fees, ',', ''), '') AS numeric)))
              / CAST(NULLIF(REPLACE(product_sales, ',', ''), '') AS numeric) > 0.40
          ORDER BY (ABS(CAST(NULLIF(REPLACE(fba_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(selling_fees, ',', ''), '') AS numeric))
              + ABS(CAST(NULLIF(REPLACE(other_transaction_fees, ',', ''), '') AS numeric)))
              / CAST(NULLIF(REPLACE(product_sales, ',', ''), '') AS numeric) DESC
        `, params);
        headers = ["Order ID", "SKU", "Product Sales", "Total Fees", "Fee Ratio %"];
        rows = result.rows.map((r: any) => {
          const sales = parseFloat(r.sales);
          const totalFees = parseFloat(r.total_fees);
          return [r.order_id, r.sku, Math.round(sales * 100) / 100, Math.round(totalFees * 100) / 100, sales > 0 ? Math.round((totalFees / sales) * 10000) / 100 : 0];
        });
        filename = "fee_overcharges.csv";
      }

      const csvContent = [headers.join(","), ...rows.map(r => r.map((v: any) => `"${v}"`).join(","))].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (err: any) {
      console.error("Anomalies CSV export failed:", err);
      res.status(500).json({ success: false, error: err?.message || String(err) });
    } finally {
      if (client) client.release();
    }
  });

  // Amazon Operational Metrics Endpoint
  app.get("/api/amazon/operational-metrics", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;
      const gstMode = (req.query.gstMode as string) === "inclusive" ? "inclusive" : "exclusive";
      const revenueCol = gstMode === "inclusive" ? "invoice_amount" : "tax_exclusive_gross";

      let gstDateFilter = "";
      let returnDateFilter = "";
      let claimDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND order_date >= $1 AND order_date <= $2`;
        returnDateFilter = `AND returndate >= $1 AND returndate <= $2`;
        claimDateFilter = `AND approvaldate >= $1 AND approvaldate <= $2`;
      }

      const [ordersResult, listingsResult, returnsResult, returnsByDispositionResult, claimsResult] = await Promise.all([
        client.query(`
          SELECT
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS total_revenue,
            COUNT(DISTINCT CASE WHEN transaction_type = 'Shipment' THEN order_id END) AS total_orders,
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS shipped_qty
          FROM "Amazon_GST_Master"
          WHERE 1=1 ${gstDateFilter}
        `, params),
        client.query(`
          SELECT
            COUNT(DISTINCT sellersku) AS total_listings,
            COUNT(DISTINCT CASE WHEN LOWER(status) = 'active' THEN sellersku END) AS active_listings
          FROM "AmazonMtrRow"
        `),
        client.query(`
          SELECT COALESCE(SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)), 0) AS returned_qty
          FROM "AmazonReturnsB2cRow"
          WHERE 1=1 ${returnDateFilter}
        `, params),
        // Good/Bad Return split via Amazon's own detaileddisposition field (SELLABLE = good/reinventorisable, else bad)
        client.query(`
          SELECT
            COALESCE(SUM(CASE WHEN detaileddisposition = 'SELLABLE' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS good_return_qty,
            COALESCE(SUM(CASE WHEN detaileddisposition IS DISTINCT FROM 'SELLABLE' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS bad_return_qty
          FROM "AmazonReturnsB2cRow"
          WHERE 1=1 ${returnDateFilter}
        `, params),
        client.query(`
          SELECT
            COUNT(*) AS total_claims,
            COUNT(CASE WHEN CAST(NULLIF(REPLACE(quantityreimbursedtotal, ',', ''), '') AS numeric) > 0 THEN 1 END) AS successful_claims,
            COALESCE(SUM(CAST(NULLIF(REPLACE(amounttotal, ',', ''), '') AS numeric)), 0) AS total_reimbursed
          FROM "AmazonClaimsReimbursementsRow"
          WHERE 1=1 ${claimDateFilter}
        `, params),
      ]);

      const totalRevenue = parseFloat(ordersResult.rows[0].total_revenue);
      const totalOrders = parseInt(ordersResult.rows[0].total_orders);
      const shippedQty = parseFloat(ordersResult.rows[0].shipped_qty);

      const totalListings = parseInt(listingsResult.rows[0].total_listings);
      const activeListings = parseInt(listingsResult.rows[0].active_listings);

      const returnedQty = parseFloat(returnsResult.rows[0].returned_qty);
      const goodReturnQty = parseFloat(returnsByDispositionResult.rows[0].good_return_qty);
      const badReturnQty = parseFloat(returnsByDispositionResult.rows[0].bad_return_qty);

      const totalClaims = parseInt(claimsResult.rows[0].total_claims);
      const successfulClaims = parseInt(claimsResult.rows[0].successful_claims);
      const totalReimbursed = parseFloat(claimsResult.rows[0].total_reimbursed);

      // Reimbursement Rate denominator: COGS of units for which a claim was raised, joined by sku/order.
      // Uses the same date-range for GST Master as the rest of this endpoint.
      const cogsOfClaimedUnitsResult = await client.query(`
        WITH claimed AS (
          SELECT DISTINCT amazonorderid, sku FROM "AmazonClaimsReimbursementsRow" WHERE 1=1 ${claimDateFilter}
        )
        SELECT COALESCE(SUM(g.cost_inventory), 0) AS cogs_of_claimed_units
        FROM "Amazon_GST_Master" g
        JOIN claimed c ON c.amazonorderid = g.order_id AND c.sku = g.sku
        WHERE g.transaction_type = 'Shipment' ${gstDateFilter}
      `, params);
      const cogsOfClaimedUnits = parseFloat(cogsOfClaimedUnitsResult.rows[0].cogs_of_claimed_units);

      const dayCount = startDate && endDate
        ? Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1)
        : 30;

      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const ordersPerDay = Math.round(totalOrders / dayCount);
      const unitsPerOrder = totalOrders > 0 ? shippedQty / totalOrders : 0;
      const revenuePerSku = activeListings > 0 ? Math.round(totalRevenue / activeListings) : 0;

      // Refund Rate (renamed from "Return & Refund Rate") -- unchanged formula: returned/shipped units
      const returnPct = shippedQty > 0 ? (returnedQty / shippedQty) * 100 : 0;
      const goodReturnPct = shippedQty > 0 ? (goodReturnQty / shippedQty) * 100 : 0;
      const badReturnPct = shippedQty > 0 ? (badReturnQty / shippedQty) * 100 : 0;

      // Preserved old "claims success" metric under a new name (was `claimPct`)
      const claimSuccessPct = totalClaims > 0 ? (successfulClaims / totalClaims) * 100 : 0;
      // New "Claim Rate" per spec: claims raised / bad-returned units
      const claimRatePct = badReturnQty > 0 ? (totalClaims / badReturnQty) * 100 : 0;

      const reimbursementPct = cogsOfClaimedUnits > 0 ? (totalReimbursed / cogsOfClaimedUnits) * 100 : 0;

      res.json({
        success: true,
        data: {
          aov: Math.round(aov * 100) / 100,
          ordersPerDay,
          unitsPerOrder: Math.round(unitsPerOrder * 100) / 100,
          totalOrders,
          listingsCount: totalListings,
          activeListingCount: activeListings,
          revenuePerSku,
          // Refund Rate (renamed from Return & Refund Rate, same formula)
          returnPct: Math.round(returnPct * 100) / 100,
          // Good/Bad Return split, sourced from Amazon's own detaileddisposition field
          goodReturnPct: Math.round(goodReturnPct * 100) / 100,
          badReturnPct: Math.round(badReturnPct * 100) / 100,
          // Claim metrics: old metric preserved under a new name, new metric added alongside it
          claimSuccessPct: Math.round(claimSuccessPct * 100) / 100,
          claimRatePct: Math.round(claimRatePct * 100) / 100,
          claim24hPct: null, // permanently unavailable -- no claim-raised timestamp exists in ingested data
          reimbursementPct: Math.round(reimbursementPct * 100) / 100,
          reimbursementAmount: Math.round(totalReimbursed * 100) / 100,
          returnLossPct: null, // computed alongside returnLoss amount in /api/amazon/financials; see that endpoint
          // Definition Pending -- explicitly flagged by finance as "to be discussed", not yet formulated
          outOfStockDays: null,
          stockoutCost: null,
          ageingInventoryPct: null,
          deadStockPct: null,
          gstMode,
        },
      });
    } catch (err: any) {
      console.error("Amazon operational metrics query failed:", err);
      res.status(500).json({
        success: false,
        error: err?.message || String(err),
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  });

  // Amazon Financials Aggregation Endpoint
  app.get("/api/amazon/financials", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;
      const gstMode = (req.query.gstMode as string) === "inclusive" ? "inclusive" : "exclusive";
      const revenueCol = gstMode === "inclusive" ? "invoice_amount" : "tax_exclusive_gross";

      let gstDateFilter = "";
      let settlementDateFilter = "";
      let returnDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND order_date >= $1 AND order_date <= $2`;
        settlementDateFilter = `AND TO_DATE(posteddate, 'DD.MM.YYYY') >= $1::date AND TO_DATE(posteddate, 'DD.MM.YYYY') <= $2::date`;
        returnDateFilter = `AND returndate >= $1 AND returndate <= $2`;
      }

      // Amazon Charges GST toggle: fba_fees/selling_fees/other_transaction_fees on Amazon_Unified_Transactions
      // are already GST-inclusive with no separate tax column to subtract. The settlement tables
      // (Electronics_all_statements / COD_ALL_Settlements) are the only source where GST-on-fees is itemized
      // separately (e.g. "FBA Weight Handling Fee CGST/SGST", "Fixed closing fee IGST"), so Amazon Charges is
      // computed from settlement ItemFees rows here, excluding CGST/SGST/IGST-described rows when exclusive.
      const gstFeeFilter = gstMode === "inclusive"
        ? ""
        : `AND amountdescription NOT ILIKE '%cgst%' AND amountdescription NOT ILIKE '%sgst%' AND amountdescription NOT ILIKE '%igst%'`;

      const [gstResult, feesResult, adsResult, returnLossResult] = await Promise.all([
        client.query(`
          SELECT
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN transaction_type = 'Return' THEN ABS(${revenueCol}) ELSE 0 END), 0) AS returns,
            COALESCE(SUM(cost_inventory), 0) AS cogs
          FROM "Amazon_GST_Master"
          WHERE 1=1 ${gstDateFilter}
        `, params),
        client.query(`
          SELECT COALESCE(SUM(ABS(CAST(NULLIF(REPLACE(amount, ',', ''), '') AS numeric))), 0) AS amazon_charges_total
          FROM (
            SELECT amountdescription, amount FROM "Electronics_all_statements"
            WHERE amounttype = 'ItemFees' ${settlementDateFilter} ${gstFeeFilter}
            UNION ALL
            SELECT amountdescription, amount FROM "COD_ALL_Settlements"
            WHERE amounttype = 'ItemFees' ${settlementDateFilter} ${gstFeeFilter}
          ) combined
        `, params),
        client.query(`
          SELECT COALESCE(SUM(CAST(NULLIF(spend, '') AS numeric)), 0) AS total_ad_spend
          FROM "AmazonAdsCampaignRow"
          WHERE currency_code = 'INR'
        `),
        // Return Loss = COGS of bad-marked returned units (per-unit COGS from Amazon_GST_Master.cost_inventory)
        // minus claim reimbursement matched to those same order/sku pairs.
        // "Bad" = detaileddisposition != 'SELLABLE' (confirmed populated: SELLABLE/CUSTOMER_DAMAGED/DEFECTIVE/CARRIER_DAMAGED/DAMAGED).
        client.query(`
          WITH bad_returns AS (
            SELECT orderid, sku, SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) AS bad_qty
            FROM "AmazonReturnsB2cRow"
            WHERE detaileddisposition IS DISTINCT FROM 'SELLABLE' ${returnDateFilter}
            GROUP BY orderid, sku
          ),
          per_unit_cogs AS (
            SELECT order_id, sku,
              CASE WHEN SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) > 0
                THEN SUM(cost_inventory) / SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric))
                ELSE 0 END AS unit_cogs
            FROM "Amazon_GST_Master"
            WHERE transaction_type = 'Shipment' ${gstDateFilter}
            GROUP BY order_id, sku
          ),
          claims AS (
            SELECT amazonorderid, sku, SUM(CAST(NULLIF(REPLACE(amounttotal, ',', ''), '') AS numeric)) AS reimbursed
            FROM "AmazonClaimsReimbursementsRow"
            GROUP BY amazonorderid, sku
          )
          SELECT COALESCE(SUM(
            (br.bad_qty * COALESCE(puc.unit_cogs, 0)) - COALESCE(c.reimbursed, 0)
          ), 0) AS return_loss
          FROM bad_returns br
          LEFT JOIN per_unit_cogs puc ON puc.order_id = br.orderid AND puc.sku = br.sku
          LEFT JOIN claims c ON c.amazonorderid = br.orderid AND c.sku = br.sku
        `, params),
      ]);

      const grossRevenue = parseFloat(gstResult.rows[0].revenue);
      const saleReturns = parseFloat(gstResult.rows[0].returns);
      const netRevenue = grossRevenue - saleReturns;
      const cogs = parseFloat(gstResult.rows[0].cogs);
      const cm1 = netRevenue - cogs;

      const amazonCharges = parseFloat(feesResult.rows[0].amazon_charges_total);
      const peopleCost = 0; // Pending Finance input -- data to be added later
      const rentalCharges = 0; // Pending Finance input -- data to be added later

      const amazonAdsSpend = parseFloat(adsResult.rows[0].total_ad_spend);
      const beyondAdsSpend = amazonAdsSpend * BEYOND_ADS_MULTIPLIER;
      const advertisementCostTotal = amazonAdsSpend + beyondAdsSpend;

      const returnLoss = Math.max(0, parseFloat(returnLossResult.rows[0].return_loss));
      const returnLossPct = netRevenue > 0 ? (returnLoss / netRevenue) * 100 : 0;

      const indirectExpenses = amazonCharges; // preserved alias, Amazon-charges-only meaning
      const advertisingSpend = amazonAdsSpend; // preserved alias, pre-Beyond-Ads meaning
      const cm2 = cm1 - amazonCharges - peopleCost - rentalCharges - advertisementCostTotal - returnLoss;

      res.json({
        success: true,
        data: {
          // Revenue 3-way split
          grossRevenue,
          saleReturns,
          netRevenue,
          // Backward-compatible aliases
          revenue: grossRevenue,
          returns: saleReturns,
          cogs,
          cm1,
          // Indirect Expense 5-way split
          amazonCharges,
          peopleCost,
          rentalCharges,
          advertisementCost: {
            amazonAds: amazonAdsSpend,
            beyondAds: beyondAdsSpend,
            total: advertisementCostTotal,
          },
          returnLoss,
          returnLossPct,
          // Backward-compatible aliases
          indirectExpenses,
          advertisingSpend,
          cm2,
          gstMode,
        },
      });
    } catch (err: any) {
      console.error("Amazon financials query failed:", err);
      res.status(500).json({
        success: false,
        error: err?.message || String(err),
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  });

  // Amazon Expense Breakdown Endpoint
  app.get("/api/amazon/expense-breakdown", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;
      const section = (req.query.section as string) === "advertisement" ? "advertisement" : "amazonCharges";
      const gstMode = (req.query.gstMode as string) === "inclusive" ? "inclusive" : "exclusive";

      let settlementDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        settlementDateFilter = `AND TO_DATE(posteddate, 'DD.MM.YYYY') >= $1::date AND TO_DATE(posteddate, 'DD.MM.YYYY') <= $2::date`;
      }

      // See /api/amazon/financials for why Amazon Charges is settlement-based rather than Unified-Transactions-based:
      // fba_fees/selling_fees/other_transaction_fees are GST-inclusive with no separate tax column, whereas the
      // settlement tables itemize GST-on-fees separately (e.g. "Fixed closing fee IGST").
      const gstFeeFilter = gstMode === "inclusive"
        ? ""
        : `AND amountdescription NOT ILIKE '%cgst%' AND amountdescription NOT ILIKE '%sgst%' AND amountdescription NOT ILIKE '%igst%'`;

      if (section === "advertisement") {
        // Advertisement Cost L2: Amazon Ads campaign-level breakdown + a single "Beyond Ads" estimate line.
        // NOTE: AmazonAdsCampaignRow has no date column (lifetime total per account) -- not date-range filterable.
        const adsResult = await client.query(`
          SELECT
            COALESCE(type, 'Unspecified') AS description,
            COALESCE(SUM(CAST(NULLIF(spend, '') AS numeric)), 0) AS amount
          FROM "AmazonAdsCampaignRow"
          WHERE currency_code = 'INR'
          GROUP BY type
          ORDER BY amount DESC
        `);
        const amazonAdsBreakdown = adsResult.rows.map((r: any) => ({
          description: `Amazon Ads (billed) - ${r.description}`,
          amount: parseFloat(r.amount),
        }));
        const amazonAdsTotal = amazonAdsBreakdown.reduce((s: number, i: any) => s + i.amount, 0);
        const beyondAdsTotal = amazonAdsTotal * BEYOND_ADS_MULTIPLIER;

        res.json({
          success: true,
          data: {
            summary: [
              { description: "Amazon Ads (billed)", amount: amazonAdsTotal },
              { description: "Beyond Ads (10% estimate, not billed)", amount: beyondAdsTotal },
            ],
            total: amazonAdsTotal + beyondAdsTotal,
            settlementBreakdown: amazonAdsBreakdown,
            settlementTotal: amazonAdsTotal,
          },
        });
        return;
      }

      const settlementResult = await client.query(`
        SELECT
          amountdescription AS description,
          COALESCE(SUM(ABS(CAST(NULLIF(REPLACE(amount, ',', ''), '') AS numeric))), 0) AS amount
        FROM (
          SELECT amountdescription, amount FROM "Electronics_all_statements"
          WHERE amounttype = 'ItemFees' AND amountdescription IS NOT NULL AND amountdescription != '' ${settlementDateFilter} ${gstFeeFilter}
          UNION ALL
          SELECT amountdescription, amount FROM "COD_ALL_Settlements"
          WHERE amounttype = 'ItemFees' AND amountdescription IS NOT NULL AND amountdescription != '' ${settlementDateFilter} ${gstFeeFilter}
        ) combined
        GROUP BY amountdescription
        ORDER BY amount DESC
      `, params);

      const settlementBreakdown = settlementResult.rows.map((r: any) => ({
        description: r.description,
        amount: parseFloat(r.amount),
      }));
      const settlementTotal = settlementBreakdown.reduce((s: number, i: any) => s + i.amount, 0);

      res.json({
        success: true,
        data: {
          summary: [
            { description: gstMode === "inclusive" ? "Amazon Charges (incl. GST)" : "Amazon Charges (excl. GST)", amount: settlementTotal },
          ],
          total: settlementTotal,
          settlementBreakdown,
          settlementTotal,
          gstMode,
        },
      });
    } catch (err: any) {
      console.error("Amazon expense breakdown query failed:", err);
      res.status(500).json({
        success: false,
        error: err?.message || String(err),
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  });

  // Amazon Channel Trend Endpoint (daily / weekly / monthly) -- real DB-driven, NOT the frontend's synthetic simulator
  app.get("/api/amazon/trend", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;
      const granularity = (req.query.granularity as string) === "weekly" || (req.query.granularity as string) === "monthly"
        ? (req.query.granularity as string)
        : "daily";
      const gstMode = (req.query.gstMode as string) === "inclusive" ? "inclusive" : "exclusive";
      const revenueCol = gstMode === "inclusive" ? "invoice_amount" : "tax_exclusive_gross";

      let gstDateFilter = "";
      const params: string[] = [];
      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND order_date >= $1 AND order_date <= $2`;
      }

      // order_date is stored as an ISO-sortable string (YYYY-MM-DD), so date_trunc requires a cast to date first.
      // Period is formatted to text via TO_CHAR (not left as a native date) so node-postgres never round-trips
      // it through a JS Date object -- pg parses SQL `date` in the server's local timezone, and calling
      // toISOString() on that (UTC) shifts the date backwards by the timezone offset (e.g. IST: -1 day).
      const periodExpr = granularity === "daily"
        ? `TO_CHAR(order_date::date, 'YYYY-MM-DD')`
        : granularity === "weekly"
        ? `TO_CHAR(date_trunc('week', order_date::date), 'YYYY-MM-DD')`
        : `TO_CHAR(date_trunc('month', order_date::date), 'YYYY-MM-DD')`;

      const gstTrendResult = await client.query(`
        SELECT
          ${periodExpr} AS period,
          COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS gross_revenue,
          COALESCE(SUM(CASE WHEN transaction_type = 'Return' THEN ABS(${revenueCol}) ELSE 0 END), 0) AS sale_returns,
          COALESCE(SUM(cost_inventory), 0) AS cogs,
          COUNT(DISTINCT CASE WHEN transaction_type = 'Shipment' THEN order_id END) AS orders,
          COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS units_sold
        FROM "Amazon_GST_Master"
        WHERE 1=1 ${gstDateFilter}
        GROUP BY period
        ORDER BY period ASC
      `, params);

      // Amazon Charges bucketed to the same granularity, from the settlement tables (see /api/amazon/financials
      // for why: Unified Transactions fee columns are GST-inclusive with no separate tax column to exclude).
      const gstFeeFilter = gstMode === "inclusive"
        ? ""
        : `AND amountdescription NOT ILIKE '%cgst%' AND amountdescription NOT ILIKE '%sgst%' AND amountdescription NOT ILIKE '%igst%'`;
      const settlementPeriodExpr = granularity === "daily"
        ? `TO_CHAR(TO_DATE(posteddate, 'DD.MM.YYYY'), 'YYYY-MM-DD')`
        : granularity === "weekly"
        ? `TO_CHAR(date_trunc('week', TO_DATE(posteddate, 'DD.MM.YYYY')), 'YYYY-MM-DD')`
        : `TO_CHAR(date_trunc('month', TO_DATE(posteddate, 'DD.MM.YYYY')), 'YYYY-MM-DD')`;
      const settlementTrendResult = await client.query(`
        SELECT period, COALESCE(SUM(ABS(CAST(NULLIF(REPLACE(amount, ',', ''), '') AS numeric))), 0) AS amazon_charges
        FROM (
          SELECT ${settlementPeriodExpr} AS period, amount FROM "Electronics_all_statements"
          WHERE amounttype = 'ItemFees' ${startDate && endDate ? `AND TO_DATE(posteddate, 'DD.MM.YYYY') >= $1::date AND TO_DATE(posteddate, 'DD.MM.YYYY') <= $2::date` : ""} ${gstFeeFilter}
          UNION ALL
          SELECT ${settlementPeriodExpr} AS period, amount FROM "COD_ALL_Settlements"
          WHERE amounttype = 'ItemFees' ${startDate && endDate ? `AND TO_DATE(posteddate, 'DD.MM.YYYY') >= $1::date AND TO_DATE(posteddate, 'DD.MM.YYYY') <= $2::date` : ""} ${gstFeeFilter}
        ) combined
        GROUP BY period
      `, params);

      const chargesByPeriod: Record<string, number> = {};
      for (const row of settlementTrendResult.rows) {
        chargesByPeriod[row.period] = parseFloat(row.amazon_charges);
      }

      // Advertisement Cost intentionally omitted -- AmazonAdsCampaignRow has no date column
      // (lifetime total per account), so daily/weekly/monthly ad spend cannot be trended.
      const data = gstTrendResult.rows.map((row: any) => {
        const periodKey = row.period;
        const grossRevenue = parseFloat(row.gross_revenue);
        const saleReturns = parseFloat(row.sale_returns);
        const netRevenue = grossRevenue - saleReturns;
        const cogs = parseFloat(row.cogs);
        const cm1 = netRevenue - cogs;
        const amazonCharges = chargesByPeriod[periodKey] || 0;
        const cm2 = cm1 - amazonCharges;
        return {
          period: periodKey,
          grossRevenue,
          saleReturns,
          netRevenue,
          cogs,
          cm1,
          amazonCharges,
          cm2,
          netProfit: cm2,
          orders: parseInt(row.orders),
          unitsSold: parseFloat(row.units_sold),
        };
      });

      res.json({ success: true, data, granularity, gstMode });
    } catch (err: any) {
      console.error("Amazon trend query failed:", err);
      res.status(500).json({ success: false, error: err?.message || String(err) });
    } finally {
      if (client) client.release();
    }
  });

  // Amazon SKU-level Trend Endpoint (daily / weekly / monthly), scoped to a single SKU on demand
  app.get("/api/amazon/sku-trend", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const sku = (req.query.sku as string) || null;
      if (!sku) {
        res.status(400).json({ success: false, error: "sku query param is required" });
        return;
      }

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;
      const granularity = (req.query.granularity as string) === "weekly" || (req.query.granularity as string) === "monthly"
        ? (req.query.granularity as string)
        : "daily";
      const gstMode = (req.query.gstMode as string) === "inclusive" ? "inclusive" : "exclusive";
      const revenueCol = gstMode === "inclusive" ? "invoice_amount" : "tax_exclusive_gross";

      // Formatted to text via TO_CHAR so pg never round-trips through a JS Date (see comment in /api/amazon/trend).
      const periodExpr = granularity === "daily"
        ? `TO_CHAR(order_date::date, 'YYYY-MM-DD')`
        : granularity === "weekly"
        ? `TO_CHAR(date_trunc('week', order_date::date), 'YYYY-MM-DD')`
        : `TO_CHAR(date_trunc('month', order_date::date), 'YYYY-MM-DD')`;

      let gstDateFilter = "";
      const params: string[] = [sku];
      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND order_date >= $2 AND order_date <= $3`;
      }

      const result = await client.query(`
        SELECT
          ${periodExpr} AS period,
          COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(cost_inventory), 0) AS cogs,
          COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS units_sold
        FROM "Amazon_GST_Master"
        WHERE sku = $1 ${gstDateFilter}
        GROUP BY period
        ORDER BY period ASC
      `, params);

      const data = result.rows.map((row: any) => ({
        period: row.period,
        revenue: parseFloat(row.revenue),
        cogs: parseFloat(row.cogs),
        cm1: parseFloat(row.revenue) - parseFloat(row.cogs),
        unitsSold: parseFloat(row.units_sold),
      }));

      res.json({ success: true, data, granularity, gstMode, sku });
    } catch (err: any) {
      console.error("Amazon SKU trend query failed:", err);
      res.status(500).json({ success: false, error: err?.message || String(err) });
    } finally {
      if (client) client.release();
    }
  });

  // Shopify Financials Aggregation Endpoint
  app.get("/api/shopify/financials", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;

      let dateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        dateFilter = `AND o."createdAt" >= $1::timestamp AND o."createdAt" <= ($2::date + interval '1 day')`;
      }

      const [revenueResult, cogsResult] = await Promise.all([
        client.query(`
          SELECT
            COALESCE(SUM("totalPrice"), 0) AS revenue,
            COALESCE(SUM("totalDiscounts"), 0) AS discounts,
            COALESCE(SUM("totalTax"), 0) AS tax
          FROM "ShopifyOrder" o
          WHERE "cancelledAt" IS NULL
            AND "financialStatus" NOT IN ('voided', 'refunded')
            ${dateFilter}
        `, params),
        client.query(`
          SELECT COALESCE(SUM(li."quantity" * inv."unitCost"), 0) AS cogs
          FROM "ShopifyOrderLineItem" li
          JOIN "ShopifyOrder" o ON o."id" = li."orderId"
          LEFT JOIN "ShopifyInventoryItem" inv ON inv."sku" = li."sku" AND inv."sku" IS NOT NULL AND inv."sku" != ''
          WHERE o."cancelledAt" IS NULL
            AND o."financialStatus" NOT IN ('voided', 'refunded')
            ${dateFilter}
        `, params),
      ]);

      const revenue = parseFloat(revenueResult.rows[0].revenue);
      const cogs = parseFloat(cogsResult.rows[0].cogs);
      const cm1 = revenue - cogs;
      const indirectExpenses = 0;
      const advertisingSpend = 0;
      const cm2 = cm1 - indirectExpenses - advertisingSpend;

      res.json({
        success: true,
        data: {
          revenue,
          cogs,
          cm1,
          indirectExpenses,
          advertisingSpend,
          cm2,
        },
      });
    } catch (err: any) {
      console.error("Shopify financials query failed:", err);
      res.status(500).json({
        success: false,
        error: err?.message || String(err),
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  });

  // Shopify Operational Metrics Endpoint
  app.get("/api/shopify/operational-metrics", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;

      let dateFilter = "";
      let returnDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        dateFilter = `AND o."createdAt" >= $1::timestamp AND o."createdAt" <= ($2::date + interval '1 day')`;
        returnDateFilter = `AND r."createdAt" >= $1::timestamp AND r."createdAt" <= ($2::date + interval '1 day')`;
      }

      const [ordersResult, listingsResult, returnsResult] = await Promise.all([
        client.query(`
          SELECT
            COALESCE(SUM("totalPrice"), 0) AS total_revenue,
            COUNT(*) AS total_orders,
            COALESCE(SUM(
              (SELECT COALESCE(SUM(li."quantity"), 0) FROM "ShopifyOrderLineItem" li WHERE li."orderId" = o."id")
            ), 0) AS total_qty
          FROM "ShopifyOrder" o
          WHERE "cancelledAt" IS NULL
            AND "financialStatus" NOT IN ('voided', 'refunded')
            ${dateFilter}
        `, params),
        client.query(`
          SELECT
            COUNT(*) AS total_items,
            COUNT(CASE WHEN "tracked" = true THEN 1 END) AS active_items
          FROM "ShopifyInventoryItem"
        `),
        client.query(`
          SELECT
            COALESCE(SUM(r."totalQuantity"), 0) AS returned_qty
          FROM "ShopifyReturn" r
          WHERE r."status" != 'DECLINED'
            ${returnDateFilter}
        `, params),
      ]);

      const totalRevenue = parseFloat(ordersResult.rows[0].total_revenue);
      const totalOrders = parseInt(ordersResult.rows[0].total_orders);
      const totalQty = parseInt(ordersResult.rows[0].total_qty);

      const totalListings = parseInt(listingsResult.rows[0].total_items);
      const activeListings = parseInt(listingsResult.rows[0].active_items);

      const returnedQty = parseInt(returnsResult.rows[0].returned_qty);

      const dayCount = startDate && endDate
        ? Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1)
        : 30;

      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const ordersPerDay = Math.round(totalOrders / dayCount);
      const revenuePerSku = activeListings > 0 ? Math.round(totalRevenue / activeListings) : 0;
      const returnPct = totalQty > 0 ? (returnedQty / totalQty) * 100 : 0;

      res.json({
        success: true,
        data: {
          aov: Math.round(aov * 100) / 100,
          ordersPerDay,
          totalOrders,
          listingsCount: totalListings,
          activeListingCount: activeListings,
          revenuePerSku,
          returnPct: Math.round(returnPct * 100) / 100,
          claimPct: 0,
          reimbursementPct: 0,
          outOfStockDays: null,
          ageingInventoryPct: null,
          deadStockPct: null,
        },
      });
    } catch (err: any) {
      console.error("Shopify operational metrics query failed:", err);
      res.status(500).json({
        success: false,
        error: err?.message || String(err),
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  });

  // Gemini AI Insights & Advisor Endpoint
  app.post("/api/insights", async (req, res) => {
    try {
      const { channel, dataContext, customQuestion } = req.body;
      const ai = getGeminiClient();

      if (!ai) {
        return res.json({
          success: false,
          error: "Gemini API Key is not set up in the secrets panel.",
          insights: "### 💡 Live AI Advisor Simulation\n\nTo see real Gemini AI responses, please configure your **GEMINI_API_KEY** in the Secrets setup in AI Studio.\n\nHere is a diagnostic assessment based on your parameters:\n\n1. **High Refund Risk**: " + (channel === "Amazon" ? "Amazon refunds represent 14.5% of total revenue. Look closely at return item logs for damaged packaging." : "Your refund rate of " + (dataContext?.returnRate || "10%") + " is slightly above the 8% industry average.") + "\n2. **Margin Check**: Net margin after allocating indirect and operational costs is thin. Consider raising the SKU markup coefficients.\n3. **Reconciliation Discrepancy**: Standard automated scans show a weight Handling discrepancies where Amazon logistics incorrectly categorized Medium goods as High Volume, overcharging ₹64 per shipment.\n\n*Configure your API key to ask custom diagnostic questions and get full mathematical audits generated by Gemini Flash.*"
        });
      }

      // Structure prompt to Gemini
      const prompt = `
You are a highly analytical CFO and Financial Consultant specialized in e-commerce, Marketplace selling (Amazon, Flipkart, FirstCry, Meesho, Shopify), and Quick Commerce platforms (Blinkit, Zepto, Instamart, BigBasket).

The user is viewing their Financial Dashboard for the channel: "${channel}".
Here is the current financial context they are looking at:
${JSON.stringify(dataContext, null, 2)}

User's custom question or request:
"${customQuestion || "Analyze this channel's profitability. Highlight three positive metrics, three leakages or danger areas, and recommend concrete, actionable pricing or logistics adjustments to increase Net Margin %."}"

Respond in elegant, clear Markdown. Cover:
1. Executive Profitability Diagnostic (evaluating CM1, CM2, and Net Profit after indirect allocations).
2. Cost Allocation Leakages (identifying specific issues such as referral/weight-handling fee errors, Return cost multipliers, or Ads/ROAS efficiency).
3. Strategic Operational Levers (recommendations for SKU pricing, logistics changes, or inventory optimization).

Keep the analysis sharp, professional, mathematical, and concise. Avoid generic definitions; refer directly to the metrics provided above.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          temperature: 0.7,
        },
      });

      res.json({
        success: true,
        insights: response.text,
      });

    } catch (error: any) {
      console.error("Gemini insights error:", error);
      res.status(500).json({
        success: false,
        error: error?.message || "An error occurred while generating insights.",
      });
    }
  });

  // Integrate Vite for development, or serve static assets in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Financial Dashboard server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
