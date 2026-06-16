import { chromium } from 'playwright';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to api-docs.easyecom.io...');
  try {
    await page.goto('https://api-docs.easyecom.io/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (err) {
    console.log('Navigation warning:', (err as Error).message);
  }
  
  // Wait a bit for dynamic content
  await page.waitForTimeout(5000);
  
  console.log('Extracting text content...');
  
  // Get all text contents of sidebar list items or buttons
  const items = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('a, button, li, span, code'));
    return elements.map(el => {
      const text = el.textContent?.trim() || '';
      const href = (el as HTMLAnchorElement).href || '';
      return { text, href };
    }).filter(item => item.text.length > 0 && item.text.length < 100);
  });
  
  console.log('--- Sidebar / Navigation Items Found ---');
  const uniqueItems = new Set<string>();
  for (const item of items) {
    const entry = `${item.text} [${item.href}]`;
    if (!uniqueItems.has(entry)) {
      uniqueItems.add(entry);
      // Filter interesting stuff to print
      const lower = item.text.toLowerCase();
      if (
        lower.includes('get') || 
        lower.includes('product') || 
        lower.includes('order') || 
        lower.includes('purchase') || 
        lower.includes('production') ||
        lower.includes('kitting')
      ) {
        console.log(`- ${item.text} (${item.href})`);
      }
    }
  }

  // Let's also look for all occurrence of actual paths in the body text
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('\n--- Searching body text for method/path names ---');
  
  // Find strings like "getInventoryDetails", "getmasterproduct" etc.
  const pathRegex = /\b(get[A-Za-z0-9_]+|create[A-Za-z0-9_]+|update[A-Za-z0-9_]+|delete[A-Za-z0-9_]+)\b/gi;
  const matches = pageText.match(pathRegex) || [];
  const uniqueMatches = Array.from(new Set(matches.map(m => m.toLowerCase())));
  console.log('Found path-like method names (lowercase):', uniqueMatches.filter(m => !m.includes('token')));

  await browser.close();
  console.log('Done.');
}

main().catch(console.error);
