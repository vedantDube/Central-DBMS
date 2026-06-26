import fs from "node:fs/promises";
import path from "node:path";
import { supabasePrisma } from "../src/prisma/client.js";

function convertToCSV(array: any[]) {
  if (array.length === 0) return "";
  const headers = Object.keys(array[0]);
  const csvRows = [headers.join(",")];

  for (const row of array) {
    const values = headers.map(header => {
      const val = row[header];
      if (val === null || val === undefined) {
        return '""';
      }
      const escaped = String(val).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(","));
  }

  return csvRows.join("\n");
}

async function main() {
  if (!supabasePrisma) {
    console.error("❌ SUPABASE_DB_URL is not configured.");
    process.exit(1);
  }

  try {
    console.log("Fetching data from COD_ALL_Settlements (Electronics Model)...");
    const electronicsData = await supabasePrisma.$queryRawUnsafe(
      `SELECT * FROM "COD_ALL_Settlements" ORDER BY depositdate DESC, settlementid DESC`
    );
    const elecCsvContent = convertToCSV(electronicsData as any[]);
    const elecPath = path.join(process.cwd(), "COD_ALL_Settlements_rows.csv");
    await fs.writeFile(elecPath, elecCsvContent, "utf8");
    console.log(`Saved ${electronicsData.length} rows to ${elecPath}`);

    console.log("Fetching data from Electronics_all_statements (COD Model)...");
    const codData = await supabasePrisma.$queryRawUnsafe(
      `SELECT * FROM "Electronics_all_statements" ORDER BY depositdate DESC, settlementid DESC`
    );
    const codCsvContent = convertToCSV(codData as any[]);
    const codPath = path.join(process.cwd(), "Electronics_all_statements_rows.csv");
    await fs.writeFile(codPath, codCsvContent, "utf8");
    console.log(`Saved ${codData.length} rows to ${codPath}`);

  } catch (err) {
    console.error("Error downloading data:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
