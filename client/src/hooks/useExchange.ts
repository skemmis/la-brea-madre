import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { toast } from "sonner";

// ─── Types (mirror server/exchangeService.ts) ────────────────────────────────

export interface ExchangeMarket {
  id: string;
  question: string;
  outcomes: string[]; // ["YES","NO"]
  prices: number[];
  status: "open" | "resolved";
  resolvedOutcome: number | null;
  targetDate: string;
  category: string;
  kind: string;
  line: number;
  labelA: string | null;
  labelB: string | null;
  state: "trading" | "closed" | "settled";
  volume: number;
  traders: number;
  spark: number[];
  baseRateYes: number;
  outcome?: string | null;
  actualA?: number | null;
  actualB?: number | null;
  myShares?: number[];
  mySpent?: number;
}

export interface BoardView {
  day: string;
  markets: ExchangeMarket[];
  closed: ExchangeMarket[];
  settled: ExchangeMarket[];
  empty?: string;
}

export interface TradeRow {
  id: number;
  user: string;
  userId: number;
  action: "buy" | "sell";
  outcome: string;
  shares: number;
  cost: number;
  yesPrice: number;
  at: string;
  marketId?: string;
  question?: string;
}

export interface HolderRow {
  user: string;
  userId: number;
  yes: number;
  no: number;
  spent: number;
}

export interface SeriesPanel {
  metric: string;
  label: string;
  series: { date: string; value: number }[];
  dow: { dow: number; avg: number; n: number }[];
  stats: { mean: number; median: number; max: number; maxDate: string; last: number; lastDate: string };
}

export interface MarketDetail {
  market: ExchangeMarket;
  rules: string;
  question: string;
  priceHistory: { t: string; yes: number }[];
  trades: TradeRow[];
  holders: HolderRow[];
  research: SeriesPanel[];
}

export interface OpenPosition {
  marketId: string;
  question: string;
  targetDate: string;
  state: "trading" | "closed";
  outcomes: string[];
  prices: number[];
  shares: number[];
  spent: number;
  value: number;
}

export interface PortfolioView {
  crude: number;
  open: OpenPosition[];
  history: {
    marketId: string;
    question: string;
    targetDate: string;
    outcome: string;
    won: boolean;
    shares: number;
    spent: number;
    payout: number;
    profit: number;
    settledAt: string;
  }[];
  trades: TradeRow[];
  equity: { date: string; realized: number }[];
  stats: {
    realized: number;
    openValue: number;
    openSpent: number;
    volume: number;
    marketsTraded: number;
    settledMarkets: number;
    wins: number;
    bestProfit: number;
    worstLoss: number;
  };
}

export interface TradeResult {
  market: { id: string; prices: number[] };
  crude: number;
  shares: number;
  cost: number;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useBoard() {
  return useQuery<BoardView>({
    queryKey: ["/api/exchange/board"],
    queryFn: () => apiRequest("GET", "/api/exchange/board"),
    refetchInterval: 30_000,
  });
}

export function useMarketDetail(id: string | null) {
  return useQuery<MarketDetail>({
    queryKey: ["/api/exchange/market", id],
    queryFn: () => apiRequest("GET", `/api/exchange/market/${id}`),
    enabled: !!id,
    refetchInterval: 20_000,
  });
}

export function useActivity() {
  return useQuery<TradeRow[]>({
    queryKey: ["/api/exchange/activity"],
    queryFn: () => apiRequest("GET", "/api/exchange/activity"),
    refetchInterval: 25_000,
  });
}

export function usePortfolio(enabled: boolean) {
  return useQuery<PortfolioView>({
    queryKey: ["/api/exchange/portfolio"],
    queryFn: () => apiRequest("GET", "/api/exchange/portfolio"),
    enabled,
    refetchInterval: 30_000,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

function invalidateFloor(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["/api/exchange/board"] });
  qc.invalidateQueries({ queryKey: ["/api/exchange/market"] });
  qc.invalidateQueries({ queryKey: ["/api/exchange/activity"] });
  qc.invalidateQueries({ queryKey: ["/api/exchange/portfolio"] });
  qc.invalidateQueries({ queryKey: ["/api/player/me"] });
}

export function useBuyExchange() {
  const qc = useQueryClient();
  return useMutation<TradeResult, Error, { marketId: string; outcome: number; budget: number }>({
    mutationFn: (body) => apiRequest("POST", "/api/exchange/buy", body),
    onSuccess: (r) => {
      toast.success(`Filled — ${r.shares.toFixed(1)} shares for $${r.cost.toFixed(1)}`);
      invalidateFloor(qc);
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useSellExchange() {
  const qc = useQueryClient();
  return useMutation<TradeResult, Error, { marketId: string; outcome: number; shares: number }>({
    mutationFn: (body) => apiRequest("POST", "/api/exchange/sell", body),
    onSuccess: (r) => {
      toast.success(`Sold — $${(-r.cost).toFixed(1)} returned`);
      invalidateFloor(qc);
    },
    onError: (e) => toast.error(e.message),
  });
}
