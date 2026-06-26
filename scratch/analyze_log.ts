import fs from "node:fs/promises";

async function main() {
  const logPath = "C:\\Users\\Vedan\\.gemini\\antigravity-ide\\brain\\bd597754-c775-460f-9cba-99768178c97c\\.system_generated\\tasks\\task-593.log";
  const content = await fs.readFile(logPath, "utf8");
  const lines = content.split("\n");
  
  let successCount = 0;
  let failCount = 0;
  let quotaExceededCount = 0;
  
  for (const line of lines) {
    if (line.includes("Ingested ") && line.includes("tableName")) {
      successCount++;
    }
    if (line.includes("Failed to process report")) {
      failCount++;
      if (line.includes("QuotaExceeded") || content.includes("You exceeded your quota")) {
        quotaExceededCount++;
      }
    }
  }
  
  console.log(`=== Ingestion Log Analysis ===`);
  console.log(`Successfully ingested reports: ${successCount}`);
  console.log(`Failed reports: ${failCount}`);
  
  // Find where failures started
  const failedReports: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Failed to process report")) {
      failedReports.push(lines[i].trim());
    }
  }
  console.log(`First 5 failed reports:`, failedReports.slice(0, 5));
  console.log(`Last 5 failed reports:`, failedReports.slice(-5));
}

main().catch(console.error);
