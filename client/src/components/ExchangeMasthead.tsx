import { Link } from "wouter";
import { Banknote } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { usePlayer } from "../hooks/usePlayer";
import { useActivity } from "../hooks/useExchange";

const cents = (p: number) => `${Math.round(p * 100)}¢`;

/** The exchange's masthead + the tape: a broadsheet header over a ticker. */
export default function ExchangeMasthead({ active }: { active: "floor" | "portfolio" | "arena" }) {
  const { user } = useAuth();
  const { data: player } = usePlayer(!!user);
  const { data: tape = [] } = useActivity();

  const nav = [
    { href: "/", label: "THE FLOOR", key: "floor" },
    { href: "/portfolio", label: "PORTFOLIO", key: "portfolio" },
    { href: "/arena", label: "ARENA", key: "arena" },
    { href: "/map", label: "MAP", key: "map" },
  ];

  return (
    <>
      <header className="flex items-center justify-between px-5 py-4 border-b-2 border-[var(--ink-strong)]">
        <div>
          <div className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.3em" }}>
            LA BREA MADRE · EST. 2026 · LOS ANGELES
          </div>
          <div className="plate-title text-sm text-[var(--ink)]">THE PARKING ORACLE</div>
        </div>
        <div className="flex items-center gap-5">
          {user && player ? (
            <div className="flex items-center gap-1.5 text-sm text-[var(--ink)]">
              <Banknote size={13} />
              <span className="font-bold tabular-nums">${player.crude.toLocaleString()}</span>
              <span className="text-[var(--sepia-soft)] text-[10px]">BANK</span>
            </div>
          ) : (
            <a
              href="/api/login"
              className="text-xs text-[var(--ink)] hover:underline"
              style={{ letterSpacing: "0.15em" }}
            >
              LOGIN TO TRADE →
            </a>
          )}
          <nav className="flex gap-3 text-[10px] text-[var(--ink)]" style={{ letterSpacing: "0.2em" }}>
            {nav.map((n) => (
              <Link
                key={n.key}
                href={n.href}
                className={
                  n.key === active
                    ? "font-bold underline"
                    : "opacity-60 hover:opacity-100 hover:underline"
                }
              >
                {n.label}
              </Link>
            ))}
            {user && (
              <Link href="/admin" className="opacity-60 hover:opacity-100 hover:underline">
                ADMIN
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* The tape */}
      {tape.length > 0 && (
        <div className="overflow-hidden border-b border-[var(--ink-faint)] bg-[var(--paper-deep)] py-1 select-none">
          <div className="ticker-track flex gap-10 whitespace-nowrap text-[10px] text-[var(--sepia)]">
            {[...tape, ...tape].map((t, i) => (
              <span key={`${t.id}-${i}`} className="inline-flex items-center gap-1.5">
                <span className="font-bold" style={{ letterSpacing: "0.06em" }}>
                  {t.user.toUpperCase()}
                </span>
                <span className="italic opacity-80">
                  {t.action === "buy" ? "bought" : "sold"}
                </span>
                <span
                  className="font-bold"
                  style={{ color: t.outcome === "YES" ? "var(--pine)" : "var(--brick)" }}
                >
                  {t.outcome}
                </span>
                <span className="opacity-70 max-w-[300px] truncate">
                  {t.question ?? t.marketId}
                </span>
                <span className="tabular-nums font-bold text-[var(--ink)]">{cents(t.yesPrice)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
