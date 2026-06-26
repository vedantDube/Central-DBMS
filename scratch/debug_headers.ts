import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const filePath = path.join(process.cwd(), "api_electronics_60days.csv");
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split("\n");
  console.log("Header split by tab:", lines[0].split("\t"));
  console.log("Header split by comma:", lines[0].split(","));
  console.log("Line 2 split by tab:", lines[1].split("\t"));
}

main();
