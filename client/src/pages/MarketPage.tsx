import { useState } from "react";
import { Link } from "wouter";
import { Droplets, Moon } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { usePlayer } from "../hooks/usePlayer";
import { useCollection } from "../hooks/useDeck";
import {
  useBoard,
  useExchangePositions,
  useBuyExchange,
  useEndDay,
  type ExchangeMarket,
  type ExchangePosition,
  type EndDayResult,
} from "../hooks/useExchange";

const cents = (p: number) => `${Math.round(p * 100)}¢`;
const weekday = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const fullDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// The two outcomes inked like the rest of the sheet: pine for YES, brick for NO.
const ACCENTS = ["var(--pine)", "var(--brick)"];

export default function MarketPage() {
  const { user } = useAuth();
  const { data: player } = usePlayer(!!user);
  const { data: deck } = useCollection(!!user);
  const { data: board, isLoading } = useBoard();
  const { data: positions = [] } = useExchangePositions(!!user);
  const endDay = useEndDay();
  const [settlement, setSettlement] = useState<EndDayResult | null>(null);

  const posByMarket = new Map(positions.map((p) => [p.marketId, p]));
  const markets = board?.markets ?? [];

  return (
    <div className="min-h-screen w-screen overflow-y-auto bg-[var(--paper)] text-[var(--sepia)]">
      {/* Masthead */}
      <header className="flex items-center justify-between px-5 py-4 border-b-2 border-[var(--ink-strong)]">
        <div>
          <div className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.3em" }}>
            LA BREA MADRE
          </div>
          <div className="plate-title text-sm text-[var(--ink)]">THE PARKING ORACLE</div>
        </div>
        <div className="flex items-center gap-4">
          {user && player ? (
            <div className="flex items-center gap-3 text-sm">
              {deck && deck.effects.payoutMult > 1 && (
                <span
                  className="text-[10px] text-[var(--pine)] border border-[var(--pine)] px-1.5 py-0.5"
                  style={{ letterSpacing: "0.08em" }}
                >
                  ×{deck.effects.payoutMult.toFixed(2)} PAYOUTS
                </span>
              )}
              <div className="flex items-center gap-1.5 text-[var(--ink)]">
                <Droplets size={13} />
                <span className="font-bold tabular-nums">{player.crude.toLocaleString()}</span>
                <span className="text-[var(--sepia-soft)] text-[10px]">CRUDE</span>
              </div>
            </div>
          ) : (
            <a
              href="/api/login"
              className="text-xs text-[var(--ink)] hover:underline"
              style={{ letterSpacing: "0.15em" }}
            >
              LOGIN TO PLAY →
            </a>
          )}
          <nav className="flex gap-3 text-[10px] text-[var(--ink)]" style={{ letterSpacing: "0.2em" }}>
            <Link href="/deck" className="opacity-60 hover:opacity-100 hover:underline">DECK</Link>
            <Link href="/map" className="opacity-60 hover:opacity-100 hover:underline">MAP</Link>
            {user && <Link href="/admin" className="opacity-60 hover:opacity-100 hover:underline">ADMIN</Link>}
          </nav>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        {/* The day */}
        {board?.day && (
          <div className="mb-6">
            <div className="text-[10px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.3em" }}>
              THE CITY, TODAY
            </div>
            <div className="text-lg text-[var(--ink)]">It's a {weekday(board.day)} in Los Angeles.</div>
            <p className="text-[11px] text-[var(--sepia-soft)] italic mt-1">
              The meter maids are out. Place your bets before the day is done — then end it and see what the city did.
            </p>
          </div>
        )}

        {isLoading && <p className="text-[var(--sepia-soft)] text-sm italic">Opening the exchange…</p>}

        {board?.empty && (
          <div className="plate p-8 text-center text-[var(--sepia-soft)] text-sm italic">
            {board.empty}
          </div>
        )}

        {/* Market board */}
        <div className="space-y-4">
          {markets.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              position={posByMarket.get(m.id)}
              crude={player?.crude ?? 0}
              canPlay={!!user}
            />
          ))}
        </div>

        {/* End the day */}
        {user && markets.length > 0 && (
          <div className="mt-8 flex items-center justify-between border-t border-[var(--ink-faint)] pt-5">
            <span className="text-[10px] text-[var(--sepia-soft)] italic">
              Ends the day · settles every market from the city's real numbers.
            </span>
            <button
              onClick={() => endDay.mutate(undefined, { onSuccess: (d) => setSettlement(d) })}
              disabled={endDay.isPending}
              className="btn-ink inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"
              data-active="true"
            >
              <Moon size={13} />
              {endDay.isPending ? "CLOSING…" : "END THE DAY"}
            </button>
          </div>
        )}
      </main>

      {settlement && (
        <SettlementOverlay result={settlement} userId={user?.id} onClose={() => setSettlement(null)} />
      )}
    </div>
  );
}

