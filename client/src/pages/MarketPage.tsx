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
    <div className="min-h-screen w-screen bg-[#0a0a0a] text-[#e8dcc8] font-mono">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-[#d97706]/20">
        <div>
          <div className="text-[10px] text-[#d97706]/50 tracking-[0.3em] uppercase">La Brea Madre</div>
          <div className="text-sm tracking-[0.2em] text-[#d97706]">THE PARKING ORACLE</div>
        </div>
        <div className="flex items-center gap-4">
          {user && player ? (
            <div className="flex items-center gap-3 text-sm">
              {deck && deck.effects.payoutMult > 1 && (
                <span className="text-[10px] text-[#86d97a] border border-[#86d97a]/40 rounded-sm px-1.5 py-0.5">
                  ×{deck.effects.payoutMult.toFixed(2)} PAYOUTS
                </span>
              )}
              <div className="flex items-center gap-1.5">
                <Droplets size={13} className="text-[#d97706]" />
                <span className="text-[#d97706] tabular-nums">{player.crude.toLocaleString()}</span>
                <span className="text-[#888] text-[10px]">CRUDE</span>
              </div>
            </div>
          ) : (
            <a href="/api/login" className="text-xs text-[#d97706]/70 hover:text-[#d97706] tracking-widest">
              LOGIN TO PLAY →
            </a>
          )}
          <nav className="flex gap-2 text-[10px] tracking-widest text-[#d97706]/40">
            <Link href="/deck" className="hover:text-[#d97706]/80">DECK</Link>
            <Link href="/map" className="hover:text-[#d97706]/80">MAP</Link>
            {user && <Link href="/admin" className="hover:text-[#d97706]/80">ADMIN</Link>}
          </nav>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        {/* The day */}
        {board?.day && (
          <div className="mb-6">
            <div className="text-[10px] text-[#d97706]/50 tracking-[0.3em] uppercase">The city, today</div>
            <div className="text-lg text-[#e8dcc8]">It's a {weekday(board.day)} in Los Angeles.</div>
            <p className="text-[11px] text-[#888] mt-1">
              The meter maids are out. Place your bets before the day is done — then end it and see what the city did.
            </p>
          </div>
        )}

        {isLoading && <p className="text-[#888] text-sm">Opening the exchange…</p>}

        {board?.empty && (
          <div className="border border-[#d97706]/30 rounded-sm p-8 text-center bg-[#0f0b07] text-[#888] text-sm">
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
          <div className="mt-8 flex items-center justify-between border-t border-[#d97706]/10 pt-5">
            <span className="text-[10px] text-[#888]">
              Ends the day · settles every market from the city's real numbers.
            </span>
            <button
              onClick={() => endDay.mutate(undefined, { onSuccess: (d) => setSettlement(d) })}
              disabled={endDay.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] text-xs rounded-sm hover:bg-[#d97706]/25 disabled:opacity-50 tracking-widest"
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
  const accents = ["#86d97a", "#e87070"]; // YES, NO

  return (
    <div className="border border-[#d97706]/30 rounded-sm bg-[#0f0b07] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#d97706]/15 text-[#e8dcc8] text-sm">{market.question}</div>

      <div className="p-5 space-y-3">
        {market.outcomes.map((label, i) => {
          const price = market.prices[i];
          const held = position?.shares[i] ?? 0;
          return (
            <div key={label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: accents[i] }}>{label}</span>
                <span className="tabular-nums" style={{ color: accents[i] }}>
                  {cents(price)}
                  <span className="text-[#888] text-[10px] ml-1">({Math.round(price * 100)}%)</span>
                </span>
              </div>
              <div className="h-1.5 bg-[#1a1209] rounded-sm overflow-hidden">
                <div className="h-full rounded-sm transition-all" style={{ width: `${price * 100}%`, background: `${accents[i]}99` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#888]">
                  {held > 0 ? `you hold ${held.toFixed(1)} · pays ${held.toFixed(1)} if ${label}` : " "}
                </span>
                {canPlay && (
                  <button
                    onClick={() => buy.mutate({ marketId: market.id, outcome: i, budget: stake })}
                    disabled={buy.isPending || stake <= 0 || stake > crude}
                    className="px-3 py-1 text-[11px] border rounded-sm hover:opacity-80 disabled:opacity-30 tracking-wide"
                    style={{ borderColor: `${accents[i]}66`, color: accents[i] }}
                  >
                    BUY {label}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {canPlay && (
          <div className="flex items-center gap-2 pt-2 border-t border-[#d97706]/10 text-[10px] text-[#888]">
            STAKE
            <input
              type="number"
              min={1}
              max={Math.max(1, crude)}
              value={stake}
              onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
              className="w-20 bg-[#1a1209] border border-[#d97706]/20 rounded-sm px-2 py-1 text-[#d97706] tabular-nums text-xs"
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
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-lg border border-[#d97706]/40 rounded-sm bg-[#0f0b07] p-6 max-h-[85vh] overflow-y-auto">
        <div className="text-center text-[10px] text-[#d97706]/50 tracking-[0.3em] mb-1">THE DAY IS DONE</div>
        <div className="text-center text-[#e8dcc8] text-sm mb-5">{fullDate(result.day)}</div>

        <div className="space-y-3 mb-5">
          {result.results.map((r) => {
            const mine = userId != null ? r.settlement?.perPlayer[String(userId)] : undefined;
            const won = (mine?.profit ?? 0) > 0;
            const had = mine && (mine.shares > 0 || mine.spent > 0);
            return (
              <div key={r.marketId} className="border border-[#d97706]/15 rounded-sm p-3">
                <div className="text-[11px] text-[#e8dcc8] mb-1">{r.question}</div>
                <div className="text-[10px] text-[#888]">
                  Outcome:{" "}
                  <span style={{ color: r.outcome === "YES" ? "#86d97a" : "#e87070" }}>{r.outcome}</span>
                  {r.type === "make_faceoff"
                    ? ` · Toyota ${r.actualA} vs Honda ${r.actualB}`
                    : ` · actual ${r.actualA.toLocaleString()} vs line ${r.line.toLocaleString()}`}
                </div>
                {had && (
                  <div className="text-[11px] tabular-nums mt-1" style={{ color: won ? "#86d97a" : "#e87070" }}>
                    {won ? "won" : "lost"} · net {mine!.profit >= 0 ? "+" : ""}{mine!.profit.toFixed(1)} crude
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {userId != null && (
          <div className="text-center text-sm mb-5" style={{ color: net >= 0 ? "#86d97a" : "#e87070" }}>
            Day's net: {net >= 0 ? "+" : ""}{net.toFixed(1)} crude
          </div>
        )}

        <div className="flex justify-center">
          <button
            onClick={onClose}
            className="px-5 py-2 text-[11px] bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] rounded-sm hover:bg-[#d97706]/25 tracking-widest"
          >
            {result.nextDay ? "ON TO THE NEXT DAY" : "CAUGHT UP TO THE PRESENT"}
          </button>
        </div>
      </div>
    </div>
  );
}
