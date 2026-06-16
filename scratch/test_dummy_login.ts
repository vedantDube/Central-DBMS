import 'dotenv/config';

async function main() {
  const email = process.env.EASY_ECOM_EMAIL;
  const password = process.env.EASY_ECOM_PASSWORD;
  const locationKey = process.env.EASY_ECOM_LOCATION_KEY;
  const apiKey = process.env.EASY_ECOM_API_KEY;

  console.log('Sending login with x-api-key header...');
  const tokenRes = await fetch('https://api.easyecom.io/access/token', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-api-key': apiKey || ''
    },
    body: JSON.stringify({ email, password, location_key: locationKey })
  });
  const data = await tokenRes.json();
  console.log('Response Status:', tokenRes.status);
  console.log('Response Body:', data);
}

main().catch(console.error);
