import 'dotenv/config';

const email = process.env.EASY_ECOM_EMAIL;
const password = process.env.EASY_ECOM_PASSWORD;
const apiKey = process.env.EASY_ECOM_API_KEY;
const locationKey = process.env.EASY_ECOM_LOCATION_KEY;

const candidates = [
  // V3 suffix
  'getmasterproductV3',
  'getMasterProductV3',
  'getmasterproductsV3',
  'getMasterProductsV3',
  
  // v3/ prefix
  'v3/getmasterproduct',
  'v3/getMasterProduct',
  'v3/getmasterproducts',
  'v3/getMasterProducts',
  'v3/getProducts',
  'v3/products',
  
  // Purchase orders V3
  'getPurchaseOrdersV3',
  'getpurchaseordersV3',
  'v3/getPurchaseOrders',
  'v3/getpurchaseorders',
  'v3/getBuyOrders',
  'v3/getbuyorders',
  
  // Production orders V3
  'getProductionOrdersV3',
  'getproductionordersV3',
  'v3/getProductionOrders',
  'v3/getproductionorders',
  'v3/getKitting',
  'v3/getkitting'
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

  for (const endpoint of candidates) {
    const getUrl = `https://api.easyecom.io/${endpoint}`;
    try {
      const res = await fetch(getUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      });
      console.log(`[GET] /${endpoint} -> HTTP ${res.status}`);
      if (res.status === 200) {
        const text = await res.text();
        console.log(`Response preview for /${endpoint}: ${text.substring(0, 300)}`);
      }
    } catch (err) {
      console.error(`[GET] /${endpoint} failed with error:`, (err as Error).message);
    }
  }
}

main().catch(console.error);
