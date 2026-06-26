import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const filePath = path.join(process.cwd(), "api_electronics_60days.csv");
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split("\n");
  
  console.log("--- Header Line Character Details ---");
  const header = lines[0] || "";
  console.log(`Length: ${header.length}`);
  console.log(`Contains Tabs: ${header.includes("\t")}`);
  console.log(`Contains Commas: ${header.includes(",")}`);
  console.log(`Contains Spaces: ${header.includes(" ")}`);
  
  // Show charCodes for first 100 characters of header
  const headerCodes = [];
  for (let i = 0; i < Math.min(header.length, 100); i++) {
    const char = header[i];
    headerCodes.push(`${char === "\t" ? "\\t" : char} (${header.charCodeAt(i)})`);
  }
  console.log("Header start chars:", headerCodes.slice(0, 15).join(" | "));

  console.log("\n--- Line 3 Character Details ---");
  const line3 = lines[2] || "";
  console.log(`Length: ${line3.length}`);
  console.log(`Contains Tabs: ${line3.includes("\t")}`);
  const line3Codes = [];
  for (let i = 0; i < Math.min(line3.length, 100); i++) {
    const char = line3[i];
    line3Codes.push(`${char === "\t" ? "\\t" : char} (${line3.charCodeAt(i)})`);
  }
  console.log("Line 3 start chars:", line3Codes.slice(0, 20).join(" | "));
}

main();
