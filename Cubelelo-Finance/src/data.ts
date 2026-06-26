import { ChannelFinancials, SKUProfitability, OrderReconciliation } from "./types";

const zeroChannel = (id: string, name: string, category: ChannelFinancials["category"]): ChannelFinancials => ({
  id, name, category,
  revenue: 0, cogs: 0, cm1: 0, indirectExpAndPeople: 0, advertisingSpend: 0,
  cm2: 0, interestTaxDA: 0, netProfit: 0,
  aov: 0, ordersPerDay: 0, listingsCount: 0, activeListingCount: 0, revenuePerSku: 0,
  outOfStockDays: 0, ageingInventoryPct: 0, deadStockPct: 0,
  returnPct: 0, claimPct: 0, reimbursementPct: 0,
  totalSkus: 0, skusBenchmark: 0,
  lastUpdated: new Date().toISOString(),
});

export const initialChannelsData: ChannelFinancials[] = [
  zeroChannel("amazon", "Amazon", "Marketplace"),
  zeroChannel("flipkart", "Flipkart", "Marketplace"),
  zeroChannel("shopify", "Shopify (D2C Website)", "Marketplace"),
  zeroChannel("firstcry", "FirstCry", "Marketplace"),
  zeroChannel("meesho", "Meesho", "Marketplace"),
  zeroChannel("blinkit", "Blinkit", "Quick Commerce"),
  zeroChannel("zepto", "Zepto", "Quick Commerce"),
  zeroChannel("instamart", "Swiggy Instamart (IM)", "Quick Commerce"),
  zeroChannel("bbnow", "BigBasket NOW (BB Now)", "Quick Commerce"),
  zeroChannel("fkmins", "Flipkart Minutes (FK Mins)", "Quick Commerce"),
  zeroChannel("snapdeal", "Snapdeal", "Marketplace"),
  zeroChannel("snooplay", "Snooplay", "Specialty"),
  zeroChannel("hamleys", "Hamleys (B2B/Retail)", "Offline"),
  zeroChannel("starmark", "Starmark (Retail Chains)", "Offline"),
  zeroChannel("whole9yards", "Whole9Yards (Partner Retail)", "Offline"),
  zeroChannel("b2bsales", "Offline B2B (Bulk/Distributors)", "Offline"),
  zeroChannel("events", "Event & Exhibition Sales", "Offline"),
];

export const initialSKUProfitability: SKUProfitability[] = [];

export const initialOrderReconciliation: OrderReconciliation[] = [];
