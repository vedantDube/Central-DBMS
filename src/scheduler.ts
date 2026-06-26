import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";
import { env } from "./config.js";

interface ScheduledScript {
  name: string;
  command: string;
  args: string[];
  cronExpression: string;
  description: string;
}

const TASKS: ScheduledScript[] = [
  {
    name: "Shiprocket Fetch Orders",
    command: "tsx",
    args: ["src/shiprocket/fetch-orders.ts"],
    cronExpression: env.CRON_SHIPROCKET_ORDERS,
    description: "Fetches orders data from Shiprocket API"
  },
  {
    name: "Shopify Fetch Orders",
    command: "tsx",
    args: ["src/shopify/fetch-orders.ts"],
    cronExpression: env.CRON_SHOPIFY_ORDERS,
    description: "Fetches orders data from Shopify Admin API"
  },
  {
    name: "Shopify Fetch Returns",
    command: "tsx",
    args: ["src/shopify/fetch-returns.ts"],
    cronExpression: env.CRON_SHOPIFY_RETURNS,
    description: "Fetches returns data from Shopify Admin API"
  },
  {
    name: "ReturnPrime Fetch Returns",
    command: "tsx",
    args: ["src/returnprime/fetch-returns.ts"],
    cronExpression: env.CRON_RETURNPRIME_RETURNS,
    description: "Fetches returns data from ReturnPrime API"
  },
  {
    name: "Shopify Fetch Inventory",
    command: "tsx",
    args: ["src/shopify/fetch-inventory.ts", "--snapshot", "Opening"],
    cronExpression: env.CRON_SHOPIFY_INVENTORY,
    description: "Fetches opening inventory from Shopify Admin API"
  },
  {
    name: "Easyecom Fetch Inventory",
    command: "tsx",
    args: ["src/easyecom/fetch-inventory.ts", "--snapshot", "Opening"],
    cronExpression: env.CRON_EASYECOM_INVENTORY,
    description: "Fetches inventory snapshot from Easyecom API"
  },
  {
    name: "Request Amazon Reports",
    command: "tsx",
    args: ["src/reports/request_amazon_reports.ts"],
    cronExpression: env.CRON_AMAZON_REQUEST_REPORTS,
    description: "Requests Unified, COD, and Electronic reports on Seller Central"
  },
  {
    name: "Amazon Ingest (SP-API & Auto)",
    command: "tsx",
    args: ["src/index.ts"],
    cronExpression: env.CRON_AMAZON_INGEST,
    description: "Downloads and ingests configured Amazon reports using SP-API and browser automation"
  },
  {
    name: "Easyecom Metadata Syncs",
    command: "tsx",
    args: [
      "src/run-all.ts",
      "Easyecom Fetch Product Master",
      "Easyecom Fetch Purchase Orders",
      "Easyecom Fetch Production Orders",
      "Easyecom Fetch Marketplace Listings"
    ],
    cronExpression: env.CRON_EASYECOM_METADATA,
    description: "Syncs Easyecom metadata (Product Master, POs, Production, Listings) sequentially"
  },
  {
    name: "Amazon Map Cost Inventory",
    command: "tsx",
    args: ["src/amazon/map-cost-inventory.ts"],
    cronExpression: env.CRON_AMAZON_MAP_COST,
    description: "Maps EasyEcom inventory costs to Amazon GST Master table"
  },
  {
    name: "Amazon GST Sync",
    command: "tsx",
    args: [
      "src/run-all.ts",
      "Amazon GST MTR Browser Sync",
      "Amazon GST Monthly Reports Sync"
    ],
    cronExpression: env.CRON_AMAZON_GST_SYNC,
    description: "Automates browser download for GST MTR and Monthly reports"
  }
];

const runningTasks = new Set<string>();

async function logMessage(msg: string) {
  const timestamped = `[${new Date().toISOString()}] ${msg}`;
  console.log(timestamped);
  try {
    const logsDir = path.join(process.cwd(), "logs");
    await mkdir(logsDir, { recursive: true });
    await appendFile(path.join(logsDir, "scheduler.log"), timestamped + "\n");
  } catch (err) {
    console.error("❌ Failed to write to scheduler.log:", err);
  }
}