function MarketCard({
  market,
  position,
  crude,
  canPlay,
}: {
  market: ExchangeMarket;
  position?: ExchangePosition;
  crude: number;
  canPlay: boolean;
}) {
  const buy = useBuyExchange();
  const [stake, setStake] = useState(20);

  return (
    <div className="plate overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--ink-faint)] text-sm text-[var(--ink)]">
        {market.question}
      </div>

      <div className="p-5 space-y-3">
        {market.outcomes.map((label, i) => {
          const price = market.prices[i];
          const held = position?.shares[i] ?? 0;
          return (
            <div key={label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold" style={{ color: ACCENTS[i] }}>
                <span style={{ letterSpacing: "0.12em" }}>{label}</span>
                <span className="tabular-nums">
                  {cents(price)}
                  <span className="text-[var(--sepia-soft)] text-[10px] ml-1 font-normal">
                    ({Math.round(price * 100)}%)
                  </span>
                </span>
              </div>
              <div className="h-1.5 border border-[var(--ink-faint)] overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{ width: `${price * 100}%`, background: ACCENTS[i], opacity: 0.55 }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--sepia-soft)] italic">
                  {held > 0 ? `you hold ${held.toFixed(1)} · pays ${held.toFixed(1)} if ${label}` : " "}
                </span>
                {canPlay && (
                  <button
                    onClick={() => buy.mutate({ marketId: market.id, outcome: i, budget: stake })}
                    disabled={buy.isPending || stake <= 0 || stake > crude}
                    className="btn-ink px-3 py-1 text-[11px]"
                    style={{ color: ACCENTS[i], borderColor: ACCENTS[i] }}
                  >
                    BUY {label}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {canPlay && (
          <div
            className="flex items-center gap-2 pt-2 border-t border-[var(--ink-faint)] text-[10px] text-[var(--sepia-soft)]"
            style={{ letterSpacing: "0.08em" }}
          >
            STAKE
            <input
              type="number"
              min={1}
              max={Math.max(1, crude)}
              value={stake}
              onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
              className="w-20 bg-transparent border border-[var(--ink-faint)] px-2 py-1 text-[var(--ink)] tabular-nums text-xs"
            />
            crude per bet
          </div>
        )}
      </div>
    </div>
  );
}

function SettlementOverlay({
  result,
  userId,
  onClose,
}: {
  result: EndDayResult;
  userId?: number;
  onClose: () => void;
}) {
  let net = 0;
  if (userId != null) {
    for (const r of result.results) {
      const e = r.settlement?.perPlayer[String(userId)];
      if (e) net += e.profit;
    }
  }

  return (
    <div className="fixed inset-0 bg-[rgba(40,30,16,0.55)] flex items-center justify-center p-4 z-50">
      <div className="plate w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
        <div className="plate-title text-center text-[10px] mb-1">THE DAY IS DONE</div>
        <div className="text-center text-[var(--sepia)] text-sm mb-5 italic">{fullDate(result.day)}</div>

        <div className="space-y-3 mb-5">
          {result.results.map((r) => {
            const mine = userId != null ? r.settlement?.perPlayer[String(userId)] : undefined;
            const won = (mine?.profit ?? 0) > 0;
            const had = mine && (mine.shares > 0 || mine.spent > 0);
            return (
              <div key={r.marketId} className="border border-[var(--ink-faint)] p-3">
                <div className="text-[11px] text-[var(--ink)] mb-1">{r.question}</div>
                <div className="text-[10px] text-[var(--sepia-soft)]">
                  Outcome:{" "}
                  <span style={{ color: r.outcome === "YES" ? "var(--pine)" : "var(--brick)" }}>
                    {r.outcome}
                  </span>
                  {r.type === "make_faceoff"
                    ? ` · Toyota ${r.actualA} vs Honda ${r.actualB}`
                    : ` · actual ${r.actualA.toLocaleString()} vs line ${r.line.toLocaleString()}`}
                </div>
                {had && (
                  <div
                    className="text-[11px] tabular-nums mt-1 font-bold"
                    style={{ color: won ? "var(--pine)" : "var(--brick)" }}
                  >
                    {won ? "won" : "lost"} · net {mine!.profit >= 0 ? "+" : ""}
                    {mine!.profit.toFixed(1)} crude
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {userId != null && (
          <div
            className="text-center text-sm mb-5 font-bold"
            style={{ color: net >= 0 ? "var(--pine)" : "var(--brick)" }}
          >
            Day's net: {net >= 0 ? "+" : ""}
            {net.toFixed(1)} crude
          </div>
        )}

        <div className="flex justify-center">
          <button onClick={onClose} className="btn-ink px-5 py-2 text-[11px] font-bold" data-active="true">
            {result.nextDay ? "ON TO THE NEXT DAY" : "CAUGHT UP TO THE PRESENT"}
          </button>
        </div>
      </div>
    </div>
  );
}
