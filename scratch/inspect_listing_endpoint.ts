import fs from 'node:fs/promises';
import path from 'node:path';

interface PostmanItem {
  name: string;
  request?: any;
  item?: PostmanItem[];
}

function findRequestByName(items: PostmanItem[], targetNames: string[], results: any[] = []) {
  for (const item of items) {
    if (targetNames.some(t => item.name.toLowerCase().includes(t.toLowerCase()))) {
      results.push(item);
    }
    if (item.item) {
      findRequestByName(item.item, targetNames, results);
    }
  }
  return results;
}

async function main() {
  const collectionPath = path.join(process.cwd(), 'EasyEcom API Document.postman_collection.json');
  const data = JSON.parse(await fs.readFile(collectionPath, 'utf8'));
  const collectionItems = data.collection?.item || data.item || [];
  
  const matches = findRequestByName(collectionItems, ['getmarketplacelisting', 'marketplace listing', 'listings']);
  await fs.writeFile('scratch/listing_endpoints.json', JSON.stringify(matches, null, 2));
  console.log(`Found ${matches.length} matches. Wrote to scratch/listing_endpoints.json`);
}

main().catch(console.error);
