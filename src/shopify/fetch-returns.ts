import { config as loadEnv } from "dotenv";
import axios from "axios";
import { prisma } from "../prisma/client.js";
import { env } from "../config.js";

loadEnv();

const SHOPIFY_DOMAIN = env.SHOPIFY_DOMAIN;
const ACCESS_TOKEN = env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = env.SHOPIFY_API_VERSION;

const graphqlUrl = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
const headers = {
  "X-Shopify-Access-Token": ACCESS_TOKEN,
  "Content-Type": "application/json",
};

const query = `
  query GetOrderReturns($cursor: String, $query: String) {
    orders(first: 250, after: $cursor, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          returns(first: 5) {
            edges {
              node {
                id
                name
                status
                createdAt
                closedAt
                requestApprovedAt
                totalQuantity
                order {
                  id
                }
                decline {
                  reason
                  note
                }
                refunds(first: 5) {
                  edges {
                    node {
                      id
                    }
                  }
                }
                returnShippingFees {
                  id
                }
                reverseFulfillmentOrders(first: 5) {
                  edges {
                    node {
                      id
                    }
                  }
                }
                returnLineItems(first: 50) {
                  edges {
                    node {
                      id
                      customerNote
                      processableQuantity
                      processedQuantity
                      quantity
                      refundableQuantity
                      refundedQuantity
                      returnReason
                      returnReasonNote
                      unprocessedQuantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function fetchOrdersWithReturnsPage(cursor: string | null, filterQuery: string | null): Promise<{ orders: any[]; hasNextPage: boolean; endCursor: string | null }> {
  const response = await axios.post(graphqlUrl, { query, variables: { cursor, query: filterQuery } }, { headers });
  
  if (response.data?.errors) {
    throw new Error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
  }

  const ordersConnection = response.data?.data?.orders;
  const edges = ordersConnection?.edges || [];
  const orders = edges.map((edge: any) => edge.node);
  const pageInfo = ordersConnection?.pageInfo || { hasNextPage: false, endCursor: null };

  return {
    orders,
    hasNextPage: pageInfo.hasNextPage,
    endCursor: pageInfo.endCursor,
  };
}

async function main() {
  const limitPagesStr = getArgValue("--limit-pages");
  const limitPages = limitPagesStr ? parseInt(limitPagesStr, 10) : undefined;

  // Set default to 30 days rolling data
  const daysStr = getArgValue("--days");
  const days = daysStr ? parseInt(daysStr, 10) : 60;

  const dateMin = new Date();
  dateMin.setDate(dateMin.getDate() - days);
  // Format: YYYY-MM-DD
  const dateMinStr = dateMin.toISOString().slice(0, 10);
  const filterQuery = `updated_at:>=${dateMinStr} AND (return_status:returned OR return_status:in_progress OR return_status:return_requested)`;

  let cursor: string | null = null;
  let hasNextPage = true;
  let pageNumber = 1;
  let totalSaved = 0;

  console.log(`Starting Shopify Returns Ingestion (via Orders) from domain: ${SHOPIFY_DOMAIN} (Rolling past ${days} days since ${dateMinStr})`);

  while (hasNextPage) {
    console.log(`Fetching page ${pageNumber}...`);
    try {
      const result = await fetchOrdersWithReturnsPage(cursor, filterQuery);
      const orders = result.orders;

      if (orders.length === 0) {
        console.log("No orders found on this page.");
        break;
      }

      console.log(`Received ${orders.length} orders. Checking for associated returns...`);

      for (const order of orders) {
        const returns = order.returns?.edges?.map((e: any) => e.node) || [];
        
        for (const ret of returns) {
          console.log(`Processing return ${ret.name} (${ret.id})...`);
          
          const returnData = {
            id: ret.id,
            name: ret.name ?? null,
            status: ret.status ?? null,
            createdAt: ret.createdAt ? new Date(ret.createdAt) : null,
            closedAt: ret.closedAt ? new Date(ret.closedAt) : null,
            requestApprovedAt: ret.requestApprovedAt ? new Date(ret.requestApprovedAt) : null,
            totalQuantity: ret.totalQuantity != null ? Number(ret.totalQuantity) : null,
            orderId: ret.order?.id ?? null,
            declineReason: ret.decline?.reason ?? null,
            declineNote: ret.decline?.note ?? null,
            refunds: ret.refunds ?? null,
            returnShippingFees: ret.returnShippingFees ?? null,
            reverseFulfillmentOrders: ret.reverseFulfillmentOrders ?? null,
            suggestedFinancialOutcome: ret.suggestedFinancialOutcome ?? null,
            rawJson: ret,
          };

          // Save return and its line items inside a transaction
          await prisma.$transaction(async (tx) => {
            await tx.shopifyReturn.upsert({
              where: { id: returnData.id },
              update: returnData,
              create: returnData,
            });

            if (ret.returnLineItems?.edges) {
              const lineItems = ret.returnLineItems.edges.map((e: any) => e.node);
              for (const item of lineItems) {
                 const lineItemData = {
                  id: item.id,
                  returnId: returnData.id,
                  customerNote: item.customerNote ?? null,
                  fulfillmentLineItem: null,
                  processableQuantity: item.processableQuantity != null ? Number(item.processableQuantity) : null,
                  processedQuantity: item.processedQuantity != null ? Number(item.processedQuantity) : null,
                  quantity: item.quantity != null ? Number(item.quantity) : null,
                  refundableQuantity: item.refundableQuantity != null ? Number(item.refundableQuantity) : null,
                  refundedQuantity: item.refundedQuantity != null ? Number(item.refundedQuantity) : null,
                  restockingFee: null,
                  returnReason: item.returnReason ?? null,
                  returnReasonNote: item.returnReasonNote ?? null,
                  totalWeight: null,
                  unprocessedQuantity: item.unprocessedQuantity != null ? Number(item.unprocessedQuantity) : null,
                  withCodeDiscountedTotalPriceSet: null,
                };

                await tx.shopifyReturnLineItem.upsert({
                  where: { id: lineItemData.id },
                  update: lineItemData,
                  create: lineItemData,
                });
              }
            }
          }, { timeout: 60000 });

          totalSaved++;
        }
      }

      console.log(`Successfully page ${pageNumber} saved.`);

      if (limitPages && pageNumber >= limitPages) {
        console.log(`Reached page limit of ${limitPages}. Stopping.`);
        break;
      }

      hasNextPage = result.hasNextPage;
      cursor = result.endCursor;
      pageNumber++;
    } catch (error: any) {
      console.error(`Failed to ingest returns page ${pageNumber}:`, error.message);
      break;
    }
  }

  console.log(`Shopify Returns Ingestion finished. Saved ${totalSaved} returns.`);
}

main().catch((error) => {
  console.error("Execution failed:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
