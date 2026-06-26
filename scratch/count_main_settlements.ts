import { prisma } from "../src/prisma/client.js";

async function main() {
  try {
    const rawCodCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::text as count FROM "COD_ALL_Settlements"`);
    const rawElecCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::text as count FROM "Electronics_all_statements"`);
    
    console.log("DATABASE_URL (main prisma client) Counts:");
    console.log(`"COD_ALL_Settlements" table count:`, rawCodCount);
    console.log(`"Electronics_all_statements" table count:`, rawElecCount);
  } catch (err) {
    console.error("Error executing raw queries on DATABASE_URL:", (err as Error).message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
