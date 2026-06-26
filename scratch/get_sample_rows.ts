import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma client is not configured!");
    return;
  }
  try {
    const electronicsRows = await supabasePrisma.$queryRawUnsafe(
      `SELECT * FROM "COD_ALL_Settlements" LIMIT 10`
    );
    const codRows = await supabasePrisma.$queryRawUnsafe(
      `SELECT * FROM "Electronics_all_statements" LIMIT 10`
    );

    console.log("FIRST 10 ROWS FROM COD_ALL_Settlements:");
    console.log(JSON.stringify(electronicsRows, null, 2));

    console.log("\nFIRST 10 ROWS FROM Electronics_all_statements:");
    console.log(JSON.stringify(codRows, null, 2));

  } catch (err) {
    console.error("Error fetching rows:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
