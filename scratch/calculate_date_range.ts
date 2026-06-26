import { supabasePrisma } from "../src/prisma/client.js";

function parseDateString(dStr: string): Date | null {
  if (!dStr) return null;
  const clean = dStr.trim();
  
  // Try parsing ISO format
  if (clean.includes("T") || clean.includes("-")) {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) return d;
  }
  
  // Try DD.MM.YYYY
  const parts = clean.split(".");
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  
  // Try fallback Date parsing
  const d = new Date(clean);
  if (!isNaN(d.getTime())) return d;
  
  return null;
}

async function getTableDateStats(tableName: string, delegateName: string) {
  console.log(`\n=== Analyzing Date Stats for ${tableName} ===`);
  const delegate = (supabasePrisma as any)[delegateName];
  
  // Fetch all unique posteddate values
  const rows = await delegate.findMany({
    select: { posteddate: true },
    distinct: ["posteddate"]
  });
  
  const parsedDates = rows
    .map((r: any) => r.posteddate)
    .filter((d: any) => d && d.trim().length > 0)
    .map((d: any) => parseDateString(d))
    .filter((d: any): d is Date => d !== null);
    
  if (parsedDates.length === 0) {
    console.log("No valid dates found in table.");
    return;
  }
  
  // Sort dates ascending
  parsedDates.sort((a, b) => a.getTime() - b.getTime());
  
  const minDate = parsedDates[0];
  const maxDate = parsedDates[parsedDates.length - 1];
  
  // Calculate unique calendar days (by YYYY-MM-DD string)
  const uniqueCalendarDays = new Set(parsedDates.map(d => d.toISOString().slice(0, 10)));
  
  // Calculate duration in days
  const diffTime = Math.abs(maxDate.getTime() - minDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  console.log(`Min Date: ${minDate.toISOString().slice(0, 10)}`);
  console.log(`Max Date: ${maxDate.toISOString().slice(0, 10)}`);
  console.log(`Date Range Duration: ${diffDays} days`);
  console.log(`Unique Calendar Days represented in data: ${uniqueCalendarDays.size} days`);
}

async function main() {
  if (!supabasePrisma) {
    console.error("Supabase client is not available.");
    return;
  }

  await getTableDateStats("AmazonCODSettlementRow (COD_ALL_Settlements)", "amazonCODSettlementRow");
  await getTableDateStats("AmazonElectronicsSettlementRow (Electronics_all_statements)", "amazonElectronicsSettlementRow");
}

main().catch(console.error).finally(() => supabasePrisma?.$disconnect());
