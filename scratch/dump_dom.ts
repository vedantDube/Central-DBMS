import { chromium } from 'playwright';
import fs from 'node:fs/promises';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating...');
  try {
    await page.goto('https://api-docs.easyecom.io/', { waitUntil: 'load', timeout: 20000 });
  } catch (err) {
    console.log('Navigation warning:', (err as Error).message);
  }
  
  await page.waitForTimeout(5000);
  
  console.log('Dumping HTML...');
  const html = await page.content();
  await fs.writeFile('scratch/dom_dump.txt', html);
  console.log('DOM dumped to scratch/dom_dump.txt. Length:', html.length);
  
  await browser.close();
}

main().catch(console.error);
