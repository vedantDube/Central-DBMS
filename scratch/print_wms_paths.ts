import fs from 'node:fs/promises';

interface PostmanItem {
  name: string;
  request?: any;
  item?: PostmanItem[];
}

function traverse(items: PostmanItem[], results: any[] = []) {
  for (const item of items) {
    if (item.request) {
      const urlObj = item.request.url;
      let pathStr = '';
      if (urlObj) {
        if (typeof urlObj === 'string') {
          pathStr = urlObj;
        } else if (urlObj.path) {
          pathStr = '/' + urlObj.path.join('/');
        } else if (urlObj.raw) {
          pathStr = urlObj.raw;
        }
      }
      results.push({
        name: item.name,
        method: item.request.method,
        path: pathStr,
        request: item.request
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

  const targets = ['getmasterproduct', 'Get Master Product', 'getPurchaseOrder', 'Production Order', 'Get Kit', 'CreatePurchaseOrder', 'Create Master Product'];
  
  const filtered = flatRequests.filter(r => targets.includes(r.name) || targets.some(t => r.name.toLowerCase().includes(t.toLowerCase())));

  for (const item of filtered) {
    console.log(`\nName: ${item.name}`);
    console.log(`Method: ${item.method}`);
    console.log(`Path/URL: ${item.path}`);
    console.log(`Query parameters:`, item.request.url?.query || []);
    if (item.request.body) {
      console.log(`Body Mode: ${item.request.body.mode}`);
      if (item.request.body.raw) {
        try {
          // Pretty print JSON body if possible
          console.log(`Body Raw:`, JSON.parse(item.request.body.raw));
        } catch {
          console.log(`Body Raw:`, item.request.body.raw);
        }
      }
    }
  }
}

main().catch(console.error);
