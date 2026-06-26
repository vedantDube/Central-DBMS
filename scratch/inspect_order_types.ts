import 'dotenv/config';

const email = process.env.EASY_ECOM_EMAIL;
const password = process.env.EASY_ECOM_PASSWORD;
const apiKey = process.env.EASY_ECOM_API_KEY;
const locationKey = process.env.EASY_ECOM_LOCATION_KEY;

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
  const tokenData = await tokenRes.json() as any;
  const token = tokenData?.data?.token?.jwt_token;
  if (!token) {
    console.error('❌ Authentication failed:', tokenData);
    return;
  }
  console.log('✅ Authenticated successfully.');

  const url = `https://api.easyecom.io/orders/V2/getAllOrders?limit=100`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });

  const json = await res.json() as any;
  const orders = json?.data?.orders || [];
  console.log(`Fetched ${orders.length} orders.`);
  
  const typeKeys = new Set();
  const types = new Set();
  const sampleMap: Record<string, any> = {};

  for (const o of orders) {
    typeKeys.add(o.order_type_key);
    types.add(o.order_type);
    if (!sampleMap[o.order_type_key]) {
      sampleMap[o.order_type_key] = {
        order_type_key: o.order_type_key,
        order_type: o.order_type,
        reference_code: o.reference_code,
        invoice_number: o.invoice_number,
        order_status: o.order_status,
      };
    }
  }

  console.log("Unique order_type_key values in the page:");
  console.log(Array.from(typeKeys));
  console.log("Unique order_type values in the page:");
  console.log(Array.from(types));
  console.log("Sample records per type:", JSON.stringify(sampleMap, null, 2));
}

main().catch(console.error);