async function runScheduledTask(task: ScheduledScript): Promise<boolean> {
  if (runningTasks.has(task.name)) {
    await logMessage(`⚠️  [LOCK] Task "${task.name}" is already running. Skipping this schedule execution to prevent overlapping.`);
    return false;
  }

  runningTasks.add(task.name);
  await logMessage(`🚀 [START] Task "${task.name}" started. Description: ${task.description}`);
  const startTime = Date.now();

  return new Promise((resolve) => {
    try {
      const logsDir = path.join(process.cwd(), "logs");
      const logFileName = `task-${task.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.log`;
      const logFilePath = path.join(logsDir, logFileName);
      const logStream = createWriteStream(logFilePath, { flags: "a" });

      logStream.write(`\n============================================================\n`);
      logStream.write(`⏰ RUN STARTED AT: ${new Date().toISOString()}\n`);
      logStream.write(`💻 COMMAND: ${task.command} ${task.args.join(" ")}\n`);
      logStream.write(`============================================================\n\n`);

      const child = spawn(task.command, task.args, {
        shell: true
      });

      child.stdout?.on("data", (data) => {
        logStream.write(data);
      });

      child.stderr?.on("data", (data) => {
        logStream.write(data);
      });

      child.on("close", async (code) => {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
        logStream.write(`\n\n============================================================\n`);
        logStream.write(`✅ RUN FINISHED AT: ${new Date().toISOString()}\n`);
        logStream.write(`🚪 EXIT CODE: ${code}\n`);
        logStream.write(`⏳ DURATION: ${durationSec}s\n`);
        logStream.write(`============================================================\n`);
        logStream.end();

        runningTasks.delete(task.name);

        if (code === 0) {
          await logMessage(`✅ [SUCCESS] Task "${task.name}" finished successfully in ${durationSec}s.`);
          resolve(true);
        } else {
          await logMessage(`❌ [FAILURE] Task "${task.name}" failed with exit code ${code} in ${durationSec}s. Check logs/` + logFileName);
          resolve(false);
        }
      });

      child.on("error", async (err) => {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
        logStream.write(`❌ SPAWN ERROR: ${err.message}\n`);
        logStream.end();
        runningTasks.delete(task.name);
        await logMessage(`❌ [ERROR] Task "${task.name}" failed to start: ${err.message} (${durationSec}s).`);
        resolve(false);
      });

    } catch (error) {
      runningTasks.delete(task.name);
      const message = error instanceof Error ? error.message : String(error);
      logMessage(`❌ [FATAL ERROR] Failed to initialize task "${task.name}": ${message}`);
      resolve(false);
    }
  });
}

async function start() {
  await logMessage("============================================================");
  await logMessage("⏰ INITIALIZING CENTRAL DBMS CRON SCHEDULER");
  await logMessage(`🌍 Configured Timezone: ${env.CRON_TIMEZONE}`);
  await logMessage("============================================================");

  // Ensure logs directory exists
  try {
    await mkdir(path.join(process.cwd(), "logs"), { recursive: true });
  } catch (err) {
    console.error("Failed to create logs directory:", err);
  }

  // 1. Check for startup run flag
  const runNow = process.argv.includes("--run-now");
  if (runNow) {
    await logMessage("⚡ '--run-now' flag detected. Running all tasks sequentially on startup...");
    for (const task of TASKS) {
      await runScheduledTask(task);
    }
    await logMessage("⚡ Startup run completed. Continuing with schedule...");
  }

  // 2. Register cron schedules
  for (const task of TASKS) {
    if (!cron.validate(task.cronExpression)) {
      await logMessage(`❌ Invalid cron expression for "${task.name}": "${task.cronExpression}". Task will not be scheduled.`);
      continue;
    }

    await logMessage(`📅 Scheduled: "${task.name}" -> "${task.cronExpression}"`);
    cron.schedule(
      task.cronExpression,
      async () => {
        await logMessage(`⏰ Scheduled trigger fired for: "${task.name}"`);
        await runScheduledTask(task);
      },
      {
        timezone: env.CRON_TIMEZONE
      }
    );
  }

  await logMessage("⏰ Scheduler is running in background. Press Ctrl+C to terminate.");
}

start().catch(async (err) => {
  await logMessage(`❌ Scheduler initialization failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
