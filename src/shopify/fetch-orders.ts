import { config as loadEnv } from "dotenv";
import axios from "axios";
import { prisma } from "../prisma/client.js";
import { env } from "../config.js";

loadEnv();

const SHOPIFY_DOMAIN = env.SHOPIFY_DOMAIN;
const ACCESS_TOKEN = env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = env.SHOPIFY_API_VERSION;

const headers = {
  "X-Shopify-Access-Token": ACCESS_TOKEN,
  "Content-Type": "application/json",
};

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const links = linkHeader.split(",");
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function fetchOrdersPage(url: string): Promise<{ orders: any[]; nextUrl: string | null }> {
  const response = await axios.get(url, { headers });
  const nextUrl = parseNextLink(response.headers["link"]);
  return {
    orders: response.data.orders || [],
    nextUrl,
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
  const dateMinStr = dateMin.toISOString();

  let url: string | null = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/orders.json?limit=250&status=any&updated_at_min=${dateMinStr}`;
  let pageNumber = 1;
  let totalSaved = 0;

  console.log(`Starting Shopify Orders Ingestion from domain: ${SHOPIFY_DOMAIN} (Rolling past ${days} days since ${dateMinStr})`);

  while (url) {
    console.log(`Fetching page ${pageNumber}...`);
    try {
      const { orders, nextUrl } = await fetchOrdersPage(url);
      
      if (orders.length === 0) {
        console.log("No orders found on this page.");
        break;
      }

      console.log(`Received ${orders.length} orders. Processing and saving...`);

      for (const order of orders) {
        const orderData = {
          id: order.admin_graphql_api_id,
          shopifyOrderId: String(order.id),
          appId: order.app_id ? String(order.app_id) : null,
          browserIp: order.browser_ip ?? null,
          buyerAcceptsMarketing: order.buyer_accepts_marketing ?? null,
          cancelReason: order.cancel_reason ?? null,
          cancelledAt: order.cancelled_at ? new Date(order.cancelled_at) : null,
          cartToken: order.cart_token ?? null,
          checkoutId: order.checkout_id ? String(order.checkout_id) : null,
          checkoutToken: order.checkout_token ?? null,
          clientDetails: order.client_details ?? null,
          closedAt: order.closed_at ? new Date(order.closed_at) : null,
          company: order.company ?? null,
          confirmationNumber: order.confirmation_number ?? null,
          confirmed: order.confirmed ?? null,
          contactEmail: order.contact_email ?? null,
          createdAt: order.created_at ? new Date(order.created_at) : null,
          currency: order.currency ?? null,
          currentSubtotalPrice: order.current_subtotal_price ?? null,
          currentSubtotalPriceSet: order.current_subtotal_price_set ?? null,
          currentTotalAdditionalFeesSet: order.current_total_additional_fees_set ?? null,
          currentTotalDiscounts: order.current_total_discounts ?? null,
          currentTotalDiscountsSet: order.current_total_discounts_set ?? null,
          currentTotalDutiesSet: order.current_total_duties_set ?? null,
          currentTotalPrice: order.current_total_price ?? null,
          currentTotalPriceSet: order.current_total_price_set ?? null,
          currentTotalTax: order.current_total_tax ?? null,
          currentTotalTaxSet: order.current_total_tax_set ?? null,
          customerLocale: order.customer_locale ?? null,
          deviceId: order.device_id ? String(order.device_id) : null,
          discountCodes: order.discount_codes ?? null,
          dutiesIncluded: order.duties_included ?? null,
          email: order.email ?? null,
          estimatedTaxes: order.estimated_taxes ?? null,
          financialStatus: order.financial_status ?? null,
          fulfillmentStatus: order.fulfillment_status ?? null,
          landingSite: order.landing_site ?? null,
          landingSiteRef: order.landing_site_ref ?? null,
          locationId: order.location_id ? String(order.location_id) : null,
          merchantBusinessEntityId: order.merchant_business_entity_id ?? null,
          merchantOfRecordAppId: order.merchant_of_record_app_id ? String(order.merchant_of_record_app_id) : null,
          name: order.name ?? null,
          note: order.note ?? null,
          noteAttributes: order.note_attributes ?? null,
          number: order.number != null ? Number(order.number) : null,
          orderNumber: order.order_number != null ? Number(order.order_number) : null,
          orderStatusUrl: order.order_status_url ?? null,
          originalTotalAdditionalFeesSet: order.original_total_additional_fees_set ?? null,
          originalTotalDutiesSet: order.original_total_duties_set ?? null,
          paymentGatewayNames: order.payment_gateway_names ?? null,
          phone: order.phone ?? null,
          poNumber: order.po_number ?? null,
          presentmentCurrency: order.presentment_currency ?? null,
          processedAt: order.processed_at ? new Date(order.processed_at) : null,
          reference: order.reference ?? null,
          referringSite: order.referring_site ?? null,
          sourceIdentifier: order.source_identifier ?? null,
          sourceName: order.source_name ?? null,
          sourceUrl: order.source_url ?? null,
          subtotalPrice: order.subtotal_price ?? null,
          subtotalPriceSet: order.subtotal_price_set ?? null,
          tags: order.tags ?? null,
          taxExempt: order.tax_exempt ?? null,
          taxLines: order.tax_lines ?? null,
          taxesIncluded: order.taxes_included ?? null,
          test: order.test ?? null,
          token: order.token ?? null,
          totalCashRoundingPaymentAdjustmentSet: order.total_cash_rounding_payment_adjustment_set ?? null,
          totalCashRoundingRefundAdjustmentSet: order.total_cash_rounding_refund_adjustment_set ?? null,
          totalDiscounts: order.total_discounts ?? null,
          totalDiscountsSet: order.total_discounts_set ?? null,
          totalLineItemsPrice: order.total_line_items_price ?? null,
          totalLineItemsPriceSet: order.total_line_items_price_set ?? null,
          totalOutstanding: order.total_outstanding ?? null,
          totalPrice: order.total_price ?? null,
          totalPriceSet: order.total_price_set ?? null,
          totalShippingPriceSet: order.total_shipping_price_set ?? null,
          totalTax: order.total_tax ?? null,
          totalTaxSet: order.total_tax_set ?? null,
          totalTipReceived: order.total_tip_received ?? null,
          totalWeight: order.total_weight != null ? Number(order.total_weight) : null,
          updatedAt: order.updated_at ? new Date(order.updated_at) : null,
          userId: order.user_id ? String(order.user_id) : null,
          billingAddress: order.billing_address ?? null,
          customer: order.customer ?? null,
          discountApplications: order.discount_applications ?? null,
          fulfillments: order.fulfillments ?? null,
          paymentTerms: order.payment_terms ?? null,
          refunds: order.refunds ?? null,
          shippingAddress: order.shipping_address ?? null,
          shippingLines: order.shipping_lines ?? null,
          rawJson: order,
        };

        // Save order and its line items inside a Prisma transaction
        await prisma.$transaction(async (tx) => {
          await tx.shopifyOrder.upsert({
            where: { id: orderData.id },
            update: orderData,
            create: orderData,
          });

          // Process line items for the order
          if (order.line_items && Array.isArray(order.line_items)) {
            for (const item of order.line_items) {
              const lineItemData = {
                id: item.admin_graphql_api_id,
                shopifyLineItemId: String(item.id),
                orderId: orderData.id,
                attributedStaffs: item.attributed_staffs ?? null,
                currentQuantity: item.current_quantity != null ? Number(item.current_quantity) : null,
                fulfillableQuantity: item.fulfillable_quantity != null ? Number(item.fulfillable_quantity) : null,
                fulfillmentService: item.fulfillment_service ?? null,
                fulfillmentStatus: item.fulfillment_status ?? null,
                giftCard: item.gift_card ?? null,
                grams: item.grams != null ? Number(item.grams) : null,
                name: item.name ?? null,
                price: item.price ?? null,
                priceSet: item.price_set ?? null,
                productExists: item.product_exists ?? null,
                productId: item.product_id ? String(item.product_id) : null,
                properties: item.properties ?? null,
                quantity: item.quantity != null ? Number(item.quantity) : null,
                requiresShipping: item.requires_shipping ?? null,
                sku: item.sku ?? null,
                taxable: item.taxable ?? null,
                title: item.title ?? null,
                totalDiscount: item.total_discount ?? null,
                totalDiscountSet: item.total_discount_set ?? null,
                variantId: item.variant_id ? String(item.variant_id) : null,
                variantInventoryManagement: item.variant_inventory_management ?? null,
                variantTitle: item.variant_title ?? null,
                vendor: item.vendor ?? null,
                taxLines: item.tax_lines ?? null,
                duties: item.duties ?? null,
                discountAllocations: item.discount_allocations ?? null,
              };

              await tx.shopifyOrderLineItem.upsert({
                where: { id: lineItemData.id },
                update: lineItemData,
                create: lineItemData,
              });
            }
          }
        }, { timeout: 60000 });

        totalSaved++;
      }

      console.log(`Successfully page ${pageNumber} saved.`);

      if (limitPages && pageNumber >= limitPages) {
        console.log(`Reached page limit of ${limitPages}. Stopping.`);
        break;
      }

      url = nextUrl;
      pageNumber++;
    } catch (error: any) {
      console.error(`Failed to ingest orders page ${pageNumber}:`, error.response?.data || error.message);
      break;
    }
  }

  console.log(`Shopify Orders Ingestion finished. Saved ${totalSaved} orders.`);
}

main().catch((error) => {
  console.error("Execution failed:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
