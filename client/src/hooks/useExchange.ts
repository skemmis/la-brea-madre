import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { toast } from "sonner";

export interface ExchangeMarket {
  id: string;
  question: string;
  outcomes: string[]; // ["YES","NO"]
  prices: number[];
  status: "open" | "resolved";
  resolvedOutcome: number | null;
}

export interface BoardView {
  day: string | null;
  markets: ExchangeMarket[];
  empty?: string;
}

export interface ExchangePosition {
  marketId: string;
  question: string;
  outcomes: string[];
  prices: number[];
  shares: number[];
  spent: number;
  value: number;
}

export interface SettlementEntry {
  shares: number;
  spent: number;
  payout: number;
  profit: number;
}

export interface DayResult {
  marketId: string;
  type: string;
  question: string;
  outcome: string; // "YES" | "NO"
  line: number;
  actualA: number;
  actualB: number;
  settlement: {
    outcome: string;
    perPlayer: Record<string, SettlementEntry>;
  } | null;
}

export interface EndDayResult {
  day: string;
  results: DayResult[];
  nextDay: string | null;
}

export function useBoard() {
  return useQuery<BoardView>({
    queryKey: ["/api/exchange/board"],
    queryFn: () => apiRequest("GET", "/api/exchange/board"),
    refetchInterval: 30_000,
  });
}

export function useExchangePositions(enabled = true) {
  return useQuery<ExchangePosition[]>({
    queryKey: ["/api/exchange/positions"],
    queryFn: () => apiRequest("GET", "/api/exchange/positions"),
    enabled,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["/api/exchange/board"] });
    qc.invalidateQueries({ queryKey: ["/api/exchange/positions"] });
    qc.invalidateQueries({ queryKey: ["/api/player/me"] });
  };
}

export function useBuyExchange() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { marketId: string; outcome: number; budget: number }) =>
      apiRequest("POST", "/api/exchange/buy", v),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useEndDay() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => apiRequest<EndDayResult>("POST", "/api/exchange/end-day"),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });
}
