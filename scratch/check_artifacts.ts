import { prisma } from "../src/prisma/client.js";

async function main() {
  try {
    const artifactCount = await prisma.reportArtifact.count();
    console.log(`ReportArtifact count: ${artifactCount}`);
    
    // Get unique reportKeys
    const keys = await prisma.reportArtifact.findMany({
      select: { reportKey: true, fileName: true, source: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    console.log("Recent report artifacts:", keys);
  } catch (err) {
    console.error("Error querying ReportArtifact:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
