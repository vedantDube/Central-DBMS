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

  console.log('--- PRODUCT MASTER (getmasterproduct) RESPONSE FIELDS ---');
  const getProduct = flatRequests.find(r => r.name.toLowerCase() === 'getmasterproduct');
  if (getProduct && getProduct.response && getProduct.response.length > 0) {
    const body = JSON.parse(getProduct.response[0].body);
    const firstProduct = body.data?.[0] || body.data || {};
    console.log(Object.keys(firstProduct));
  } else {
    console.log('No product master response example found.');
  }

  console.log('\n--- PURCHASE ORDER (getPurchaseOrderDetails) RESPONSE FIELDS ---');
  const getPO = flatRequests.find(r => r.name.toLowerCase() === 'getpurchaseorder');
  if (getPO && getPO.response && getPO.response.length > 0) {
    const body = JSON.parse(getPO.response[0].body);
    const firstPO = body.data?.[0] || body.data || {};
    console.log('PO Header Fields:', Object.keys(firstPO));
    if (firstPO.po_items && firstPO.po_items.length > 0) {
      console.log('PO Item Fields:', Object.keys(firstPO.po_items[0]));
    }
  } else {
    console.log('No PO response example found.');
  }

  console.log('\n--- PRODUCTION ORDER (Get All Orders with production filter) RESPONSE FIELDS ---');
  const getOrders = flatRequests.find(r => r.name.toLowerCase() === 'get all orders');
  if (getOrders && getOrders.response && getOrders.response.length > 0) {
    const body = JSON.parse(getOrders.response[0].body);
    const firstOrder = body.data?.orders?.[0] || {};
    console.log('Order Header Fields:', Object.keys(firstOrder));
    if (firstOrder.suborders && firstOrder.suborders.length > 0) {
      console.log('Order Suborder Item Fields:', Object.keys(firstOrder.suborders[0]));
    }
  } else {
    console.log('No order response example found.');
  }
}

main().catch(console.error);
