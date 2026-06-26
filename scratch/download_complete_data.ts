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
    console.log("Downloading Electronics Settlements (from 'COD_ALL_Settlements' table)...");
    const electronicsData = await supabasePrisma.$queryRawUnsafe(
      `SELECT * FROM "COD_ALL_Settlements" ORDER BY depositdate DESC, settlementid DESC`
    );
    const elecPath = path.join(process.cwd(), "database_electronics_settlements.csv");
    await fs.writeFile(elecPath, convertToCSV(electronicsData as any[]), "utf8");
    console.log(`Saved ${electronicsData.length} records to ${elecPath}`);

    console.log("Downloading COD Settlements (from 'Electronics_all_statements' table)...");
    const codData = await supabasePrisma.$queryRawUnsafe(
      `SELECT * FROM "Electronics_all_statements" ORDER BY depositdate DESC, settlementid DESC`
    );
    const codPath = path.join(process.cwd(), "database_cod_settlements.csv");
    await fs.writeFile(codPath, convertToCSV(codData as any[]), "utf8");
    console.log(`Saved ${codData.length} records to ${codPath}`);

    console.log("Export complete!");

  } catch (err) {
    console.error("Error exporting data from Supabase:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
