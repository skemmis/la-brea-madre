import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { toast } from "sonner";

export interface CardDef {
  id: string;
  name: string;
  text: string;
  rarity: "common" | "uncommon" | "rare";
  payoutMult?: number;
  loserRefund?: number;
  owned?: boolean;
}

export interface DrawnCard extends CardDef {
  isNew: boolean;
}

export interface CollectionView {
  owned: string[];
  effects: { payoutMult: number; loserRefund: number };
  catalog: CardDef[];
  packCost: number;
}

export interface OpenPackResult {
  drawn: DrawnCard[];
  refund: number;
  crude: number;
  collection: string[];
}

export function useCollection(enabled = true) {
  return useQuery<CollectionView>({
    queryKey: ["/api/deck"],
    queryFn: () => apiRequest("GET", "/api/deck"),
    enabled,
  });
}

export function useOpenPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<OpenPackResult>("POST", "/api/deck/open-pack"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/deck"] });
      qc.invalidateQueries({ queryKey: ["/api/player/me"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
