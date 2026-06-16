import fs from 'node:fs/promises';

interface PostmanItem {
  name: string;
  request?: {
    method: string;
    url?: {
      raw?: string;
      path?: string[];
      query?: Array<{ key: string; value?: string; description?: string }>;
    };
    body?: {
      mode?: string;
      raw?: string;
    };
    description?: string;
  };
  item?: PostmanItem[];
}

function traverse(items: PostmanItem[], results: any[] = []) {
  for (const item of items) {
    if (item.request) {
      results.push({
        name: item.name,
        method: item.request.method,
        path: item.request.url?.path?.join('/') || '',
        query: item.request.url?.query || [],
        body: item.request.body?.raw || '',
        description: item.request.description || ''
      });
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

  console.log(`=== Total Requests Found in Collection: ${flatRequests.length} ===\n`);

  const productRequests = flatRequests.filter(r => 
    r.name.toLowerCase().includes('product') || 
    r.path.toLowerCase().includes('product')
  );
  console.log(`=== Product Requests (${productRequests.length}) ===`);
  productRequests.forEach(r => {
    console.log(`- [${r.method}] /${r.path} | Name: ${r.name}`);
  });

  const purchaseRequests = flatRequests.filter(r => 
    r.name.toLowerCase().includes('purchase') || 
    r.path.toLowerCase().includes('purchase') ||
    r.name.toLowerCase().includes('buy') || 
    r.path.toLowerCase().includes('buy')
  );
  console.log(`\n=== Purchase/Buy Order Requests (${purchaseRequests.length}) ===`);
  purchaseRequests.forEach(r => {
    console.log(`- [${r.method}] /${r.path} | Name: ${r.name}`);
  });

  const productionRequests = flatRequests.filter(r => 
    r.name.toLowerCase().includes('production') || 
    r.path.toLowerCase().includes('production') ||
    r.name.toLowerCase().includes('kitting') || 
    r.path.toLowerCase().includes('kitting') ||
    r.name.toLowerCase().includes('kit') || 
    r.path.toLowerCase().includes('kit')
  );
  console.log(`\n=== Production/Kitting Requests (${productionRequests.length}) ===`);
  productionRequests.forEach(r => {
    console.log(`- [${r.method}] /${r.path} | Name: ${r.name}`);
  });
}

main().catch(console.error);
