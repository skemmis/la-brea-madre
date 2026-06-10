import { usePlayer } from "../hooks/usePlayer";
import { useAuth } from "../hooks/useAuth";
import { Banknote, MapPin, ClipboardList } from "lucide-react";
import { Link } from "wouter";

export default function PlayerHUD() {
  const { user } = useAuth();
  const { data: player } = usePlayer(!!user);

  return (
    <div className="absolute top-4 left-4 flex flex-col gap-2">
      {user && player ? (
        <div className="plate p-3 min-w-[190px]">
          <div className="text-[10px] font-bold mb-2" style={{ letterSpacing: "0.25em" }}>
            {player.displayName.toUpperCase()}
          </div>
          <div className="space-y-1.5">
            <Stat icon={<Banknote size={11} />} label="BANK" value={`$${player.crude.toLocaleString()}`} />
            <Stat icon={<MapPin size={11} />} label="PARCELS" value={String(player.totalHexes)} />
            <div className="pt-1.5 border-t border-[var(--ink-faint)]">
              <div
                className="flex items-center gap-1.5 text-[10px]"
                style={{
                  letterSpacing: "0.08em",
                  color: player.workOrders > 0 ? "var(--pine)" : "var(--sepia-soft)",
                }}
              >
                <ClipboardList size={10} />
                <span>
                  {player.workOrders > 0
                    ? `${player.workOrders} WORK ORDER${player.workOrders === 1 ? "" : "S"}`
                    : "NO WORK ORDERS — carrion earns more"}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="plate px-3 py-2.5">
          <a
            href="/api/login"
            className="text-[11px] hover:underline"
            style={{ letterSpacing: "0.15em" }}
          >
            LOGIN TO CLAIM TERRITORY →
          </a>
        </div>
      )}

      {/* Nav */}
      <div className="flex gap-2 px-1">
        <Link
          href="/"
          className="text-[10px] text-[var(--ink)] opacity-60 hover:opacity-100 hover:underline"
          style={{ letterSpacing: "0.2em" }}
        >
          MARKET
        </Link>
        {user && (
          <>
            <span className="text-[var(--ink)] opacity-30">·</span>
            <Link
              href="/admin"
              className="text-[10px] text-[var(--ink)] opacity-60 hover:opacity-100 hover:underline"
              style={{ letterSpacing: "0.2em" }}
            >
              ADMIN
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span
        className="flex items-center gap-1.5 text-[var(--sepia-soft)]"
        style={{ letterSpacing: "0.08em" }}
      >
        {icon}
        {label}
      </span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}
