import 'dotenv/config';

const email = process.env.EASY_ECOM_EMAIL;
const password = process.env.EASY_ECOM_PASSWORD;
const apiKey = process.env.EASY_ECOM_API_KEY;
const locationKey = process.env.EASY_ECOM_LOCATION_KEY;

const candidateEndpoints = [
  // Product Master Candidates
  'getProducts',
  'getProductsDetails',
  'getProductsDetailsV2',
  'getProductsDetailsV3',
  'getAllProducts',
  'products',
  'product',
  'getMasterProducts',
  'getProductsMaster',
  
  // Purchase Order Candidates
  'getPurchaseOrders',
  'getPurchaseOrdersV3',
  'getPurchaseOrdersDetails',
  'getAllPurchaseOrders',
  'getBuyOrders',
  'getBuyOrderDetails',
  'purchaseOrders',
  'buyOrders',
  'getPurchaseOrderDetails',
  
  // Production Order Candidates
  'getProductionOrders',
  'getProductionOrdersV3',
  'getProductionOrdersDetails',
  'getAllProductionOrders',
  'productionOrders',
  'kitting',
  'getKittingDetails',
  'getKitting'
];

async function main() {
  if (!email || !password || !apiKey || !locationKey) {
    console.error('❌ Missing EASY_ECOM credentials in .env');
    return;
  }

  console.log('Authenticating...');
  const tokenRes = await fetch('https://api.easyecom.io/access/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, location_key: locationKey })
  });
  const tokenData = await tokenRes.json();
  const token = tokenData?.data?.token?.jwt_token;
  if (!token) {
    console.error('❌ Authentication failed:', tokenData);
    return;
  }
  console.log('✅ Authenticated successfully.');

  for (const endpoint of candidateEndpoints) {
    // Try GET
    const getUrl = `https://api.easyecom.io/${endpoint}?page=1&limit=5`;
    try {
      const res = await fetch(getUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      });
      const text = await res.text();
      console.log(`[GET] /${endpoint} -> HTTP ${res.status} | Length: ${text.length}`);
      if (res.status === 200) {
        console.log(`Response preview: ${text.substring(0, 300)}`);
      }
    } catch (err) {
      console.error(`[GET] /${endpoint} failed with error:`, (err as Error).message);
    }

    // Try POST
    const postUrl = `https://api.easyecom.io/${endpoint}`;
    try {
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      const text = await res.text();
      console.log(`[POST] /${endpoint} -> HTTP ${res.status} | Length: ${text.length}`);
      if (res.status === 200) {
        console.log(`Response preview: ${text.substring(0, 300)}`);
      }
    } catch (err) {
      console.error(`[POST] /${endpoint} failed with error:`, (err as Error).message);
    }
  }
}

main().catch(console.error);
