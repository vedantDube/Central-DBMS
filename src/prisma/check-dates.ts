import { prisma } from "./client.js";

async function main() {
  console.log("=== Database Date Ranges ===");
  try {
    // 1. Amazon B2C Customer Returns
    const b2cDates = await prisma.amazonReturnsB2cRow.findMany({
      select: { returndate: true },
      where: { returndate: { not: null } },
    });
    const b2cSorted = b2cDates.map(d => d.returndate!).filter(Boolean).sort();
    console.log(`Amazon B2C Returns Date Range: ${b2cSorted[0] ?? "N/A"} to ${b2cSorted[b2cSorted.length - 1] ?? "N/A"} (${b2cDates.length} records)`);

    // 2. Amazon B2B Removal Shipments
    const b2bShipmentDates = await prisma.amazonReturnsB2bRow.findMany({
      select: { requestdate: true },
      where: { requestdate: { not: null } },
    });
    const b2bSorted = b2bShipmentDates.map(d => d.requestdate!).filter(Boolean).sort();
    console.log(`Amazon B2B Returns Date Range: ${b2bSorted[0] ?? "N/A"} to ${b2bSorted[b2bSorted.length - 1] ?? "N/A"} (${b2bShipmentDates.length} records)`);

    // 3. Amazon B2B Removal Orders
    const b2bOrderDates = await prisma.amazonReturnsB2bOrderRow.findMany({
      select: { requestdate: true },
      where: { requestdate: { not: null } },
    });
    const b2bOrderSorted = b2bOrderDates.map(d => d.requestdate!).filter(Boolean).sort();
    console.log(`Amazon B2B Removal Orders Date Range: ${b2bOrderSorted[0] ?? "N/A"} to ${b2bOrderSorted[b2bOrderSorted.length - 1] ?? "N/A"} (${b2bOrderDates.length} records)`);

    // 4. Amazon Sales and Traffic
    const salesTrafficDates = await prisma.amazonSalesAndTrafficRow.findMany({
      select: { date: true },
      where: { date: { not: null } },
    });
    const salesTrafficSorted = salesTrafficDates.map(d => d.date!).filter(Boolean).sort();
    console.log(`Amazon Sales & Traffic Date Range: ${salesTrafficSorted[0] ?? "N/A"} to ${salesTrafficSorted[salesTrafficSorted.length - 1] ?? "N/A"} (${salesTrafficDates.length} records)`);

    // 5. Amazon MTR Rows
    const mtrDates = await prisma.amazonMtrRow.findMany({
      select: { opendate: true },
      where: { opendate: { not: null } },
    });
    const mtrSorted = mtrDates.map(d => d.opendate!).filter(Boolean).sort();
    console.log(`Amazon MTR Rows Date Range: ${mtrSorted[0] ?? "N/A"} to ${mtrSorted[mtrSorted.length - 1] ?? "N/A"} (${mtrDates.length} records)`);

    // 6. Amazon Claims
    const claimsDates = await prisma.amazonClaimsReimbursementsRow.findMany({
      select: { approvaldate: true },
      where: { approvaldate: { not: null } },
    });
    const claimsSorted = claimsDates.map(d => d.approvaldate!).filter(Boolean).sort();
    console.log(`Amazon Claims Date Range: ${claimsSorted[0] ?? "N/A"} to ${claimsSorted[claimsSorted.length - 1] ?? "N/A"} (${claimsDates.length} records)`);

  } catch (error) {
    console.error("Error checking date ranges:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
