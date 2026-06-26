import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const filePath = path.join(process.cwd(), "api_electronics_60days.csv");
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < 15; i++) {
    const line = lines[i];
    if (line !== undefined) {
      const parts = line.split("\t");
      console.log(`Line ${i + 1} (${parts.length} columns):`, parts);
    }
  }
}

main();
