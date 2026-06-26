import fs from 'node:fs/promises';
import path from 'node:path';

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
        path: Array.isArray(item.request.url?.path) 
          ? item.request.url.path.join('/') 
          : (typeof item.request.url === 'string' ? item.request.url : ''),
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
  const collectionPath = path.join(process.cwd(), 'EasyEcom API Document.postman_collection.json');
  try {
    const data = JSON.parse(await fs.readFile(collectionPath, 'utf8'));
    const collectionItems = data.collection?.item || data.item || [];
    const flatRequests = traverse(collectionItems);

    console.log(`=== Total Requests Found in Collection: ${flatRequests.length} ===\n`);

    // Let's print the first 100 requests to get a list
    flatRequests.forEach((r, idx) => {
      console.log(`${idx + 1}. [${r.method}] /${r.path} | Name: ${r.name}`);
    });
  } catch (err) {
    console.error('Error reading collection:', err);
  }
}

main().catch(console.error);
