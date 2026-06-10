import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { toast } from "sonner";

interface PlayerState {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  crude: number; // bankroll, in dollars (the field name is a fossil)
  totalHexes: number;
  hexIndexes: string[];
  workOrders: number;
  tickDate: string;
}

export function usePlayer(enabled = true) {
  return useQuery<PlayerState>({
    queryKey: ["/api/player/me"],
    queryFn: () => apiRequest("GET", "/api/player/me"),
    enabled,
    refetchInterval: 60_000,
  });
}

function invalidateTerritory(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["/api/player/me"] });
  qc.invalidateQueries({ queryKey: ["/api/map/hexes"] });
}

export function useClaimHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (h3Index: string) =>
      apiRequest("POST", "/api/territory/claim", { h3Index }),
    onSuccess: () => {
      invalidateTerritory(qc);
      toast.success("Parcel claimed. The meter money is yours.");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useUpgradeHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (h3Index: string) =>
      apiRequest("POST", "/api/territory/upgrade", { h3Index }),
    onSuccess: () => {
      invalidateTerritory(qc);
      toast.success("Parcel upgraded.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useExploitHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ h3Index, exploit }: { h3Index: string; exploit: boolean }) =>
      apiRequest("POST", "/api/territory/exploit", { h3Index, exploit }),
    onSuccess: (_, { exploit }) => {
      qc.invalidateQueries({ queryKey: ["/api/map/hexes"] });
      toast[exploit ? "warning" : "success"](
        exploit
          ? "Exploit mode enabled. She will remember."
          : "Exploit mode disabled."
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useContestHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ h3Index, bid }: { h3Index: string; bid: number }) =>
      apiRequest("POST", "/api/territory/contest", { h3Index, bid }),
    onSuccess: () => {
      invalidateTerritory(qc);
      toast.success("War declared — sealed bids open at midnight PT.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDefendHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ h3Index, bid }: { h3Index: string; bid: number }) =>
      apiRequest("POST", "/api/territory/defend", { h3Index, bid }),
    onSuccess: () => {
      invalidateTerritory(qc);
      toast.success("Defense committed. Hold the line.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
