import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { toast } from "sonner";

interface PlayerState {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  crude: number;
  totalHexes: number;
  hexIndexes: string[];
  todayAction: { actionType: string; h3Index: string } | null;
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

export function useClaimHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (h3Index: string) =>
      apiRequest("POST", "/api/territory/claim", { h3Index }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player/me"] });
      qc.invalidateQueries({ queryKey: ["/api/map/hexes"] });
      toast.success("Hex claimed. The crude is yours.");
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
      qc.invalidateQueries({ queryKey: ["/api/player/me"] });
      qc.invalidateQueries({ queryKey: ["/api/map/hexes"] });
      toast.success("Hex upgraded.");
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

export function useRaidHex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (h3Index: string) =>
      apiRequest("POST", "/api/territory/raid", { h3Index }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/player/me"] });
      qc.invalidateQueries({ queryKey: ["/api/map/hexes"] });
      toast.success(`Contest initiated. Resolves at midnight PT.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
