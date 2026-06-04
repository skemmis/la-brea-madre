import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { toast } from "sonner";

export interface MarketView {
  id: string;
  question: string;
  outcomes: string[];
  prices: number[];
  status: "open" | "resolved";
  resolvedOutcome: number | null;
}

export interface Position {
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

export interface RevealResult {
  marketId: string;
  question: string;
  targetDate: string;
  line: number;
  actualFine: number;
  outcome: string;
  settlement: {
    marketId: string;
    question: string;
    outcome: string;
    perPlayer: Record<string, SettlementEntry>;
  } | null;
}

export function useMarkets() {
  return useQuery<MarketView[]>({
    queryKey: ["/api/markets"],
    queryFn: () => apiRequest("GET", "/api/markets"),
    refetchInterval: 30_000,
  });
}

export function usePositions(enabled = true) {
  return useQuery<Position[]>({
    queryKey: ["/api/markets/positions"],
    queryFn: () => apiRequest("GET", "/api/markets/positions"),
    enabled,
  });
}

function useInvalidateMarkets() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["/api/markets"] });
    qc.invalidateQueries({ queryKey: ["/api/markets/positions"] });
    qc.invalidateQueries({ queryKey: ["/api/player/me"] });
  };
}

export function useOpenRound() {
  const invalidate = useInvalidateMarkets();
  return useMutation({
    mutationFn: () => apiRequest<MarketView>("POST", "/api/markets/open"),
    onSuccess: () => {
      invalidate();
      toast.success("A new line is on the board.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useBuy() {
  const invalidate = useInvalidateMarkets();
  return useMutation({
    mutationFn: (v: { marketId: string; outcome: number; budget: number }) =>
      apiRequest("POST", `/api/markets/${v.marketId}/buy`, {
        outcome: v.outcome,
        budget: v.budget,
      }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useReveal() {
  const invalidate = useInvalidateMarkets();
  return useMutation({
    mutationFn: (marketId: string) =>
      apiRequest<RevealResult>("POST", `/api/markets/${marketId}/reveal`),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });
}
