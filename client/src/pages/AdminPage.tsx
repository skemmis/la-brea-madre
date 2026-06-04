import { useState } from "react";
import { apiRequest } from "../lib/queryClient";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

interface Stats {
  users: number;
  hexes: number;
  ownedHexes: number;
  pendingContests: number;
}

export default function AdminPage() {
  const [running, setRunning] = useState<string | null>(null);

  const { data: stats, refetch } = useQuery<Stats>({
    queryKey: ["/api/admin/stats"],
    queryFn: () => apiRequest("GET", "/api/admin/stats"),
  });

  async function runAction(label: string, fn: () => Promise<unknown>) {
    setRunning(label);
    try {
      await fn();
      toast.success(`${label} complete`);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e8dcc8] font-mono p-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-[#d97706] text-sm tracking-[0.3em] uppercase">Admin Panel</h1>
          <Link href="/" className="text-[10px] text-[#d97706]/40 hover:text-[#d97706]">
            ← MAP
          </Link>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Players", stats.users],
              ["Total Hexes", stats.hexes],
              ["Owned Hexes", stats.ownedHexes],
              ["Pending Contests", stats.pendingContests],
            ].map(([label, val]) => (
              <div key={label as string} className="border border-[#d97706]/20 p-3">
                <div className="text-[#888] text-[10px] tracking-wide mb-1">{label}</div>
                <div className="text-[#d97706] text-lg">{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <h2 className="text-[10px] text-[#888] tracking-widest">OPERATIONS</h2>

          <AdminButton
            label="RUN DAILY TICK"
            description="Distribute yields, resolve contests"
            loading={running === "tick"}
            onClick={() => runAction("tick", () => apiRequest("POST", "/api/admin/tick"))}
          />
          <AdminButton
            label="RUN FULL PIPELINE"
            description="Fetch citations + census oil wells"
            loading={running === "pipeline"}
            onClick={() => runAction("pipeline", () => apiRequest("POST", "/api/admin/pipeline"))}
          />
          <AdminButton
            label="CENSUS OIL WELLS"
            description="Re-run CalGEM active-well census"
            loading={running === "wells"}
            onClick={() => runAction("wells", () => apiRequest("POST", "/api/admin/pipeline/wells"))}
          />
          <AdminButton
            label="CENSUS DEAD ANIMALS"
            description="Re-run MyLA311 dead-animal reports"
            loading={running === "deadanimals"}
            onClick={() => runAction("deadanimals", () => apiRequest("POST", "/api/admin/pipeline/deadanimals"))}
          />
          <AdminButton
            label="MARKET HISTORY"
            description="Daily fines + citations series for the exchange"
            loading={running === "history"}
            onClick={() => runAction("history", () => apiRequest("POST", "/api/admin/pipeline/history"))}
          />
          <AdminButton
            label="CAR MAKES"
            description="Toyota vs Honda daily ticket counts"
            loading={running === "makes"}
            onClick={() => runAction("makes", () => apiRequest("POST", "/api/admin/pipeline/makes"))}
          />
        </div>

        <div className="text-[9px] text-[#555] tracking-wider pt-4 border-t border-[#d97706]/10">
          ADMIN EMAILS: configured via ADMIN_EMAILS env var
        </div>
      </div>
    </div>
  );
}

function AdminButton({ label, description, loading, onClick }: {
  label: string;
  description: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!!loading}
      className="w-full text-left px-3 py-2.5 border border-[#d97706]/30 hover:border-[#d97706]/60 hover:bg-[#d97706]/5 disabled:opacity-40 transition-colors rounded-sm"
    >
      <div className="text-xs text-[#d97706] tracking-wide">
        {loading ? "RUNNING..." : label}
      </div>
      <div className="text-[10px] text-[#888] mt-0.5">{description}</div>
    </button>
  );
}
