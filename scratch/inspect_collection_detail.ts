import fs from 'node:fs/promises';

interface PostmanItem {
  name: string;
  request?: any;
  item?: PostmanItem[];
}

function findRequestByName(items: PostmanItem[], targetNames: string[], results: any[] = []) {
  for (const item of items) {
    if (targetNames.includes(item.name)) {
      results.push(item);
    }
    if (item.item) {
      findRequestByName(item.item, targetNames, results);
    }
  }
  return results;
}

async function main() {
  const data = JSON.parse(await fs.readFile('scratch/easyecom_collection.json', 'utf8'));
  const collectionItems = data.collection?.item || data.item || [];
  
  const matches = findRequestByName(collectionItems, ['getmasterproduct', 'Get Master Product', 'getPurchaseOrder', 'Production Order', 'Get Kit']);
  console.log(JSON.stringify(matches, null, 2));
}

main().catch(console.error);
