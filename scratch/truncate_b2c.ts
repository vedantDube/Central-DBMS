import { PrismaClient } from '@prisma/client-amazon';

async function main() {
  const url = "postgresql://postgres:S6b9FW8WW9ZirkI1@db.ppyumqeosmeyqlzjszla.supabase.co:5432/postgres";
  console.log("Connecting to Supabase to truncate tables...");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url,
      },
    },
  });

  try {
    console.log("Terminating active blocking queries on Supabase...");
    await prisma.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = 'postgres'
        AND pid <> pg_backend_pid()
        AND state in ('active', 'idle in transaction');
    `);
  } catch (e) {
    console.warn("Could not terminate other backends:", e);
  }

  const tables = ["AmazonGstMonthlyStrRow", "AmazonClaimsReimbursementsRow", "AmazonReturnsB2bOrderRow"];
  for (const t of tables) {
    try {
      console.log(`Truncating ${t}...`);
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE;`);
      console.log(`${t} truncated successfully.`);
    } catch (e) {
      console.error(`Failed to truncate table ${t}:`, e);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
