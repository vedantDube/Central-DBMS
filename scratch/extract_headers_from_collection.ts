import fs from 'node:fs/promises';

interface PostmanItem {
  name: string;
  request?: any;
  response?: any[];
  item?: PostmanItem[];
}

function traverse(items: PostmanItem[], results: PostmanItem[] = []) {
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

  const targetNames = [
    'getmasterproduct', 
    'Get Master Product',
    'getPurchaseOrder', 
    'Get Purchase Order',
    'Production Order', 
    'Get All Orders'
  ];

  for (const name of targetNames) {
    const matches = flatRequests.filter(r => r.name.toLowerCase() === name.toLowerCase());
    console.log(`\n===========================================`);
    console.log(`API NAME: ${name} (Matches: ${matches.length})`);
    console.log(`===========================================`);

    for (const match of matches) {
      console.log(`Method: ${match.request?.method}`);
      console.log(`URL: ${match.request?.url?.raw || JSON.stringify(match.request?.url)}`);
      
      const responses = match.response || [];
      console.log(`Examples found: ${responses.length}`);
      
      for (let i = 0; i < responses.length; i++) {
        const resp = responses[i];
        console.log(`\n--- Example ${i + 1} (${resp.name}) ---`);
        if (resp.body) {
          try {
            const bodyObj = JSON.parse(resp.body);
            console.log("Response JSON Schema Keys:");
            printKeys(bodyObj);
          } catch {
            console.log("Raw Response body preview:", resp.body.substring(0, 300));
          }
        }
      }
    }
  }
}

function printKeys(obj: any, prefix = '') {
  if (Array.isArray(obj)) {
    console.log(`${prefix}[] (Array)`);
    if (obj.length > 0) {
      printKeys(obj[0], prefix + '  ');
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (Array.isArray(val)) {
        console.log(`${prefix}- ${key} : Array[${val.length}]`);
        if (val.length > 0) {
          printKeys(val[0], prefix + '    ');
        }
      } else if (typeof val === 'object' && val !== null) {
        console.log(`${prefix}- ${key} : Object`);
        printKeys(val, prefix + '    ');
      } else {
        console.log(`${prefix}- ${key} : ${typeof val} (${val})`);
      }
    }
  } else {
    console.log(`${prefix}${typeof obj} (${obj})`);
  }
}

main().catch(console.error);
