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
    headers: { 
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({ email, password, location_key: locationKey })
  });
  const tokenData = await tokenRes.json();
  const token = tokenData?.data?.token?.jwt_token;
  if (!token) {
    console.error('❌ Authentication failed:', tokenData);
    return;
  }
  console.log('✅ Authenticated successfully.');

  // Test 1: Product Master
  console.log('\n--- Testing Product Master ---');
  try {
    const res = await fetch('https://api.easyecom.io/Products/GetProductMaster?custom_fields=1', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    const json = await res.json();
    console.log(`Product Master Status: ${res.status}`);
    const products = json?.data || [];
    console.log(`Number of products returned: ${products.length}`);
    if (products.length > 0) {
      console.log('Sample Product columns/headers:', Object.keys(products[0]));
      console.log('Sample Product data:', JSON.stringify(products[0], null, 2));
    } else {
      console.log('No product master data returned. Full response:', JSON.stringify(json, null, 2));
    }
  } catch (err) {
    console.error('Failed to fetch Product Master:', err);
  }

  // Test 2: Purchase Orders
  console.log('\n--- Testing Purchase Orders ---');
  try {
    const res = await fetch('https://api.easyecom.io/wms/V2/getPurchaseOrderDetails', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    const json = await res.json();
    console.log(`Purchase Orders Status: ${res.status}`);
    const poList = json?.data || [];
    console.log(`Number of POs returned: ${poList.length}`);
    if (poList.length > 0) {
      console.log('Sample PO columns/headers:', Object.keys(poList[0]));
      console.log('Sample PO data:', JSON.stringify(poList[0], null, 2));
    } else {
      console.log('No PO data returned. Full response:', JSON.stringify(json, null, 2));
    }
  } catch (err) {
    console.error('Failed to fetch Purchase Orders:', err);
  }

  // Test 3: Production Orders
  console.log('\n--- Testing Orders in 7-day chunks (Parallel) ---');
  try {
    const orderTypes = new Set<string>();
    let totalAllOrders = 0;
    let totalProductionOrders = 0;
    const numChunks = Math.ceil(365 / 7);

    const promises = Array.from({ length: numChunks }).map(async (_, i) => {
      const endDaysAgo = i * 7;
      const startDaysAgo = (i + 1) * 7;
      const endDateTime = new Date(Date.now() - endDaysAgo * 24 * 60 * 60 * 1000);
      const startDateTime = new Date(Date.now() - startDaysAgo * 24 * 60 * 60 * 1000);
      const endDate = endDateTime.toISOString().slice(0, 10) + ' 23:59:59';
      const startDate = startDateTime.toISOString().slice(0, 10) + ' 00:00:00';

      const url = `https://api.easyecom.io/orders/V2/getAllOrders?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&limit=100`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'x-api-key': apiKey,
            'Content-Type': 'application/json'
          }
        });
        const json = await res.json();
        const orders = json?.data?.orders || [];
        totalAllOrders += orders.length;

        for (const order of orders) {
          if (order.order_type_key) {
            orderTypes.add(order.order_type_key);
          }
        }
        
        const productionOrders = orders.filter((o: any) => o.order_type_key === 'productionorder');
        if (productionOrders.length > 0) {
          totalProductionOrders += productionOrders.length;
          console.log(`Found ${productionOrders.length} production orders in range ${startDate} to ${endDate}`);
        }
      } catch (err) {
        console.error(`Failed to fetch range ${startDate} to ${endDate}:`, (err as Error).message);
      }
    });

    await Promise.all(promises);

    console.log(`\nScan finished.`);
    console.log(`Total orders fetched: ${totalAllOrders}`);
    console.log(`Total production orders found: ${totalProductionOrders}`);
    console.log(`Distinct order_type_key values found:`, Array.from(orderTypes));
  } catch (err) {
    console.error('Failed to fetch orders in chunks:', err);
  }
}

main().catch(console.error);
