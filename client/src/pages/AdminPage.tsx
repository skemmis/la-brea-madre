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
  const [result, setResult] = useState<{ label: string; data: unknown } | null>(null);

  const { data: stats, refetch } = useQuery<Stats>({
    queryKey: ["/api/admin/stats"],
    queryFn: () => apiRequest("GET", "/api/admin/stats"),
  });

  async function runAction(label: string, fn: () => Promise<unknown>) {
    setRunning(label);
    try {
      const data = await fn();
      setResult({ label, data });
      toast.success(`${label} complete`);
      refetch();
    } catch (err: any) {
      setResult({ label, data: { error: err.message } });
      toast.error(err.message);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-[var(--paper)] text-[var(--sepia)] p-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center justify-between border-b-2 border-[var(--ink-strong)] pb-3">
          <h1 className="plate-title text-sm text-[var(--ink)]">CITY WORKS DEPARTMENT</h1>
          <Link
            href="/"
            className="text-[10px] text-[var(--ink)] opacity-60 hover:opacity-100 hover:underline"
            style={{ letterSpacing: "0.15em" }}
          >
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
              <div key={label as string} className="plate p-3">
                <div
                  className="text-[var(--sepia-soft)] text-[10px] mb-1"
                  style={{ letterSpacing: "0.1em" }}
                >
                  {String(label).toUpperCase()}
                </div>
                <div className="text-lg font-bold tabular-nums">{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <h2 className="text-[10px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.25em" }}>
            OPERATIONS
          </h2>

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
          <AdminButton
            label="DIAGNOSTICS"
            description="Probe source APIs + dataset field names"
            loading={running === "diag"}
            onClick={() => runAction("diag", () => apiRequest("GET", "/api/admin/diag"))}
          />
        </div>

        {/* Last run output — fetched/indexed/errors, or the diag dump */}
        {result && (
          <div className="plate">
            <div
              className="text-[10px] text-[var(--sepia-soft)] px-3 py-1.5 border-b border-[var(--ink-faint)]"
              style={{ letterSpacing: "0.2em" }}
            >
              {result.label.toUpperCase()} RESULT
            </div>
            <pre className="text-[10px] text-[var(--ink)] p-3 overflow-auto max-h-72 whitespace-pre-wrap font-mono">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </div>
        )}

        <div
          className="text-[9px] text-[var(--sepia-soft)] pt-4 border-t border-[var(--ink-faint)]"
          style={{ letterSpacing: "0.12em" }}
        >
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
      className="btn-ink w-full text-left px-3 py-2.5 bg-[var(--paper)]"
    >
      <div className="text-xs font-bold" style={{ letterSpacing: "0.1em" }}>
        {loading ? "RUNNING..." : label}
      </div>
      <div className="text-[10px] text-[var(--sepia-soft)] mt-0.5 normal-case" style={{ letterSpacing: "0.02em" }}>
        {description}
      </div>
    </button>
  );
}
