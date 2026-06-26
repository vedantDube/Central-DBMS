import { prisma, supabasePrisma } from "../src/prisma/client.js";

async function main() {
  try {
    const mainTables = await prisma.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    console.log("=== Tables in DATABASE_URL ===");
    console.log(mainTables);
  } catch (err) {
    console.error("Error listing DATABASE_URL tables:", (err as Error).message);
  }

  if (supabasePrisma) {
    try {
      const supabaseTables = await supabasePrisma.$queryRawUnsafe(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      console.log("\n=== Tables in SUPABASE_DB_URL ===");
      console.log(supabaseTables);
    } catch (err) {
      console.error("Error listing SUPABASE_DB_URL tables:", (err as Error).message);
    }
  }
}

main().finally(async () => {
  await prisma.$disconnect();
  if (supabasePrisma) {
    await supabasePrisma.$disconnect();
  }
});
