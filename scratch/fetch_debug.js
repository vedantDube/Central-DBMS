import 'dotenv/config';
(async () => {
  const email = process.env.EASY_ECOM_EMAIL;
  const password = process.env.EASY_ECOM_PASSWORD;
  const locationKey = process.env.EASY_ECOM_LOCATION_KEY;
  if (!email || !password || !locationKey) {
    console.error('Missing env vars');
    return;
  }
  const tokenRes = await fetch('https://api.easyecom.io/access/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, location_key: locationKey })
  });
  const tokenData = await tokenRes.json();
  const token = tokenData?.data?.token?.jwt_token;
  const apiKey = process.env.EASY_ECOM_API_KEY;
  const url = `https://api.easyecom.io/getInventoryDetailsV3?includeLocations=0&page=1&limit=150`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'x-api-key': apiKey }
  });
  const json = await res.json();
  console.log('Response JSON:', JSON.stringify(json, null, 2));
})();
