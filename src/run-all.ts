import { spawn } from "node:child_process";
import path from "node:path";

interface ScriptTask {
  name: string;
  command: string;
  args: string[];
  description: string;
}

const ALL_TASKS: ScriptTask[] = [
  {
    name: "Amazon Ingest (SP-API & Auto)",
    command: "tsx",
    args: ["src/index.ts"],
    description: "Downloads and ingests configured Amazon reports using SP-API and browser automation"
  },
  {
    name: "ReturnPrime Fetch Returns",
    command: "tsx",
    args: ["src/returnprime/fetch-returns.ts"],
    description: "Fetches returns data from ReturnPrime API"
  },
  {
    name: "Amazon GST MTR Browser Sync",
    command: "tsx",
    args: ["src/amazon/gst-mtr-browser.ts"],
    description: "Automates browser download for GST MTR reports"
  },
  {
    name: "Shiprocket Fetch Orders",
    command: "tsx",
    args: ["src/shiprocket/fetch-orders.ts"],
    description: "Fetches orders data from Shiprocket API"
  },
  {
    name: "Easyecom Fetch Inventory",
    command: "tsx",
    args: ["src/easyecom/fetch-inventory.ts", "--snapshot", "Opening"],
    description: "Fetches inventory data from Easyecom API"
  },
  {
    name: "Shopify Fetch Orders",
    command: "tsx",
    args: ["src/shopify/fetch-orders.ts"],
    description: "Fetches orders data from Shopify Admin API"
  },
  {
    name: "Shopify Fetch Returns",
    command: "tsx",
    args: ["src/shopify/fetch-returns.ts"],
    description: "Fetches returns data from Shopify Admin API"
  },
  {
    name: "Shopify Fetch Inventory",
    command: "tsx",
    args: ["src/shopify/fetch-inventory.ts", "--snapshot", "Opening"],
    description: "Fetches inventory data from Shopify Admin API"
  },
  {
    name: "Request Amazon Reports (Browser)",
    command: "tsx",
    args: ["src/reports/request_amazon_reports.ts"],
    description: "Requests Unified, COD, and Electronic reports on Seller Central"
  },
  {
    name: "Download Portal Report",
    command: "tsx",
    args: ["src/reports/download-report.ts"],
    description: "Playwright automation template to download portal reports"
  }
];

function printHeader(text: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`🚀 ${text}`);
  console.log("=".repeat(60) + "\n");
}

async function runTask(task: ScriptTask): Promise<{ success: boolean; durationMs: number }> {
  console.log(`📋 Running Task: ${task.name}`);
  console.log(`💡 Description:  ${task.description}`);
  console.log(`💻 Executing:    ${task.command} ${task.args.join(" ")}\n`);
  
  const startTime = Date.now();

  return new Promise((resolve) => {
    // We use shell: true for robust execution across different OS environments (especially Windows)
    const child = spawn(task.command, task.args, {
      stdio: "inherit",
      shell: true
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(2);
      
      if (code === 0) {
        console.log(`\n✅ SUCCESS: "${task.name}" completed in ${durationSec}s\n`);
        resolve({ success: true, durationMs });
      } else {
        console.error(`\n❌ FAILURE: "${task.name}" exited with code ${code} in ${durationSec}s\n`);
        resolve({ success: false, durationMs });
      }
    });

    child.on("error", (err) => {
      const durationMs = Date.now() - startTime;
      console.error(`\n❌ ERROR spawning "${task.name}":`, err.message);
      resolve({ success: false, durationMs });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const bailOnError = args.includes("--bail") || args.includes("-b");
  
  // Filter out any CLI flag arguments (starting with -) to check for task filters
  const filters = args.filter(arg => !arg.startsWith("-"));

  let tasksToRun = ALL_TASKS;
  if (filters.length > 0) {
    tasksToRun = ALL_TASKS.filter(task => 
      filters.some(filter => 
        task.name.toLowerCase().includes(filter.toLowerCase()) || 
        task.args.some(arg => arg.toLowerCase().includes(filter.toLowerCase()))
      )
    );
    
    if (tasksToRun.length === 0) {
      console.error(`No tasks matched the filters: ${filters.join(", ")}`);
      console.log("Available tasks:");
      ALL_TASKS.forEach(t => console.log(`  - ${t.name}`));
      process.exit(1);
    }
  }

  printHeader(`Starting Ingestion Run (${tasksToRun.length} tasks scheduled)`);
  
  const results: Array<{
    Task: string;
    Status: string;
    Duration: string;
  }> = [];

  let overallSuccess = true;

  for (const task of tasksToRun) {
    const { success, durationMs } = await runTask(task);
    const durationSec = `${(durationMs / 1000).toFixed(2)}s`;
    
    results.push({
      Task: task.name,
      Status: success ? "✅ Success" : "❌ Failed",
      Duration: durationSec
    });

    if (!success) {
      overallSuccess = false;
      if (bailOnError) {
        console.error("🛑 --bail flag active. Stopping run on first failure.");
        break;
      }
    }
  }

  printHeader("Execution Summary Table");
  console.table(results);

  if (overallSuccess) {
    console.log("🎉 All executed tasks completed successfully!");
    process.exit(0);
  } else {
    console.error("⚠️ Some tasks failed during the run. Check the logs above.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal orchestrator error:", error);
  process.exit(1);
});
