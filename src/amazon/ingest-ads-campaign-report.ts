import { config as loadEnv } from "dotenv";
import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { prisma } from "../prisma/client.js";

loadEnv();

// One-off ingestion for Amazon Ads' account-level "Spend/Sales" export (columns: Accounts, Account ID,
// Country Name, Currency Code, Type, Spend, Impressions, Clicks, CTR, CPC, Sales, ACOS, ROAS). This
// report has no date column of its own -- the figures cover whatever date range was selected on the
// Amazon Ads console when exporting, so the period must be supplied explicitly via --period, e.g.
// "May 2026". AmazonAdsCampaignRow is unique on (account_id, dateRange), so re-running this for the
// same period safely upserts rather than creating duplicates or clobbering other periods.

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const filePath = getArgValue("--file");
  const period = getArgValue("--period");

  if (!filePath || !period) {
    console.error('Usage: tsx src/amazon/ingest-ads-campaign-report.ts --file <path.csv> --period "May 2026"');
    process.exitCode = 1;
    return;
  }

  console.log(`Reading ${filePath} for period "${period}"...`);
  const text = readFileSync(filePath, "utf8");
  const rows: string[][] = parse(text, { columns: false, skip_empty_lines: true, relax_column_count: true, bom: true });

  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  const col = {
    accounts: idx("Accounts"),
    accountId: idx("Account ID"),
    countryName: idx("Country Name"),
    currencyCode: idx("Currency Code"),
    type: idx("Type"),
    spend: idx("Spend"),
    impressions: idx("Impressions"),
    clicks: idx("Clicks"),
    ctr: idx("CTR"),
    cpc: idx("CPC"),
    sales: idx("Sales"),
    acos: idx("ACOS"),
    roas: idx("ROAS"),
  };

  const reportKey = `ads_campaign_${Date.now()}`;
  const records = rows.slice(1).map((r) => ({
    reportKey,
    accounts: r[col.accounts] || null,
    account_id: r[col.accountId] || "",
    dateRange: period,
    country_name: r[col.countryName] || null,
    currency_code: r[col.currencyCode] || null,
    type: r[col.type] || null,
    spend: r[col.spend] || null,
    impressions: r[col.impressions] || null,
    clicks: r[col.clicks] || null,
    ctr: r[col.ctr] || null,
    cpc: r[col.cpc] || null,
    sales: r[col.sales] || null,
    acos: r[col.acos] || null,
    roas: r[col.roas] || null,
  })).filter((r) => r.account_id);

  console.log(`Parsed ${records.length} rows. Upserting...`);

  let upserted = 0;
  for (const r of records) {
    await prisma.amazonAdsCampaignRow.upsert({
      where: { account_id_dateRange: { account_id: r.account_id, dateRange: r.dateRange } },
      update: r,
      create: r,
    });
    upserted++;
  }

  console.log(`Finished. Upserted ${upserted} rows for period "${period}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
