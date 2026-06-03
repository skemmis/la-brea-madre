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
        className="absolute bottom-4 left-4 flex items-center gap-1.5 text-[10px] font-mono text-[#d97706]/50 hover:text-[#d97706] tracking-widest bg-[#0f0b07]/80 border border-[#d97706]/20 px-2 py-1.5 rounded-sm"
      >
        <Trophy size={11} />
        LEADERBOARD
      </button>

      {open && (
        <div className="absolute bottom-14 left-4 w-64 bg-[#0f0b07] border border-[#d97706]/40 rounded-sm font-mono text-[#e8dcc8] text-xs shadow-2xl">
          <div className="flex items-center justify-between p-2.5 border-b border-[#d97706]/20">
            <span className="text-[10px] text-[#d97706]/60 tracking-widest">TERRITORY CONTROL</span>
            <button onClick={() => setOpen(false)} className="text-[#d97706]/40 hover:text-[#d97706]">
              <X size={12} />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {data.slice(0, 20).map((p, i) => (
              <div key={p.id} className="flex items-center justify-between px-3 py-1.5 border-b border-[#d97706]/5">
                <div className="flex items-center gap-2">
                  <span className="text-[#d97706]/40 w-4">{i + 1}</span>
                  <span className="text-[11px] truncate max-w-[110px]">{p.displayName}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-right">
                  <span className="text-[#888]">{p.totalHexes} hex</span>
                  <span className="text-[#d97706]">{p.crude.toLocaleString()}♦</span>
                </div>
              </div>
            ))}
            {data.length === 0 && (
              <p className="text-center text-[#555] p-4 text-[10px]">NO PLAYERS YET</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
