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

export function useRepairHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (h3Index: string) =>
      apiRequest("POST", "/api/territory/repair", { h3Index }),
    onSuccess: () => {
      invalidateTerritory(qc);
      toast.success("Crews dispatched — the parcel stands repaired.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useAssessHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ h3Index, price }: { h3Index: string; price: number }) =>
      apiRequest("POST", "/api/territory/assess", { h3Index, price }),
    onSuccess: () => {
      invalidateTerritory(qc);
      toast.success("Assessment filed. The county will be in touch.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useBuyoutHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (h3Index: string) =>
      apiRequest("POST", "/api/territory/buyout", { h3Index }),
    onSuccess: () => {
      invalidateTerritory(qc);
      toast.success("Sold! The deed is yours — at their price.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
