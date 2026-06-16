import 'dotenv/config';

let email = process.env.EASY_ECOM_EMAIL;
let password = process.env.EASY_ECOM_PASSWORD;
let apiKey = process.env.EASY_ECOM_API_KEY;
let locationKey = process.env.EASY_ECOM_LOCATION_KEY;

if (password && password.startsWith('"') && password.endsWith('"')) {
  password = password.slice(1, -1);
}

async function tryLogin(pw: string) {
  console.log(`Trying login with password: ${pw}`);
  const tokenRes = await fetch('https://api.easyecom.io/access/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw, location_key: locationKey })
  });
  const data = await tokenRes.json();
  console.log('Response:', data);
  return data?.data?.token?.jwt_token;
}

async function main() {
  console.log(`Original password from env: ${process.env.EASY_ECOM_PASSWORD}`);
  console.log(`Stripped password: ${password}`);

  let token = await tryLogin(password);
  if (!token && process.env.EASY_ECOM_PASSWORD) {
    token = await tryLogin(process.env.EASY_ECOM_PASSWORD);
  }
}

main().catch(console.error);
