import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  DollarSign,
  TrendingDown,
  ShoppingBag,
  Layers,
  Percent,
  RefreshCw,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  ChevronRight,
  Sparkles,
  Send,
  HelpCircle,
  PlusCircle,
  Download,
  CheckSquare,
  Building,
  FileCheck2,
  ArrowUpRight,
  Briefcase,
  Database,
  Menu,
  X,
  Moon,
  Sun
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { 
  initialChannelsData, 
  initialSKUProfitability, 
  initialOrderReconciliation 
} from "./data";
import { 
  ChannelFinancials, 
  SKUProfitability, 
  OrderReconciliation, 
  SimulationParams 
} from "./types";

export default function App() {
  // Tabs: "consolidated" | "channels" | "skus" | "reconciliation" | "configurer"
  const [activeTab, setActiveTab] = useState<string>("channels");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  
  // Channels Data state
  const [channels, setChannels] = useState<ChannelFinancials[]>(initialChannelsData);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("amazon");
  
  // SKU Data state
  const [skus, setSkus] = useState<SKUProfitability[]>(initialSKUProfitability);
  const [skuSearch, setSkuSearch] = useState<string>("");
  const [skuFilter, setSkuFilter] = useState<string>("all"); // "all" | "profitable" | "loss" | "borderline"
  const [skuChannelFilter, setSkuChannelFilter] = useState<string>("amazon");
  
  // Reconciliation Data state
  const [orders, setOrders] = useState<OrderReconciliation[]>(initialOrderReconciliation);
  const [orderSearch, setOrderSearch] = useState<string>("");
  const [reconPlatformFilter, setReconPlatformFilter] = useState<string>("all"); // "all" | "Amazon" | "Flipkart"
  const [reconStatusFilter, setReconStatusFilter] = useState<string>("all"); // "all" | "Overcharged" | "Returned" | "Reconciled"
  const [selectedOrder, setSelectedOrder] = useState<OrderReconciliation | null>(null);

  // Future Channel Configurator Form state
  const [newChannelName, setNewChannelName] = useState<string>("");
  const [newChannelCategory, setNewChannelCategory] = useState<string>("Marketplace");
  const [newChannelRevenue, setNewChannelRevenue] = useState<string>("1200000");
  const [newChannelCogsPct, setNewChannelCogsPct] = useState<string>("40");
  const [newChannelCm1Pct, setNewChannelCm1Pct] = useState<string>("35");
  const [newChannelStaffCost, setNewChannelStaffCost] = useState<string>("100000");
  const [newChannelAdsSpend, setNewChannelAdsSpend] = useState<string>("150000");
  const [newChannelAov, setNewChannelAov] = useState<string>("500");

  // Simulation Params (Sensitivity Analysis sliders)
  const [simulationParams, setSimulationParams] = useState<SimulationParams>({
    indirectExpenseMultiplier: 1.0, 
    landingCostMultiplier: 1.0,
    shippingCostMultiplier: 1.0,
    adsSpendMultiplier: 1.0
  });

  // Amazon live financials state
  const [isLoadingAmazonData, setIsLoadingAmazonData] = useState<boolean>(false);

  // Indirect expense breakdown state
  const [showIndirectBreakdown, setShowIndirectBreakdown] = useState<boolean>(false);
  const [indirectSummaryData, setIndirectSummaryData] = useState<{description: string, amount: number}[]>([]);
  const [indirectSettlementData, setIndirectSettlementData] = useState<{description: string, amount: number}[]>([]);
  const [indirectTotal, setIndirectTotal] = useState<number>(0);
  const [indirectSettlementTotal, setIndirectSettlementTotal] = useState<number>(0);
  const [isLoadingBreakdown, setIsLoadingBreakdown] = useState<boolean>(false);
  const [breakdownFetched, setBreakdownFetched] = useState<boolean>(false);

  // Database integration state
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [b2cSchemaData, setB2cSchemaData] = useState<any>(null);
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const checkDbStatus = async () => {
    try {
      const res = await fetch("/api/amazon/db-status");
      const data = await res.json();
      setDbStatus(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const fetchB2cSchema = async () => {
    setIsLoadingDb(true);
    setDbError(null);
    try {
      const res = await fetch("/api/amazon/b2c-schema");
      const data = await res.json();
      if (data.success) {
        setB2cSchemaData(data);
      } else {
        setDbError(data.error || "Failed to retrieve database schema.");
        setB2cSchemaData(data);
      }
    } catch (err: any) {
      setDbError(err?.message || String(err));
    } finally {
      setIsLoadingDb(false);
    }
  };

  const fetchAmazonFinancials = async (start: string, end: string) => {
    setIsLoadingAmazonData(true);
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const res = await fetch(`/api/amazon/financials?${params}`);
      const data = await res.json();
      if (data.success) {
        setChannels(prev => prev.map(ch => {
          if (ch.id !== "amazon") return ch;
          const cm2 = data.data.cm2;
          return {
            ...ch,
            revenue: data.data.netRevenue,
            cogs: data.data.cogs,
            cm1: data.data.cm1,
            indirectExpAndPeople: data.data.indirectExpenses,
            advertisingSpend: data.data.advertisingSpend ?? 0,
            cm2: cm2,
            netProfit: cm2,
            lastUpdated: new Date().toISOString(),
          };
        }));
      }
    } catch (err) {
      console.error("Failed to fetch Amazon financials:", err);
    } finally {
      setIsLoadingAmazonData(false);
    }
  };

  const fetchAmazonOperationalMetrics = async (start: string, end: string) => {
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const res = await fetch(`/api/amazon/operational-metrics?${params}`);
      const data = await res.json();
      if (data.success) {
        setChannels(prev => prev.map(ch => {
          if (ch.id !== "amazon") return ch;
          return {
            ...ch,
            aov: data.data.aov ?? 0,
            ordersPerDay: data.data.ordersPerDay ?? 0,
            listingsCount: data.data.listingsCount ?? 0,
            activeListingCount: data.data.activeListingCount ?? 0,
            revenuePerSku: data.data.revenuePerSku ?? 0,
            returnPct: data.data.returnPct ?? 0,
            claimPct: data.data.claimPct ?? 0,
            reimbursementPct: data.data.reimbursementAmount ?? 0,
            outOfStockDays: data.data.outOfStockDays ?? 0,
            ageingInventoryPct: data.data.ageingInventoryPct ?? 0,
            deadStockPct: data.data.deadStockPct ?? 0,
          };
        }));
      }
    } catch (err) {
      console.error("Failed to fetch Amazon operational metrics:", err);
    }
  };

  const fetchShopifyFinancials = async (start: string, end: string) => {
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const res = await fetch(`/api/shopify/financials?${params}`);
      const data = await res.json();
      if (data.success) {
        setChannels(prev => prev.map(ch => {
          if (ch.id !== "shopify") return ch;
          const cm2 = data.data.cm2;
          return {
            ...ch,
            revenue: data.data.revenue,
            cogs: data.data.cogs,
            cm1: data.data.cm1,
            indirectExpAndPeople: data.data.indirectExpenses,
            advertisingSpend: data.data.advertisingSpend ?? 0,
            cm2: cm2,
            netProfit: cm2,
            lastUpdated: new Date().toISOString(),
          };
        }));
      }
    } catch (err) {
      console.error("Failed to fetch Shopify financials:", err);
    }
  };

  const fetchShopifyOperationalMetrics = async (start: string, end: string) => {
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const res = await fetch(`/api/shopify/operational-metrics?${params}`);
      const data = await res.json();
      if (data.success) {
        setChannels(prev => prev.map(ch => {
          if (ch.id !== "shopify") return ch;
          return {
            ...ch,
            aov: data.data.aov ?? 0,
            ordersPerDay: data.data.ordersPerDay ?? 0,
            listingsCount: data.data.listingsCount ?? 0,
            activeListingCount: data.data.activeListingCount ?? 0,
            revenuePerSku: data.data.revenuePerSku ?? 0,
            returnPct: data.data.returnPct ?? 0,
            claimPct: data.data.claimPct ?? 0,
            reimbursementPct: data.data.reimbursementPct ?? 0,
            outOfStockDays: data.data.outOfStockDays ?? 0,
            ageingInventoryPct: data.data.ageingInventoryPct ?? 0,
            deadStockPct: data.data.deadStockPct ?? 0,
          };
        }));
      }
    } catch (err) {
      console.error("Failed to fetch Shopify operational metrics:", err);
    }
  };

  const fetchExpenseBreakdown = async (start: string, end: string) => {
    setIsLoadingBreakdown(true);
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const res = await fetch(`/api/amazon/expense-breakdown?${params}`);
      const data = await res.json();
      if (data.success) {
        setIndirectSummaryData(data.data.summary);
        setIndirectSettlementData(data.data.settlementBreakdown);
        setIndirectTotal(data.data.total);
        setIndirectSettlementTotal(data.data.settlementTotal);
        setBreakdownFetched(true);
      }
    } catch (err) {
      console.error("Failed to fetch expense breakdown:", err);
    } finally {
      setIsLoadingBreakdown(false);
    }
  };

  const [anomalies, setAnomalies] = useState<any>(null);

  const fetchAnomalies = async (start: string, end: string) => {
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const res = await fetch(`/api/amazon/anomalies?${params}`);
      const data = await res.json();
      if (data.success) {
        setAnomalies(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch anomalies:", err);
    }
  };

  const fetchSkuProfitability = async (start: string, end: string) => {
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const res = await fetch(`/api/amazon/sku-profitability?${params}`);
      const data = await res.json();
      if (data.success) {
        setSkus(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch SKU profitability:", err);
    }
  };

  // Run on load
  useEffect(() => {
    checkDbStatus();
  }, []);

  // AI advisory state
  const [aiQuestion, setAiQuestion] = useState<string>("");
  const [aiResponse, setAiResponse] = useState<string>("");
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [showAiAdvisor, setShowAiAdvisor] = useState<boolean>(true);

  // Pre-configured questions
  const quickAiPrompts = {
    Amazon: "Why are my Amazon refund return costs bleeding ₹2.1 Lakhs, and how can we optimize packing weights?",
    Flipkart: "Conduct a strategic fee audit on Flipkart closing and technology margins to find leakages.",
    Shopify: "How can I re-allocate my 54% Shopify marketing spend to achieve a sustainable CM2?",
    overall: "Look at all business channels. Which 3 channels are highly efficient, and which SKU is high risk?"
  };

  // Toast State for actions
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Date Controls state
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateRangePreset, setDateRangePreset] = useState<string>("previous_month");
  const [startDateStr, setStartDateStr] = useState<string>(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split("T")[0]);
  const [endDateStr, setEndDateStr] = useState<string>(new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split("T")[0]);
  const [comparisonType, setComparisonType] = useState<string>("previous_period"); // "previous_period" | "wow" | "previous_month"

  // Date Synchronization and shifts
  useEffect(() => {
    const today = new Date();
    let start = new Date();
    let end = new Date();

    if (dateRangePreset === "last_7_days") {
      start.setDate(today.getDate() - 6);
    } else if (dateRangePreset === "last_14_days") {
      start.setDate(today.getDate() - 13);
    } else if (dateRangePreset === "last_30_days") {
      start.setDate(today.getDate() - 29);
    } else if (dateRangePreset === "current_month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (dateRangePreset === "previous_month") {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (dateRangePreset === "full_60_days") {
      start.setDate(today.getDate() - 59);
    } else {
      return; // custom allows manual overrides
    }

    setStartDateStr(start.toISOString().split("T")[0]);
    setEndDateStr(end.toISOString().split("T")[0]);
  }, [dateRangePreset]);

  const handleStartDateChange = (val: string) => {
    setDateRangePreset("custom");
    setStartDateStr(val);
  };

  const handleEndDateChange = (val: string) => {
    setDateRangePreset("custom");
    setEndDateStr(val);
  };

  // Re-fetch Amazon data when date range changes
  useEffect(() => {
    fetchAmazonFinancials(startDateStr, endDateStr);
    fetchAmazonOperationalMetrics(startDateStr, endDateStr);
    fetchSkuProfitability(startDateStr, endDateStr);
    fetchAnomalies(startDateStr, endDateStr);
    fetchShopifyFinancials(startDateStr, endDateStr);
    fetchShopifyOperationalMetrics(startDateStr, endDateStr);
    setBreakdownFetched(false);
    setShowIndirectBreakdown(false);
  }, [startDateStr, endDateStr]);

  // Deterministic noise generator for 90-day historical timeseries data
  const getDeterministicNoise = (dateStr: string, channelId: string, idx: number) => {
    let str = dateStr + channelId + idx;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const floatVal = (Math.abs(hash) % 1000) / 1000;
    return (floatVal * 0.3) - 0.15; // -15% to +15% random variation
  };

  const getDiffDays = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const diffTime = e.getTime() - s.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1; // inclusive
  };

  const shiftDateStr = (dateStr: string, daysToShift: number) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + daysToShift);
    return d.toISOString().split("T")[0];
  };

  const rolling60DaysData = useMemo(() => {
    const result: {
      date: string;
      channelId: string;
      revenue: number;
      cogs: number;
      cm1: number;
      indirectExpAndPeople: number;
      advertisingSpend: number;
      cm2: number;
      interestTaxDA: number;
      netProfit: number;
      orders: number;
    }[] = [];
    
    const today = new Date();

    // Generate exactly 90 days total so that there is always perfect comparative data back to 60 days
    for (let i = 0; i < 90; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayOfWeek = d.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const weekendFactor = isWeekend ? 1.22 : 0.91;
      
      channels.forEach(c => {
        const dailyRevenueBase = c.revenue / 30;
        const dailyCogsBase = c.cogs / 30;
        const dailyCm1Base = c.cm1 / 30;
        const dailyIndirectBase = c.indirectExpAndPeople / 30;
        const dailyAdsBase = c.advertisingSpend / 30;
        const dailyInterestBase = c.interestTaxDA / 30;
        const dailyOrdersBase = c.ordersPerDay;
        
        const noise1 = getDeterministicNoise(dateStr, c.id, 1);
        const finalFactor = (1 + noise1) * weekendFactor;
        
        const revenue = Math.round(dailyRevenueBase * finalFactor);
        const cogs = Math.round(dailyCogsBase * finalFactor * (1 + getDeterministicNoise(dateStr, c.id, 2) * 0.05));
        const cm1 = Math.round(dailyCm1Base * finalFactor * (1 + getDeterministicNoise(dateStr, c.id, 3) * 0.03));
        const indirect = Math.round(dailyIndirectBase * (1 + getDeterministicNoise(dateStr, c.id, 4) * 0.01));
        const ads = Math.round(dailyAdsBase * (1 + getDeterministicNoise(dateStr, c.id, 5) * 0.22));
        
        const cm2 = cm1 - ads - indirect;
        const interestTaxDA = Math.round(dailyInterestBase);
        const netProfit = cm2 - interestTaxDA;
        const ordersCount = Math.max(1, Math.round(dailyOrdersBase * finalFactor));
        
        result.push({
          date: dateStr,
          channelId: c.id,
          revenue,
          cogs,
          cm1,
          indirectExpAndPeople: indirect,
          advertisingSpend: ads,
          cm2,
          interestTaxDA,
          netProfit,
          orders: ordersCount
        });
      });
    }
    return result;
  }, [channels]);

  // Comparison period dates bounding box
  const { compStartStr, compEndStr } = useMemo(() => {
    const diff = getDiffDays(startDateStr, endDateStr);
    
    let compStart = "";
    let compEnd = "";
    
    if (comparisonType === "previous_period") {
      compStart = shiftDateStr(startDateStr, -diff);
      compEnd = shiftDateStr(startDateStr, -1);
    } else if (comparisonType === "wow") {
      compStart = shiftDateStr(startDateStr, -7);
      compEnd = shiftDateStr(endDateStr, -7);
    } else { // "previous_month"
      compStart = shiftDateStr(startDateStr, -30);
      compEnd = shiftDateStr(endDateStr, -30);
    }
    
    return { compStartStr: compStart, compEndStr: compEnd };
  }, [startDateStr, endDateStr, comparisonType]);

  // Active filter context
  const selectedChannel = useMemo(() => {
    return channels.find(c => c.id === selectedChannelId) || channels[0];
  }, [channels, selectedChannelId]);

  // Live Simulated Calculations based on selected date range and multipliers
  const simulatedChannelsObj = useMemo(() => {
    return channels.map(chan => {
      // Find matching daily entries in the selected date range
      let periodRevenue = 0;
      let periodCogs = 0;
      let periodCm1 = 0;
      let periodIndirect = 0;
      let periodAds = 0;
      let periodInterest = 0;
      let periodNetProfit = 0;
      let periodOrders = 0;

      rolling60DaysData.forEach(d => {
        if (d.date >= startDateStr && d.date <= endDateStr && d.channelId === chan.id) {
          // Base values from rolling data
          periodRevenue += d.revenue;
          periodOrders += d.orders;
          
          // Apply multipliers
          const adjustedCogs = d.cogs * simulationParams.landingCostMultiplier;
          const adjustedAds = d.advertisingSpend * simulationParams.adsSpendMultiplier;
          const adjustedIndirect = d.indirectExpAndPeople * simulationParams.indirectExpenseMultiplier;
          
          // Contribution Margin 1 & EBITDA logic
          const marginReduction = adjustedCogs - d.cogs;
          const adjustedCm1 = Math.max(0, d.cm1 - marginReduction);
          const adjustedCm2 = adjustedCm1 - adjustedIndirect - adjustedAds;
          const adjustedNetProfit = adjustedCm2 - d.interestTaxDA;

          periodCogs += adjustedCogs;
          periodCm1 += adjustedCm1;
          periodIndirect += adjustedIndirect;
          periodAds += adjustedAds;
          periodInterest += d.interestTaxDA;
          periodNetProfit += adjustedNetProfit;
        }
      });

      const dayCount = getDiffDays(startDateStr, endDateStr);

      return {
        ...chan,
        revenue: periodRevenue,
        cogs: periodCogs,
        cm1: periodCm1,
        indirectExpAndPeople: periodIndirect,
        advertisingSpend: periodAds,
        cm2: periodCm1 - periodIndirect - periodAds,
        interestTaxDA: periodInterest,
        netProfit: periodNetProfit,
        ordersPerDay: periodOrders / (dayCount || 1),
        // adjust some channel metrics
        aov: periodOrders > 0 ? periodRevenue / periodOrders : chan.aov
      };
    });
  }, [channels, startDateStr, endDateStr, rolling60DaysData, simulationParams]);

  const activeSimulatedChannel = useMemo(() => {
    return simulatedChannelsObj.find(c => c.id === selectedChannelId) || simulatedChannelsObj[0];
  }, [simulatedChannelsObj, selectedChannelId]);

  // Consolidated Aggregated Figures
  const consolidatedMetrics = useMemo(() => {
    let rev = 0;
    let cogs = 0;
    let cm1 = 0;
    let indirect = 0;
    let ads = 0;
    let cm2 = 0;
    let interestDA = 0;
    let netProf = 0;
    let totalOrders = 0;

    simulatedChannelsObj.forEach(c => {
      rev += c.revenue;
      cogs += c.cogs;
      cm1 += c.cm1;
      indirect += c.indirectExpAndPeople;
      ads += c.advertisingSpend;
      cm2 += c.cm2;
      interestDA += c.interestTaxDA;
      netProf += c.netProfit;
      
      const dayCount = getDiffDays(startDateStr, endDateStr);
      const periodOrders = Math.round(c.ordersPerDay * dayCount);
      totalOrders += periodOrders;
    });

    return {
      revenue: rev,
      cogs,
      cm1,
      indirect,
      advertisingSpend: ads,
      cm2,
      interestTaxDA: interestDA,
      netProfit: netProf,
      netMarginPct: rev > 0 ? (netProf / rev) * 100 : 0,
      cm1Pct: rev > 0 ? (cm1 / rev) * 100 : 0,
      cm2Pct: rev > 0 ? (cm2 / rev) * 100 : 0,
      avgAov: rev > 0 ? rev / (totalOrders || 1) : 0,
      totalOrders,
    };
  }, [simulatedChannelsObj, startDateStr, endDateStr]);

  // Consolidated Comparison Figures
  const comparativeMetrics = useMemo(() => {
    if (!compStartStr || !compEndStr) return null;
    
    let rev = 0;
    let cogs = 0;
    let cm1 = 0;
    let indirect = 0;
    let ads = 0;
    let cm2 = 0;
    let interestDA = 0;
    let netProf = 0;
    let totalOrders = 0;

    channels.forEach(chan => {
      rolling60DaysData.forEach(d => {
        if (d.date >= compStartStr && d.date <= compEndStr && d.channelId === chan.id) {
          rev += d.revenue;
          totalOrders += d.orders;
          
          const adjustedCogs = d.cogs * simulationParams.landingCostMultiplier;
          const adjustedAds = d.advertisingSpend * simulationParams.adsSpendMultiplier;
          const adjustedIndirect = d.indirectExpAndPeople * simulationParams.indirectExpenseMultiplier;
          
          const marginReduction = adjustedCogs - d.cogs;
          const adjustedCm1 = Math.max(0, d.cm1 - marginReduction);
          const adjustedCm2 = adjustedCm1 - adjustedIndirect - adjustedAds;
          const adjustedNetProfit = adjustedCm2 - d.interestTaxDA;

          cogs += adjustedCogs;
          cm1 += adjustedCm1;
          indirect += adjustedIndirect;
          ads += adjustedAds;
          cm2 += adjustedCm2;
          interestDA += d.interestTaxDA;
          netProf += adjustedNetProfit;
        }
      });
    });

    return {
      revenue: rev,
      cogs,
      cm1,
      indirect,
      advertisingSpend: ads,
      cm2,
      interestTaxDA: interestDA,
      netProfit: netProf,
      netMarginPct: rev > 0 ? (netProf / rev) * 100 : 0,
      cm1Pct: rev > 0 ? (cm1 / rev) * 100 : 0,
      totalOrders,
    };
  }, [channels, compStartStr, compEndStr, rolling60DaysData, simulationParams]);

  // Channel specific Comparator
  const activeChannelComparativeMetrics = useMemo(() => {
    if (!compStartStr || !compEndStr || !selectedChannelId) return null;
    
    let rev = 0;
    let cogs = 0;
    let cm1 = 0;
    let indirect = 0;
    let ads = 0;
    let interestDA = 0;
    let netProf = 0;
    let totalOrders = 0;

    rolling60DaysData.forEach(d => {
      if (d.date >= compStartStr && d.date <= compEndStr && d.channelId === selectedChannelId) {
        rev += d.revenue;
        totalOrders += d.orders;
        
        const adjustedCogs = d.cogs * simulationParams.landingCostMultiplier;
        const adjustedAds = d.advertisingSpend * simulationParams.adsSpendMultiplier;
        const adjustedIndirect = d.indirectExpAndPeople * simulationParams.indirectExpenseMultiplier;
        
        const marginReduction = adjustedCogs - d.cogs;
        const adjustedCm1 = Math.max(0, d.cm1 - marginReduction);
        const adjustedCm2 = adjustedCm1 - adjustedIndirect - adjustedAds;
        const adjustedNetProfit = adjustedCm2 - d.interestTaxDA;

        cogs += adjustedCogs;
        cm1 += adjustedCm1;
        indirect += adjustedIndirect;
        ads += adjustedAds;
        interestDA += d.interestTaxDA;
        netProf += adjustedNetProfit;
      }
    });

    return {
      revenue: rev,
      cogs,
      cm1,
      indirect,
      advertisingSpend: ads,
      netProfit: netProf,
      netMarginPct: rev > 0 ? (netProf / rev) * 100 : 0,
      cm1Pct: rev > 0 ? (cm1 / rev) * 105 : 0, // safe base
      totalOrders,
    };
  }, [selectedChannelId, compStartStr, compEndStr, rolling60DaysData, simulationParams]);

  // Dynamic trend chart mapper
  const dailyTrendData = useMemo(() => {
    const dataMap: { [date: string]: { date: string; Revenue: number; NetProfit: number; EBITDA: number } } = {};
    
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const temp = new Date(start);
    while (temp <= end) {
      const dateStr = temp.toISOString().split("T")[0];
      dataMap[dateStr] = {
        date: dateStr,
        Revenue: 0,
        NetProfit: 0,
        EBITDA: 0
      };
      temp.setDate(temp.getDate() + 1);
    }
    
    rolling60DaysData.forEach(d => {
      if (d.date >= startDateStr && d.date <= endDateStr) {
        if (dataMap[d.date]) {
          const adjustedCogs = d.cogs * simulationParams.landingCostMultiplier;
          const adjustedAds = d.advertisingSpend * simulationParams.adsSpendMultiplier;
          const adjustedIndirect = d.indirectExpAndPeople * simulationParams.indirectExpenseMultiplier;
          
          const marginReduction = adjustedCogs - d.cogs;
          const adjustedCm1 = Math.max(0, d.cm1 - marginReduction);
          const adjustedCm2 = adjustedCm1 - adjustedIndirect - adjustedAds;
          const adjustedNetProfit = adjustedCm2 - d.interestTaxDA;

          dataMap[d.date].Revenue += d.revenue;
          dataMap[d.date].EBITDA += adjustedCm2;
          dataMap[d.date].NetProfit += adjustedNetProfit;
        }
      }
    });

    return Object.values(dataMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [startDateStr, endDateStr, rolling60DaysData, simulationParams]);

  // Format currency helpers (INR / standard numeric fallback)
  const formatCurrency = (val: number) => {
    const isNegative = val < 0;
    const absVal = Math.abs(val);
    
    // Format to Lakhs/Crores if needed, otherwise normal Indian formatting
    if (absVal >= 10000000) {
      return `${isNegative ? "-" : ""}₹${(absVal / 10000000).toFixed(2)} Cr`;
    } else if (absVal >= 100000) {
      return `${isNegative ? "-" : ""}₹${(absVal / 100000).toFixed(2)} L`;
    }
    return `${isNegative ? "-" : ""}₹${absVal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  };

  const formatPercent = (val: number) => {
    return `${val.toFixed(1)}%`;
  };

  // Helper to render WoW comparison badges
  const renderComparisonBadge = (current: number, comparative: number | undefined | null, isExpense = false) => {
    if (comparative === undefined || comparative === null || comparative === 0) {
      return (
        <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-md font-mono font-normal">
          --
        </span>
      );
    }
    
    const pctChange = ((current - comparative) / comparative) * 100;
    const isZero = Math.abs(pctChange) < 0.01;
    
    let colorClass = "bg-slate-100 text-slate-500 border border-slate-200/50";
    let icon = "";
    
    if (!isZero) {
      if (pctChange > 0) {
        colorClass = isExpense ? "bg-red-50 text-red-600 border border-red-100" : "bg-emerald-50 text-emerald-600 border border-emerald-100";
        icon = "▲ ";
      } else {
        colorClass = isExpense ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-red-50 text-red-600 border border-red-100";
        icon = "▼ ";
      }
    }
    
    return (
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg flex items-center gap-0.5 font-mono ${colorClass}`} title={`Prev period: ${formatCurrency(comparative)}`}>
        {icon}{Math.abs(pctChange).toFixed(1)}%
      </span>
    );
  };

  // Filter SKUs
  const filteredSKUs = useMemo(() => {
    return skus.map(s => {
      // Adjust SKU metrics based on multipliers
      const adjustedCOGS = s.landingCost * simulationParams.landingCostMultiplier;
      const adjustedShipping = s.shippingCost * simulationParams.shippingCostMultiplier;
      const adjustedAds = s.adsSpend * simulationParams.adsSpendMultiplier;
      
      const cm1 = s.revenue - adjustedCOGS - s.marketplaceFees - s.packagingCost - adjustedShipping - s.returnLoss;
      const profit = cm1 - adjustedAds;

      let status: "Profitable" | "Borderline" | "Loss Making" = "Profitable";
      if (profit < 0) status = "Loss Making";
      else if (profit < s.revenue * 0.08) status = "Borderline";

      return {
        ...s,
        landingCost: adjustedCOGS,
        shippingCost: adjustedShipping,
        adsSpend: adjustedAds,
        contributionMargin1: cm1,
        netProfit: profit,
        status
      };
    }).filter(s => {
      if (skuChannelFilter !== "amazon") return false;

      const matchesSearch = s.sku.toLowerCase().includes(skuSearch.toLowerCase()) ||
                            s.name.toLowerCase().includes(skuSearch.toLowerCase());

      if (!matchesSearch) return false;
      if (skuFilter === "all") return true;
      if (skuFilter === "profitable") return s.status === "Profitable";
      if (skuFilter === "loss") return s.status === "Loss Making";
      if (skuFilter === "borderline") return s.status === "Borderline";
      return true;
    });
  }, [skus, skuSearch, skuFilter, skuChannelFilter, simulationParams]);

  // Filter Orders for reconciliation
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const matchesSearch = o.orderId.toLowerCase().includes(orderSearch.toLowerCase()) || 
                            o.sku.toLowerCase().includes(orderSearch.toLowerCase());
      
      const matchesPlatform = reconPlatformFilter === "all" || o.platform === reconPlatformFilter;
      
      let matchesStatus = true;
      if (reconStatusFilter === "Overcharged") {
        matchesStatus = o.status.startsWith("Overcharged");
      } else if (reconStatusFilter === "Returned") {
        matchesStatus = o.status.includes("Returned");
      } else if (reconStatusFilter === "Reconciled") {
        matchesStatus = o.status === "Fully Reconciled";
      }

      const oDate = o.dateTime.substring(0, 10);
      const matchesDate = oDate >= startDateStr && oDate <= endDateStr;

      return matchesSearch && matchesPlatform && matchesStatus && matchesDate;
    });
  }, [orders, orderSearch, reconPlatformFilter, reconStatusFilter, startDateStr, endDateStr]);

  // Reconciliation audit overview figures
  const reconciliationSummary = useMemo(() => {
    let totalDiscrepancies = 0;
    let overchargeAmount = 0;
    let refundedSecured = 0;
    
    filteredOrders.forEach(o => {
      if (o.reconciliationDifference > 0) {
        totalDiscrepancies++;
        overchargeAmount += o.reconciliationDifference;
        if (o.claimStatus === "Refunded") {
          refundedSecured += o.reconciliationDifference;
        }
      }
    });

    return {
      discrepancyCount: totalDiscrepancies,
      totalOvercharged: overchargeAmount,
      securedRefunds: refundedSecured,
      backlogAmount: overchargeAmount - refundedSecured,
    };
  }, [filteredOrders]);

  // Trigger Gemini AI insights via API
  const getAIQuery = async (question: string) => {
    if (!question) return;
    setAiLoading(true);
    setAiResponse("");
    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: activeTab === "channels" ? selectedChannel.name : "Combined Business",
          dataContext: activeTab === "channels" ? {
            name: selectedChannel.name,
            revenue: activeSimulatedChannel.revenue,
            cogs: activeSimulatedChannel.cogs,
            cm1: activeSimulatedChannel.cm1,
            advertising: activeSimulatedChannel.advertisingSpend,
            indirectOverhead: activeSimulatedChannel.indirectExpAndPeople,
            netProfit: activeSimulatedChannel.netProfit,
            aov: activeSimulatedChannel.aov,
            returnRate: formatPercent(activeSimulatedChannel.returnPct),
            claimRate: formatPercent(activeSimulatedChannel.claimPct),
            listingsCount: activeSimulatedChannel.listingsCount,
            activeCount: activeSimulatedChannel.activeListingCount
          } : {
            summary: "Consolidated all channels",
            revenue: consolidatedMetrics.revenue,
            cogs: consolidatedMetrics.cogs,
            cm1: consolidatedMetrics.cm1,
            ads: consolidatedMetrics.advertisingSpend,
            overhead: consolidatedMetrics.indirect,
            netProfit: consolidatedMetrics.netProfit,
            marginPct: consolidatedMetrics.netMarginPct.toFixed(2)
          },
          customQuestion: question,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setAiResponse(data.insights);
      } else {
        setAiResponse(`### ⚠️ Connection Setup Suggested\n\n${data.error || "Could not reach Gemini."}\n\n*However, based on standard heuristics:*\nYour selected channel **${selectedChannel.name}** is operating at a Net Margin of **${((activeSimulatedChannel.netProfit / activeSimulatedChannel.revenue) * 100).toFixed(1)}%**. High advertising spend relative to your CM1 targets represents the primary vector of capital leakage.*`);
      }
    } catch (e: any) {
      setAiResponse(`### Simulation Fallback Diagnostic\n\nYour selected dataset **${selectedChannel.name}** is fully mapped. Setup a live secret API key to activate natural language consulting on these figures!`);
    } finally {
      setAiLoading(false);
    }
  };

  // Load initial prompt on channel click
  useEffect(() => {
    if (activeTab === "channels") {
      const customQ = quickAiPrompts[selectedChannelId as keyof typeof quickAiPrompts] || `Provide structural CFO advisory to improve contribution margins for ${selectedChannel.name}.`;
      setAiQuestion(customQ);
    } else {
      setAiQuestion(quickAiPrompts.overall);
    }
  }, [selectedChannelId, activeTab]);

  // Add Dynamic Custom Channel
  const handleAddChannel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName) return;

    const rev = parseFloat(newChannelRevenue) || 0;
    const cogsPct = parseFloat(newChannelCogsPct) || 40;
    const cm1Pct = parseFloat(newChannelCm1Pct) || 35;
    const staff = parseFloat(newChannelStaffCost) || 0;
    const ads = parseFloat(newChannelAdsSpend) || 0;
    const aovVal = parseFloat(newChannelAov) || 500;

    const computedCOGS = Math.round(rev * (cogsPct / 100));
    const computedCM1 = Math.round(rev * (cm1Pct / 100));
    const computedCM2 = computedCM1 - staff - ads;
    const computedNet = computedCM2 - Math.round(rev * 0.05); // simulate standard taxes/interest

    const newChan: ChannelFinancials = {
      id: newChannelName.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: newChannelName,
      category: newChannelCategory as any,
      revenue: rev,
      cogs: computedCOGS,
      cm1: computedCM1,
      indirectExpAndPeople: staff,
      advertisingSpend: ads,
      cm2: computedCM2,
      interestTaxDA: Math.round(rev * 0.05),
      netProfit: computedNet,
      aov: aovVal,
      ordersPerDay: Math.ceil(rev / (30 * aovVal)),
      listingsCount: 15,
      activeListingCount: 12,
      revenuePerSku: Math.round(rev / 15),
      outOfStockDays: 3.5,
      ageingInventoryPct: 10.0,
      deadStockPct: 2.0,
      returnPct: 5.0,
      claimPct: 1.0,
      reimbursementPct: 0.5,
      totalSkus: 15,
      skusBenchmark: 10,
      lastUpdated: new Date().toISOString()
    };

    setChannels([...channels, newChan]);
    setSelectedChannelId(newChan.id);
    setActiveTab("channels");
    showToast(`Successfully launched new channel: ${newChannelName}! Metrics are fully synced.`);
    
    // reset form
    setNewChannelName("");
  };

  // Handle dispute filing
  const handleFileDispute = (orderId: string) => {
    setOrders(prev => prev.map(o => {
      if (o.orderId === orderId) {
        return {
          ...o,
          claimStatus: "In Process",
          claimRef: `SAFE-${Math.floor(100000 + Math.random() * 900000)}-AUD`
        };
      }
      return o;
    }));
    
    showToast(`Claim dispute submitted successfully to Amazon Service Team for Order ID: ${orderId}`);
  };

  // Re-sync simulation
  const handleResetSimulation = () => {
    setSimulationParams({
      indirectExpenseMultiplier: 1.0,
      landingCostMultiplier: 1.0,
      shippingCostMultiplier: 1.0,
      adsSpendMultiplier: 1.0
    });
    showToast("Reverted all sensitivity parameters to baseline actuals.");
  };

  // Chart data formatting
  const channelChartData = useMemo(() => {
    return simulatedChannelsObj.map(c => ({
      name: c.name,
      Revenue: c.revenue,
      EBITDA: c.cm2,
      NetProfit: c.netProfit
    })).sort((a, b) => b.Revenue - a.Revenue);
  }, [simulatedChannelsObj]);

  const categoryBreakdownData = useMemo(() => {
    const data: { [key: string]: number } = {};
    simulatedChannelsObj.forEach(c => {
      data[c.category] = (data[c.category] || 0) + c.revenue;
    });
    return Object.entries(data).map(([key, value]) => ({
      name: key,
      value
    }));
  }, [simulatedChannelsObj]);

  const CATEGORY_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6"];

  return (
    <div className={`min-h-screen flex flex-col font-sans ${darkMode ? "dark-theme" : "bg-slate-100 text-slate-900"}`}>
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg border border-emerald-500 flex items-center gap-3 glow-emerald animate-bounce">
          <CheckCircle2 size={18} />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <nav className="flex items-center justify-between px-6 h-14 bg-white border-b border-slate-200 shrink-0 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(prev => !prev)}
            className="w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold">F</div>
          <h1 className="text-sm font-semibold tracking-tight text-slate-800 uppercase">FinPulse <span className="text-blue-600">Central</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-slate-50 rounded-md px-3 py-1.5 border border-slate-200">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-2">Audit Range:</span>
            <span className="text-xs font-semibold text-slate-700">{new Date(startDateStr).toLocaleDateString("en-IN", { month: "short", day: "2-digit", year: "numeric" })} - {new Date(endDateStr).toLocaleDateString("en-IN", { month: "short", day: "2-digit", year: "numeric" })}</span>
          </div>
          <button
            onClick={() => setDarkMode(prev => !prev)}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200"
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? <Sun size={15} className="text-amber-500" /> : <Moon size={15} className="text-slate-500" />}
          </button>
          <div className="w-8 h-8 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-600 text-xs font-bold font-mono">
            FP
          </div>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className={`${sidebarOpen ? "w-64" : "w-0 overflow-hidden"} bg-[#111827] flex flex-col shrink-0 text-slate-300 border-r border-slate-850 transition-all duration-300`}>
          <div className="p-4 flex-1 overflow-y-auto">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Main Menu</p>
            <ul className="space-y-1">
              <li>
                <button
                  id="tab-consolidated"
                  onClick={() => setActiveTab("consolidated")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "consolidated"
                      ? "bg-blue-600/10 text-blue-400 font-semibold"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Briefcase size={16} />
                  Consolidated Cockpit
                </button>
              </li>
              <li>
                <button
                  id="tab-channels"
                  onClick={() => setActiveTab("channels")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "channels"
                      ? "bg-blue-600/10 text-blue-400 font-semibold"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <ShoppingBag size={16} />
                  Channel Performance
                </button>
              </li>
              <li>
                <button
                  id="tab-skus"
                  onClick={() => setActiveTab("skus")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "skus"
                      ? "bg-blue-600/10 text-blue-400 font-semibold"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Layers size={16} />
                  SKU Profitability
                </button>
              </li>
              <li>
                <button
                  id="tab-reconciliation"
                  onClick={() => setActiveTab("reconciliation")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "reconciliation"
                      ? "bg-blue-600/10 text-blue-400 font-semibold"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <FileCheck2 size={16} />
                  Order Reconciliation
                </button>
              </li>
              <li>
                <button
                  id="tab-configurer"
                  onClick={() => setActiveTab("configurer")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "configurer"
                      ? "bg-blue-600/10 text-blue-400 font-semibold"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <PlusCircle size={16} />
                  Add Channel
                </button>
              </li>
              <li>
                <button
                  id="tab-database"
                  onClick={() => setActiveTab("database")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "database"
                      ? "bg-emerald-600/10 text-emerald-400 font-semibold"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Database size={16} />
                  DB Integrator
                </button>
              </li>
            </ul>

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 mt-8">Active Channels</p>
            <ul className="space-y-1 text-xs">
              {channels.map(chan => {
                const isSelectedInPerformance = activeTab === "channels" && selectedChannelId === chan.id;
                return (
                  <li key={chan.id}>
                    <button
                      onClick={() => {
                        setSelectedChannelId(chan.id);
                        setActiveTab("channels");
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-left transition-colors ${
                        isSelectedInPerformance 
                          ? "text-white font-medium bg-slate-800"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <span>{chan.name}</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        chan.netProfit >= 0 ? "bg-emerald-500" : "bg-rose-500"
                      }`}></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="p-4 border-t border-slate-800 shrink-0">
            <div className="bg-slate-800 rounded p-3 text-[10px] text-slate-400">
              <div className="flex justify-between items-center mb-1">
                <span>Enterprise Ledger Engine</span>
                <span className="text-emerald-400 font-mono">100%</span>
              </div>
              <div className="h-1 w-full bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full w-full bg-emerald-500"></div>
              </div>
            </div>
          </div>
        </aside>

        {/* Content canvas container */}
        <div className="flex-1 overflow-y-auto bg-slate-100 flex flex-col">
          
          {/* Main layout inner */}
          <main className="p-6 space-y-6 w-full flex-1">
            
            {/* Dynamic Date Range Filter & Comparison Cockpit */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200" id="temporal-controls-card">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 text-blue-600 p-2.5 rounded-xl border border-blue-100">
                    <Sliders size={18} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider block font-sans">Enterprise Ledger Analysis Temporal Controls</h2>
                    <p className="text-[10px] text-slate-400 font-mono">CHOOSE THE DATE PERIOD AND THE COMPARATIVE BASIS TO AUTO-RECONCILE METRICS</p>
                  </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  {/* Date Presets Dropdown */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Date preset:</label>
                    <select 
                      id="period-preset-select"
                      value={dateRangePreset}
                      onChange={(e) => setDateRangePreset(e.target.value)}
                      className="bg-slate-50 text-xs text-slate-700 border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:border-blue-500 font-sans cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <option value="last_7_days">Last 7 Days (WoW standard)</option>
                      <option value="last_14_days">Last 14 Days</option>
                      <option value="last_30_days">Last 30 Days</option>
                      <option value="current_month">Current Month (June)</option>
                      <option value="previous_month">Previous Month (May)</option>
                      <option value="full_60_days">Full rolling 60 Days</option>
                      <option value="custom">Custom Range...</option>
                    </select>
                  </div>

                  {/* Start Date */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Start date:</label>
                    <input 
                      id="period-start-date-input"
                      type="date"
                      min="2026-04-17"
                      max="2026-06-15"
                      value={startDateStr}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      className="bg-slate-50 text-xs text-slate-700 border border-slate-200 rounded-xl px-3 py-1 outline-none focus:border-blue-500 font-mono cursor-pointer hover:bg-slate-100 transition-colors animate-fade-in"
                    />
                  </div>

                  {/* End Date */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">End date:</label>
                    <input 
                      id="period-end-date-input"
                      type="date"
                      min="2026-04-17"
                      max="2026-06-15"
                      value={endDateStr}
                      onChange={(e) => handleEndDateChange(e.target.value)}
                      className="bg-slate-50 text-xs text-slate-700 border border-slate-200 rounded-xl px-3 py-1 outline-none focus:border-blue-500 font-mono cursor-pointer hover:bg-slate-100 transition-colors"
                    />
                  </div>

                  {/* Comparison basis */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Comparison basis:</label>
                    <select 
                      id="compare-period-select"
                      value={comparisonType}
                      onChange={(e) => setComparisonType(e.target.value)}
                      className="bg-slate-50 text-xs text-slate-700 border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:border-blue-500 font-sans cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <option value="previous_period">vs Previous Period (matching duration)</option>
                      <option value="wow">vs Previous Week (WoW standard)</option>
                      <option value="previous_month">vs Previous Month (30d prior)</option>
                    </select>
                  </div>
                </div>
              </div>
              
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap justify-between items-center text-[10px] text-slate-400">
                <div id="target-duration-display" className="flex items-center gap-1.5 mb-1 sm:mb-0">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block animate-pulse"></span>
                  <span>Active Analyzed Range: <strong className="text-slate-600 font-mono">{startDateStr}</strong> to <strong className="text-slate-600 font-mono">{endDateStr}</strong> ({getDiffDays(startDateStr, endDateStr)} days parsed)</span>
                </div>
                {compStartStr && compEndStr && (
                  <div id="compare-duration-display" className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block"></span>
                    <span>Comparison Period: <strong className="text-slate-500 font-mono">{compStartStr}</strong> to <strong className="text-slate-500 font-mono">{compEndStr}</strong> ({getDiffDays(compStartStr, compEndStr)} days matched)</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Sensitivity analysis panel */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Sliders size={16} className="text-slate-500" />
                  <div>
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">CFO Sensitivity Projections</span>
                    <span className="text-[10px] text-slate-400 font-mono">ADJUST SLIDERS TO MODEL SIMULATED IMPACT ON BUSINESS CONSOLIDATED PROFITABILITY</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1 max-w-3xl">
                  {/* Landing Cost / COGS Multiplier */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>Landing Cost (COGS)</span>
                      <span className="text-blue-600 font-bold">x{simulationParams.landingCostMultiplier.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.80"
                      max="1.50"
                      step="0.05"
                      value={simulationParams.landingCostMultiplier}
                      onChange={(e) => setSimulationParams({ ...simulationParams, landingCostMultiplier: parseFloat(e.target.value) })}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Ads Budget Multiplier */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>Advertising bids</span>
                      <span className="text-blue-605 font-bold">x{simulationParams.adsSpendMultiplier.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.50"
                      max="2.00"
                      step="0.10"
                      value={simulationParams.adsSpendMultiplier}
                      onChange={(e) => setSimulationParams({ ...simulationParams, adsSpendMultiplier: parseFloat(e.target.value) })}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Indirect Exp & Staff Costs */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>Overhead / People</span>
                      <span className="text-blue-605 font-bold">x{simulationParams.indirectExpenseMultiplier.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.70"
                      max="1.50"
                      step="0.05"
                      value={simulationParams.indirectExpenseMultiplier}
                      onChange={(e) => setSimulationParams({ ...simulationParams, indirectExpenseMultiplier: parseFloat(e.target.value) })}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Shipping Multiplier */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>Shipment charge</span>
                      <span className="text-blue-605 font-bold">x{simulationParams.shippingCostMultiplier.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.80"
                      max="1.50"
                      step="0.05"
                      value={simulationParams.shippingCostMultiplier}
                      onChange={(e) => setSimulationParams({ ...simulationParams, shippingCostMultiplier: parseFloat(e.target.value) })}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <button 
                    onClick={handleResetSimulation}
                    className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 font-mono flex items-center gap-1.5 transition-all w-full justify-center cursor-pointer"
                  >
                    <RefreshCw size={11} />
                    Reset Actuals
                  </button>
                </div>
              </div>
            </div>

        {/* TAB 1: CONSOLIDATED COCKPIT / EXECUTIVE OVERVIEW */}
        {activeTab === "consolidated" && (
          <div className="flex flex-col gap-6">
            
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 p-5 rounded-2xl relative shadow-sm overflow-hidden" id="consolidated-revenue-kpi">
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl translate-x-4 -translate-y-4"></div>
                <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <span>TOTAL REVENUE</span>
                  <ShoppingBag size={14} className="text-slate-400" />
                </div>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xl font-bold tracking-tight text-slate-900 font-mono">
                    {formatCurrency(consolidatedMetrics.revenue)}
                  </span>
                  {renderComparisonBadge(consolidatedMetrics.revenue, comparativeMetrics?.revenue)}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">Combined period aggregate across platforms</div>
              </div>

              <div className="bg-white border border-slate-200 p-5 rounded-2xl relative shadow-sm overflow-hidden" id="consolidated-cm1-kpi">
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl translate-x-4 -translate-y-4"></div>
                <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <span>CONTRIBUTION MARGIN (CM1)</span>
                  <Layers size={14} className="text-slate-400" />
                </div>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xl font-bold tracking-tight text-slate-900 font-mono">
                    {formatCurrency(consolidatedMetrics.cm1)}
                  </span>
                  {renderComparisonBadge(consolidatedMetrics.cm1, comparativeMetrics?.cm1)}
                </div>
                <div className="text-[10px] text-emerald-600 mt-1 font-semibold flex items-center gap-1">
                  <Percent size={10} />
                  {formatPercent(consolidatedMetrics.cm1Pct)} of Sales
                </div>
              </div>

              <div className="bg-white border border-slate-200 p-5 rounded-2xl relative shadow-sm overflow-hidden" id="consolidated-ads-kpi">
                <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full blur-xl translate-x-4 -translate-y-4"></div>
                <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <span>TOTAL PERFORMANCE ADS SPEND</span>
                  <TrendingDown size={14} className="text-slate-400" />
                </div>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xl font-bold tracking-tight text-amber-600 font-mono">
                    {formatCurrency(consolidatedMetrics.advertisingSpend)}
                  </span>
                  {renderComparisonBadge(consolidatedMetrics.advertisingSpend, comparativeMetrics?.advertisingSpend, true)}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  Equivalent to {formatPercent(consolidatedMetrics.revenue > 0 ? (consolidatedMetrics.advertisingSpend / consolidatedMetrics.revenue) * 100 : 0)} of revenue
                </div>
              </div>

              <div className="bg-white border border-slate-200 p-5 rounded-2xl relative shadow-sm overflow-hidden" id="consolidated-profit-kpi">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl translate-x-4 -translate-y-4"></div>
                <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <span>NET PROFIT (EBITDA)</span>
                  <DollarSign size={14} className="text-slate-400" />
                </div>
                <div className="flex items-baseline justify-between mt-2">
                  <span className={`text-2xl font-bold tracking-tight font-mono ${consolidatedMetrics.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {formatCurrency(consolidatedMetrics.netProfit)}
                  </span>
                  {renderComparisonBadge(consolidatedMetrics.netProfit, comparativeMetrics?.netProfit)}
                </div>
                <span className={`text-[10px] font-semibold mt-1 flex items-center gap-1 ${consolidatedMetrics.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {consolidatedMetrics.netProfit >= 0 ? "✓ Net Surplus Margin:" : "⚠️ Net Deficit Margin:"} {formatPercent(consolidatedMetrics.netMarginPct)}
                </span>
              </div>
            </div>

            {/* Charts Cockpit Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Channel Revenue & Net Profit Comparison */}
              <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm lg:col-span-2">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Channel-wise Revenue & Profit Comparison</h3>
                    <p className="text-xs text-slate-500">Volume and net impact sorted descending</p>
                  </div>
                  <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-2 py-0.5 rounded">30-day aggregated values</span>
                </div>
                
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={channelChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={9} interval={0} tickFormatter={(v) => v.split(" ")[0]} />
                      <YAxis stroke="#64748b" fontSize={9} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0", borderRadius: "12px", fontSize: "12px", color: "#0f172a" }}
                        formatter={(val: number) => [formatCurrency(val), ""]}
                      />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} opacity={0.85} name="Revenue" />
                      <Bar dataKey="NetProfit" fill="#10b981" radius={[4, 4, 0, 0]} name="Net Profit" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Revenue Category Share & Efficiency Factors */}
              <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Category Revenue Share</h3>
                  <p className="text-xs text-slate-500 mb-6">Marketplace vs Quick Commerce vs Offline wholesales</p>
                  
                  <div className="h-44 flex items-center justify-center relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryBreakdownData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {categoryBreakdownData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(val: number) => formatCurrency(val)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute text-center">
                      <p className="text-[9px] text-slate-400 font-bold">TOTAL REVENUE</p>
                      <p className="text-xs font-bold text-slate-800 font-mono">{formatCurrency(consolidatedMetrics.revenue)}</p>
                    </div>
                  </div>
                </div>

                {/* Category Legend list */}
                <div className="flex flex-col gap-1.5 mt-4">
                  {categoryBreakdownData.map((cat, i) => (
                    <div key={cat.name} className="flex items-center justify-between text-xs text-slate-600">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}></span>
                        <span>{cat.name}</span>
                      </div>
                      <span className="font-mono text-slate-500">{formatPercent(consolidatedMetrics.revenue > 0 ? (cat.value / consolidatedMetrics.revenue) * 100 : 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Dynamic Daily Revenue & Profit Trend */}
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm" id="daily-timeseries-trend-card">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Dynamic Daily Revenue & Net Profit Trend</h3>
                  <p className="text-xs text-slate-500">Day-by-day telemetry for the selected range ({startDateStr} to {endDateStr})</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-blue-500 rounded-full inline-block"></span> Daily Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block"></span> Daily Net Profit</span>
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={9} tickFormatter={(v) => {
                      const parts = v.split("-");
                      return parts[2] ? `${parts[2]}/${parts[1]}` : v;
                    }} />
                    <YAxis stroke="#64748b" fontSize={9} tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0", borderRadius: "12px", fontSize: "12px", color: "#0f172a" }}
                      formatter={(val: number) => [formatCurrency(val), ""]}
                    />
                    <Area type="monotone" dataKey="Revenue" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" name="Daily Revenue" />
                    <Area type="monotone" dataKey="NetProfit" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" name="Daily Profit" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Channels Ledger Overview Summary Table */}
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4">Master Ledger Channels Dashboard (Summary)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Channel</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4 text-right">Revenue (Sim)</th>
                      <th className="py-3 px-4 text-right">COGS</th>
                      <th className="py-3 px-4 text-right text-emerald-700 bg-emerald-500/5 border-x border-slate-100">CM1</th>
                      <th className="py-3 px-4 text-right text-amber-700">Marketing Spend</th>
                      <th className="py-3 px-4 text-right">Indirect Costs</th>
                      <th className="py-3 px-4 text-right text-indigo-700 font-semibold bg-indigo-500/5 border-x border-slate-100">Net Profit</th>
                      <th className="py-3 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                    {simulatedChannelsObj.map(c => {
                      const netMargin = c.revenue > 0 ? (c.netProfit / c.revenue) * 100 : 0;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-all cursor-pointer" onClick={() => { setSelectedChannelId(c.id); setActiveTab("channels"); }}>
                          <td className="py-3 px-4 font-sans font-semibold text-slate-800 flex items-center gap-2">
                            <span>{c.name}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-[10px] font-sans px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">{c.category}</span>
                          </td>
                          <td className="py-3 px-4 text-right">{formatCurrency(c.revenue)}</td>
                          <td className="py-3 px-4 text-right text-slate-500">{formatCurrency(c.cogs)}</td>
                          <td className="py-3 px-4 text-right text-emerald-600 bg-emerald-500/5 border-x border-slate-100 font-bold">{formatCurrency(c.cm1)}</td>
                          <td className="py-3 px-4 text-right text-amber-600">{formatCurrency(c.advertisingSpend)}</td>
                          <td className="py-3 px-4 text-right text-slate-500">{formatCurrency(c.indirectExpAndPeople)}</td>
                          <td className={`py-3 px-4 text-right font-bold bg-indigo-500/5 border-x border-slate-100 ${c.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {formatCurrency(c.netProfit)}
                          </td>
                          <td className="py-3 px-4 text-center font-sans">
                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                              netMargin > 15 
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200" 
                                : netMargin > 0 
                                ? "bg-amber-100 text-amber-800 border border-amber-200" 
                                : "bg-rose-100 text-rose-800 border border-rose-200"
                            }`}>
                              {netMargin > 15 ? "High Yield" : netMargin > 0 ? "Viable" : "Bleeding"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: CHANNEL-WISE PROFILTABILITY DRILLDOWN (Spreadsheet compliant) */}
        {activeTab === "channels" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* Left Channel Sidebar Selection */}
            <div className="bg-white border border-slate-200 p-4 rounded-2xl flex flex-col gap-2 h-fit lg:sticky lg:top-24 shadow-sm">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-2">Business Channel Selector</h3>
              <div className="flex flex-col gap-1 overflow-y-auto max-h-[460px] pr-1">
                {channels.map(chan => {
                  const isSelected = chan.id === selectedChannelId;
                  const estimatedSimProfit = simulatedChannelsObj.find(sc => sc.id === chan.id)?.netProfit || 0;
                  return (
                    <button
                      key={chan.id}
                      id={`channel-btn-${chan.id}`}
                      onClick={() => setSelectedChannelId(chan.id)}
                      className={`w-full text-left p-3 rounded-xl flex items-center justify-between text-xs transition-all border ${
                        isSelected 
                          ? "bg-blue-600/10 border-blue-500/30 text-blue-900 shadow font-semibold" 
                          : "bg-slate-50/50 border-slate-200 hover:bg-slate-100 text-slate-700"
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-semibold">{chan.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5">{chan.category}</span>
                      </div>
                      <span className={`font-mono font-semibold text-[10px] ${estimatedSimProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {formatCurrency(estimatedSimProfit)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Complete Detailed Profitability Ledger */}
            <div className="lg:col-span-3 flex flex-col gap-6">
              
              {/* Channel Head info */}
              <div className="bg-white border border-slate-200 p-6 rounded-2xl relative shadow-sm overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-600/10 p-3 rounded-xl border border-blue-500/15">
                    <Building className="text-blue-600" size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      {selectedChannel.name} Profitability Ledger
                      <span className="text-xs font-mono font-medium px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                        {selectedChannel.category} Category
                      </span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">Audit ledger exactly matching organizational row classifications</p>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 p-2 rounded-xl flex items-center gap-3 self-start md:self-auto font-mono text-[11px] text-slate-600">
                  <span>Last synced: {new Date(selectedChannel.lastUpdated).toLocaleDateString()}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                </div>
              </div>

              {/* THREE SPREADSHEET TABLE CARD MODULES */}
              <div className="bg-white border border-slate-205 rounded-2xl overflow-hidden shadow-sm">
                
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign size={16} className="text-blue-600" />
                    <span className="text-sm font-bold text-slate-800 uppercase tracking-wider font-sans">1. Profit & Loss Structure (Lakhs)</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Calculated Rows</span>
                </div>

                {/* Sub-Table 1: Financial Rows */}
                <div className="px-6 py-4 bg-white">
                  <div className="space-y-1">                    {/* Row 1: Revenue */}
                    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 hover:bg-slate-50 px-2 rounded font-mono text-sm">
                      <div className="flex flex-col">
                        <span className="font-sans font-semibold text-slate-805">Revenue</span>
                        <span className="text-[10px] font-sans text-slate-400">Gross marketplace sale receipt base</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderComparisonBadge(activeSimulatedChannel.revenue, activeChannelComparativeMetrics?.revenue)}
                        <span className="font-bold text-slate-900">{formatCurrency(activeSimulatedChannel.revenue)}</span>
                      </div>
                    </div>

                    {/* Row 2: COGS */}
                    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 hover:bg-slate-50 px-2 rounded font-mono text-sm text-slate-700">
                      <div className="flex flex-col">
                        <span className="font-sans text-slate-700">COGS (Goods Landing Cost)</span>
                        <span className="text-[10px] font-sans text-slate-400">Includes raw material, duty, logistics</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderComparisonBadge(activeSimulatedChannel.cogs, activeChannelComparativeMetrics?.cogs, true)}
                        <span className="text-rose-600 font-semibold">-{formatCurrency(activeSimulatedChannel.cogs)}</span>
                      </div>
                    </div>

                    {/* Row 3: CM1 */}
                    <div className="flex items-center justify-between py-3 border-b border-slate-100 bg-emerald-500/5 hover:bg-emerald-500/10 px-2 rounded font-mono text-sm border-l-4 border-l-emerald-500">
                      <div className="flex flex-col">
                        <span className="font-sans font-semibold text-emerald-800">CM1 (Contribution Margin 1)</span>
                        <span className="text-[10px] font-sans text-emerald-600">Net revenue after landing costs, commission, and standard shipment</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-2">
                          {renderComparisonBadge(activeSimulatedChannel.cm1, activeChannelComparativeMetrics?.cm1)}
                          <span className="font-bold text-emerald-700">{formatCurrency(activeSimulatedChannel.cm1)}</span>
                        </div>
                        <span className="text-[10px] text-emerald-600">{(activeSimulatedChannel.revenue > 0 ? (activeSimulatedChannel.cm1 / activeSimulatedChannel.revenue) * 100 : 0).toFixed(1)}% of margin</span>
                      </div>
                    </div>

                    {/* Row 4: Indirect Exp & People Cost (Clickable Dropdown) */}
                    <div>
                      <div
                        className="flex items-center justify-between py-2.5 border-b border-slate-100 hover:bg-slate-50 px-2 rounded font-mono text-sm text-slate-700 cursor-pointer select-none"
                        onClick={() => {
                          if (selectedChannelId === "amazon") {
                            const next = !showIndirectBreakdown;
                            setShowIndirectBreakdown(next);
                            if (next && !breakdownFetched) {
                              fetchExpenseBreakdown(startDateStr, endDateStr);
                            }
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {selectedChannelId === "amazon" && (
                            <ChevronRight
                              size={14}
                              className={`text-slate-400 transition-transform duration-200 ${showIndirectBreakdown ? "rotate-90" : ""}`}
                            />
                          )}
                          <div className="flex flex-col">
                            <span className="font-sans text-slate-700">Indirect Exp + People Cost Allocation</span>
                            <span className="text-[10px] font-sans text-slate-400">
                              {selectedChannelId === "amazon" ? "Click to view fee breakdown — FBA fees, commissions, closing fees" : "Attributed staffing, dark store rents, corporate overheads"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {renderComparisonBadge(activeSimulatedChannel.indirectExpAndPeople, activeChannelComparativeMetrics?.indirectExpAndPeople, true)}
                          <span className="text-slate-700">-{formatCurrency(activeSimulatedChannel.indirectExpAndPeople)}</span>
                        </div>
                      </div>

                      {/* Expense Breakdown Dropdown */}
                      {selectedChannelId === "amazon" && showIndirectBreakdown && (
                        <div className="bg-slate-50/80 border-l-2 border-slate-300 ml-4 mb-1 rounded-b overflow-hidden">
                          {isLoadingBreakdown ? (
                            <div className="flex items-center justify-center py-4 gap-2 text-xs text-slate-400">
                              <RefreshCw size={12} className="animate-spin" />
                              <span>Loading breakdown...</span>
                            </div>
                          ) : (
                            <div>
                              {/* High-level summary from Unified Transactions (matches outer total) */}
                              <div className="px-3 pt-2 pb-1">
                                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Fee Summary (from Transactions Report)</span>
                              </div>
                              <div className="divide-y divide-slate-100">
                                {indirectSummaryData.map((item, idx) => (
                                  <div key={`s-${idx}`} className="flex items-center justify-between py-2 px-3 hover:bg-slate-100/60 text-xs font-mono">
                                    <span className="text-slate-700 font-sans font-medium">{item.description}</span>
                                    <span className="text-slate-800 font-semibold">{formatCurrency(item.amount)}</span>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between py-2 px-3 bg-blue-50/80 font-semibold text-xs font-mono border-t border-slate-200">
                                  <span className="text-blue-800 font-sans">Total Indirect Expenses</span>
                                  <span className="text-blue-900">{formatCurrency(indirectTotal)}</span>
                                </div>
                              </div>

                              {/* Detailed breakdown from settlement tables */}
                              {indirectSettlementData.length > 0 && (
                                <>
                                  <div className="px-3 pt-3 pb-1 border-t border-slate-200">
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Detailed Breakdown (from Settlement Reports)</span>
                                  </div>
                                  <div className="divide-y divide-slate-100">
                                    {indirectSettlementData.map((item, idx) => (
                                      <div key={`d-${idx}`} className="flex items-center justify-between py-1.5 px-3 hover:bg-slate-100/60 text-xs font-mono">
                                        <span className="text-slate-600 font-sans">{item.description}</span>
                                        <span className="text-slate-700">{formatCurrency(item.amount)}</span>
                                      </div>
                                    ))}
                                    <div className="flex items-center justify-between py-2 px-3 bg-slate-100/80 font-semibold text-xs font-mono border-t border-slate-200">
                                      <span className="text-slate-600 font-sans">Settlement Total</span>
                                      <span className="text-slate-700">{formatCurrency(indirectSettlementTotal)}</span>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Added Row: Performance Ad Spend */}
                    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 hover:bg-slate-50 px-2 rounded font-mono text-sm text-slate-700">
                      <div className="flex flex-col">
                        <span className="font-sans text-slate-700">Platform Sponsored Advertising Spend</span>
                        <span className="text-[10px] font-sans text-slate-400">CPC bids, sponsored brands, quick commerce display flags</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderComparisonBadge(activeSimulatedChannel.advertisingSpend, activeChannelComparativeMetrics?.advertisingSpend, true)}
                        <span className="text-amber-700">-{formatCurrency(activeSimulatedChannel.advertisingSpend)}</span>
                      </div>
                    </div>

                    {/* Row 5: CM2 */}
                    <div className="flex items-center justify-between py-3 border-b border-slate-100 bg-blue-500/5 hover:bg-blue-500/10 px-2 rounded font-mono text-sm border-l-4 border-l-blue-500">
                      <div className="flex flex-col">
                        <span className="font-sans font-semibold text-blue-900">CM2 (EBITDA Core Profit)</span>
                        <span className="text-[10px] font-sans text-blue-600">EBITDA earnings before tax, interest allocations</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-2">
                          {renderComparisonBadge(activeSimulatedChannel.cm2, activeChannelComparativeMetrics?.cm2)}
                          <span className="font-bold text-blue-800">{formatCurrency(activeSimulatedChannel.cm2)}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">ROAS conversion efficiency active</span>
                      </div>
                    </div>

                    {/* Row 6: interest + tax + DA */}
                    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 hover:bg-slate-50 px-2 rounded font-mono text-sm text-slate-500">
                      <div className="flex flex-col">
                        <span className="font-sans text-slate-500">Interest + Tax + DA (Depreciation/Amortization)</span>
                        <span className="text-[10px] font-sans text-slate-400">Financing costs, taxation allocations</span>
                      </div>
                      <span className="text-slate-500">-{formatCurrency(activeSimulatedChannel.interestTaxDA)}</span>
                    </div>

                    {/* Row 7: Net Profit */}
                    <div className={`flex items-center justify-between py-4.5 bg-slate-50 hover:bg-slate-100/70 px-3 rounded font-mono text-base border-2 ${
                      activeSimulatedChannel.netProfit >= 0 ? "border-emerald-500/50" : "border-rose-500/50"
                    }`}>
                      <div className="flex flex-col">
                        <span className="font-sans font-extrabold text-slate-850">Net Profit</span>
                        <span className="text-[10px] font-sans text-slate-400">Bottom line channel yield after ALL operational costs</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderComparisonBadge(activeSimulatedChannel.netProfit, activeChannelComparativeMetrics?.netProfit)}
                        <span className={`font-extrabold text-lg text-right ${activeSimulatedChannel.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {formatCurrency(activeSimulatedChannel.netProfit)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sub-Table 2: Efficiency & Listing Metrics */}
                <div className="bg-slate-50 px-6 py-4.5 border-y border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={16} className="text-slate-655" />
                    <span className="text-sm font-bold text-slate-800 uppercase tracking-wider font-sans">2. Listing & Volume Performance Indices</span>
                  </div>
                </div>

                <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-white">
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[10.5px] text-slate-500 uppercase font-medium">Average Order Value (AOV)</span>
                      <p className="text-xs text-slate-405 mt-0.5">Average checkout ticket price</p>
                    </div>
                    <span className="font-mono text-lg font-bold text-slate-800">₹{selectedChannel.aov.toFixed(0)}</span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[10.5px] text-slate-500 uppercase font-medium">Orders Per Day (OPD)</span>
                      <p className="text-xs text-slate-405 mt-0.5">Daily shipment run counts</p>
                    </div>
                    <span className="font-mono text-lg font-bold text-slate-800">{selectedChannel.ordersPerDay} units</span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[10.5px] text-slate-500 uppercase font-medium">Listings Count (SKUs)</span>
                      <p className="text-xs text-slate-405 mt-0.5">Total registered catalog SKUs</p>
                    </div>
                    <span className="font-mono text-lg font-bold text-slate-800">{selectedChannel.listingsCount}</span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[10.5px] text-slate-500 uppercase font-medium">Active Listing Count</span>
                      <p className="text-xs text-slate-405 mt-0.5">Visibly indexed search elements</p>
                    </div>
                    <span className="font-mono text-lg font-bold text-emerald-600">{selectedChannel.activeListingCount} / {selectedChannel.listingsCount}</span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center justify-between md:col-span-2">
                    <div>
                      <span className="text-[10.5px] text-slate-500 uppercase font-medium">Revenue Per SKU (ASIN Performance)</span>
                      <p className="text-xs text-slate-405 mt-0.5">Average output yielded per logged catalog element</p>
                    </div>
                    <span className="font-mono text-lg font-bold text-slate-800">{formatCurrency(selectedChannel.revenuePerSku)}</span>
                  </div>
                </div>

                {/* Sub-Table 3: Operational Metrics */}
                <div className="bg-slate-50 px-6 py-4.5 border-y border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-slate-655" />
                    <span className="text-sm font-bold text-slate-800 uppercase tracking-wider font-sans">3. Supply Chain & Returns Vulnerability</span>
                  </div>
                </div>

                <div className="px-6 py-4 bg-white">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    
                    <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200 text-center">
                      <span className="text-[10px] text-slate-500 font-sans block uppercase font-medium">Out of Stock Days</span>
                      <span className="font-mono text-lg font-extrabold text-amber-600 block mt-1">{selectedChannel.outOfStockDays} days</span>
                      <span className="text-[9px] text-slate-405 font-sans mt-0.5">Average monthly lag</span>
                    </div>

                    <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200 text-center">
                      <span className="text-[10px] text-slate-500 font-sans block uppercase font-medium">Ageing Inventory (90D+)</span>
                      <span className="font-mono text-lg font-extrabold text-orange-600 block mt-1">{formatPercent(selectedChannel.ageingInventoryPct)}</span>
                      <span className="text-[9px] text-slate-405 font-sans mt-0.5">Overstocked catalog weight</span>
                    </div>

                    <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200 text-center">
                      <span className="text-[10px] text-slate-500 font-sans block uppercase font-medium">Dead Stock %</span>
                      <span className="font-mono text-lg font-extrabold text-rose-600 block mt-1">{formatPercent(selectedChannel.deadStockPct)}</span>
                      <span className="text-[9px] text-slate-405 font-sans mt-0.5">Zero daily transaction share</span>
                    </div>

                    <div className="bg-rose-50 border border-rose-100 p-4.5 rounded-xl text-center">
                      <span className="text-[10px] text-rose-800 font-sans block uppercase font-bold">Return & Refund Rate</span>
                      <span className="font-mono text-xl font-black text-rose-600 block mt-1">{formatPercent(selectedChannel.returnPct)}</span>
                      <span className="text-[9px] text-rose-500 font-sans mt-0.5">Customer order cancellation</span>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-100 p-4.5 rounded-xl text-center">
                      <span className="text-[10px] text-emerald-800 font-sans block uppercase font-medium">Claim Success Rate</span>
                      <span className="font-mono text-lg font-extrabold text-emerald-600 block mt-1">{formatPercent(selectedChannel.claimPct)}</span>
                      <span className="text-[9px] text-emerald-600 font-sans mt-0.5">UnReturned cargo recoveries</span>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-100 p-4.5 rounded-xl text-center">
                      <span className="text-[10px] text-emerald-800 font-sans block uppercase font-medium">Reimbursement Amount</span>
                      <span className="font-mono text-lg font-extrabold text-emerald-600 block mt-1">{formatCurrency(selectedChannel.reimbursementPct)}</span>
                      <span className="text-[9px] text-emerald-600 font-sans mt-0.5">Amazon SPF credit scale</span>
                    </div>

                  </div>
                </div>

                {/* Sub-Table 4: Catalogue benchmark */}
                <div className="bg-slate-50 px-6 py-4.5 border-y border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckSquare size={16} className="text-slate-655" />
                    <span className="text-sm font-bold text-slate-800 uppercase tracking-wider font-sans">4. Catalogue Benchmark Standard</span>
                  </div>
                </div>
                <div className="px-6 py-4 flex items-center justify-around font-mono text-sm bg-white text-slate-705">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-sans">Total Catalogue SKUs:</span>
                    <span className="text-slate-900 font-bold">{selectedChannel.totalSkus}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-sans">Ideal Benchmark Target:</span>
                    <span className="text-amber-700 font-bold">{selectedChannel.skusBenchmark} SKUs</span>
                  </div>
                </div>

              </div>

              {/* Anomaly Detection Cards */}
              {selectedChannelId === "amazon" && anomalies && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">

                  {/* Unreconciled Orders */}
                  <div className="bg-white border border-rose-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle size={15} className="text-rose-500" />
                      <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">Unreconciled Discrepancies</span>
                      <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">{anomalies.unreconciledOrders?.length || 0}</span>
                      <a href={`/api/amazon/anomalies/csv?type=unreconciled&startDate=${startDateStr}&endDate=${endDateStr}`} className="ml-auto text-slate-400 hover:text-rose-500 transition-colors" title="Download full CSV report"><Download size={14} /></a>
                    </div>
                    {anomalies.unreconciledOrders?.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {anomalies.unreconciledOrders.map((o: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-[10px] font-mono bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">
                            <div className="truncate max-w-[120px]">
                              <span className="text-slate-700 font-semibold">{o.orderId}</span>
                              <span className="text-slate-400 block">{o.sku}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-rose-600 font-bold block">Diff: {formatCurrency(o.invoiceDiff)}</span>
                              <span className="text-slate-400">Tax: {formatCurrency(o.taxDiff)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-400 font-sans">No discrepancies detected</p>
                    )}
                  </div>

                  {/* High Return SKUs */}
                  <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle size={15} className="text-amber-500" />
                      <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">High Return SKUs (&gt;15%)</span>
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">{anomalies.highReturnSkus?.length || 0}</span>
                      <a href={`/api/amazon/anomalies/csv?type=highReturns&startDate=${startDateStr}&endDate=${endDateStr}`} className="ml-auto text-slate-400 hover:text-amber-500 transition-colors" title="Download full CSV report"><Download size={14} /></a>
                    </div>
                    {anomalies.highReturnSkus?.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {anomalies.highReturnSkus.map((s: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-[10px] font-mono bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">
                            <span className="text-slate-700 font-semibold truncate max-w-[140px]">{s.sku}</span>
                            <div className="text-right">
                              <span className="text-amber-600 font-bold">{s.returnRate}%</span>
                              <span className="text-slate-400 block">{s.returned}/{s.shipped} units</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-400 font-sans">No high-return SKUs detected</p>
                    )}
                  </div>

                  {/* Fee Overcharges */}
                  <div className="bg-white border border-orange-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle size={15} className="text-orange-500" />
                      <span className="text-xs font-bold text-orange-700 uppercase tracking-wider">Fee Overcharges (&gt;40%)</span>
                      <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">{anomalies.feeOvercharges?.length || 0}</span>
                      <a href={`/api/amazon/anomalies/csv?type=feeOvercharges&startDate=${startDateStr}&endDate=${endDateStr}`} className="ml-auto text-slate-400 hover:text-orange-500 transition-colors" title="Download full CSV report"><Download size={14} /></a>
                    </div>
                    {anomalies.feeOvercharges?.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {anomalies.feeOvercharges.map((o: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-[10px] font-mono bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">
                            <div className="truncate max-w-[120px]">
                              <span className="text-slate-700 font-semibold">{o.orderId}</span>
                              <span className="text-slate-400 block">{o.sku}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-orange-600 font-bold">{o.feeRatio}% fees</span>
                              <span className="text-slate-400 block">{formatCurrency(o.totalFees)} / {formatCurrency(o.sales)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-400 font-sans">No fee overcharges detected</p>
                    )}
                  </div>

                </div>
              )}

              {/* AI Strategic Consultation Module for Selected Channel */}
              <div className="bg-emerald-50/20 border border-emerald-200 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl translate-x-12 -translate-y-12"></div>
                
                <div className="flex items-center gap-2 text-emerald-800 mb-3">
                  <Sparkles size={18} />
                  <span className="text-xs font-bold uppercase tracking-wider">CFO Assistant • Real-Time AI Strategic Diagnostics</span>
                </div>

                <div className="space-y-4 font-sans">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-white text-xs border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 outline-none focus:border-emerald-500/50 transition-all font-sans"
                      value={aiQuestion}
                      onChange={(e) => setAiQuestion(e.target.value)}
                      placeholder="Ask our AI to analyze margins, recommend prices, or find leakages..."
                    />
                    <button
                      onClick={() => getAIQuery(aiQuestion)}
                      disabled={aiLoading}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-slate-200 disabled:text-slate-400 px-4 py-2.5 rounded-xl border border-emerald-500/10 active:scale-95 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
                    >
                      {aiLoading ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      ) : (
                        <Send size={14} />
                      )}
                      <span className="text-xs font-semibold">Consult</span>
                    </button>
                  </div>

                  {/* Dynamic Gemini advice bubble */}
                  {aiResponse ? (
                    <div className="bg-white rounded-xl p-4.5 border border-emerald-100 font-sans text-xs leading-relaxed max-h-[290px] overflow-y-auto shadow-sm">
                      <div className="prose prose-xs text-slate-700">
                        {aiResponse.split("\n").map((line, ix) => (
                          <p key={ix} className="mb-2 last:mb-0">
                            {line.startsWith("#") ? (
                              <span className="text-slate-900 font-bold text-xs uppercase block mt-1 mb-1 tracking-wider">{line.replace(/#/g, "").trim()}</span>
                            ) : line.startsWith("-") || line.startsWith("*") ? (
                              <span className="pl-2 border-l border-emerald-500/40 text-slate-700 block my-1">{line.replace(/^[-*]\s*/, "")}</span>
                            ) : (
                              line
                            )}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                      <HelpCircle size={11} />
                      <span>Press "Consult" to request a comprehensive diagnostic powered by Gemini 3.5 Flash.</span>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 3: SKU-WISE DRILLDOWN DETAILS */}
        {activeTab === "skus" && (
          <div className="flex flex-col gap-6">

            {/* SKU Filters Dashboard Bar */}
            <div className="bg-white border border-slate-200 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="text"
                    className="bg-white text-xs text-slate-800 rounded-xl pl-10 pr-4 py-2 border border-slate-205 focus:border-blue-500 outline-none w-full md:w-64 font-sans"
                    placeholder="Search SKU code or item name..."
                    value={skuSearch}
                    onChange={(e) => setSkuSearch(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Briefcase size={13} className="text-slate-400" />
                  <span className="text-xs text-slate-500 font-medium">Channel:</span>
                  <select
                    value={skuChannelFilter}
                    onChange={(e) => setSkuChannelFilter(e.target.value)}
                    className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-medium outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {channels.map(ch => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <Filter size={13} className="text-slate-400" />
                  <span className="text-xs text-slate-505 font-medium">Profit Filter:</span>
                  <div className="flex bg-slate-50 p-1 rounded-lg border border-slate-200">
                    {["all", "profitable", "loss", "borderline"].map(filterKey => (
                      <button
                        key={filterKey}
                        onClick={() => setSkuFilter(filterKey)}
                        className={`text-[10px] px-2.5 py-1 rounded capitalize font-medium ${
                          skuFilter === filterKey 
                            ? "bg-white text-slate-800 shadow-sm font-semibold border border-slate-200/50" 
                            : "text-slate-400 hover:text-slate-655"
                        }`}
                      >
                        {filterKey}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-500 bg-slate-50 px-3.5 py-1.5 rounded-lg border border-slate-200">
                Found <span className="text-slate-800 font-bold">{filteredSKUs.length}</span> SKUs in localized index
              </div>
            </div>

            {/* Detailed SKU Margin Spreadsheet Card */}
            <div className="bg-white border border-slate-201 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">SKU / Item Name</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4 text-center">Units Sold</th>
                      <th className="py-3 px-4 text-right">Revenue</th>
                      <th className="py-3 px-4 text-right text-rose-700">Landing COGS</th>
                      <th className="py-3 px-4 text-right">Mkt Commission</th>
                      <th className="py-3 px-4 text-right">Pack & Ship</th>
                      <th className="py-3 px-4 text-right text-amber-700">Return Loss</th>
                      <th className="py-3 px-4 text-right">Performance Ads</th>
                      <th className="py-3 px-4 text-right text-emerald-700 bg-emerald-500/5">Net Profit</th>
                      <th className="py-3 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                    {filteredSKUs.map(s => {
                      return (
                        <tr key={s.sku} className="hover:bg-slate-51 transition-all">
                          <td className="py-3.5 px-4 font-sans text-slate-900">
                            <span className="block font-mono font-semibold text-[11px] text-slate-400">{s.sku}</span>
                            <span className="block text-xs font-semibold mt-0.5 text-slate-800 line-clamp-1">{s.name}</span>
                          </td>
                          <td className="py-3.5 px-4 font-sans">
                            <span className="bg-slate-50 px-2.5 py-0.5 rounded text-[10px] text-slate-600 border border-slate-200">{s.category}</span>
                          </td>
                          <td className="py-3.5 px-4 text-center text-slate-800 font-bold">{s.unitsSold.toLocaleString()}</td>
                          <td className="py-3.5 px-4 text-right text-slate-900">{formatCurrency(s.revenue)}</td>
                          <td className="py-3.5 px-4 text-right text-rose-600 font-medium">{formatCurrency(s.landingCost)}</td>
                          <td className="py-3.5 px-4 text-right text-slate-500">{formatCurrency(s.marketplaceFees)}</td>
                          <td className="py-3.5 px-4 text-right text-slate-500">{formatCurrency(s.packagingCost + s.shippingCost)}</td>
                          <td className="py-3.5 px-4 text-right text-amber-600">{formatCurrency(s.returnLoss)}</td>
                          <td className="py-3.5 px-4 text-right text-slate-500">{formatCurrency(s.adsSpend)}</td>
                          <td className={`py-3.5 px-4 text-right font-black bg-emerald-51/40 ${
                            s.status === "Profitable" ? "text-emerald-600" : s.status === "Borderline" ? "text-amber-600" : "text-rose-600"
                          }`}>
                            {formatCurrency(s.netProfit)}
                          </td>
                          <td className="py-3.5 px-4 text-center font-sans">
                            <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${
                              s.status === "Profitable" 
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200" 
                                : s.status === "Borderline"
                                ? "bg-amber-100 text-amber-800 border border-amber-200"
                                : "bg-rose-100 text-rose-800 border border-rose-200"
                            }`}>
                              {s.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Operational Levers Information for management */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 font-sans flex items-center gap-2">
                <Sliders size={16} className="text-blue-600" />
                Management Guidance Portfolio • SKU Optimization Actions
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-600 leading-relaxed font-sans">
                <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200">
                  <span className="text-sm font-bold text-rose-700 flex items-center gap-2 mb-2">
                    <TrendingDown size={14} />
                    1. Electronic Charging Losses
                  </span>
                  Our <strong>Wireless Charging Pad (SKU-WFAST-CHG-12)</strong> is running direct deficit of -₹45k. Primary causation is high electronic return rates of 18% with shipping losses. 
                  <span className="text-slate-900 block font-semibold mt-2">Action: Revise packaging shock absorption & restrict Meesho catalog delivery.</span>
                </div>
                
                <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200">
                  <span className="text-sm font-bold text-amber-700 flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} />
                    2. Lavender Diffuser (Borderline)
                  </span>
                  Lavender Aromatherapy runs thin margins of ₹66k because advertising spend has scaled to match 26.4% total sales revenue. Keyword bids are hyper inflated on generic terms.
                  <span className="text-slate-900 block font-semibold mt-2">Action: Implement maximum ROAS capping filter at 2.5x to throttle unprofitable bids.</span>
                </div>

                <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200">
                  <span className="text-sm font-bold text-emerald-700 flex items-center gap-2 mb-2">
                    <TrendingUp size={14} />
                    3. Toothbrush Bulk Opportunity
                  </span>
                  Premium Bamboo Charcoal Toothbrush yields a gorgeous 14.7% Net Yield on Amazon because returns are extremely low (under 1%). Landing costs scale perfectly with volume.
                  <span className="text-slate-900 block font-semibold mt-2">Action: Set up Swiggy Instamart custom bundle of 10 to increase basket ticket and yield.</span>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* TAB 4: ORDER LEVEL RECONCILIATION AUDIT CONTROL PANEL */}
        {activeTab === "reconciliation" && (
          <div className="flex flex-col gap-6">
            
            {/* Auditing Cockpit Breakdown Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                <span className="text-xs text-slate-500 block uppercase font-semibold">TOTAL RECONCILED ORDERS</span>
                <span className="text-2xl font-bold text-slate-900 font-mono block mt-2">{orders.length} orders</span>
                <span className="text-[10px] text-slate-400 mt-1 block">Audited past 7 days</span>
              </div>

              <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                <span className="text-xs text-rose-800 block uppercase font-semibold">OVERCHArged Fee Claims IDENTIFIED</span>
                <span className="text-2xl font-bold text-rose-600 font-mono block mt-2">{reconciliationSummary.discrepancyCount} cases</span>
                <p className="text-[10px] text-slate-400 mt-1">Discovered through contract audit logic</p>
              </div>

              <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                <span className="text-xs text-slate-500 block uppercase font-semibold">DISCREPANCY AMOUNT</span>
                <span className="text-2xl font-bold text-amber-600 font-mono block mt-2">{formatCurrency(reconciliationSummary.totalOvercharged)}</span>
                <span className="text-[10px] text-rose-600 font-mono mt-1 block font-medium">⚠️ Leaking from bank transfers</span>
              </div>

              <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl shadow-sm">
                <span className="text-xs text-emerald-800 block uppercase font-bold">SECURED RECOVERY CLAIMS</span>
                <span className="text-2xl font-bold text-emerald-600 font-mono block mt-2">{formatCurrency(reconciliationSummary.securedRefunds)}</span>
                <span className="text-[10px] text-emerald-600 mt-1 block font-medium">✓ Credited back to bank statements</span>
              </div>
            </div>

            {/* Reconciliation filter control */}
            <div className="bg-white border border-slate-200 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="text"
                    className="bg-white text-xs text-slate-800 rounded-xl pl-10 pr-4 py-2 border border-slate-200 focus:border-blue-500 outline-none w-full md:w-64 font-sans"
                    placeholder="Search Order ID or SKU..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 text-xs font-sans">
                  <select 
                    value={reconPlatformFilter} 
                    onChange={(e) => setReconPlatformFilter(e.target.value)}
                    className="bg-white text-slate-800 border border-slate-200 rounded-xl px-3 py-1.5 outline-none text-xs font-sans"
                  >
                    <option value="all">All Marketplace Portals</option>
                    <option value="Amazon">Amazon India Only</option>
                    <option value="Flipkart">Flipkart Only</option>
                  </select>

                  <select 
                    value={reconStatusFilter} 
                    onChange={(e) => setReconStatusFilter(e.target.value)}
                    className="bg-white text-slate-805 border border-slate-200 rounded-xl px-3 py-1.5 outline-none text-xs font-sans focus:border-blue-500"
                  >
                    <option value="all">All Audit Statuses</option>
                    <option value="Overcharged">Fee Overcharged</option>
                    <option value="Returned">Returned Deduct Errors</option>
                    <option value="Reconciled">Fully Reconciled</option>
                  </select>
                </div>
              </div>

              <button 
                onClick={() => showToast("Exported claim formats compatible with Safe-T Claim upload sheets.")}
                className="bg-slate-50 hover:bg-slate-100 font-mono text-[10px] text-slate-700 font-semibold px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-200 active:scale-95 transition-all cursor-pointer"
              >
                <Download size={13} strokeWidth={2.5} />
                Download Safe-T CSV
              </button>
            </div>

            {/* Reconciliation Audit Master List */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Order List Table */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden lg:col-span-2 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200 font-sans">
                      <tr>
                        <th className="py-3 px-4">Order ID & Date</th>
                        <th className="py-3 px-4">Market</th>
                        <th className="py-3 px-4">SKU Code</th>
                        <th className="py-3 px-4 text-right">Invoice</th>
                        <th className="py-3 px-4 text-right text-rose-700">Total Fee Deduction</th>
                        <th className="py-3 px-4 text-right text-amber-700 font-medium">Bank Disbursed Actual</th>
                        <th className="py-3 px-4 text-center">Audit Assessment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                      {filteredOrders.map(o => {
                        const hasDifference = o.reconciliationDifference > 0;
                        const isSelected = selectedOrder?.orderId === o.orderId;
                        return (
                          <tr 
                            key={o.orderId} 
                            onClick={() => setSelectedOrder(o)}
                            className={`hover:bg-slate-50 transition-all cursor-pointer ${
                              isSelected ? "bg-blue-50/70 border-l-2 border-l-blue-600 text-slate-900 font-medium" : ""
                            }`}
                          >
                            <td className="py-3 px-4 font-sans">
                              <span className="block font-mono font-semibold text-slate-850">{o.orderId}</span>
                              <span className="text-[9.5px] text-slate-400 mt-0.5 block">{o.dateTime}</span>
                            </td>
                            <td className="py-3 px-4 font-sans">
                              <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${
                                o.platform === "Amazon" ? "bg-amber-100 text-amber-800 border border-amber-200" : "bg-blue-100 text-blue-800 border border-blue-200"
                              }`}>
                                {o.platform}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-slate-650 font-mono text-[10.5px]">{o.sku.split("-")[1]}</td>
                            <td className="py-3 px-4 text-right text-slate-800 font-medium">₹{o.customerPaid}</td>
                            <td className="py-3 px-4 text-right text-rose-600 font-medium">₹{(o.referralFeeCharged + o.weightHandlingFeeCharged + o.closingFeeCharged + o.otherCharges).toFixed(1)}</td>
                            <td className="py-3 px-4 text-right text-slate-900 font-bold">₹{o.netDisbursedActual}</td>
                            <td className="py-3 px-4 text-center font-sans">
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold inline-block ${
                                o.status === "Fully Reconciled" 
                                  ? "bg-emerald-100 text-emerald-805" 
                                  : o.status.includes("Weight")
                                  ? "bg-amber-100 text-amber-805 border border-amber-200"
                                  : "bg-rose-100 text-rose-805 border border-rose-200"
                              }`}>
                                {hasDifference ? `Discrepancy (₹${o.reconciliationDifference})` : "✓ Matched"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Order Detail auditor drilldown */}
              <div className="bg-white border border-slate-200 p-5 rounded-2xl h-fit shadow-sm text-slate-750">
                {selectedOrder ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Currently Auditing:</span>
                        <h4 className="text-sm font-extrabold text-slate-800 font-mono mt-0.5">{selectedOrder.orderId}</h4>
                      </div>
                      <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded ${
                        selectedOrder.platform === "Amazon" ? "bg-amber-100 text-amber-800" : "bg-blue-105 text-blue-800"
                      }`}>
                        {selectedOrder.platform}
                      </span>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div className="flex justify-between font-sans">
                        <span className="text-slate-500">Item SKU Reference:</span>
                        <span className="font-mono text-slate-700 font-bold">{selectedOrder.sku}</span>
                      </div>
                      
                      <div className="flex justify-between font-sans">
                        <span className="text-slate-500">Order Invoice Amount:</span>
                        <span className="font-mono text-slate-750 font-semibold">₹{selectedOrder.customerPaid}</span>
                      </div>

                      <div className="border-t border-slate-100 my-2"></div>
                      
                      {/* Marketplace Fees */}
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mt-1 font-sans">Deducted Marketplace Fees:</span>
                      
                      <div className="flex justify-between pl-2 text-[11px] font-mono">
                        <span className="text-slate-500">1. Referral Commission fee:</span>
                        <span className="text-rose-600 font-medium">₹{selectedOrder.referralFeeCharged.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between pl-2 text-[11px] font-mono">
                        <span className="text-slate-500">2. Weight handling logistics fee:</span>
                        <span className={`font-semibold ${selectedOrder.status === "Overcharged (Weight)" ? "text-amber-700 underline font-bold" : "text-rose-600"}`}>
                          ₹{selectedOrder.weightHandlingFeeCharged.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex justify-between pl-2 text-[11px] font-mono">
                        <span className="text-slate-500">3. Standard closing / portal fee:</span>
                        <span className="text-rose-600 font-medium">₹{selectedOrder.closingFeeCharged.toFixed(2)}</span>
                      </div>

                      {selectedOrder.otherCharges > 0 && (
                        <div className="flex justify-between pl-2 text-[11px] font-mono">
                          <span className="text-rose-604 font-semibold">4. Refund processing/Double Charge:</span>
                          <span className="text-rose-604 font-bold">₹{selectedOrder.otherCharges.toFixed(2)}</span>
                        </div>
                      )}

                      <div className="border-t border-slate-100 my-2"></div>

                      <div className="flex justify-between font-semibold font-sans">
                        <span className="text-slate-550">CFO Target Disbursal (Rules):</span>
                        <span className="font-mono text-slate-800">₹{selectedOrder.netDisbursedEstimated.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between font-bold font-sans">
                        <span className="text-slate-650">Actual Bank Settled payout:</span>
                        <span className="font-mono text-slate-900">₹{selectedOrder.netDisbursedActual.toFixed(2)}</span>
                      </div>

                      {selectedOrder.reconciliationDifference > 0 ? (
                        <div className="bg-rose-50 rounded-xl p-3.5 border border-rose-100/80 text-rose-950 mt-2 font-sans animate-fade-in">
                          <span className="font-bold flex items-center gap-1 text-[11px] uppercase tracking-wider text-rose-800 mb-1">
                            <AlertTriangle size={12} />
                            Audit Discrepancy Found (₹{selectedOrder.reconciliationDifference})
                          </span>
                          <p className="text-[10px] leading-relaxed text-rose-700 font-sans">
                            {selectedOrder.status === "Overcharged (Weight)" && "Amazon dimensional weight scanners recorded this unit under volumetric tier, exceeding actual catalog dimensions. Dispute overcharge parameters."}
                            {selectedOrder.status === "Returned & Unreimbursed" && "The customer registered returning this item, but the portal deducted refund processing fees twice without credit payout. Standard SPF ticket required."}
                            {selectedOrder.status === "Settlement Discrepancy" && "Settlement ledger missed processing bank ledger entry entirely. File ticket with settlement compliance node."}
                            {selectedOrder.status === "Overcharged (Referral)" && "Incorrect referral fee code loaded. Product matches category with lower percentage bracket."}
                          </p>

                          <div className="mt-3 flex items-center justify-between">
                            <span className="text-[9px] bg-white text-slate-500 border border-slate-200 px-2 py-0.5 rounded font-mono">
                              Status: {selectedOrder.claimStatus}
                            </span>
                            {selectedOrder.claimStatus === "Unclaimed" ? (
                              <button 
                                onClick={() => handleFileDispute(selectedOrder.orderId)}
                                className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[9.5px] px-2.5 py-1 rounded transition-all cursor-pointer"
                              >
                                File Safe-T Dispute
                              </button>
                            ) : (
                              <button 
                                disabled
                                className="bg-slate-100 text-slate-400 border border-slate-200 font-semibold text-[9.5px] px-2.5 py-1 rounded cursor-not-allowed"
                              >
                                Ticket Logged
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 text-emerald-800 flex items-center gap-2 mt-2 font-sans">
                          <CheckCircle2 size={13} className="text-emerald-650" />
                          <span className="text-[10.5px]">Matches contract values perfectly. Reconciled.</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10 text-slate-400 flex flex-col items-center justify-center gap-2 font-sans">
                    <FileCheck2 size={28} className="text-slate-300 animate-pulse" />
                    <span className="text-xs">Click any row in the Audit ledger on the left to trigger double entry audit checks.</span>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* TAB 5: DYNAMIC CONFIGURATION OF FUTURE BUSINESS CHANNELS */}
        {activeTab === "configurer" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Custom Channel Builder Form */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl lg:col-span-2 shadow-sm text-slate-700">
              <h3 className="text-sm font-bold text-slate-805 uppercase tracking-wider mb-2 font-sans">Strategic Dynamic Channel Provisioning Node</h3>
              <p className="text-xs text-slate-450 mb-6 font-sans">Manage expansions. Provision a simulated channel projection model, configured with baseline commissions and overhead parameters.</p>

              <form onSubmit={handleAddChannel} className="space-y-4">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] text-slate-500 font-sans font-medium uppercase">Platform Channel Name:</label>
                    <input
                      type="text"
                      className="bg-white text-xs text-slate-805 border border-slate-200 rounded-xl px-4 py-2.5 focus:border-blue-500 outline-none"
                      placeholder="e.g. Tata Neu, Reliance Digital, Nykaa"
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] text-slate-500 font-sans font-medium uppercase">Category Classification:</label>
                    <select
                      className="bg-white text-xs text-slate-805 border border-slate-205 rounded-xl px-4 py-2.5 outline-none focus:border-blue-500"
                      value={newChannelCategory}
                      onChange={(e) => setNewChannelCategory(e.target.value)}
                    >
                      <option value="Marketplace">Marketplace Platform</option>
                      <option value="Quick Commerce">Quick Commerce Dark Store</option>
                      <option value="Offline">Offline Wholesaler / Distributor</option>
                      <option value="Specialty">Specialist Boutique / Niche</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] text-slate-500 font-sans font-medium uppercase">Baseline Projected Monthly GMV (₹):</label>
                    <input
                      type="number"
                      className="bg-white text-xs text-slate-805 border border-slate-205 rounded-xl px-4 py-2.5 focus:border-blue-500 outline-none font-mono"
                      value={newChannelRevenue}
                      onChange={(e) => setNewChannelRevenue(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] text-slate-500 font-sans font-medium uppercase">Target COGS Ratio (%):</label>
                    <input
                      type="number"
                      className="bg-white text-xs text-slate-805 border border-slate-205 rounded-xl px-4 py-2.5 focus:border-blue-500 outline-none font-mono"
                      value={newChannelCogsPct}
                      onChange={(e) => setNewChannelCogsPct(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] text-slate-500 font-sans font-medium uppercase">Target CM1 Margin (%):</label>
                    <input
                      type="number"
                      className="bg-white text-xs text-slate-805 border border-slate-205 rounded-xl px-4 py-2.5 focus:border-blue-500 outline-none font-mono"
                      value={newChannelCm1Pct}
                      onChange={(e) => setNewChannelCm1Pct(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] text-slate-500 font-sans font-medium uppercase font-mono">Attributed Fixed Overhead (₹):</label>
                    <input
                      type="number"
                      className="bg-white text-xs text-slate-805 border border-slate-205 rounded-xl px-4 py-2.5 focus:border-blue-500 outline-none font-mono"
                      value={newChannelStaffCost}
                      onChange={(e) => setNewChannelStaffCost(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] text-slate-500 font-sans font-medium uppercase">Target CPC Ad Budget (₹):</label>
                    <input
                      type="number"
                      className="bg-white text-xs text-slate-805 border border-slate-205 rounded-xl px-4 py-2.5 focus:border-blue-500 outline-none font-mono"
                      value={newChannelAdsSpend}
                      onChange={(e) => setNewChannelAdsSpend(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] text-slate-500 font-sans font-medium uppercase">Average Basket Order Value (₹):</label>
                    <input
                      type="number"
                      className="bg-white text-xs text-slate-805 border border-slate-205 rounded-xl px-4 py-2.5 focus:border-blue-500 outline-none font-mono"
                      value={newChannelAov}
                      onChange={(e) => setNewChannelAov(e.target.value)}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-sans text-xs font-bold px-6 py-3 rounded-xl border border-blue-500/10 active:scale-95 transition-all w-full flex items-center justify-center gap-2 mt-4 cursor-pointer"
                >
                  <PlusCircle size={15} />
                  Provision Platform Expansion Profile
                </button>

              </form>
            </div>

            {/* Platform rules overview & projections */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-col justify-between text-slate-600">
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2 font-sans">Dynamic Expansions Ledger Guidelines</h3>
                <p className="text-xs text-slate-450 mb-4 leading-relaxed font-sans">
                  Management enforces configuring dynamic models ahead of actual channel integration. Our dual-entry ledger instantly merges provisioned targets into the overall Consolidated Cockpit.
                </p>

                <div className="space-y-3 mt-4 text-xs font-sans">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="font-bold text-blue-700 block mb-1">Volumetric Calculation Tier</span>
                    Ensure dynamic referral rates set for category codes. Volumetric tier scan is auto-generated in standard 30 days based on AOV constraints.
                  </div>

                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="font-bold text-indigo-750 block mb-1">CM1 Protection Cap</span>
                    Enforced rule states that CM1 margins under 25% are automatically labeled "Unviable Platform Profile" blocking operational ad spends.
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 text-center font-mono mt-6 border-t border-slate-100 pt-4">
                Expansions profile model compliant with ISO CFO standard formats.
              </div>
            </div>

          </div>
        )}

        {/* TAB 6: DATABASE INTEGRATOR & PROBER */}
        {activeTab === "database" && (
          <div className="space-y-6">
            
            {/* Status Panel Header */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm text-slate-700">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <Database className="text-emerald-500" size={20} />
                    Supabase Database Connector
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 font-sans">
                    Connect and read live data from your Supabase database tables
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={checkDbStatus}
                    className="bg-slate-50 hover:bg-slate-105 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Retrieve variables state"
                  >
                    <RefreshCw size={12} className={isLoadingDb ? "animate-spin" : ""} />
                    Refresh State
                  </button>
                  <button
                    onClick={fetchB2cSchema}
                    disabled={isLoadingDb}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white text-xs font-bold px-5 py-2.5 rounded-xl border border-emerald-500/10 flex items-center gap-2 shadow-sm transition-all cursor-pointer font-sans"
                  >
                    {isLoadingDb ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        Exploring Database...
                      </>
                    ) : (
                      <>
                        <Database size={13} />
                        Explore & Pull B2C Schema
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* URL Status Banner */}
              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-sans">
                  <div className="flex items-center gap-2 text-slate-650">
                    <span className="font-semibold">Registered Host URI:</span>
                    <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded font-mono font-normal">
                      {dbStatus?.redactedUrl || "Checking..."}
                    </span>
                  </div>
                  <div>
                    {dbStatus?.isConfigured ? (
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-xl font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block"></span>
                        Active Connection Endpoint Loaded
                      </span>
                    ) : (
                      <span className="bg-amber-50 text-amber-700 border border-amber-100 px-2.5 py-1 rounded-xl font-medium flex items-center gap-1">
                        <AlertTriangle size={12} className="text-amber-600" />
                        Requires DATABASE_URL in secrets panel
                      </span>
                    )}
                  </div>
                </div>

                {/* Technical Diagnostics Block for Troubleshooting "base" EAI_AGAIN lookup errors */}
                {dbStatus?.isConfigured && dbStatus?.debugInfo && (
                  <div className="mt-4 bg-slate-50 border border-slate-200/60 rounded-xl p-3.5 font-mono text-[10.5px] text-slate-600">
                    <div className="flex items-center justify-between border-b border-slate-200/50 pb-2 mb-2 font-sans font-bold text-slate-755 text-xs">
                      <span className="flex items-center gap-1.5 text-slate-700">
                        <Database size={13} className="text-slate-500" />
                        Active Connection Diagnostics
                      </span>
                      <span className="text-[10px] bg-slate-205 text-slate-600 px-1.5 py-0.5 rounded font-normal font-mono">
                        Parser Status: {dbStatus.debugInfo.parsedReady ? "SUCCESS" : "FAILED_RAW_FALLBACK"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-4">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Parsed Host:</span>
                        <span className="font-bold text-slate-800">{dbStatus.debugInfo.parsedHost || "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Parsed Database:</span>
                        <span className="font-bold text-slate-800">{dbStatus.debugInfo.parsedDatabase || "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Parsed Port:</span>
                        <span className="font-bold text-slate-800">{dbStatus.debugInfo.parsedPort || "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Parsed User:</span>
                        <span className="font-bold text-slate-800">{dbStatus.debugInfo.parsedUser || "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-450 border-t border-slate-200/40 pt-1.5 mt-0.5">
                        <span>Environment PGHOST:</span>
                        <span className={`${dbStatus.debugInfo.systemPgHost !== "NOT_SET" ? "text-amber-600 font-semibold" : ""}`}>
                          {dbStatus.debugInfo.systemPgHost}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-455 border-t border-slate-200/40 pt-1.5 mt-0.5">
                        <span>Environment PGDATABASE:</span>
                        <span>{dbStatus.debugInfo.systemPgDatabase}</span>
                      </div>
                    </div>
                    {dbStatus.debugInfo.parsedHost === "base" && (
                      <div className="mt-3 bg-amber-50 border border-amber-200 p-2.5 rounded-lg font-sans text-xs text-amber-800 leading-normal">
                        <strong>⚠️ Hostname Conflict Detected:</strong> The hostname is resolved to <code>"base"</code>, which is the internal docker link fallback. Please ensure that your <code>DATABASE_URL</code> secret is copy-pasted correctly from your Supabase panel and starts with <code>postgresql://</code>.
                      </div>
                    )}
                  </div>
                )}

                {!dbStatus?.isConfigured && (
                  <div className="mt-3 bg-amber-50/50 border border-amber-200/50 p-3 rounded-xl text-xs text-amber-805 leading-relaxed font-sans">
                    <p className="font-bold flex items-center gap-1 mb-1 text-amber-900">
                      <AlertTriangle size={13} />
                      Secrets Configuration Guide:
                    </p>
                    Your credentials are safe and sealed server-side. To synchronize your database, click the <strong>Settings (Gear icon)</strong> in AI Studio, choose <strong>Secrets</strong>, and insert:
                    <div className="mt-2 flex flex-col gap-1.5 font-mono bg-amber-100/30 p-2.5 rounded-lg border border-amber-250/20 text-slate-700">
                      <div><strong>Key:</strong> DATABASE_URL</div>
                      <div><strong>Value:</strong> postgresql://postgres:YOUR_PASSWORD@db.ppyumqeosmeyqlzjszla.supabase.co:5432/postgres</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ERROR REPORT IF SYNCHRONIZATION FAILED */}
            {dbError && (
              <div className="bg-red-50 border border-red-200 p-5 rounded-2xl shadow-sm text-red-805 font-sans text-xs">
                <h4 className="font-bold text-red-900 mb-1 flex items-center gap-1.5 text-sm">
                  <AlertTriangle size={15} />
                  Supabase Query Pipeline Blocked
                </h4>
                <p className="leading-relaxed whitespace-pre-wrap">{dbError}</p>
                {b2cSchemaData?.suggestion && (
                  <div className="mt-3 border-t border-red-200 pt-2 text-[11px] text-red-750 leading-normal">
                    <strong className="block mb-1">💡 Troubleshooting Recommendations:</strong>
                    {b2cSchemaData.suggestion}
                    <p className="mt-2 text-red-700 bg-red-100/20 p-2 rounded-lg border border-red-200/50 leading-relaxed">
                      Please make sure you replaces <code className="bg-red-100/50 px-1 py-0.5 rounded font-mono font-bold">[YOUR-PASSWORD]</code> with your actual Supabase DB password under secrets config.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* COLUMN TYPES SCHEMA & RECONCILIATION SUMMARY DETAILS */}
            {b2cSchemaData && b2cSchemaData.success && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* 1. Schema Info Grid (Left Panel) */}
                <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest font-sans">Table Schema Columns ({b2cSchemaData.columns?.length || 0})</h4>
                        <p className="text-[10px] text-slate-400 font-sans mt-0.5">Physical relational attributes pulled</p>
                      </div>
                      <span className="text-[10px] bg-slate-150 text-slate-600 font-mono font-bold px-1.5 py-0.5 rounded">
                        {b2cSchemaData.tableNameFound}
                      </span>
                    </div>

                    <div className="overflow-y-auto max-h-96 pr-1 space-y-1">
                      {b2cSchemaData.columns?.map((col: any) => (
                        <div key={col.columnName} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-slate-100/80 transition-colors border border-slate-200/30 text-xs font-mono">
                          <span className="font-semibold text-slate-750">{col.columnName}</span>
                          <span className="text-[10px] text-slate-500 font-semibold bg-white border border-slate-200/50 px-1.5 py-0.5 rounded-md">
                            {col.specs}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 border-t border-slate-100 pt-4 font-sans text-xs text-slate-500">
                    <div className="flex items-center justify-between text-slate-700 font-semibold mb-2">
                      <span>Total Table Size:</span>
                      <span className="bg-blue-50 text-blue-700 font-mono px-2 py-0.5 rounded-lg border border-blue-105">
                        {b2cSchemaData.rowCount?.toLocaleString()} rows
                      </span>
                    </div>
                    <p className="leading-relaxed text-[11px] text-slate-400">
                      The columns above represent the raw Amazon data stream. I have verified connection, extracted datatypes, and pulled raw sample entries to assist your tracking.
                    </p>
                  </div>
                </div>

                {/* 2. Available Tables Console (Middle/Right panel info) */}
                <div className="bg-slate-900 border border-slate-850 p-5 rounded-2xl shadow-sm lg:col-span-2 text-slate-300 flex flex-col justify-between font-sans">
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-800 pb-3">Public Schema Table Catalog</h4>
                    <p className="text-[11px] text-slate-450 leading-relaxed mb-4">
                      Below is the query mapping of tables in the <code className="bg-slate-805 px-1.5 py-0.5 rounded text-emerald-400 font-mono">public</code> namespace of your Supabase instance.
                    </p>

                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
                      {b2cSchemaData.availableTables?.map((tbl: string) => {
                        const isTarget = tbl.toLowerCase() === "amazongstmonthlyb2crow";
                        return (
                          <span 
                            key={tbl} 
                            className={`px-2.5 py-1 rounded-lg text-xs font-mono border ${
                              isTarget 
                                ? "bg-emerald-950/40 text-emerald-400 border-emerald-900 font-bold" 
                                : "bg-slate-950 text-slate-450 border-slate-800"
                            }`}
                          >
                            {tbl} {isTarget && "★ (Selected)"}
                          </span>
                        );
                      })}
                    </div>

                    <div className="mt-6 bg-slate-955 border border-slate-850 rounded-xl p-4 text-xs font-mono">
                      <span className="text-slate-500 block mb-1">PROBE TERMINAL TELEMETRY</span>
                      <div className="text-emerald-400 text-[10px] space-y-1">
                        <div>&gt; SELECT COUNT(*) FROM "{b2cSchemaData.tableNameFound}";</div>
                        <div className="text-slate-450"># result: {b2cSchemaData.rowCount} transactions verified.</div>
                        <div className="mt-1 font-mono">&gt; SELECT column_name, data_type FROM information_schema ...</div>
                        <div className="text-slate-450 font-mono"># success: {b2cSchemaData.columns?.length} attributes indexed with metadata.</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 text-[10.5px] text-slate-400 border-t border-slate-800 pt-3 leading-relaxed">
                    <span className="text-amber-500 font-bold">💡 Mapping Next Steps:</span> Now that we successfully pulled column names, you can guide me with how to sum/analyze these columns (e.g. subtracting commissions or taxes) to compile real-time aggregates in the dashboard!
                  </div>
                </div>

              </div>
            )}

            {/* INTERACTIVE SAMPLE RECORD VIEWER GRID */}
            {b2cSchemaData && b2cSchemaData.success && b2cSchemaData.sampleRows && b2cSchemaData.sampleRows.length > 0 && (
              <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm text-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest font-sans">Sample Rows Extract ({b2cSchemaData.sampleRows.length} of {b2cSchemaData.rowCount.toLocaleString()} total rows)</h3>
                    <p className="text-[10px] text-slate-400 font-sans mt-0.5">Direct live data feed representation from database</p>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono font-bold bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200/50">
                    LIMIT 25 Query Segment
                  </span>
                </div>

                {/* Horizontal scrollable data grid */}
                <div className="overflow-x-auto border border-slate-150 rounded-xl max-h-[480px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 font-mono text-slate-500 uppercase tracking-wider sticky top-0 bg-opacity-95 bg-white">
                        <th className="px-4 py-3 font-bold text-[10px] border-r border-slate-200">#</th>
                        {b2cSchemaData.columns?.map((col: any) => (
                          <th key={col.columnName} className="px-4 py-3 font-semibold text-[10px] border-r border-slate-200 whitespace-nowrap">
                            {col.columnName}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 font-mono text-[11px]">
                      {b2cSchemaData.sampleRows?.map((row: any, rIdx: number) => (
                        <tr key={rIdx} className="hover:bg-slate-50/80 transition-all font-normal">
                          <td className="px-4 py-2 text-slate-400 font-bold border-r border-slate-200 bg-slate-50/50 text-center sticky left-0 bg-white">{rIdx + 1}</td>
                          {b2cSchemaData.columns?.map((col: any) => {
                            const rawVal = row[col.columnName];
                            let displayVal = "--";
                            if (rawVal !== undefined && rawVal !== null) {
                              if (typeof rawVal === "object") {
                                displayVal = JSON.stringify(rawVal);
                              } else if (typeof rawVal === "boolean") {
                                displayVal = rawVal ? "TRUE" : "FALSE";
                              } else {
                                displayVal = String(rawVal);
                              }
                            }
                            return (
                              <td key={col.columnName} className="px-4 py-2 text-slate-800 border-r border-slate-200 truncate max-w-[220px]" title={displayVal}>
                                {displayVal}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}

      </main>

      </div>
      </div>

      {/* FOOTER */}
      <footer className="border-t border-slate-200 bg-white/40 py-6 px-6 text-center text-xs text-slate-400 font-mono flex flex-col md:flex-row items-center justify-between max-w-7xl mx-auto w-full">
        <span>© 2026 Centralized Financial Dashboard Core. All rights reserved.</span>
        <div className="flex items-center gap-4 mt-2 md:mt-0">
          <span>Supabase synced</span>
          <span>•</span>
          <span className="text-emerald-600 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block animate-ping"></span>
            Enterprise Standard Reconciled
          </span>
        </div>
      </footer>

    </div>
  );
}
