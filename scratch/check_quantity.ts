import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.log("Supabase DB not configured (SUPABASE_DB_URL missing). Cannot check quantity.");
    return;
  }

  console.log("Checking quantity values in AmazonMtrRow table on Supabase...");
  try {
    const totalCount = await supabasePrisma.amazonMtrRow.count();
    const nullCount = await supabasePrisma.amazonMtrRow.count({
      where: {
        quantity: null
      }
    });
    const nonNullCount = totalCount - nullCount;

    console.log(`Total rows in AmazonMtrRow: ${totalCount}`);
    console.log(`Rows with NULL quantity: ${nullCount}`);
    console.log(`Rows with NON-NULL quantity: ${nonNullCount}`);

    if (nonNullCount > 0) {
      console.log("\nSample non-null quantity values:");
      const samples = await supabasePrisma.amazonMtrRow.findMany({
        where: {
          NOT: {
            quantity: null
          }
        },
        select: {
          id: true,
          quantity: true,
        },
        take: 5
      });
      for (const s of samples) {
        console.log(`ID: ${s.id}, quantity field: "${s.quantity}"`);
      }
    }
  } catch (error) {
    console.error("Error checking quantity:", error);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
