import fs from 'node:fs/promises';

async function main() {
  console.log('Fetching Postman Collection...');
  const res = await fetch('https://api-docs.easyecom.io/api/collections/20795951/2s93ecupH6?segregateAuth=true&versionTag=latest');
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  await fs.writeFile('scratch/easyecom_collection.json', JSON.stringify(json, null, 2));
  console.log('Saved Postman Collection to scratch/easyecom_collection.json');
}

main().catch(console.error);
