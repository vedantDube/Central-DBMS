export interface ChannelFinancials {
  id: string;
  name: string;
  category: "Marketplace" | "Quick Commerce" | "Offline" | "Specialty" | "Custom";
  
  // High-level Metrics (User Spreadsheet rows)
  revenue: number;
  cogs: number;
  cm1: number; // Contribution Margin 1
  indirectExpAndPeople: number;
  advertisingSpend: number; // For EBITDA math
  cm2: number; // EBITDA
  interestTaxDA: number;
  netProfit: number;

  // Efficiency KPIs (User Spreadsheet rows)
  aov: number; // Average Order Value
  ordersPerDay: number;
  listingsCount: number;
  activeListingCount: number;
  revenuePerSku: number;

  // Operational Metrics (User Spreadsheet rows)
  outOfStockDays: number;
  ageingInventoryPct: number;
  deadStockPct: number;
  returnPct: number;
  claimPct: number;
  reimbursementPct: number;

  // Catalogue Performance (User Spreadsheet rows)
  totalSkus: number;
  skusBenchmark: number;
  
  // Custom metadata
  lastUpdated: string;
}

export interface SKUProfitability {
  sku: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: number;
  landingCost: number; // COGS base
  marketplaceFees: number; // referral fee + handling fee + closing fee etc.
  packagingCost: number;
  shippingCost: number;
  returnLoss: number; // average return penalty & claims shortfall
  adsSpend: number; // performance ads allocated
  netProfit: number;
  contributionMargin1: number; // Revenue - COGS - Marketplace fees - shipping - packaging
  contributionMargin2: number; // CM1 - Ads
  status: "Profitable" | "Borderline" | "Loss Making";
}

export interface OrderReconciliation {
  orderId: string;
  sku: string;
  platform: "Amazon" | "Flipkart";
  dateTime: string;
  customerPaid: number; // Product Price + Cust Shipping
  referralFeeCharged: number;
  weightHandlingFeeCharged: number;
  closingFeeCharged: number;
  otherCharges: number;
  netDisbursedEstimated: number; // Math according to contract rules
  netDisbursedActual: number; // Disbursed per standard settlement
  cogs: number; // base inventory cost
  reconciliationDifference: number; // discrepancy
  status: "Fully Reconciled" | "Overcharged (Weight)" | "Overcharged (Referral)" | "Settlement Discrepancy" | "Returned & Unreimbursed";
  claimRef?: string;
  claimStatus: "Unclaimed" | "In Process" | "Refunded" | "Rejected";
  estimatedOverchargeAmount: number;
}

export interface SimulationParams {
  indirectExpenseMultiplier: number; // e.g. 1.0 (100%)
  landingCostMultiplier: number;     // e.g. 1.0
  shippingCostMultiplier: number;    // e.g. 1.0
  adsSpendMultiplier: number;        // e.g. 1.0
}
