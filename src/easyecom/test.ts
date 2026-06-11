async function test() {
  const email = "jainendra@cubelelo.com";
  const password = "9XkVgv5pL#s6T2Y";
  const apiKey = "f68694e1bdeba69581d0d302ac07cea420b4c061";
  const locationKey = "en27701274969";
  
  // Try login
  const res = await fetch('https://api.easyecom.io/access/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, location_key: locationKey })
  });
  
  const data = await res.json();
  console.log('Login Response:', data);
  
  if (data.data?.token?.jwt_token) {
    const token = data.data.token.jwt_token;
    
    // Test Inventory
    const invRes = await fetch('https://api.easyecom.io/getInventoryDetails', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    const invText = await invRes.text();
    console.log('Inventory Response (text):', invText.substring(0, 500));
  }
}

test().catch(console.error);
