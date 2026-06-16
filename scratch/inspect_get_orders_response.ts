import fs from 'node:fs/promises';

interface PostmanItem {
  name: string;
  request?: any;
  response?: any[];
  item?: PostmanItem[];
}

function traverse(items: PostmanItem[], results: any[] = []) {
  for (const item of items) {
    if (item.name === 'Get All Orders') {
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
  const matches = traverse(collectionItems);

  console.log(`Found ${matches.length} matches.`);
  for (const match of matches) {
    if (match.response && match.response.length > 0) {
      console.log(`Example Response for ${match.name}:`);
      console.log(match.response[0].body?.substring(0, 1000));
    }
  }
}

main().catch(console.error);
