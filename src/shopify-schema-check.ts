import axios from 'axios';

const SHOPIFY_DOMAIN = 'cubelelo-cube-store.myshopify.com';
const ACCESS_TOKEN = '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';
const API_VERSION = '2024-01';

const graphqlUrl = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
const headers = {
  'Content-Type': 'application/json',
  'X-Shopify-Access-Token': ACCESS_TOKEN,
};

async function main() {
  const query = `
    {
      orders(first: 10, query: "updated_at:>=2025-06-01 AND (return_status:returned OR return_status:in_progress OR return_status:return_requested)") {
        edges {
          node {
            id
            name
            updatedAt
            returns(first: 5) {
              edges {
                node {
                  id
                  name
                  status
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(graphqlUrl, { query }, { headers });
    const orders = response.data?.data?.orders?.edges || [];
    console.log('Filtered Orders with returns:', JSON.stringify(orders, null, 2));
  } catch (error: any) {
    console.error('Error:', error.response?.data || error.message);
  }
}

main();
