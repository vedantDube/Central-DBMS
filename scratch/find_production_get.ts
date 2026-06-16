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

  console.log('Searching for any GET requests related to orders...');
  const orderGets = flatRequests.filter(r => 
    r.request.method === 'GET' && 
    (r.name.toLowerCase().includes('order') || r.request.url?.raw?.toLowerCase().includes('order'))
  );

  for (const r of orderGets) {
    let urlStr = typeof r.request.url === 'string' ? r.request.url : (r.request.url?.raw || r.request.url?.path?.join('/') || '');
    console.log(`- Name: ${r.name} | URL: ${urlStr}`);
  }
}

main().catch(console.error);
