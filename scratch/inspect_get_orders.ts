import fs from 'node:fs/promises';

interface PostmanItem {
  name: string;
  request?: any;
  item?: PostmanItem[];
}

function traverse(items: PostmanItem[], results: any[] = []) {
  for (const item of items) {
    if (item.request) {
      results.push(item);
    }
    if (item.item) {
      traverse(item.item, results);
    }
  }
  return results;
}

async function main() {
  const data = JSON.parse(await fs.readFile('scratch/easyecom_collection.json', 'utf8'));
  const collectionItems = data.collection?.item || data.item || [];
  const flatRequests = traverse(collectionItems);

  const getOrders = flatRequests.filter(r => r.name === 'Get All Orders');
  for (const r of getOrders) {
    console.log(`\nName: ${r.name}`);
    console.log(`URL:`, r.request.url?.raw || r.request.url);
    console.log(`Query parameters:`, r.request.url?.query || []);
  }
}

main().catch(console.error);
