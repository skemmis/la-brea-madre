import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { Trophy, X } from "lucide-react";
import { useState } from "react";

interface LeaderEntry {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  crude: number;
  totalHexes: number;
}

export default function Leaderboard() {
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery<LeaderEntry[]>({
    queryKey: ["/api/leaderboard"],
    queryFn: () => apiRequest("GET", "/api/leaderboard"),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-ink absolute bottom-4 left-4 flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 bg-[var(--paper)]"
      >
        <Trophy size={11} />
        LEADERBOARD
      </button>

      {open && (
        <div className="plate absolute bottom-14 left-4 w-72 text-xs">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--ink-faint)]">
            <span className="plate-title text-[10px]">STANDINGS</span>
            <button
              onClick={() => setOpen(false)}
              className="opacity-50 hover:opacity-100 text-[var(--ink)]"
            >
              <X size={12} />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {data.slice(0, 20).map((p, i) => (
              <div
                key={p.id}
                className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--ink-faint)] last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span className="opacity-50 w-4 tabular-nums">{i + 1}</span>
                  <span className="text-[11px] truncate max-w-[120px]">{p.displayName}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-right tabular-nums">
                  <span className="text-[var(--sepia-soft)]">{p.totalHexes} hex</span>
                  <span className="font-bold">{p.crude.toLocaleString()}♦</span>
                </div>
              </div>
            ))}
            {data.length === 0 && (
              <p className="text-center text-[var(--sepia-soft)] p-4 text-[10px]" style={{ letterSpacing: "0.15em" }}>
                NO PLAYERS YET
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
