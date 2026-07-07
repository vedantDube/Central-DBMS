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

// Rental Charges for PPOB: fixed monthly figure (finance-confirmed), prorated across the selected date range
const RENTAL_CHARGES_PER_MONTH = 16000;

// Monday of the ISO week containing a given date, as a YYYY-MM-DD string (Mon-Sun weeks, matching Amazon's
// own "Deep dive ASIN performance" week-over-week convention)
const isoWeekStart = (dateStr: string) => {
  const dt = new Date(dateStr + "T00:00:00Z");
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().slice(0, 10);
};

// AmazonAdsCampaignRow snapshots are labeled by calendar month (e.g. "May 2026"), matching the
// account-level Ads Console export's own reporting granularity -- not arbitrary date ranges. Given a
// selected startDate/endDate, this returns every "Month YYYY" label the range overlaps, so a query can
// sum only the matching monthly snapshot(s) instead of every period ever ingested.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabelsInRange(startDate: string, endDate: string): string[] {
  const labels: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    labels.push(`${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return labels;
}

// Binary search for the latest cost history entry with date <= targetDate; falls back to the earliest
// known cost if targetDate predates every recorded snapshot. Same semantics as the cost_inventory
// backfill in src/amazon/map-cost-inventory.ts, reused here as a fallback when a claim/return's order
// never got a Amazon_GST_Master row (a real gap in Amazon's own GST export, not an ingestion bug) --
// COGS is fundamentally a per-SKU cost basis, not tied to the order having a GST Master row at all.
function costAsOf(history: { date: string; cost: number }[], targetDate: string): number | undefined {
  if (history.length === 0) return undefined;
  let lo = 0, hi = history.length - 1, result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].date <= targetDate) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result === -1 ? history[0].cost : history[result].cost;
}

async function loadEasyEcomCostHistory(client: import("pg").PoolClient, skus: string[]): Promise<Map<string, { date: string; cost: number }[]>> {
  const history = new Map<string, { date: string; cost: number }[]>();
  if (skus.length === 0) return history;
  const result = await client.query(
    `SELECT sku, date, "rawJson"->>'cost' AS cost FROM "EasyEcomInventory" WHERE sku = ANY($1::text[]) AND "rawJson"->>'cost' IS NOT NULL ORDER BY sku, date ASC`,
    [skus]
  );
  for (const row of result.rows) {
    const cost = parseFloat(row.cost);
    if (isNaN(cost)) continue;
    const sku = String(row.sku).trim();
    if (!history.has(sku)) history.set(sku, []);
    history.get(sku)!.push({ date: row.date, cost });
  }
  return history;
}

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

// Generic in-memory TTL cache. Used for expensive per-request aggregations (e.g. the Supply Chain
// metrics block) whose inputs change at most a few times a day, so recomputing on every dashboard
// load is pure waste -- especially on Render's free tier, where the JS-side aggregation loop is the
// dominant cost, not the DB query itself.
const ttlCache = new Map<string, { expiresAt: number; value: any }>();
async function withTtlCache<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const cached = ttlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }
  const value = await compute();
  ttlCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
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
      let utDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date`;
        utDateFilter = `AND TO_DATE(datetime, 'DD Mon YYYY') >= $1::date AND TO_DATE(datetime, 'DD Mon YYYY') <= $2::date`;
      }

      const [gstResult, feesResult, returnsResult, productsResult, firstSeenResult, trafficResult] = await Promise.all([
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
        // Accrual basis: pulled un-dated and joined to the shipment's order_date, then filtered/grouped
        // in JS below by accrual date (shipment date, falling back to the return's own returndate when
        // unmatched) -- same pattern as /api/amazon/financials, so a unit sold at period-end and returned
        // early next period counts against the period it was SOLD in. Carries orderid/detaileddisposition
        // (not just quantity) so Return Loss below can resolve real per-(orderid,sku) COGS and matched
        // claim reimbursement, same as /api/amazon/financials, instead of a revenue-based approximation.
        client.query(`
          SELECT r.orderid, r.sku, r.quantity, r.returndate, r.detaileddisposition, g.order_date AS shipment_order_date
          FROM "AmazonReturnsB2cRow" r
          LEFT JOIN "Amazon_GST_Master" g
            ON g.order_id = r.orderid AND g.sku = r.sku AND g.transaction_type = 'Shipment'
        `),
        client.query(`SELECT sku, product_name, category_name, brand FROM "EasyEcomProductMaster"`),
        client.query(`SELECT sku, MIN(date) AS first_seen FROM "EasyEcomInventory" GROUP BY sku`),
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

      // Return Loss = COGS of bad-disposition units minus matched claim reimbursement, resolved per
      // (orderid, sku) pair exactly as /api/amazon/financials does -- not the revenue-share approximation
      // this endpoint used previously. Accrual-filtered the same way: a return's reporting date is its
      // matched shipment's order_date, falling back to the return's own returndate when unmatched.
      const badReturnRows = returnsResult.rows.filter((row: any) => {
        if (row.detaileddisposition === "SELLABLE") return false;
        const accrualDate = (row.shipment_order_date || row.returndate || "").slice(0, 10);
        if (!accrualDate) return false;
        if (startDate && endDate && (accrualDate < startDate || accrualDate > endDate)) return false;
        return true;
      });

      const returnLossMap: Record<string, number> = {};
      if (badReturnRows.length > 0) {
        const orderIds = badReturnRows.map((r: any) => r.orderid);
        const skus = badReturnRows.map((r: any) => r.sku);

        const [perUnitCogsResult, claimsResult] = await Promise.all([
          client.query(`
            SELECT order_id, sku,
              CASE WHEN SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) > 0
                THEN SUM(cost_inventory) / SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric))
                ELSE NULL END AS unit_cogs
            FROM "Amazon_GST_Master"
            WHERE transaction_type = 'Shipment'
              AND (order_id, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
            GROUP BY order_id, sku
          `, [orderIds, skus]),
          client.query(`
            SELECT amazonorderid, sku, SUM(CAST(NULLIF(REPLACE(amounttotal, ',', ''), '') AS numeric)) AS reimbursed
            FROM "AmazonClaimsReimbursementsRow"
            WHERE (amazonorderid, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
            GROUP BY amazonorderid, sku
          `, [orderIds, skus]),
        ]);

        const gstUnitCogsByPair = new Map<string, number>();
        for (const row of perUnitCogsResult.rows) {
          if (row.unit_cogs === null) continue;
          const unitCogs = parseFloat(row.unit_cogs);
          if (!isNaN(unitCogs)) gstUnitCogsByPair.set(`${row.order_id}|||${row.sku}`, unitCogs);
        }
        const reimbursedByPair = new Map<string, number>();
        for (const row of claimsResult.rows) {
          reimbursedByPair.set(`${row.amazonorderid}|||${row.sku}`, parseFloat(row.reimbursed));
        }

        const easyEcomCostHistory = await loadEasyEcomCostHistory(client, Array.from(new Set(skus)));

        for (const row of badReturnRows) {
          const pairKey = `${row.orderid}|||${row.sku}`;
          const badQty = parseFloat(String(row.quantity).replace(/,/g, "")) || 0;

          let unitCogs = gstUnitCogsByPair.get(pairKey);
          if (unitCogs === undefined) {
            const history = easyEcomCostHistory.get(String(row.sku).trim());
            unitCogs = history ? costAsOf(history, (row.returndate || "").slice(0, 10)) : undefined;
          }

          if (unitCogs !== undefined) {
            const reimbursed = reimbursedByPair.get(pairKey) || 0;
            returnLossMap[row.sku] = (returnLossMap[row.sku] || 0) + (badQty * unitCogs - reimbursed);
          }
        }
        for (const sku of Object.keys(returnLossMap)) {
          returnLossMap[sku] = Math.max(0, returnLossMap[sku]);
        }
      }

      const productMap: Record<string, { name: string; category: string }> = {};
      for (const row of productsResult.rows) {
        productMap[row.sku] = {
          name: row.product_name || row.sku,
          category: row.category_name || "Uncategorized",
        };
      }

      // New Listing: SKU's earliest inventory-data date is within the last 180 days (i.e. first
      // observed after Today-180d). Uses EasyEcomInventory as the catalog's date-of-first-record source.
      const newListingCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const firstSeenMap: Record<string, string> = {};
      for (const row of firstSeenResult.rows) {
        firstSeenMap[row.sku] = row.first_seen;
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
          const returnLoss = returnLossMap[sku] || 0;
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
            // New Listing: first inventory record for this SKU is more recent than Today-180d
            isNewListing: firstSeenMap[sku] ? firstSeenMap[sku] > newListingCutoff : false,
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
      let utDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date`;
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

        // Accrual basis: returns are joined to their ORIGINAL SHIPMENT's order_date (via orderid+sku),
        // not filtered by their own returndate -- so a unit shipped in-range and returned just after the
        // range boundary still counts against the shipment it belongs to, matching the same accrual logic
        // as /api/amazon/financials' Return Loss. r.shipment_order_date falls back to r.returndate only
        // when no matching Shipment row exists in Amazon_GST_Master.
        client.query(`
          SELECT g.sku,
            COALESCE(SUM(CASE WHEN g.transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(g.quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS shipped,
            COALESCE(r.returned, 0) AS returned
          FROM "Amazon_GST_Master" g
          LEFT JOIN (
            SELECT r.sku, SUM(CAST(NULLIF(REPLACE(r.quantity, ',', ''), '') AS numeric)) AS returned
            FROM "AmazonReturnsB2cRow" r
            LEFT JOIN "Amazon_GST_Master" sg
              ON sg.order_id = r.orderid AND sg.sku = r.sku AND sg.transaction_type = 'Shipment'
            WHERE 1=1 ${gstDateFilter.replace(/order_date/g, "COALESCE(sg.order_date, r.returndate)")}
            GROUP BY r.sku
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
      let utDateFilter = "";
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date`;
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
        // Accrual basis: see the same query in /api/amazon/anomalies -- returns are joined to their
        // original shipment's order_date rather than filtered by their own returndate.
        const result = await client.query(`
          SELECT g.sku,
            COALESCE(SUM(CASE WHEN g.transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(g.quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS shipped,
            COALESCE(r.returned, 0) AS returned
          FROM "Amazon_GST_Master" g
          LEFT JOIN (
            SELECT r.sku, SUM(CAST(NULLIF(REPLACE(r.quantity, ',', ''), '') AS numeric)) AS returned
            FROM "AmazonReturnsB2cRow" r
            LEFT JOIN "Amazon_GST_Master" sg
              ON sg.order_id = r.orderid AND sg.sku = r.sku AND sg.transaction_type = 'Shipment'
            WHERE 1=1 ${gstDateFilter.replace(/order_date/g, "COALESCE(sg.order_date, r.returndate)")}
            GROUP BY r.sku
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
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date`;
      }

      const [ordersResult, listingsResult, returnsResult, claimsResult] = await Promise.all([
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
        // Accrual basis: every return row is pulled un-dated and joined to its shipment's order_date, then
        // filtered/aggregated in JS below by accrual date (shipment date, falling back to the return's own
        // returndate when unmatched) -- so a unit sold at period-end and returned early next period counts
        // against the period it was SOLD in, not the period it happened to be returned in. See the same
        // pattern's comment in /api/amazon/financials.
        client.query(`
          SELECT r.orderid, r.sku, r.quantity, r.detaileddisposition, r.returndate, g.order_date AS shipment_order_date
          FROM "AmazonReturnsB2cRow" r
          LEFT JOIN "Amazon_GST_Master" g
            ON g.order_id = r.orderid AND g.sku = r.sku AND g.transaction_type = 'Shipment'
        `),
        client.query(`
          SELECT c.amazonorderid, c.sku, c.approvaldate,
            g.order_date AS shipment_order_date,
            CAST(NULLIF(REPLACE(c.amounttotal, ',', ''), '') AS numeric) AS amount,
            CAST(NULLIF(REPLACE(c.quantityreimbursedtotal, ',', ''), '') AS numeric) AS qty
          FROM "AmazonClaimsReimbursementsRow" c
          LEFT JOIN "Amazon_GST_Master" g
            ON g.order_id = c.amazonorderid AND g.sku = c.sku AND g.transaction_type = 'Shipment'
        `),
      ]);

      const totalRevenue = parseFloat(ordersResult.rows[0].total_revenue);
      const totalOrders = parseInt(ordersResult.rows[0].total_orders);
      const shippedQty = parseFloat(ordersResult.rows[0].shipped_qty);

      const totalListings = parseInt(listingsResult.rows[0].total_listings);
      const activeListings = parseInt(listingsResult.rows[0].active_listings);

      // A row's accrual date is its matched shipment's order_date, falling back to its own event date
      // (returndate / approvaldate) only when no matching Shipment row exists in Amazon_GST_Master.
      const inAccrualRange = (accrualDate: string | null): boolean => {
        if (!accrualDate) return false;
        if (!startDate || !endDate) return true;
        return accrualDate >= startDate && accrualDate <= endDate;
      };

      const returnRowsInRange = returnsResult.rows.filter((r: any) => {
        const accrualDate = (r.shipment_order_date || r.returndate || "").slice(0, 10);
        return inAccrualRange(accrualDate);
      });
      const returnedQty = returnRowsInRange.reduce((sum: number, r: any) => sum + (parseFloat(String(r.quantity).replace(/,/g, "")) || 0), 0);
      const goodReturnQty = returnRowsInRange
        .filter((r: any) => r.detaileddisposition === "SELLABLE")
        .reduce((sum: number, r: any) => sum + (parseFloat(String(r.quantity).replace(/,/g, "")) || 0), 0);
      const badReturnQty = returnRowsInRange
        .filter((r: any) => r.detaileddisposition !== "SELLABLE")
        .reduce((sum: number, r: any) => sum + (parseFloat(String(r.quantity).replace(/,/g, "")) || 0), 0);

      const claimRowsInRangeRaw = claimsResult.rows.filter((r: any) => {
        const accrualDate = (r.shipment_order_date || r.approvaldate || "").slice(0, 10);
        return inAccrualRange(accrualDate);
      });
      const totalClaims = claimRowsInRangeRaw.length;
      const successfulClaims = claimRowsInRangeRaw.filter((r: any) => (parseFloat(r.qty) || 0) > 0).length;

      // Reimbursement Rate: reimbursed amount / COGS of claimed units, restricted to claims we can
      // actually cost -- around two-thirds of claimed orders never got a Amazon_GST_Master row at all
      // (a real gap in Amazon's own GST export, confirmed not a join-key or date-range bug: broadening to
      // every transaction_type, and removing the date filter entirely, made no difference). Comparing all
      // claims' reimbursed amount against a badly undercounted COGS denominator is what previously
      // produced rates like 422% -- both sides must now come from the same resolvable population.
      // Primary cost source: the matching Amazon_GST_Master shipment row(s) cost_inventory.
      // Fallback: EasyEcomInventory's own per-SKU cost history (same source cost_inventory itself is
      // built from), since COGS is a SKU-level cost basis, not something that requires the order to
      // appear in Amazon's GST export. Claims with no cost available from either source are excluded
      // from both sides, rather than left in the numerator alone.
      // Accrual basis: pulled un-dated and joined to the shipment's order_date, filtered in JS by accrual
      // date (falling back to approvaldate when unmatched), same pattern as returnRowsInRange above.
      const claimRowsInRange = claimRowsInRangeRaw;

      // Group claim rows by (orderid, sku) pair first -- a pair can have multiple claim rows (partial/
      // repeat reimbursements), and COGS must be resolved once per pair, not once per claim row, or a
      // pair with 2 claims would have its cost counted twice.
      const claimsByPair = new Map<string, { amount: number; qty: number; sku: string; latestApprovaldate: string }>();
      for (const row of claimRowsInRange) {
        const pairKey = `${row.amazonorderid}|||${row.sku}`;
        const existing = claimsByPair.get(pairKey);
        const amount = parseFloat(row.amount) || 0;
        const qty = parseFloat(row.qty) || 0;
        const approvaldate = row.approvaldate || "";
        if (existing) {
          existing.amount += amount;
          existing.qty += qty;
          if (approvaldate > existing.latestApprovaldate) existing.latestApprovaldate = approvaldate;
        } else {
          claimsByPair.set(pairKey, { amount, qty, sku: row.sku, latestApprovaldate: approvaldate });
        }
      }

      const gstCostByPair = new Map<string, number>();
      if (claimsByPair.size > 0) {
        const orderIds: string[] = [];
        const skus: string[] = [];
        for (const key of claimsByPair.keys()) {
          const [orderId, sku] = key.split("|||");
          orderIds.push(orderId);
          skus.push(sku);
        }
        const gstCostResult = await client.query(`
          SELECT order_id, sku, COALESCE(SUM(cost_inventory), 0) AS total_cost
          FROM "Amazon_GST_Master"
          WHERE transaction_type = 'Shipment'
            AND (order_id, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
          GROUP BY order_id, sku
        `, [orderIds, skus]);
        for (const row of gstCostResult.rows) {
          const cost = parseFloat(row.total_cost);
          if (!isNaN(cost)) gstCostByPair.set(`${row.order_id}|||${row.sku}`, cost);
        }
      }

      const claimSkus = Array.from(new Set(Array.from(claimsByPair.values()).map((v) => v.sku).filter(Boolean)));
      const easyEcomCostHistory = await loadEasyEcomCostHistory(client, claimSkus);

      // True total reimbursed across ALL claims in the period (for the standalone "Reimbursement Amount"
      // figure) -- distinct from the resolvable-cost-only subset used in the Reimbursement Rate ratio below.
      const totalReimbursedAll = Array.from(claimsByPair.values()).reduce((sum, c) => sum + c.amount, 0);

      let totalReimbursed = 0; // restricted to resolvable-cost claims (see comment above)
      let cogsOfClaimedUnits = 0;
      for (const [pairKey, claim] of claimsByPair) {
        let rowCogs: number | undefined;
        if (gstCostByPair.has(pairKey)) {
          rowCogs = gstCostByPair.get(pairKey);
        } else {
          const history = easyEcomCostHistory.get(String(claim.sku).trim());
          const unitCost = history ? costAsOf(history, claim.latestApprovaldate.slice(0, 10)) : undefined;
          if (unitCost !== undefined) rowCogs = unitCost * claim.qty;
        }

        if (rowCogs !== undefined) {
          totalReimbursed += claim.amount;
          cogsOfClaimedUnits += rowCogs;
        }
      }

      // Claim Rate: bad-returned units for which a claim was actually raised (matched by orderid+sku),
      // over total bad-returned units, both restricted to the accrual-filtered rows already resolved above
      // (returnRowsInRange / claimRowsInRange), so both sides of the ratio share the same accrual-period
      // population instead of being independently date-filtered on different columns.
      const claimedPairSet = new Set(claimRowsInRange.map((r: any) => `${r.amazonorderid}|||${r.sku}`));
      const badReturnRowsInRange = returnRowsInRange.filter((r: any) => r.detaileddisposition !== "SELLABLE");
      // Return rows don't carry a sku-qualified orderid pairing column of their own name here, so match
      // via the same orderid/sku fields returnsResult already selected alongside quantity/disposition.
      const claimedBadReturnQty = badReturnRowsInRange
        .filter((r: any) => claimedPairSet.has(`${r.orderid}|||${r.sku}`))
        .reduce((sum: number, r: any) => sum + (parseFloat(String(r.quantity).replace(/,/g, "")) || 0), 0);

      // Claim (<24h) Rate: bad-returned UNITS for which a claim was filed within 24h of the return, over
      // total bad-returned units (both accrual-filtered as above) -- a unit-for-unit ratio matching the
      // spec definition, not a count of claim records (a pair with 2 claims, or a claim covering multiple
      // units, must not skew the ratio away from actual unit counts). filedat is backfilled from the
      // returns-ops DB's Reimbursement.filedAt -- Amazon's own export has no claim-raised timestamp.
      const claim24hResult = await client.query(`
        SELECT DISTINCT r.orderid, r.sku, r.returndate, g.order_date AS shipment_order_date
        FROM "AmazonReturnsB2cRow" r
        LEFT JOIN "Amazon_GST_Master" g
          ON g.order_id = r.orderid AND g.sku = r.sku AND g.transaction_type = 'Shipment'
        JOIN "AmazonClaimsReimbursementsRow" c ON c.amazonorderid = r.orderid AND c.sku = r.sku
        WHERE r.detaileddisposition IS DISTINCT FROM 'SELLABLE'
          AND c.filedat IS NOT NULL
          AND EXTRACT(EPOCH FROM (c.filedat::timestamptz - r.returndate::timestamptz)) / 3600 BETWEEN 0 AND 24
      `);
      const pairsWithin24h = new Set(
        claim24hResult.rows
          .filter((r: any) => inAccrualRange((r.shipment_order_date || r.returndate || "").slice(0, 10)))
          .map((r: any) => `${r.orderid}|||${r.sku}`)
      );
      const claimsWithin24hUnits = badReturnRowsInRange
        .filter((r: any) => pairsWithin24h.has(`${r.orderid}|||${r.sku}`))
        .reduce((sum: number, r: any) => sum + (parseFloat(String(r.quantity).replace(/,/g, "")) || 0), 0);
      const claim24hPct = badReturnQty > 0 ? (claimsWithin24hUnits / badReturnQty) * 100 : 0;

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

      // Preserved old "claims success" metric under a new name (was `claimPct`).
      // NOTE: this reads ~100% by construction, not as a data bug. AmazonClaimsReimbursementsRow is
      // Amazon's *reimbursements* report -- every row already represents a paid-out claim, so
      // quantityreimbursedtotal is always >0 for every row in it. Rejected/denied claims are never
      // ingested anywhere (confirmed against the returns-ops DB too: Reimbursement/claims_all/
      // claims_status all only track post-approval or pre-filing state, never a rejection outcome).
      // A real approval-rate would need Amazon's claims-*filed* data, which isn't ingested.
      const claimSuccessPct = totalClaims > 0 ? (successfulClaims / totalClaims) * 100 : 0;
      // Claim Rate: bad-returned units matched to an actual claim / total bad-returned units
      const claimRatePct = badReturnQty > 0 ? (claimedBadReturnQty / badReturnQty) * 100 : 0;

      const reimbursementPct = cogsOfClaimedUnits > 0 ? (totalReimbursed / cogsOfClaimedUnits) * 100 : 0;

      // --- Supply Chain vulnerability metrics: Out of Stock Days, Stockout Cost, Ageing Inventory %, Dead Stock % ---
      // Reference date = end of the selected range (or today, if no range picked); a 182-day (26-week) trailing
      // lookback before it is pulled to run the week-over-week ageing state-machine and day-over-day dead-stock
      // check. (A SKU whose ageing flag was triggered further back than this window, and never recovered, will
      // read as un-flagged -- an accepted bound rather than pulling unbounded history on every request.)
      //
      // This block is cached (1h TTL, keyed by revenueCol/reportStartStr/reportEndStr): it pulls ~300K
      // EasyEcomInventory rows and runs a per-SKU/per-day JS aggregation loop over them, which dominates
      // this endpoint's latency on Render's free tier (fractional shared CPU) even though the underlying
      // SQL itself runs in well under a second. The inputs (daily shipment/stock snapshots) only change
      // once or so per day, so recomputing on every dashboard load is pure waste.
      const referenceDateStr = endDate || new Date().toISOString().slice(0, 10);
      const lookbackStartStr = new Date(new Date(referenceDateStr).getTime() - 182 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const reportStartStr = startDate || lookbackStartStr;
      const reportEndStr = referenceDateStr;

      const supplyChainCacheKey = `supply-chain:${revenueCol}:${lookbackStartStr}:${referenceDateStr}:${reportStartStr}:${reportEndStr}`;
      const supplyChain = await withTtlCache(supplyChainCacheKey, 60 * 60 * 1000, async () => {
        const [dailyUnitsResult, dailyStockResult] = await Promise.all([
          client!.query(`
            SELECT sku, TO_CHAR(NULLIF(order_date, '')::date, 'YYYY-MM-DD') AS d,
              COALESCE(SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)), 0) AS units,
              COALESCE(SUM(${revenueCol}), 0) AS revenue
            FROM "Amazon_GST_Master"
            WHERE transaction_type = 'Shipment'
              AND order_date IS NOT NULL AND order_date != ''
              AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date
            GROUP BY sku, NULLIF(order_date, '')::date
          `, [lookbackStartStr, referenceDateStr]),
          client!.query(`
            SELECT sku, TO_CHAR(date::date, 'YYYY-MM-DD') AS d, quantity
            FROM "EasyEcomInventory"
            WHERE date IS NOT NULL AND date != ''
              AND date::date >= $1::date AND date::date <= $2::date
          `, [lookbackStartStr, referenceDateStr]),
        ]);

        type DayNum = { units: number; revenue: number };
        const unitsBySkuDate = new Map<string, Map<string, DayNum>>();
        for (const row of dailyUnitsResult.rows) {
          const d = row.d;
          if (!unitsBySkuDate.has(row.sku)) unitsBySkuDate.set(row.sku, new Map());
          unitsBySkuDate.get(row.sku)!.set(d, { units: parseFloat(row.units), revenue: parseFloat(row.revenue) });
        }
        const stockBySkuDate = new Map<string, Map<string, number>>();
        for (const row of dailyStockResult.rows) {
          const d = row.d;
          if (!stockBySkuDate.has(row.sku)) stockBySkuDate.set(row.sku, new Map());
          stockBySkuDate.get(row.sku)!.set(d, row.quantity == null ? 0 : parseFloat(row.quantity));
        }

        const allSkus = new Set<string>([...unitsBySkuDate.keys(), ...stockBySkuDate.keys()]);

        let ageingFlaggedCount = 0;
        let deadStockCriticalCount = 0;
        let outOfStockDaysWeighted = 0;
        let platformRevenueInRange = 0;
        const perSkuRevenueInRange = new Map<string, number>();
        const criticalSkus: { sku: string; prevRate: number; lastRate: number; dropPct: number }[] = [];
        const ageingSkus: { sku: string; triggerWeek: string; prevRate: number; currRate: number; dropPct: number }[] = [];

        for (const sku of allSkus) {
          const stockMap = stockBySkuDate.get(sku) || new Map<string, number>();
          const unitsMap = unitsBySkuDate.get(sku) || new Map<string, DayNum>();

          // All dates this SKU has a stock snapshot for, ascending -- the timeline we can evaluate "stocked" on
          const dates = [...stockMap.keys()].sort();

          // Weekly avg run-rate over stocked days only (per spec footnote), for the ageing state-machine
          const weekBuckets = new Map<string, { sum: number; count: number }>();
          for (const d of dates) {
            const qty = stockMap.get(d)!;
            if (qty <= 0) continue; // not stocked -- excluded from run-rate per spec
            const unitsSold = unitsMap.get(d)?.units ?? 0;
            const wk = isoWeekStart(d);
            const bucket = weekBuckets.get(wk) || { sum: 0, count: 0 };
            bucket.sum += unitsSold;
            bucket.count += 1;
            weekBuckets.set(wk, bucket);
          }
          const weeks = [...weekBuckets.entries()]
            .map(([wk, b]) => ({ wk, rate: b.sum / b.count }))
            .sort((a, b) => (a.wk < b.wk ? -1 : 1));

          let flagged = false;
          let triggerRate = 0;
          let triggerWeek = "";
          let triggerCurrRate = 0;
          for (let i = 1; i < weeks.length; i++) {
            const prevRate = weeks[i - 1].rate;
            const currRate = weeks[i].rate;
            if (!flagged) {
              if (prevRate > 0 && (prevRate - currRate) / prevRate >= 0.30) {
                flagged = true;
                triggerRate = prevRate;
                triggerWeek = weeks[i].wk;
                triggerCurrRate = currRate;
              }
            } else if (currRate >= triggerRate) {
              flagged = false;
            }
          }
          if (flagged) {
            ageingFlaggedCount++;
            ageingSkus.push({
              sku,
              triggerWeek,
              prevRate: Math.round(triggerRate * 100) / 100,
              currRate: Math.round(triggerCurrRate * 100) / 100,
              dropPct: Math.round(((triggerRate - triggerCurrRate) / triggerRate) * 10000) / 100,
            });
          }

          // Dead Stock (critical): day-over-day run-rate drop >= 50%, checked on the most recent two stocked days
          const stockedDatesInRange = dates.filter((d) => d >= reportStartStr && d <= reportEndStr && stockMap.get(d)! > 0);
          if (stockedDatesInRange.length >= 2) {
            const last = stockedDatesInRange[stockedDatesInRange.length - 1];
            const prev = stockedDatesInRange[stockedDatesInRange.length - 2];
            const lastRate = unitsMap.get(last)?.units ?? 0;
            const prevRate = unitsMap.get(prev)?.units ?? 0;
            if (prevRate > 0 && (prevRate - lastRate) / prevRate >= 0.50) {
              deadStockCriticalCount++;
              criticalSkus.push({
                sku,
                prevRate: Math.round(prevRate * 100) / 100,
                lastRate: Math.round(lastRate * 100) / 100,
                dropPct: Math.round(((prevRate - lastRate) / prevRate) * 10000) / 100,
              });
            }
          }

          // Out of Stock Days: count OOS days within the reporting range only, weighted by this SKU's revenue share
          let oosDaysInRange = 0;
          for (const d of dates) {
            if (d < reportStartStr || d > reportEndStr) continue;
            if (stockMap.get(d)! <= 0) oosDaysInRange++;
          }
          let skuRevenueInRange = 0;
          for (const [d, dn] of unitsMap.entries()) {
            if (d < reportStartStr || d > reportEndStr) continue;
            skuRevenueInRange += dn.revenue;
          }
          perSkuRevenueInRange.set(sku, skuRevenueInRange);
          platformRevenueInRange += skuRevenueInRange;

          if (oosDaysInRange > 0) {
            outOfStockDaysWeighted += oosDaysInRange * skuRevenueInRange; // divided by platform revenue below
          }
        }

        const outOfStockDays = platformRevenueInRange > 0 ? outOfStockDaysWeighted / platformRevenueInRange : 0;
        // Stockout Cost must multiply the day-count by an average DAILY revenue rate, not the whole period's
        // total revenue -- multiplying by period-total revenue mismatches units (days x total-period-money
        // produces a figure that can exceed the period's entire actual revenue several times over).
        const reportDayCount = Math.max(1, Math.round(
          (new Date(reportEndStr).getTime() - new Date(reportStartStr).getTime()) / (1000 * 60 * 60 * 24)
        ) + 1);
        const avgDailyPlatformRevenue = platformRevenueInRange / reportDayCount;
        const stockoutCost = outOfStockDays * avgDailyPlatformRevenue;

        return {
          ageingFlaggedCount,
          deadStockCriticalCount,
          outOfStockDays,
          stockoutCost,
          criticalSkus,
          ageingSkus,
          perSkuRevenueInRange: Array.from(perSkuRevenueInRange.entries()),
        };
      });

      const perSkuRevenueInRange = new Map<string, number>(supplyChain.perSkuRevenueInRange);
      const { outOfStockDays, stockoutCost, criticalSkus, ageingSkus, ageingFlaggedCount, deadStockCriticalCount } = supplyChain;
      const ageingInventoryPct = activeListings > 0 ? (ageingFlaggedCount / activeListings) * 100 : 0;
      const deadStockPct = activeListings > 0 ? (deadStockCriticalCount / activeListings) * 100 : 0;

      res.json({
        success: true,
        data: {
          aov: Math.round(aov * 100) / 100,
          ordersPerDay,
          unitsPerOrder: Math.round(unitsPerOrder * 100) / 100,
          totalOrders,
          unitsSold: shippedQty,
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
          claim24hPct: Math.round(claim24hPct * 100) / 100,
          reimbursementPct: Math.round(reimbursementPct * 100) / 100,
          reimbursementAmount: Math.round(totalReimbursedAll * 100) / 100,
          returnLossPct: null, // computed alongside returnLoss amount in /api/amazon/financials; see that endpoint
          // Supply Chain vulnerability metrics -- see the computation block above for formulas/assumptions
          outOfStockDays: Math.round(outOfStockDays * 100) / 100,
          stockoutCost: Math.round(stockoutCost * 100) / 100,
          ageingInventoryPct: Math.round(ageingInventoryPct * 100) / 100,
          deadStockPct: Math.round(deadStockPct * 100) / 100,
          criticalSkus: criticalSkus
            .sort((a, b) => b.dropPct - a.dropPct)
            .map((c) => ({ ...c, revenueInRange: Math.round((perSkuRevenueInRange.get(c.sku) ?? 0) * 100) / 100 })),
          ageingSkus: ageingSkus
            .map((a) => ({
              ...a,
              revenueInRange: Math.round((perSkuRevenueInRange.get(a.sku) ?? 0) * 100) / 100,
              // Velocity tag from the pre-drop run-rate (units/day), per spec bands
              velocityTag: a.prevRate >= 30 ? "Fast" : a.prevRate >= 15 ? "Medium" : a.prevRate >= 4 ? "Slow" : "Non-Selling",
            }))
            .sort((a, b) => {
              const tagOrder: Record<string, number> = { Fast: 0, Medium: 1, Slow: 2, "Non-Selling": 3 };
              const tagDiff = tagOrder[a.velocityTag] - tagOrder[b.velocityTag];
              if (tagDiff !== 0) return tagDiff;
              return b.revenueInRange - a.revenueInRange;
            }),
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
      const params: string[] = [];

      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date`;
        settlementDateFilter = `AND safe_posteddate(posteddate) >= $1::date AND safe_posteddate(posteddate) <= $2::date`;
      }

      // Amazon Charges GST toggle: fba_fees/selling_fees/other_transaction_fees on Amazon_Unified_Transactions
      // are already GST-inclusive with no separate tax column to subtract. The settlement tables
      // (Electronics_all_statements / COD_ALL_Settlements) are the only source where GST-on-fees is itemized
      // separately (e.g. "FBA Weight Handling Fee CGST/SGST", "Fixed closing fee IGST"), so Amazon Charges is
      // computed from settlement ItemFees rows here, excluding CGST/SGST/IGST-described rows when exclusive.
      const gstFeeFilter = gstMode === "inclusive"
        ? ""
        : `AND amountdescription NOT ILIKE '%cgst%' AND amountdescription NOT ILIKE '%sgst%' AND amountdescription NOT ILIKE '%igst%'`;

      // AmazonAdsCampaignRow is a monthly snapshot per account (dateRange = "May 2026" etc), not a single
      // lifetime row -- sum only the month(s) the selected range overlaps, so switching periods in the UI
      // doesn't silently add up every month ever ingested.
      const adPeriodLabels = startDate && endDate ? monthLabelsInRange(startDate, endDate) : [];

      const [gstResult, feesResult, adsResult, badReturnsResult] = await Promise.all([
        client.query(`
          SELECT
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN transaction_type = 'Refund' THEN ABS(${revenueCol}) ELSE 0 END), 0) AS returns,
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
          WHERE currency_code = 'INR' ${adPeriodLabels.length > 0 ? "AND \"dateRange\" = ANY($1::text[])" : ""}
        `, adPeriodLabels.length > 0 ? [adPeriodLabels] : []),
        // Return Loss raw ingredients -- resolved and combined in JS below (see comment there for why).
        // Accrual basis: a return is attributed to the month its ORIGINAL SALE shipped in, not the month
        // it was returned. Without this, a unit sold on the last day of a month and returned early the
        // next month would inflate that month's revenue/profit with no offsetting loss, and dump the
        // loss on the following month instead -- a pure timing artifact, not a real month-over-month
        // profit change. So this queries ALL bad-disposition returns (no returndate filter) and later
        // buckets them in JS by their matched shipment's order_date, falling back to the return's own
        // returndate only for the ~15-20% of returns with no matching Shipment row in Amazon_GST_Master
        // (genuinely no shipment month to accrue back to).
        client.query(`
          SELECT r.orderid, r.sku,
            SUM(CAST(NULLIF(REPLACE(r.quantity, ',', ''), '') AS numeric)) AS bad_qty,
            MAX(r.returndate) AS latest_returndate,
            MAX(g.order_date) AS shipment_order_date
          FROM "AmazonReturnsB2cRow" r
          LEFT JOIN "Amazon_GST_Master" g
            ON g.order_id = r.orderid AND g.sku = r.sku AND g.transaction_type = 'Shipment'
          WHERE r.detaileddisposition IS DISTINCT FROM 'SELLABLE'
          GROUP BY r.orderid, r.sku
        `),
      ]);

      const grossRevenue = parseFloat(gstResult.rows[0].revenue);
      const saleReturns = parseFloat(gstResult.rows[0].returns);
      const netRevenue = grossRevenue - saleReturns;
      const cogs = parseFloat(gstResult.rows[0].cogs);
      const cm1 = netRevenue - cogs;

      const amazonCharges = parseFloat(feesResult.rows[0].amazon_charges_total);
      const peopleCost = 0; // Pending Finance input -- data to be added later

      const dayCount = startDate && endDate
        ? Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1)
        : 30;
      const rentalCharges = RENTAL_CHARGES_PER_MONTH * (dayCount / 30);

      const amazonAdsSpend = parseFloat(adsResult.rows[0].total_ad_spend);
      const beyondAdsSpend = amazonAdsSpend * BEYOND_ADS_MULTIPLIER;
      const advertisementCostTotal = amazonAdsSpend + beyondAdsSpend;

      // Return Loss = COGS of bad-marked returned units minus matched claim reimbursement, resolved per
      // (orderid, sku) pair with the same primary/fallback cost chain as Reimbursement Rate (see that
      // endpoint's comment): most bad-disposition returns' orders were never in Amazon's own GST export
      // (Amazon_GST_Master), so a plain LEFT JOIN silently treated their cost as 0 while still subtracting
      // any matched reimbursement -- understating the loss. Pairs with no resolvable cost from either
      // source are excluded entirely, not counted as zero-cost.
      //
      // Accrual month resolution: a return's "reporting date" for range-filtering purposes is its
      // shipment_order_date (the original sale's order_date), NOT its own returndate -- so a unit sold
      // May 31 and returned June 14 counts against MAY's profit, matching the revenue it's offsetting,
      // instead of silently inflating May and dumping an unrelated loss on June. Falls back to the
      // return's own returndate only when no matching Shipment row exists in Amazon_GST_Master (no
      // shipment month to accrue back to).
      const accrualDateInRange = (row: any): boolean => {
        if (!startDate || !endDate) return true;
        const accrualDate = (row.shipment_order_date || row.latest_returndate || "").slice(0, 10);
        if (!accrualDate) return false;
        return accrualDate >= startDate && accrualDate <= endDate;
      };
      const badReturnsInRange = badReturnsResult.rows.filter(accrualDateInRange);

      let returnLoss = 0;
      // Return Loss Rate = (Total COGS of bad-disposition units - Total reimbursed for those units) /
      // Total COGS of bad-disposition units -- tracked as its own numerator/denominator (not derived from
      // netRevenue) because the spec defines this as a recovery-rate on the loss itself, not a % of sales.
      let totalBadUnitsCogs = 0;
      let totalReimbursedForBadUnits = 0;
      if (badReturnsInRange.length > 0) {
        const orderIds = badReturnsInRange.map((r: any) => r.orderid);
        const skus = badReturnsInRange.map((r: any) => r.sku);

        const [perUnitCogsResult, claimsResult] = await Promise.all([
          client.query(`
            SELECT order_id, sku,
              CASE WHEN SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) > 0
                THEN SUM(cost_inventory) / SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric))
                ELSE NULL END AS unit_cogs
            FROM "Amazon_GST_Master"
            WHERE transaction_type = 'Shipment'
              AND (order_id, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
            GROUP BY order_id, sku
          `, [orderIds, skus]),
          // Claim reimbursements are matched to the same accrual period as the return loss they offset
          // (not filtered by their own approvaldate) -- a reimbursement approved in a later month for a
          // return that's been accrued back to an earlier month must net against that same earlier
          // month, or the loss and its offsetting reimbursement would land in different periods.
          client.query(`
            SELECT amazonorderid, sku, SUM(CAST(NULLIF(REPLACE(amounttotal, ',', ''), '') AS numeric)) AS reimbursed
            FROM "AmazonClaimsReimbursementsRow"
            WHERE (amazonorderid, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
            GROUP BY amazonorderid, sku
          `, [orderIds, skus]),
        ]);

        const gstUnitCogsByPair = new Map<string, number>();
        for (const row of perUnitCogsResult.rows) {
          if (row.unit_cogs === null) continue;
          const unitCogs = parseFloat(row.unit_cogs);
          if (!isNaN(unitCogs)) gstUnitCogsByPair.set(`${row.order_id}|||${row.sku}`, unitCogs);
        }
        const reimbursedByPair = new Map<string, number>();
        for (const row of claimsResult.rows) {
          reimbursedByPair.set(`${row.amazonorderid}|||${row.sku}`, parseFloat(row.reimbursed));
        }

        const easyEcomCostHistory = await loadEasyEcomCostHistory(client, Array.from(new Set(skus)));

        for (const row of badReturnsInRange) {
          const pairKey = `${row.orderid}|||${row.sku}`;
          const badQty = parseFloat(row.bad_qty) || 0;

          let unitCogs = gstUnitCogsByPair.get(pairKey);
          if (unitCogs === undefined) {
            const history = easyEcomCostHistory.get(String(row.sku).trim());
            unitCogs = history ? costAsOf(history, (row.latest_returndate || "").slice(0, 10)) : undefined;
          }

          if (unitCogs !== undefined) {
            const reimbursed = reimbursedByPair.get(pairKey) || 0;
            const badCogs = badQty * unitCogs;
            returnLoss += badCogs - reimbursed;
            totalBadUnitsCogs += badCogs;
            totalReimbursedForBadUnits += reimbursed;
          }
        }
        returnLoss = Math.max(0, returnLoss);
      }
      const returnLossPct = totalBadUnitsCogs > 0 ? ((totalBadUnitsCogs - totalReimbursedForBadUnits) / totalBadUnitsCogs) * 100 : 0;

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
        settlementDateFilter = `AND safe_posteddate(posteddate) >= $1::date AND safe_posteddate(posteddate) <= $2::date`;
      }

      // See /api/amazon/financials for why Amazon Charges is settlement-based rather than Unified-Transactions-based:
      // fba_fees/selling_fees/other_transaction_fees are GST-inclusive with no separate tax column, whereas the
      // settlement tables itemize GST-on-fees separately (e.g. "Fixed closing fee IGST").
      const gstFeeFilter = gstMode === "inclusive"
        ? ""
        : `AND amountdescription NOT ILIKE '%cgst%' AND amountdescription NOT ILIKE '%sgst%' AND amountdescription NOT ILIKE '%igst%'`;

      if (section === "advertisement") {
        // Advertisement Cost L2: Amazon Ads campaign-level breakdown + a single "Beyond Ads" estimate line.
        // AmazonAdsCampaignRow is a monthly snapshot per account (dateRange = "May 2026" etc) -- sum only
        // the month(s) the selected range overlaps.
        const adPeriodLabels = startDate && endDate ? monthLabelsInRange(startDate, endDate) : [];
        const adsResult = await client.query(`
          SELECT
            COALESCE(type, 'Unspecified') AS description,
            COALESCE(SUM(CAST(NULLIF(spend, '') AS numeric)), 0) AS amount,
            COALESCE(SUM(CAST(NULLIF(impressions, '') AS numeric)), 0) AS impressions,
            COALESCE(SUM(CAST(NULLIF(clicks, '') AS numeric)), 0) AS clicks,
            COALESCE(SUM(CAST(NULLIF(sales, '') AS numeric)), 0) AS sales
          FROM "AmazonAdsCampaignRow"
          WHERE currency_code = 'INR' ${adPeriodLabels.length > 0 ? "AND \"dateRange\" = ANY($1::text[])" : ""}
          GROUP BY type
          ORDER BY amount DESC
        `, adPeriodLabels.length > 0 ? [adPeriodLabels] : []);
        // CTR/ACOS/ROAS computed from the summed totals (weighted), not by averaging the per-row ratios.
        const amazonAdsBreakdown = adsResult.rows.map((r: any) => {
          const amount = parseFloat(r.amount);
          const impressions = parseFloat(r.impressions);
          const clicks = parseFloat(r.clicks);
          const sales = parseFloat(r.sales);
          return {
            description: `Amazon Ads (billed) - ${r.description}`,
            amount,
            impressions,
            clicks,
            sales,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            acos: sales > 0 ? (amount / sales) * 100 : 0,
            roas: amount > 0 ? sales / amount : 0,
          };
        });
        const amazonAdsTotal = amazonAdsBreakdown.reduce((s: number, i: any) => s + i.amount, 0);
        const beyondAdsTotal = amazonAdsTotal * BEYOND_ADS_MULTIPLIER;

        // Per-campaign breakdown with real campaign names, Glance Views (Detail Page Views) and
        // Conversion Rate (Purchases / Clicks) -- from the manually-exported Advertised Product report.
        // NOTE: Detail Page Views is sparsely populated in the source export (mostly blank/zero for
        // low-volume campaigns) -- shown as null rather than 0 when genuinely absent, not estimated.
        const campaignResult = await client.query(`
          SELECT
            "campaignId",
            MAX("campaignName") AS campaign_name,
            COALESCE(SUM(CAST(NULLIF(impressions, '') AS numeric)), 0) AS impressions,
            COALESCE(SUM(CAST(NULLIF(clicks, '') AS numeric)), 0) AS clicks,
            COALESCE(SUM(CAST(NULLIF("totalCost", '') AS numeric)), 0) AS spend,
            COALESCE(SUM(CAST(NULLIF(sales, '') AS numeric)), 0) AS sales,
            COALESCE(SUM(CAST(NULLIF(purchases, '') AS numeric)), 0) AS purchases,
            SUM(CAST(NULLIF("detailPageViews", '') AS numeric)) AS detail_page_views,
            COUNT("detailPageViews") FILTER (WHERE "detailPageViews" IS NOT NULL AND "detailPageViews" != '') AS detail_page_views_rows
          FROM "Amazon_Advertised_Product"
          GROUP BY "campaignId"
          ORDER BY spend DESC
        `);
        const byCampaign = campaignResult.rows.map((r: any) => {
          const impressions = parseFloat(r.impressions);
          const clicks = parseFloat(r.clicks);
          const spend = parseFloat(r.spend);
          const sales = parseFloat(r.sales);
          const purchases = parseFloat(r.purchases);
          const hasDetailPageViews = parseInt(r.detail_page_views_rows) > 0;
          return {
            campaignId: r.campaignId,
            campaignName: r.campaign_name,
            impressions,
            clicks,
            spend,
            sales,
            purchases,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            acos: sales > 0 ? (spend / sales) * 100 : 0,
            roas: spend > 0 ? sales / spend : 0,
            conversionRate: clicks > 0 ? (purchases / clicks) * 100 : 0,
            glanceViews: hasDetailPageViews ? parseFloat(r.detail_page_views) : null,
          };
        });

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
            byCampaign,
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
        gstDateFilter = `AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date`;
      }

      // order_date is stored as a full timestamp string (not a bare date), so date_trunc requires a cast to date first.
      // Period is formatted to text via TO_CHAR (not left as a native date) so node-postgres never round-trips
      // it through a JS Date object -- pg parses SQL `date` in the server's local timezone, and calling
      // toISOString() on that (UTC) shifts the date backwards by the timezone offset (e.g. IST: -1 day).
      const periodExpr = granularity === "daily"
        ? `TO_CHAR(NULLIF(order_date, '')::date, 'YYYY-MM-DD')`
        : granularity === "weekly"
        ? `TO_CHAR(date_trunc('week', NULLIF(order_date, '')::date), 'YYYY-MM-DD')`
        : `TO_CHAR(date_trunc('month', NULLIF(order_date, '')::date), 'YYYY-MM-DD')`;

      const gstTrendResult = await client.query(`
        SELECT
          ${periodExpr} AS period,
          COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS gross_revenue,
          COALESCE(SUM(CASE WHEN transaction_type = 'Refund' THEN ABS(${revenueCol}) ELSE 0 END), 0) AS sale_returns,
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
        ? `TO_CHAR(safe_posteddate(posteddate), 'YYYY-MM-DD')`
        : granularity === "weekly"
        ? `TO_CHAR(date_trunc('week', safe_posteddate(posteddate)), 'YYYY-MM-DD')`
        : `TO_CHAR(date_trunc('month', safe_posteddate(posteddate)), 'YYYY-MM-DD')`;
      const settlementTrendResult = await client.query(`
        SELECT period, COALESCE(SUM(ABS(CAST(NULLIF(REPLACE(amount, ',', ''), '') AS numeric))), 0) AS amazon_charges
        FROM (
          SELECT ${settlementPeriodExpr} AS period, amount FROM "Electronics_all_statements"
          WHERE amounttype = 'ItemFees' ${startDate && endDate ? `AND safe_posteddate(posteddate) >= $1::date AND safe_posteddate(posteddate) <= $2::date` : ""} ${gstFeeFilter}
          UNION ALL
          SELECT ${settlementPeriodExpr} AS period, amount FROM "COD_ALL_Settlements"
          WHERE amounttype = 'ItemFees' ${startDate && endDate ? `AND safe_posteddate(posteddate) >= $1::date AND safe_posteddate(posteddate) <= $2::date` : ""} ${gstFeeFilter}
        ) combined
        GROUP BY period
      `, params);

      const chargesByPeriod: Record<string, number> = {};
      for (const row of settlementTrendResult.rows) {
        chargesByPeriod[row.period] = parseFloat(row.amazon_charges);
      }

      // Return Loss, bucketed to the same granularity as everything else -- resolved with the same
      // per-(orderid, sku) cost chain as /api/amazon/financials (GST Master unit COGS, falling back to
      // EasyEcom cost history), so a period's cm2 here is comparable to the headline financials cm2 for
      // that same period.
      //
      // Accrual basis: periodized by the ORIGINAL SHIPMENT's order_date (matching /api/amazon/financials'
      // accrual logic), not the return's own returndate -- a unit sold on the last day of one period and
      // returned early in the next would otherwise inflate that period's profit with no offsetting loss,
      // dumping an unrelated loss on the following period. Falls back to the return's own returndate only
      // when no matching Shipment row exists in Amazon_GST_Master (no shipment period to accrue back to).
      // Claim reimbursements are matched to this same accrual period, not their own approvaldate, so a
      // loss and its offsetting reimbursement always net together in the period they're accrued to.
      const badReturnsTrendResult = await client.query(`
        SELECT r.orderid, r.sku,
          SUM(CAST(NULLIF(REPLACE(r.quantity, ',', ''), '') AS numeric)) AS bad_qty,
          MAX(r.returndate) AS latest_returndate,
          MAX(g.order_date) AS shipment_order_date
        FROM "AmazonReturnsB2cRow" r
        LEFT JOIN "Amazon_GST_Master" g
          ON g.order_id = r.orderid AND g.sku = r.sku AND g.transaction_type = 'Shipment'
        WHERE r.detaileddisposition IS DISTINCT FROM 'SELLABLE'
        GROUP BY r.orderid, r.sku
      `);

      const periodOf = (dateStr: string): string => {
        const d = dateStr.slice(0, 10);
        if (granularity === "daily") return d;
        const [y, m, day] = d.split("-").map(Number);
        if (granularity === "weekly") {
          return isoWeekStart(d);
        }
        return `${y}-${String(m).padStart(2, "0")}-01`;
      };
      const accrualDateInRange = (row: any): string | null => {
        const accrualDate = (row.shipment_order_date || row.latest_returndate || "").slice(0, 10);
        if (!accrualDate) return null;
        if (startDate && endDate && (accrualDate < startDate || accrualDate > endDate)) return null;
        return accrualDate;
      };
      const badReturnsInRange = badReturnsTrendResult.rows
        .map((row: any) => ({ row, accrualDate: accrualDateInRange(row) }))
        .filter((x: any): x is { row: any; accrualDate: string } => x.accrualDate !== null);

      const returnLossByPeriod: Record<string, number> = {};
      if (badReturnsInRange.length > 0) {
        const orderIds = badReturnsInRange.map(({ row }) => row.orderid);
        const skus = badReturnsInRange.map(({ row }) => row.sku);

        const [perUnitCogsResult, claimsResult] = await Promise.all([
          client.query(`
            SELECT order_id, sku,
              CASE WHEN SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) > 0
                THEN SUM(cost_inventory) / SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric))
                ELSE NULL END AS unit_cogs
            FROM "Amazon_GST_Master"
            WHERE transaction_type = 'Shipment'
              AND (order_id, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
            GROUP BY order_id, sku
          `, [orderIds, skus]),
          client.query(`
            SELECT amazonorderid, sku, SUM(CAST(NULLIF(REPLACE(amounttotal, ',', ''), '') AS numeric)) AS reimbursed
            FROM "AmazonClaimsReimbursementsRow"
            WHERE (amazonorderid, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
            GROUP BY amazonorderid, sku
          `, [orderIds, skus]),
        ]);

        const gstUnitCogsByPair = new Map<string, number>();
        for (const row of perUnitCogsResult.rows) {
          if (row.unit_cogs === null) continue;
          const unitCogs = parseFloat(row.unit_cogs);
          if (!isNaN(unitCogs)) gstUnitCogsByPair.set(`${row.order_id}|||${row.sku}`, unitCogs);
        }
        const reimbursedByPair = new Map<string, number>();
        for (const row of claimsResult.rows) {
          reimbursedByPair.set(`${row.amazonorderid}|||${row.sku}`, parseFloat(row.reimbursed));
        }

        const easyEcomCostHistory = await loadEasyEcomCostHistory(client, Array.from(new Set(skus)));

        for (const { row, accrualDate } of badReturnsInRange) {
          const pairKey = `${row.orderid}|||${row.sku}`;
          const badQty = parseFloat(row.bad_qty) || 0;

          let unitCogs = gstUnitCogsByPair.get(pairKey);
          if (unitCogs === undefined) {
            const history = easyEcomCostHistory.get(String(row.sku).trim());
            unitCogs = history ? costAsOf(history, (row.latest_returndate || "").slice(0, 10)) : undefined;
          }

          if (unitCogs !== undefined) {
            const period = periodOf(accrualDate);
            const reimbursed = reimbursedByPair.get(pairKey) || 0;
            returnLossByPeriod[period] = (returnLossByPeriod[period] || 0) + (badQty * unitCogs - reimbursed);
          }
        }
        for (const period of Object.keys(returnLossByPeriod)) {
          returnLossByPeriod[period] = Math.max(0, returnLossByPeriod[period]);
        }
      }

      // Rental Charges prorated per period's actual day span (30-day month basis, same as the headline
      // financials endpoint) -- a monthly bucket's real length (28-31 days) is derived from its period
      // key (the 1st of that month) rather than assumed to be a flat 30, so e.g. a 31-day month prorates
      // to slightly more than one full month's rent, matching what /api/amazon/financials computes for
      // the same range via dayCount.
      const daysInPeriod = (periodKey: string): number => {
        if (granularity === "daily") return 1;
        if (granularity === "weekly") return 7;
        const [y, m] = periodKey.split("-").map(Number);
        return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this month
      };

      // Advertisement Cost intentionally omitted -- AmazonAdsCampaignRow has no date column
      // (lifetime total per account), so daily/weekly/monthly ad spend cannot be trended. cm2/netProfit
      // here is therefore CM1 minus Amazon Charges, Rental, and Return Loss only -- it will read higher
      // than the headline /api/amazon/financials cm2 for the same range, which also subtracts ad spend.
      const data = gstTrendResult.rows.map((row: any) => {
        const periodKey = row.period;
        const grossRevenue = parseFloat(row.gross_revenue);
        const saleReturns = parseFloat(row.sale_returns);
        const netRevenue = grossRevenue - saleReturns;
        const cogs = parseFloat(row.cogs);
        const cm1 = netRevenue - cogs;
        const amazonCharges = chargesByPeriod[periodKey] || 0;
        const returnLoss = returnLossByPeriod[periodKey] || 0;
        const rentalCharges = RENTAL_CHARGES_PER_MONTH * (daysInPeriod(periodKey) / 30);
        const cm2 = cm1 - amazonCharges - rentalCharges - returnLoss;
        return {
          period: periodKey,
          grossRevenue,
          saleReturns,
          netRevenue,
          cogs,
          cm1,
          amazonCharges,
          rentalCharges,
          returnLoss,
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

  // Amazon Supply Chain & Returns Vulnerability Trend Endpoint -- daily/weekly/monthly series for the
  // Return %, Good/Bad Return Rate, Claim Rate, Claim (<24h) Rate, Reimbursement Rate, Return Loss Rate,
  // Stockout Cost, Ageing Inventory %, and Dead Stock % metrics that /api/amazon/operational-metrics
  // otherwise only reports as a single collapsed figure for the whole selected range.
  app.get("/api/amazon/supply-chain-trend", async (req, res) => {
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

      if (!startDate || !endDate) {
        res.status(400).json({ success: false, error: "startDate and endDate are required" });
        return;
      }

      // Period boundaries within [startDate, endDate], clipped to the requested range at both ends --
      // the same daily/weekly(Mon-Sun)/monthly bucketing convention as /api/amazon/trend.
      const periodKeyOf = (d: string): string => {
        if (granularity === "daily") return d;
        if (granularity === "weekly") return isoWeekStart(d);
        return d.slice(0, 7) + "-01";
      };
      const periods: { key: string; start: string; end: string }[] = [];
      {
        const seen = new Map<string, { start: string; end: string }>();
        let cursor = new Date(startDate + "T00:00:00Z");
        const end = new Date(endDate + "T00:00:00Z");
        while (cursor <= end) {
          const d = cursor.toISOString().slice(0, 10);
          const key = periodKeyOf(d);
          const existing = seen.get(key);
          if (existing) {
            if (d > existing.end) existing.end = d;
          } else {
            seen.set(key, { start: d, end: d });
          }
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        for (const [key, { start, end }] of seen) periods.push({ key, start, end });
        periods.sort((a, b) => (a.key < b.key ? -1 : 1));
      }

      // --- Return / Claim ratio metrics: fetch un-dated (as in /api/amazon/operational-metrics), resolve
      // COGS + reimbursement ONCE globally, then bucket by each row's accrual period instead of collapsing
      // to a single range-wide total. ---
      const [shipmentsResult, returnsResult, claimsResult] = await Promise.all([
        client.query(`
          SELECT TO_CHAR(NULLIF(order_date, '')::date, 'YYYY-MM-DD') AS d,
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS shipped_qty
          FROM "Amazon_GST_Master"
          WHERE transaction_type = 'Shipment' AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date
          GROUP BY d
        `, [startDate, endDate]),
        client.query(`
          SELECT r.orderid, r.sku, r.quantity, r.detaileddisposition, r.returndate, g.order_date AS shipment_order_date
          FROM "AmazonReturnsB2cRow" r
          LEFT JOIN "Amazon_GST_Master" g
            ON g.order_id = r.orderid AND g.sku = r.sku AND g.transaction_type = 'Shipment'
        `),
        client.query(`
          SELECT c.amazonorderid, c.sku, c.approvaldate, g.order_date AS shipment_order_date,
            CAST(NULLIF(REPLACE(c.amounttotal, ',', ''), '') AS numeric) AS amount,
            CAST(NULLIF(REPLACE(c.quantityreimbursedtotal, ',', ''), '') AS numeric) AS qty
          FROM "AmazonClaimsReimbursementsRow" c
          LEFT JOIN "Amazon_GST_Master" g
            ON g.order_id = c.amazonorderid AND g.sku = c.sku AND g.transaction_type = 'Shipment'
        `),
      ]);

      const shippedQtyByPeriod: Record<string, number> = {};
      for (const row of shipmentsResult.rows) {
        const key = periodKeyOf(row.d);
        shippedQtyByPeriod[key] = (shippedQtyByPeriod[key] || 0) + parseFloat(row.shipped_qty);
      }

      const accrualDateOf = (row: any, fallbackCol: string): string | null => {
        const d = (row.shipment_order_date || row[fallbackCol] || "").slice(0, 10);
        return d || null;
      };
      const inRequestedRange = (d: string | null): boolean => !!d && d >= startDate && d <= endDate;

      const returnRowsInRange = returnsResult.rows
        .map((r: any) => ({ row: r, accrualDate: accrualDateOf(r, "returndate") }))
        .filter((x: any) => inRequestedRange(x.accrualDate));
      const claimRowsInRange = claimsResult.rows
        .map((r: any) => ({ row: r, accrualDate: accrualDateOf(r, "approvaldate") }))
        .filter((x: any) => inRequestedRange(x.accrualDate));

      // Claim Rate / Claim(<24h) Rate need to know, per bad-returned unit, whether a claim was ever raised
      // for that (orderid, sku) pair, and whether it was raised within 24h -- both matched at the pair level.
      const claimedPairSet = new Set(claimRowsInRange.map(({ row }: any) => `${row.amazonorderid}|||${row.sku}`));
      const claim24hResult = await client.query(`
        SELECT DISTINCT r.orderid, r.sku, r.returndate, g.order_date AS shipment_order_date
        FROM "AmazonReturnsB2cRow" r
        LEFT JOIN "Amazon_GST_Master" g
          ON g.order_id = r.orderid AND g.sku = r.sku AND g.transaction_type = 'Shipment'
        JOIN "AmazonClaimsReimbursementsRow" c ON c.amazonorderid = r.orderid AND c.sku = r.sku
        WHERE r.detaileddisposition IS DISTINCT FROM 'SELLABLE'
          AND c.filedat IS NOT NULL
          AND EXTRACT(EPOCH FROM (c.filedat::timestamptz - r.returndate::timestamptz)) / 3600 BETWEEN 0 AND 24
      `);
      const pairsWithin24h = new Set(
        claim24hResult.rows
          .filter((r: any) => inRequestedRange((r.shipment_order_date || r.returndate || "").slice(0, 10)))
          .map((r: any) => `${r.orderid}|||${r.sku}`)
      );

      // Reimbursement Rate + Return Loss Rate need real per-(orderid,sku) COGS -- resolved ONCE globally
      // across every claimed/bad-returned pair in range, same primary/fallback chain as /api/amazon/financials
      // and /api/amazon/operational-metrics (GST Master unit COGS, falling back to EasyEcom cost history).
      const badReturnRowsInRange = returnRowsInRange.filter(({ row }: any) => row.detaileddisposition !== "SELLABLE");
      const allPairOrderIds = [
        ...badReturnRowsInRange.map(({ row }: any) => row.orderid),
        ...claimRowsInRange.map(({ row }: any) => row.amazonorderid),
      ];
      const allPairSkus = [
        ...badReturnRowsInRange.map(({ row }: any) => row.sku),
        ...claimRowsInRange.map(({ row }: any) => row.sku),
      ];

      // Two distinct, already-established COGS conventions in this codebase, both preserved here:
      // - Return Loss Rate (/api/amazon/financials) uses PER-UNIT cost (SUM(cost_inventory)/SUM(quantity))
      //   times the bad-returned quantity.
      // - Reimbursement Rate (/api/amazon/operational-metrics) uses the shipment's RAW TOTAL cost_inventory
      //   for the pair, un-divided, treating a claim as backed by the full shipment cost regardless of the
      //   claimed quantity. Using per-unit cost here instead would silently change the metric's meaning
      //   and produce numbers inconsistent with the headline operational-metrics figure.
      const gstUnitCogsByPair = new Map<string, number>();
      const gstTotalCogsByPair = new Map<string, number>();
      if (allPairOrderIds.length > 0) {
        const [perUnitCogsResult, totalCogsResult] = await Promise.all([
          client.query(`
            SELECT order_id, sku,
              CASE WHEN SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) > 0
                THEN SUM(cost_inventory) / SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric))
                ELSE NULL END AS unit_cogs
            FROM "Amazon_GST_Master"
            WHERE transaction_type = 'Shipment'
              AND (order_id, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
            GROUP BY order_id, sku
          `, [allPairOrderIds, allPairSkus]),
          client.query(`
            SELECT order_id, sku, COALESCE(SUM(cost_inventory), 0) AS total_cost
            FROM "Amazon_GST_Master"
            WHERE transaction_type = 'Shipment'
              AND (order_id, sku) IN (SELECT unnest($1::text[]), unnest($2::text[]))
            GROUP BY order_id, sku
          `, [allPairOrderIds, allPairSkus]),
        ]);
        for (const row of perUnitCogsResult.rows) {
          if (row.unit_cogs === null) continue;
          const v = parseFloat(row.unit_cogs);
          if (!isNaN(v)) gstUnitCogsByPair.set(`${row.order_id}|||${row.sku}`, v);
        }
        for (const row of totalCogsResult.rows) {
          const v = parseFloat(row.total_cost);
          if (!isNaN(v)) gstTotalCogsByPair.set(`${row.order_id}|||${row.sku}`, v);
        }
      }
      // Reimbursed amount / claimed qty per pair summed from claimRowsInRange itself (already accrual-
      // filtered), NOT a fresh unscoped SQL aggregate -- a pair with claim rows both inside and outside
      // the requested range must only count the in-range rows here, same as /api/amazon/operational-metrics.
      const reimbursedByPair = new Map<string, number>();
      const claimedQtyByPair = new Map<string, number>();
      for (const { row } of claimRowsInRange) {
        const key = `${row.amazonorderid}|||${row.sku}`;
        reimbursedByPair.set(key, (reimbursedByPair.get(key) || 0) + (parseFloat(row.amount) || 0));
        claimedQtyByPair.set(key, (claimedQtyByPair.get(key) || 0) + (parseFloat(row.qty) || 0));
      }
      const easyEcomCostHistory = await loadEasyEcomCostHistory(
        client,
        Array.from(new Set(allPairSkus))
      );
      const unitCogsFor = (orderId: string, sku: string, fallbackDate: string): number | undefined => {
        const pairKey = `${orderId}|||${sku}`;
        let unitCogs = gstUnitCogsByPair.get(pairKey);
        if (unitCogs === undefined) {
          const history = easyEcomCostHistory.get(String(sku).trim());
          unitCogs = history ? costAsOf(history, fallbackDate.slice(0, 10)) : undefined;
        }
        return unitCogs;
      };
      // Total shipment COGS for a pair, falling back to EasyEcom unit cost x claimed qty (matching
      // /api/amazon/operational-metrics' Reimbursement Rate fallback exactly) when no GST Master row exists.
      const totalCogsFor = (orderId: string, sku: string, claimedQty: number, fallbackDate: string): number | undefined => {
        const pairKey = `${orderId}|||${sku}`;
        const total = gstTotalCogsByPair.get(pairKey);
        if (total !== undefined) return total;
        const history = easyEcomCostHistory.get(String(sku).trim());
        const unitCost = history ? costAsOf(history, fallbackDate.slice(0, 10)) : undefined;
        return unitCost !== undefined ? unitCost * claimedQty : undefined;
      };

      // --- Bucket everything by period and compute each period's ratios ---
      const data = periods.map(({ key, start, end }) => {
        const inThisPeriod = (accrualDate: string | null) => !!accrualDate && accrualDate >= start && accrualDate <= end;

        const periodReturns = returnRowsInRange.filter((x: any) => inThisPeriod(x.accrualDate));
        const qtyOf = (r: any) => parseFloat(String(r.quantity).replace(/,/g, "")) || 0;
        const returnedQty = periodReturns.reduce((sum: number, x: any) => sum + qtyOf(x.row), 0);
        const goodReturnQty = periodReturns.filter((x: any) => x.row.detaileddisposition === "SELLABLE").reduce((sum: number, x: any) => sum + qtyOf(x.row), 0);
        const badReturnRows = periodReturns.filter((x: any) => x.row.detaileddisposition !== "SELLABLE");
        const badReturnQty = badReturnRows.reduce((sum: number, x: any) => sum + qtyOf(x.row), 0);

        const shippedQty = shippedQtyByPeriod[key] || 0;
        const returnPct = shippedQty > 0 ? (returnedQty / shippedQty) * 100 : 0;
        const goodReturnPct = shippedQty > 0 ? (goodReturnQty / shippedQty) * 100 : 0;
        const badReturnPct = shippedQty > 0 ? (badReturnQty / shippedQty) * 100 : 0;

        const claimedBadReturnQty = badReturnRows
          .filter((x: any) => claimedPairSet.has(`${x.row.orderid}|||${x.row.sku}`))
          .reduce((sum: number, x: any) => sum + qtyOf(x.row), 0);
        const claimRatePct = badReturnQty > 0 ? (claimedBadReturnQty / badReturnQty) * 100 : 0;

        const claimsWithin24hUnits = badReturnRows
          .filter((x: any) => pairsWithin24h.has(`${x.row.orderid}|||${x.row.sku}`))
          .reduce((sum: number, x: any) => sum + qtyOf(x.row), 0);
        const claim24hPct = badReturnQty > 0 ? (claimsWithin24hUnits / badReturnQty) * 100 : 0;

        // Reimbursement Rate: reimbursed amount / COGS of claimed units, restricted to resolvable-cost
        // claims. Reimbursed amount and claimed qty are summed from THIS period's own claim rows only
        // (a pair with claim rows spread across multiple periods must not have another period's amount
        // bleed into this one).
        const periodClaims = claimRowsInRange.filter((x: any) => inThisPeriod(x.accrualDate));
        const periodReimbursedByPair = new Map<string, number>();
        const periodClaimedQtyByPair = new Map<string, number>();
        const periodLatestApprovaldateByPair = new Map<string, string>();
        for (const { row } of periodClaims) {
          const pairKey = `${row.amazonorderid}|||${row.sku}`;
          periodReimbursedByPair.set(pairKey, (periodReimbursedByPair.get(pairKey) || 0) + (parseFloat(row.amount) || 0));
          periodClaimedQtyByPair.set(pairKey, (periodClaimedQtyByPair.get(pairKey) || 0) + (parseFloat(row.qty) || 0));
          const approvaldate = row.approvaldate || "";
          if (approvaldate > (periodLatestApprovaldateByPair.get(pairKey) || "")) periodLatestApprovaldateByPair.set(pairKey, approvaldate);
        }
        // Reimbursement Rate uses the pair's RAW TOTAL shipment COGS (totalCogsFor), not per-unit cost --
        // matching /api/amazon/operational-metrics' existing convention exactly (see comment above totalCogsFor).
        let totalReimbursed = 0;
        let cogsOfClaimedUnits = 0;
        for (const pairKey of periodClaimedQtyByPair.keys()) {
          const [orderId, claimSku] = pairKey.split("|||");
          const claimedQty = periodClaimedQtyByPair.get(pairKey) || 0;
          const rowCogs = totalCogsFor(orderId, claimSku, claimedQty, periodLatestApprovaldateByPair.get(pairKey) || "");
          if (rowCogs !== undefined) {
            totalReimbursed += periodReimbursedByPair.get(pairKey) || 0;
            cogsOfClaimedUnits += rowCogs;
          }
        }
        const reimbursementPct = cogsOfClaimedUnits > 0 ? (totalReimbursed / cogsOfClaimedUnits) * 100 : 0;

        // Return Loss Rate: (COGS of bad-disposition units - reimbursed for those units) / COGS of those
        // units, reimbursement again drawn only from this period's own claim rows (periodReimbursedByPair).
        let totalBadUnitsCogs = 0;
        let totalReimbursedForBadUnits = 0;
        const badQtyByPair = new Map<string, number>();
        for (const { row } of badReturnRows) {
          const pairKey = `${row.orderid}|||${row.sku}`;
          badQtyByPair.set(pairKey, (badQtyByPair.get(pairKey) || 0) + qtyOf(row));
        }
        for (const [pairKey, badQty] of badQtyByPair) {
          const [orderId, returnSku] = pairKey.split("|||");
          const matchingRow = badReturnRows.find((x: any) => `${x.row.orderid}|||${x.row.sku}` === pairKey)?.row;
          const unitCogs = unitCogsFor(orderId, returnSku, matchingRow?.returndate || "");
          if (unitCogs !== undefined) {
            totalBadUnitsCogs += badQty * unitCogs;
            totalReimbursedForBadUnits += periodReimbursedByPair.get(pairKey) || 0;
          }
        }
        const returnLossPct = totalBadUnitsCogs > 0 ? ((totalBadUnitsCogs - totalReimbursedForBadUnits) / totalBadUnitsCogs) * 100 : 0;

        return {
          period: key,
          returnPct: Math.round(returnPct * 100) / 100,
          goodReturnPct: Math.round(goodReturnPct * 100) / 100,
          badReturnPct: Math.round(badReturnPct * 100) / 100,
          claimRatePct: Math.round(claimRatePct * 100) / 100,
          claim24hPct: Math.round(claim24hPct * 100) / 100,
          reimbursementPct: Math.round(reimbursementPct * 100) / 100,
          returnLossPct: Math.round(returnLossPct * 100) / 100,
        };
      });

      // --- Ageing Inventory %, Dead Stock %, Stockout Cost: snapshot metrics, recomputed as of each
      // period's end date using the same 182-day trailing lookback + week-over-week/day-over-day state
      // machine as /api/amazon/operational-metrics, just evaluated at multiple points along the timeline
      // instead of once at the overall range's end. ---
      const earliestPeriodEnd = periods[0]?.end || endDate;
      const widestLookbackStart = new Date(new Date(earliestPeriodEnd).getTime() - 182 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

      const [dailyUnitsResult, dailyStockResult] = await Promise.all([
        client.query(`
          SELECT sku, TO_CHAR(NULLIF(order_date, '')::date, 'YYYY-MM-DD') AS d,
            COALESCE(SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)), 0) AS units,
            COALESCE(SUM(${revenueCol}), 0) AS revenue
          FROM "Amazon_GST_Master"
          WHERE transaction_type = 'Shipment'
            AND order_date IS NOT NULL AND order_date != ''
            AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date
          GROUP BY sku, NULLIF(order_date, '')::date
        `, [widestLookbackStart, endDate]),
        client.query(`
          SELECT sku, TO_CHAR(date::date, 'YYYY-MM-DD') AS d, quantity
          FROM "EasyEcomInventory"
          WHERE date IS NOT NULL AND date != ''
            AND date::date >= $1::date AND date::date <= $2::date
        `, [widestLookbackStart, endDate]),
      ]);

      type DayNum = { units: number; revenue: number };
      const unitsBySkuDate = new Map<string, Map<string, DayNum>>();
      for (const row of dailyUnitsResult.rows) {
        if (!unitsBySkuDate.has(row.sku)) unitsBySkuDate.set(row.sku, new Map());
        unitsBySkuDate.get(row.sku)!.set(row.d, { units: parseFloat(row.units), revenue: parseFloat(row.revenue) });
      }
      const stockBySkuDate = new Map<string, Map<string, number>>();
      for (const row of dailyStockResult.rows) {
        if (!stockBySkuDate.has(row.sku)) stockBySkuDate.set(row.sku, new Map());
        stockBySkuDate.get(row.sku)!.set(row.d, row.quantity == null ? 0 : parseFloat(row.quantity));
      }
      const allSkus = new Set<string>([...unitsBySkuDate.keys(), ...stockBySkuDate.keys()]);

      const listingsCountResult = await client.query(`
        SELECT COUNT(DISTINCT CASE WHEN LOWER(status) = 'active' THEN sellersku END) AS active_listings
        FROM "AmazonMtrRow"
      `);
      const activeListings = parseInt(listingsCountResult.rows[0].active_listings);

      // Computes ageing-flag / dead-stock-flag counts and OOS-days as of a given reference (period-end) date,
      // reusing the exact state-machine logic from /api/amazon/operational-metrics.
      const snapshotAt = (periodStart: string, periodEnd: string) => {
        const lookbackStart = new Date(new Date(periodEnd).getTime() - 182 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        let ageingFlaggedCount = 0;
        let deadStockCriticalCount = 0;
        let outOfStockDaysWeighted = 0;
        let platformRevenueInPeriod = 0;

        for (const sku of allSkus) {
          const stockMap = stockBySkuDate.get(sku) || new Map<string, number>();
          const unitsMap = unitsBySkuDate.get(sku) || new Map<string, DayNum>();
          const dates = [...stockMap.keys()].filter((d) => d <= periodEnd).sort();

          const weekBuckets = new Map<string, { sum: number; count: number }>();
          for (const d of dates) {
            if (d < lookbackStart) continue;
            const qty = stockMap.get(d)!;
            if (qty <= 0) continue;
            const unitsSold = unitsMap.get(d)?.units ?? 0;
            const wk = isoWeekStart(d);
            const bucket = weekBuckets.get(wk) || { sum: 0, count: 0 };
            bucket.sum += unitsSold;
            bucket.count += 1;
            weekBuckets.set(wk, bucket);
          }
          const weeks = [...weekBuckets.entries()].map(([wk, b]) => ({ wk, rate: b.sum / b.count })).sort((a, b) => (a.wk < b.wk ? -1 : 1));

          let flagged = false;
          let triggerRate = 0;
          for (let i = 1; i < weeks.length; i++) {
            const prevRate = weeks[i - 1].rate;
            const currRate = weeks[i].rate;
            if (!flagged) {
              if (prevRate > 0 && (prevRate - currRate) / prevRate >= 0.30) {
                flagged = true;
                triggerRate = prevRate;
              }
            } else if (currRate >= triggerRate) {
              flagged = false;
            }
          }
          if (flagged) ageingFlaggedCount++;

          const stockedDatesInPeriod = dates.filter((d) => d >= periodStart && d <= periodEnd && stockMap.get(d)! > 0);
          if (stockedDatesInPeriod.length >= 2) {
            const last = stockedDatesInPeriod[stockedDatesInPeriod.length - 1];
            const prev = stockedDatesInPeriod[stockedDatesInPeriod.length - 2];
            const lastRate = unitsMap.get(last)?.units ?? 0;
            const prevRate = unitsMap.get(prev)?.units ?? 0;
            if (prevRate > 0 && (prevRate - lastRate) / prevRate >= 0.50) deadStockCriticalCount++;
          }

          // OOS day-count depends on stock snapshots (dates), but revenue-in-period is summed from ALL
          // units/revenue records independently (unitsMap.entries()) -- a day can have a sale with no
          // stock snapshot logged, and that day's revenue must still count, same as
          // /api/amazon/operational-metrics.
          let oosDaysInPeriod = 0;
          for (const d of dates) {
            if (d < periodStart || d > periodEnd) continue;
            if (stockMap.get(d)! <= 0) oosDaysInPeriod++;
          }
          let skuRevenueInPeriod = 0;
          for (const [d, dn] of unitsMap.entries()) {
            if (d < periodStart || d > periodEnd) continue;
            skuRevenueInPeriod += dn.revenue;
          }
          platformRevenueInPeriod += skuRevenueInPeriod;
          if (oosDaysInPeriod > 0) outOfStockDaysWeighted += oosDaysInPeriod * skuRevenueInPeriod;
        }

        const outOfStockDays = platformRevenueInPeriod > 0 ? outOfStockDaysWeighted / platformRevenueInPeriod : 0;
        const periodDayCount = Math.max(1, Math.round(
          (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)
        ) + 1);
        const avgDailyRevenue = platformRevenueInPeriod / periodDayCount;
        const stockoutCost = outOfStockDays * avgDailyRevenue;
        const ageingInventoryPct = activeListings > 0 ? (ageingFlaggedCount / activeListings) * 100 : 0;
        const deadStockPct = activeListings > 0 ? (deadStockCriticalCount / activeListings) * 100 : 0;

        return {
          outOfStockDays: Math.round(outOfStockDays * 100) / 100,
          stockoutCost: Math.round(stockoutCost * 100) / 100,
          ageingInventoryPct: Math.round(ageingInventoryPct * 100) / 100,
          deadStockPct: Math.round(deadStockPct * 100) / 100,
        };
      };

      const dataWithSnapshots = data.map((row, i) => ({
        ...row,
        ...snapshotAt(periods[i].start, periods[i].end),
      }));

      res.json({ success: true, data: dataWithSnapshots, granularity, gstMode });
    } catch (err: any) {
      console.error("Amazon supply chain trend query failed:", err);
      res.status(500).json({ success: false, error: err?.message || String(err) });
    } finally {
      if (client) client.release();
    }
  });

  // Amazon Compare Sales Endpoint -- single-day metrics for a reference date vs the day before,
  // same day last week, and same day last year (mirrors Amazon Seller Central's own "Compare Sales" panel).
  // "Reference date" is whatever date the dashboard's selected range ends on -- this app has no live "today"
  // concept since the underlying data isn't a real-time feed.
  app.get("/api/amazon/compare-sales", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const refDateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const gstMode = (req.query.gstMode as string) === "inclusive" ? "inclusive" : "exclusive";
      const revenueCol = gstMode === "inclusive" ? "invoice_amount" : "tax_exclusive_gross";

      const refDate = new Date(refDateStr + "T00:00:00Z");
      const addDays = (d: Date, n: number) => {
        const copy = new Date(d);
        copy.setUTCDate(copy.getUTCDate() + n);
        return copy.toISOString().slice(0, 10);
      };

      const periods = [
        { key: "reference", label: "Selected Day", date: refDateStr },
        { key: "previousDay", label: "Previous Day", date: addDays(refDate, -1) },
        { key: "sameDayLastWeek", label: "Same Day Last Week", date: addDays(refDate, -7) },
        { key: "sameDayLastYear", label: "Same Day Last Year", date: addDays(refDate, -365) },
      ];
      const dates = periods.map((p) => p.date);

      const result = await client.query(`
        SELECT TO_CHAR(NULLIF(order_date, '')::date, 'YYYY-MM-DD') AS d,
          COUNT(DISTINCT CASE WHEN transaction_type = 'Shipment' THEN order_id END) AS total_orders,
          COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS units_sold,
          COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS revenue
        FROM "Amazon_GST_Master"
        WHERE order_date IS NOT NULL AND order_date != '' AND NULLIF(order_date, '')::date = ANY($1::date[])
        GROUP BY NULLIF(order_date, '')::date
      `, [dates]);

      const byDate: Record<string, { totalOrders: number; unitsSold: number; revenue: number }> = {};
      for (const row of result.rows) {
        const d = row.d;
        byDate[d] = {
          totalOrders: parseInt(row.total_orders),
          unitsSold: parseFloat(row.units_sold),
          revenue: parseFloat(row.revenue),
        };
      }

      const data = periods.map((p) => {
        const stats = byDate[p.date] || { totalOrders: 0, unitsSold: 0, revenue: 0 };
        return {
          key: p.key,
          label: p.label,
          date: p.date,
          totalOrders: stats.totalOrders,
          unitsSold: stats.unitsSold,
          revenue: Math.round(stats.revenue * 100) / 100,
          avgUnitsPerOrder: stats.totalOrders > 0 ? Math.round((stats.unitsSold / stats.totalOrders) * 100) / 100 : 0,
          avgSalesPerOrder: stats.totalOrders > 0 ? Math.round((stats.revenue / stats.totalOrders) * 100) / 100 : 0,
          hasData: !!byDate[p.date],
        };
      });

      res.json({ success: true, data, gstMode });
    } catch (err: any) {
      console.error("Amazon compare-sales query failed:", err);
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
        ? `TO_CHAR(NULLIF(order_date, '')::date, 'YYYY-MM-DD')`
        : granularity === "weekly"
        ? `TO_CHAR(date_trunc('week', NULLIF(order_date, '')::date), 'YYYY-MM-DD')`
        : `TO_CHAR(date_trunc('month', NULLIF(order_date, '')::date), 'YYYY-MM-DD')`;

      let gstDateFilter = "";
      const params: string[] = [sku];
      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND NULLIF(order_date, '')::date >= $2::date AND NULLIF(order_date, '')::date <= $3::date`;
      }

      // Marketplace fees and returns bucketed to the same granularity, each on their own date column
      // (see /api/amazon/sku-profitability for why these two tables are the source for these figures).
      const utPeriodExpr = granularity === "daily"
        ? `TO_CHAR(TO_DATE(datetime, 'DD Mon YYYY'), 'YYYY-MM-DD')`
        : granularity === "weekly"
        ? `TO_CHAR(date_trunc('week', TO_DATE(datetime, 'DD Mon YYYY')), 'YYYY-MM-DD')`
        : `TO_CHAR(date_trunc('month', TO_DATE(datetime, 'DD Mon YYYY')), 'YYYY-MM-DD')`;
      let utDateFilter = "";
      const utParams: string[] = [sku];
      if (startDate && endDate) {
        utParams.push(startDate, endDate);
        utDateFilter = `AND TO_DATE(datetime, 'DD Mon YYYY') >= $2::date AND TO_DATE(datetime, 'DD Mon YYYY') <= $3::date`;
      }

      const [result, feesResult, returnsResult] = await Promise.all([
        client.query(`
          SELECT
            ${periodExpr} AS period,
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN ${revenueCol} ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(cost_inventory), 0) AS cogs,
            COALESCE(SUM(CASE WHEN transaction_type = 'Shipment' THEN CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric) ELSE 0 END), 0) AS units_sold
          FROM "Amazon_GST_Master"
          WHERE sku = $1 ${gstDateFilter}
          GROUP BY period
          ORDER BY period ASC
        `, params),
        client.query(`
          SELECT ${utPeriodExpr} AS period,
            COALESCE(ABS(SUM(CAST(NULLIF(REPLACE(fba_fees, ',', ''), '') AS numeric))), 0)
              + COALESCE(ABS(SUM(CAST(NULLIF(REPLACE(selling_fees, ',', ''), '') AS numeric))), 0)
              + COALESCE(ABS(SUM(CAST(NULLIF(REPLACE(other_transaction_fees, ',', ''), '') AS numeric))), 0) AS marketplace_fees
          FROM "Amazon_Unified_Transactions"
          WHERE sku = $1 ${utDateFilter}
          GROUP BY period
        `, utParams),
        // Accrual basis: pulled un-dated (per this SKU) and joined to the shipment's order_date, then
        // bucketed in JS below by accrual date (shipment date, falling back to the return's own returndate
        // when unmatched) using the same periodOf() logic as the revenue query above, so a unit sold at
        // period-end and returned early next period counts against the period it was SOLD in. Carries
        // orderid/detaileddisposition so Return Loss below can resolve real per-(orderid,sku) COGS and
        // matched claim reimbursement -- same formula as /api/amazon/financials and /api/amazon/sku-profitability,
        // not a revenue-based approximation.
        client.query(`
          SELECT r.orderid, r.quantity, r.returndate, r.detaileddisposition, g.order_date AS shipment_order_date
          FROM "AmazonReturnsB2cRow" r
          LEFT JOIN "Amazon_GST_Master" g
            ON g.order_id = r.orderid AND g.sku = r.sku AND g.transaction_type = 'Shipment'
          WHERE r.sku = $1
        `, [sku]),
      ]);

      const feesByPeriod: Record<string, number> = {};
      for (const row of feesResult.rows) feesByPeriod[row.period] = parseFloat(row.marketplace_fees);

      const periodOf = (dateStr: string): string => {
        if (granularity === "daily") return dateStr;
        if (granularity === "weekly") return isoWeekStart(dateStr);
        const [y, m] = dateStr.split("-");
        return `${y}-${m}-01`;
      };

      const badReturnRows = returnsResult.rows.filter((row: any) => {
        if (row.detaileddisposition === "SELLABLE") return false;
        const accrualDate = (row.shipment_order_date || row.returndate || "").slice(0, 10);
        if (!accrualDate) return false;
        if (startDate && endDate && (accrualDate < startDate || accrualDate > endDate)) return false;
        return true;
      });

      const returnLossByPeriod: Record<string, number> = {};
      if (badReturnRows.length > 0) {
        const orderIds = badReturnRows.map((r: any) => r.orderid);

        const [perUnitCogsResult, claimsResult] = await Promise.all([
          client.query(`
            SELECT order_id,
              CASE WHEN SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)) > 0
                THEN SUM(cost_inventory) / SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric))
                ELSE NULL END AS unit_cogs
            FROM "Amazon_GST_Master"
            WHERE transaction_type = 'Shipment' AND sku = $1
              AND order_id = ANY($2::text[])
            GROUP BY order_id
          `, [sku, orderIds]),
          client.query(`
            SELECT amazonorderid, SUM(CAST(NULLIF(REPLACE(amounttotal, ',', ''), '') AS numeric)) AS reimbursed
            FROM "AmazonClaimsReimbursementsRow"
            WHERE sku = $1 AND amazonorderid = ANY($2::text[])
            GROUP BY amazonorderid
          `, [sku, orderIds]),
        ]);

        const gstUnitCogsByOrder = new Map<string, number>();
        for (const row of perUnitCogsResult.rows) {
          if (row.unit_cogs === null) continue;
          const unitCogs = parseFloat(row.unit_cogs);
          if (!isNaN(unitCogs)) gstUnitCogsByOrder.set(row.order_id, unitCogs);
        }
        const reimbursedByOrder = new Map<string, number>();
        for (const row of claimsResult.rows) {
          reimbursedByOrder.set(row.amazonorderid, parseFloat(row.reimbursed));
        }

        const easyEcomCostHistory = await loadEasyEcomCostHistory(client, [sku]);

        for (const row of badReturnRows) {
          const badQty = parseFloat(String(row.quantity).replace(/,/g, "")) || 0;

          let unitCogs = gstUnitCogsByOrder.get(row.orderid);
          if (unitCogs === undefined) {
            const history = easyEcomCostHistory.get(sku.trim());
            unitCogs = history ? costAsOf(history, (row.returndate || "").slice(0, 10)) : undefined;
          }

          if (unitCogs !== undefined) {
            const accrualDate = (row.shipment_order_date || row.returndate || "").slice(0, 10);
            const period = periodOf(accrualDate);
            const reimbursed = reimbursedByOrder.get(row.orderid) || 0;
            returnLossByPeriod[period] = (returnLossByPeriod[period] || 0) + (badQty * unitCogs - reimbursed);
          }
        }
        for (const period of Object.keys(returnLossByPeriod)) {
          returnLossByPeriod[period] = Math.max(0, returnLossByPeriod[period]);
        }
      }

      const data = result.rows.map((row: any) => {
        const period = row.period;
        const revenue = parseFloat(row.revenue);
        const cogs = parseFloat(row.cogs);
        const unitsSold = parseFloat(row.units_sold);
        const marketplaceFees = feesByPeriod[period] || 0;
        const returnLoss = returnLossByPeriod[period] || 0;
        const netProfit = revenue - cogs - marketplaceFees - returnLoss;
        return {
          period,
          revenue,
          cogs,
          unitsSold,
          marketplaceFees: Math.round(marketplaceFees * 100) / 100,
          returnLoss: Math.round(returnLoss * 100) / 100,
          cm1: Math.round((revenue - cogs) * 100) / 100,
          netProfit: Math.round(netProfit * 100) / 100,
        };
      });

      res.json({ success: true, data, granularity, gstMode, sku });
    } catch (err: any) {
      console.error("Amazon SKU trend query failed:", err);
      res.status(500).json({ success: false, error: err?.message || String(err) });
    } finally {
      if (client) client.release();
    }
  });

  // Amazon SKU Sparklines Endpoint -- weekly units-sold series for ALL SKUs in one query, so the SKU table
  // can render an inline trend glance per row without an N+1 fetch-per-SKU (the per-SKU sku-trend endpoint
  // above is for the full detail chart when a row is clicked).
  app.get("/api/amazon/sku-sparklines", async (req, res) => {
    let client;
    try {
      const pool = getDbPool();
      client = await pool.connect();

      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;

      let gstDateFilter = "";
      const params: string[] = [];
      if (startDate && endDate) {
        params.push(startDate, endDate);
        gstDateFilter = `AND NULLIF(order_date, '')::date >= $1::date AND NULLIF(order_date, '')::date <= $2::date`;
      }

      const result = await client.query(`
        SELECT sku,
          TO_CHAR(date_trunc('week', NULLIF(order_date, '')::date), 'YYYY-MM-DD') AS period,
          COALESCE(SUM(CAST(NULLIF(REPLACE(quantity, ',', ''), '') AS numeric)), 0) AS units_sold
        FROM "Amazon_GST_Master"
        WHERE transaction_type = 'Shipment' AND order_date IS NOT NULL AND order_date != '' ${gstDateFilter}
        GROUP BY sku, period
        ORDER BY sku, period ASC
      `, params);

      const bySku: Record<string, { period: string; unitsSold: number }[]> = {};
      for (const row of result.rows) {
        if (!bySku[row.sku]) bySku[row.sku] = [];
        bySku[row.sku].push({ period: row.period, unitsSold: parseFloat(row.units_sold) });
      }

      res.json({ success: true, data: bySku });
    } catch (err: any) {
      console.error("Amazon SKU sparklines query failed:", err);
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
