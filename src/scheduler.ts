import { spawn } from "node:child_process";

// Set interval for execution (default: 24 hours)
const INTERVAL_HOURS = 24;
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

function runIngest() {
  console.log(`\n============================================================`);
  console.log(`⏰ [${new Date().toISOString()}] STARTING SCHEDULED DATA SYNC`);
  console.log(`============================================================\n`);

  const child = spawn("npm", ["run", "ingest:all"], {
    stdio: "inherit",
    shell: true
  });

  child.on("close", (code) => {
    console.log(`\n============================================================`);
    console.log(`✅ [${new Date().toISOString()}] SYNC FINISHED (Exit Code: ${code})`);
    console.log(`Next run scheduled in ${INTERVAL_HOURS} hours.`);
    console.log(`============================================================\n`);
  });
}

// Run immediately on startup
runIngest();

// Schedule future executions
setInterval(runIngest, INTERVAL_MS);
