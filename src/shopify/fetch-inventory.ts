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
query GetInventoryItems($cursor: String) {
  inventoryItems(first: 250, after: $cursor) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        legacyResourceId
        sku
        unitCost {
          amount
        }
        tracked
        requiresShipping
        createdAt
        updatedAt
        variant {
          id
        }
        countryCodeOfOrigin
        countryHarmonizedSystemCodes(first: 5) {
          edges {
            node {
              harmonizedSystemCode
            }
          }
        }
        duplicateSkuCount
        harmonizedSystemCode
        inventoryHistoryUrl
        locationsCount {
          count
        }
        measurement {
          weight {
            value
            unit
          }
        }
        provinceCodeOfOrigin
        trackedEditable {
          locked
        }
        inventoryLevels(first: 100) {
          edges {
            node {
              id
              createdAt
              updatedAt
              canDeactivate
              deactivationAlert
              location {
                id
              }
              quantities(
                names: [
                  "available"
                  "on_hand"
                  "committed"
                  "reserved"
                ]
              ) {
                name
                quantity
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
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function fetchInventoryPage(cursor: string | null) {
  const response = await axios.post(
    graphqlUrl,
    {
      query,
      variables: { cursor },
    },
    { headers }
  );

  if (response.data?.errors) {
    throw new Error(JSON.stringify(response.data.errors));
  }

  const connection = response.data.data.inventoryItems;

  return {
    items: connection.edges.map((e: any) => e.node),
    hasNextPage: connection.pageInfo.hasNextPage,
    endCursor: connection.pageInfo.endCursor,
  };
}

async function saveInventoryItem(item: any, dateStr: string, snapshotType: string) {
  const itemData = {
    id: item.id,
    legacyResourceId: item.legacyResourceId
      ? String(item.legacyResourceId)
      : null,
    sku: item.sku ?? null,
    unitCost: item.unitCost?.amount ?? null,
    tracked: item.tracked ?? null,
    requiresShipping: item.requiresShipping ?? null,
    createdAt: item.createdAt ? new Date(item.createdAt) : null,
    updatedAt: item.updatedAt ? new Date(item.updatedAt) : null,
    variantId: item.variant?.id ?? null,
    countryCodeOfOrigin: item.countryCodeOfOrigin ?? null,
    countryHarmonizedSystemCodes:
      item.countryHarmonizedSystemCodes ?? null,
    duplicateSkuCount:
      item.duplicateSkuCount != null
        ? Number(item.duplicateSkuCount)
        : null,
    harmonizedSystemCode: item.harmonizedSystemCode ?? null,
    inventoryHistoryUrl: item.inventoryHistoryUrl ?? null,
    locationsCount:
      item.locationsCount?.count != null
        ? Number(item.locationsCount.count)
        : null,
    measurement: item.measurement ?? null,
    provinceCodeOfOrigin: item.provinceCodeOfOrigin ?? null,
    trackedEditable: item.trackedEditable ?? null,
  };

  await prisma.shopifyInventoryItem.upsert({
    where: {
      id: itemData.id,
    },
    update: itemData,
    create: itemData,
  });

  const levels = item.inventoryLevels?.edges ?? [];

  await Promise.all(
    levels.map(async (edge: any) => {
      const lvl = edge.node;

      let availableQty: number | null = null;
      let onHandQty: number | null = null;
      let committedQty: number | null = null;
      let reservedQty: number | null = null;

      for (const q of lvl.quantities || []) {
        if (q.name === "available") availableQty = q.quantity;
        else if (q.name === "on_hand") onHandQty = q.quantity;
        else if (q.name === "committed") committedQty = q.quantity;
        else if (q.name === "reserved") reservedQty = q.quantity;
      }

      const locationId = lvl.location?.id ?? "";

      await prisma.shopifyInventoryLevel.upsert({
        where: {
          date_snapshotType_inventoryItemId_locationId: {
            date: dateStr,
            snapshotType,
            inventoryItemId: item.id,
            locationId,
          },
        },
        update: {
          shopifyLevelId: lvl.id,
          inventoryItemId: item.id,
          date: dateStr,
          snapshotType,
          createdAt: lvl.createdAt
            ? new Date(lvl.createdAt)
            : null,
          updatedAt: lvl.updatedAt
            ? new Date(lvl.updatedAt)
            : null,
          locationId,
          locationName: null,
          canDeactivate: lvl.canDeactivate ?? null,
          deactivationAlert: lvl.deactivationAlert ?? null,
          availableQty,
          onHandQty,
          committedQty,
          reservedQty,
          rawJson: lvl,
        },
        create: {
          shopifyLevelId: lvl.id,
          inventoryItemId: item.id,
          date: dateStr,
          snapshotType,
          createdAt: lvl.createdAt
            ? new Date(lvl.createdAt)
            : null,
          updatedAt: lvl.updatedAt
            ? new Date(lvl.updatedAt)
            : null,
          locationId,
          locationName: null,
          canDeactivate: lvl.canDeactivate ?? null,
          deactivationAlert: lvl.deactivationAlert ?? null,
          availableQty,
          onHandQty,
          committedQty,
          reservedQty,
          rawJson: lvl,
        },
      });
    })
  );
}

async function main() {
  const snapshotTypeInput = getArgValue("--snapshot");

  if (
    snapshotTypeInput !== "Opening" &&
    snapshotTypeInput !== "Closing"
  ) {
    console.error(
      "Use --snapshot Opening or --snapshot Closing"
    );
    process.exit(1);
  }

  const snapshotType = snapshotTypeInput;

  const dateStr = new Date().toISOString().slice(0, 10);

  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 1;
  let totalSaved = 0;

  console.log(
    `Starting inventory sync (${snapshotType})`
  );

  while (hasNextPage) {
    console.log(`Fetching page ${page}`);

    const result = await fetchInventoryPage(cursor);

    const items = result.items;

    if (!items.length) {
      break;
    }

    console.log(
      `Received ${items.length} inventory items`
    );

    const CHUNK_SIZE = 25;

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);

      await Promise.all(
        chunk.map((item) =>
          saveInventoryItem(
            item,
            dateStr,
            snapshotType
          )
        )
      );
    }

    totalSaved += items.length;

    console.log(
      `Page ${page} completed. Total saved: ${totalSaved}`
    );

    hasNextPage = result.hasNextPage;
    cursor = result.endCursor;
    page++;
  }

  console.log(
    `Inventory sync complete. Total items processed: ${totalSaved}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});