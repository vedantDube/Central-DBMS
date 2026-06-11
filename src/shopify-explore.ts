import axios from 'axios';

const SHOPIFY_DOMAIN = 'cubelelo-cube-store.myshopify.com';
const ACCESS_TOKEN = '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';
const API_VERSION = '2024-01';

const graphqlUrl = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
const headers = {
  'Content-Type': 'application/json',
  'X-Shopify-Access-Token': ACCESS_TOKEN,
};

async function fetchGraphQLSchema(typeName: string) {
  const query = `
    query IntrospectType($name: String!) {
      __type(name: $name) {
        name
        fields {
          name
          description
          type {
            name
            kind
            ofType {
              name
              kind
              ofType {
                name
                kind
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      graphqlUrl,
      { query, variables: { name: typeName } },
      { headers }
    );
    return response.data?.data?.__type;
  } catch (error: any) {
    console.error(`Error introspecting type ${typeName}:`, error.response?.data || error.message);
    return null;
  }
}

async function fetchSampleRestOrder() {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/orders.json?limit=1&status=any`;
  try {
    const response = await axios.get(url, { headers });
    return response.data?.orders?.[0] || null;
  } catch (error: any) {
    console.error('Error fetching sample REST order:', error.response?.data || error.message);
    return null;
  }
}

async function fetchSampleGraphQLReturns() {
  const query = `
    query {
      returns(first: 1) {
        edges {
          node {
            id
            name
            status
          }
        }
      }
    }
  `;
  try {
    const response = await axios.post(graphqlUrl, { query }, { headers });
    return response.data?.data?.returns?.edges || null;
  } catch (error: any) {
    console.error('Error fetching sample GraphQL returns:', error.response?.data || error.message);
    return null;
  }
}

async function main() {
  console.log('--- Fetching Sample REST Order Keys ---');
  const sampleOrder = await fetchSampleRestOrder();
  if (sampleOrder) {
    console.log('Order columns found:');
    const keys = Object.keys(sampleOrder);
    console.log(JSON.stringify(keys, null, 2));
    
    console.log('\n--- Line Item Keys ---');
    if (sampleOrder.line_items && sampleOrder.line_items.length > 0) {
      console.log(JSON.stringify(Object.keys(sampleOrder.line_items[0]), null, 2));
    }
  } else {
    console.log('No orders found or error occurred.');
  }

  console.log('\n--- Introspecting GraphQL "Return" Type ---');
  const returnType = await fetchGraphQLSchema('Return');
  if (returnType) {
    console.log(`Fields for ${returnType.name}:`);
    const fields = returnType.fields.map((f: any) => `${f.name} (${f.type.name || f.type.ofType?.name || 'unknown'}) - ${f.description || 'No description'}`);
    console.log(JSON.stringify(fields, null, 2));
  }

  console.log('\n--- Introspecting GraphQL "ReturnLineItem" Type ---');
  const returnLineItemType = await fetchGraphQLSchema('ReturnLineItem');
  if (returnLineItemType) {
    console.log(`Fields for ${returnLineItemType.name}:`);
    const fields = returnLineItemType.fields.map((f: any) => `${f.name} (${f.type.name || f.type.ofType?.name || 'unknown'}) - ${f.description || 'No description'}`);
    console.log(JSON.stringify(fields, null, 2));
  }

  console.log('\n--- Introspecting GraphQL "InventoryItem" Type ---');
  const inventoryItemType = await fetchGraphQLSchema('InventoryItem');
  if (inventoryItemType) {
    console.log(`Fields for ${inventoryItemType.name}:`);
    const fields = inventoryItemType.fields.map((f: any) => `${f.name} (${f.type.name || f.type.ofType?.name || 'unknown'}) - ${f.description || 'No description'}`);
    console.log(JSON.stringify(fields, null, 2));
  }

  console.log('\n--- Introspecting GraphQL "InventoryLevel" Type ---');
  const inventoryLevelType = await fetchGraphQLSchema('InventoryLevel');
  if (inventoryLevelType) {
    console.log(`Fields for ${inventoryLevelType.name}:`);
    const fields = inventoryLevelType.fields.map((f: any) => `${f.name} (${f.type.name || f.type.ofType?.name || 'unknown'}) - ${f.description || 'No description'}`);
    console.log(JSON.stringify(fields, null, 2));
  }

  console.log('\n--- Introspecting GraphQL "InventoryQuantity" Type ---');
  const inventoryQuantityType = await fetchGraphQLSchema('InventoryQuantity');
  if (inventoryQuantityType) {
    console.log(`Fields for ${inventoryQuantityType.name}:`);
    const fields = inventoryQuantityType.fields.map((f: any) => `${f.name} (${f.type.name || f.type.ofType?.name || 'unknown'}) - ${f.description || 'No description'}`);
    console.log(JSON.stringify(fields, null, 2));
  }

  console.log('\n--- Introspecting GraphQL "Refund" Type ---');
  const refundType = await fetchGraphQLSchema('Refund');
  if (refundType) {
    console.log(`Fields for ${refundType.name}:`);
    const fields = refundType.fields.map((f: any) => `${f.name} (${f.type.name || f.type.ofType?.name || 'unknown'}) - ${f.description || 'No description'}`);
    console.log(JSON.stringify(fields, null, 2));
  }

  console.log('\n--- Checking Sample Return ---');
  const sampleReturns = await fetchSampleGraphQLReturns();
  console.log('Sample Returns:', JSON.stringify(sampleReturns, null, 2));
}

main().catch(console.error);
