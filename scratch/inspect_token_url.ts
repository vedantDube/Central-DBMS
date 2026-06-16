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

  const tokenRequests = flatRequests.filter(r => 
    r.name.toLowerCase().includes('token') || 
    (r.request.url?.raw && r.request.url.raw.toLowerCase().includes('token'))
  );

  for (const r of tokenRequests) {
    console.log(`\nName: ${r.name}`);
    console.log(`URL:`, r.request.url?.raw || r.request.url);
    console.log(`Method: ${r.request.method}`);
    console.log(`Headers:`, r.request.header);
    console.log(`Body:`, r.request.body?.raw);
  }
}

main().catch(console.error);
