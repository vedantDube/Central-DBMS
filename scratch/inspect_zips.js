import fs from 'node:fs';
import path from 'node:path';
import unzipper from 'unzipper';
import readline from 'node:readline';

const files = [
  'b2bReport_May_2026.zip',
  'b2cReport_May_2026.zip',
  'stockTransferReport_May_2026.zip'
];

async function inspectZip(zipName) {
  const zipPath = path.join(process.cwd(), 'scratch', zipName);
  console.log(`\n--- Inspecting ${zipName} ---`);
  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) {
    console.log(`Found file inside zip: ${entry.path} (${entry.size} bytes)`);
    if (entry.path.endsWith('.csv')) {
      const stream = entry.stream();
      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      let count = 0;
      for await (const line of rl) {
        if (count === 0) {
          // Parse CSV header line robustly
          const headers = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.replace(/^"|"$/g, '').trim());
          console.log(`Total headers: ${headers.length}`);
          console.log(JSON.stringify(headers, null, 2));
        }
        if (count < 3) {
          console.log(`Line ${count + 1}: ${line.substring(0, 200)}...`);
          count++;
        } else {
          break;
        }
      }
      rl.close();
    }
  }
}

async function main() {
  for (const file of files) {
    try {
      await inspectZip(file);
    } catch (err) {
      console.error(`Error inspecting ${file}:`, err);
    }
  }
}

main();
