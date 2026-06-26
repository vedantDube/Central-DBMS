import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ supabasePrisma client is not configured!");
    return;
  }
  try {
    const elecCount = await supabasePrisma.amazonElectronicsSettlementRow.count();
    const codCount = await supabasePrisma.amazonCODSettlementRow.count();
    console.log(`AmazonElectronicsSettlementRow count: ${elecCount}`);
    console.log(`AmazonCODSettlementRow count: ${codCount}`);
  } catch (err) {
    console.error("Error fetching settlement counts:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
