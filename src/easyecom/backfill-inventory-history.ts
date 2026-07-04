import { config as loadEnv } from "dotenv";
import { parse } from "csv-parse/sync";
import { prisma } from "../prisma/client.js";

loadEnv();

// One-off historical backfill for EasyEcomInventory using EasyEcom's getInventorySnapshotApi, which returns
// a pre-generated end-of-day inventory CSV per calendar day (unlike fetch-inventory.ts's getInventoryDetailsV3,
// which only ever returns the current live snapshot -- there is no other way to get past days).

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function getEasyEcomToken(email: string, password: string, locationKey: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.easyecom.io/access/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ email, password, location_key: locationKey }),
  });
  if (!res.ok) throw new Error(`Authentication failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as any;
  const token = json?.data?.token?.jwt_token;
  if (!token) throw new Error(`Token missing in response: ${JSON.stringify(json)}`);
  return token;
}

interface SnapshotEntry {
  entry_date: string;
  file_url: string;
}

async function listSnapshots(token: string, apiKey: string, startDate: string, endDate: string): Promise<SnapshotEntry[]> {
  const url = `https://api.easyecom.io/inventory/getInventorySnapshotApi?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "x-api-key": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Snapshot list fetch failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as any;
  return Array.isArray(json?.data) ? json.data : [];
}

interface DailyRecord {
  date: string;
  sku: string;
  name: string | null;
  modelNo: string | null;
  brand: string | null;
  quantity: number;
  inventoryStatus: string | null;
}

// Column indices confirmed against a real sample file (see scratch/probe_inventory_snapshot.ts investigation):
// 0 Report Generated Date, 3 Product Name, 5 SKU (leading backtick artifact), 7 Model No, 8 Category (actually
// a status like "Active_SKUs"/"Discontinued"), 9 Brand, 22 Available Quantity. A SKU can appear on multiple
// rows in one file (per-bin/batch breakdown), so quantities must be summed per SKU per day.
function parseSnapshotCsv(csvText: string, dateStr: string): DailyRecord[] {
  const rows: string[][] = parse(csvText, { columns: false, skip_empty_lines: true, relax_column_count: true });
  const bySku = new Map<string, DailyRecord>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 23) continue;
    const sku = (r[5] || "").replace(/^`/, "").trim();
    if (!sku) continue;
    const qty = parseInt(r[22], 10) || 0;
    const existing = bySku.get(sku);
    if (existing) {
      existing.quantity += qty;
    } else {
      bySku.set(sku, {
        date: dateStr,
        sku,
        name: r[3] || null,
        modelNo: (r[7] || "").replace(/^`/, "").trim() || null,
        brand: r[9] || null,
        quantity: qty,
        inventoryStatus: r[8] || null,
      });
    }
  }
  return [...bySku.values()];
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function saveBatch(records: DailyRecord[]) {
  const chunks = chunkArray(records, 500);
  for (const chunk of chunks) {
    await prisma.$transaction(
      chunk.map((record) =>
        prisma.easyEcomInventory.upsert({
          where: { date_sku: { date: record.date, sku: record.sku } },
          update: record,
          create: record,
        })
      )
    );
  }
}

async function main() {
  const startDate = getArgValue("--start") || "2026-01-01 00:00:00";
  const endDate = getArgValue("--end") || `${new Date().toISOString().slice(0, 10)} 23:59:59`;

  const email = process.env.EASY_ECOM_EMAIL;
  const password = process.env.EASY_ECOM_PASSWORD;
  const apiKey = process.env.EASY_ECOM_API_KEY;
  const locationKey = process.env.EASY_ECOM_LOCATION_KEY;
  if (!email || !password || !apiKey || !locationKey) {
    throw new Error("Missing EASY_ECOM credentials in .env");
  }

  console.log("Authenticating...");
  const token = await getEasyEcomToken(email, password, locationKey, apiKey);
  console.log("Authentication successful.");

  console.log(`Listing snapshots from ${startDate} to ${endDate}...`);
  const entries = await listSnapshots(token, apiKey, startDate, endDate);
  console.log(`Found ${entries.length} snapshot entries.`);

  // Multiple entries can exist for the same calendar day (re-runs) -- keep only the latest per day.
  const latestByDay = new Map<string, SnapshotEntry>();
  for (const e of entries) {
    const day = e.entry_date.slice(0, 10);
    const existing = latestByDay.get(day);
    if (!existing || e.entry_date > existing.entry_date) latestByDay.set(day, e);
  }
  const days = [...latestByDay.keys()].sort();
  console.log(`${days.length} unique calendar days to backfill.`);

  let processed = 0;
  for (const day of days) {
    const entry = latestByDay.get(day)!;
    try {
      const res = await fetch(entry.file_url);
      if (!res.ok) {
        console.error(`  [${day}] file download failed: ${res.status}`);
        continue;
      }
      const csvText = await res.text();
      const records = parseSnapshotCsv(csvText, day);
      await saveBatch(records);
      processed++;
      console.log(`  [${day}] saved ${records.length} SKU rows (${processed}/${days.length})`);
    } catch (err) {
      console.error(`  [${day}] failed:`, err);
    }
    // Be polite to the S3 bucket / API
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`Finished. Backfilled ${processed}/${days.length} days.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
