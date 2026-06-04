import { useState } from "react";
import { Link } from "wouter";
import { Droplets, TrendingUp, TrendingDown, Sparkles } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { usePlayer } from "../hooks/usePlayer";
import { useCollection } from "../hooks/useDeck";
import {
  useMarkets,
  usePositions,
  useOpenRound,
  useBuy,
  useReveal,
  type MarketView,
  type Position,
  type RevealResult,
} from "../hooks/useMarkets";

const cents = (p: number) => `${Math.round(p * 100)}¢`;
const money = (n: number) => `$${n.toLocaleString()}`;

export default function MarketPage() {
  const { user } = useAuth();
  const { data: player } = usePlayer(!!user);
  const { data: deck } = useCollection(!!user);
  const { data: markets = [], isLoading } = useMarkets();
  const { data: positions = [] } = usePositions(!!user);
  const openRound = useOpenRound();
  const [reveal, setReveal] = useState<RevealResult | null>(null);

  const openMarkets = markets.filter((m) => m.status === "open");

  return (
    <div className="min-h-screen w-screen bg-[#0a0a0a] text-[#e8dcc8] font-mono">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-[#d97706]/20">
        <div>
          <div className="text-[10px] text-[#d97706]/50 tracking-[0.3em] uppercase">
            La Brea Madre
          </div>
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
        <p className="text-[11px] text-[#888] leading-relaxed mb-6">
          Somewhere in Los Angeles, on a day you can't see, the meter maids did their work.
          Read the city better than the market and the crude is yours.
        </p>

        {isLoading && <p className="text-[#888] text-sm">Reading the ledger…</p>}

        {!isLoading && openMarkets.length === 0 && (
          <div className="border border-[#d97706]/30 rounded-sm p-8 text-center bg-[#0f0b07]">
            <p className="text-[#888] text-sm mb-4">No line on the board.</p>
            {user ? (
              <button
                onClick={() => openRound.mutate()}
                disabled={openRound.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] text-xs rounded-sm hover:bg-[#d97706]/25 disabled:opacity-50 tracking-widest"
              >
                <Sparkles size={13} />
                DEAL A ROUND
              </button>
            ) : (
              <a href="/api/login" className="text-xs text-[#d97706]/70 hover:text-[#d97706] tracking-widest">
                LOGIN TO PLAY →
              </a>
            )}
          </div>
        )}

        <div className="space-y-6">
          {openMarkets.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              position={positions.find((p) => p.marketId === m.id)}
              crude={player?.crude ?? 0}
              canPlay={!!user}
              onReveal={setReveal}
            />
          ))}
        </div>
      </main>

      {reveal && (
        <RevealOverlay
          reveal={reveal}
          userId={user?.id}
          onClose={() => setReveal(null)}
          onAgain={() => {
            setReveal(null);
            openRound.mutate();
          }}
        />
      )}
    </div>
  );
}

function MarketCard({
  market,
  position,
  crude,
  canPlay,
  onReveal,
}: {
  market: MarketView;
  position?: Position;
  crude: number;
  canPlay: boolean;
  onReveal: (r: RevealResult) => void;
}) {
  const buy = useBuy();
  const reveal = useReveal();
  const [stake, setStake] = useState(20);

  const icons = [<TrendingUp size={14} key="o" />, <TrendingDown size={14} key="u" />];
  const accents = ["#86d97a", "#e87070"];

  return (
    <div className="border border-[#d97706]/30 rounded-sm bg-[#0f0b07] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#d97706]/15">
        <div className="text-[10px] text-[#d97706]/50 tracking-widest mb-1">MYSTERY DAY · LIVE</div>
        <div className="text-[#e8dcc8] text-sm">{market.question}</div>
      </div>

      <div className="p-5 space-y-3">
        {market.outcomes.map((label, i) => {
          const price = market.prices[i];
          const held = position?.shares[i] ?? 0;
          return (
            <div key={label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5" style={{ color: accents[i] }}>
                  {icons[i]}
                  {label}
                </span>
                <span className="tabular-nums" style={{ color: accents[i] }}>
                  {cents(price)}
                  <span className="text-[#888] text-[10px] ml-1">({Math.round(price * 100)}%)</span>
                </span>
              </div>
              {/* probability bar */}
              <div className="h-1.5 bg-[#1a1209] rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{ width: `${price * 100}%`, background: `${accents[i]}99` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#888]">
                  {held > 0 ? `you hold ${held.toFixed(1)} · pays ${held.toFixed(1)} if right` : " "}
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
          <div className="flex items-center justify-between pt-3 border-t border-[#d97706]/10">
            <label className="flex items-center gap-2 text-[10px] text-[#888]">
              STAKE
              <input
                type="number"
                min={1}
                max={Math.max(1, crude)}
                value={stake}
                onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
                className="w-20 bg-[#1a1209] border border-[#d97706]/20 rounded-sm px-2 py-1 text-[#d97706] tabular-nums text-xs"
              />
              crude
            </label>
            <button
              onClick={() =>
                reveal.mutate(market.id, {
                  onSuccess: (data) => onReveal(data),
                })
              }
              disabled={reveal.isPending}
              className="px-4 py-1.5 text-[11px] bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] rounded-sm hover:bg-[#d97706]/25 disabled:opacity-50 tracking-widest"
            >
              {reveal.isPending ? "REVEALING…" : "REVEAL THE DAY"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RevealOverlay({
  reveal,
  userId,
  onClose,
  onAgain,
}: {
  reveal: RevealResult;
  userId?: number;
  onClose: () => void;
  onAgain: () => void;
}) {
  const mine = userId != null ? reveal.settlement?.perPlayer[String(userId)] : undefined;
  const won = (mine?.profit ?? 0) > 0;
  const overWon = reveal.outcome === "OVER";

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md border border-[#d97706]/40 rounded-sm bg-[#0f0b07] p-6 text-center">
        <div className="text-[10px] text-[#d97706]/50 tracking-[0.3em] mb-3">THE DAY REVEALED</div>
        <div className="text-[#e8dcc8] text-lg mb-1">{reveal.targetDate}</div>
        <div className="text-sm text-[#888] mb-4">
          The city wrote{" "}
          <span className="text-[#d97706]">{money(reveal.actualFine)}</span> in fines —{" "}
          <span style={{ color: overWon ? "#86d97a" : "#e87070" }}>{reveal.outcome}</span>{" "}
          {money(reveal.line)}.
        </div>

        {mine ? (
          <div
            className="rounded-sm border p-4 mb-5"
            style={{ borderColor: won ? "#86d97a55" : "#e8707055" }}
          >
            <div className="text-xs tracking-widest mb-1" style={{ color: won ? "#86d97a" : "#e87070" }}>
              {won ? "YOU READ IT RIGHT" : "THE CITY FOOLED YOU"}
            </div>
            <div className="text-sm text-[#e8dcc8] tabular-nums">
              {mine.payout > 0 ? `+${mine.payout.toFixed(1)} crude` : "no payout"}
              <span className="text-[#888] text-[11px]"> · staked {mine.spent.toFixed(1)}</span>
            </div>
            <div className="text-[11px] tabular-nums mt-1" style={{ color: won ? "#86d97a" : "#e87070" }}>
              net {mine.profit >= 0 ? "+" : ""}{mine.profit.toFixed(1)}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-[#888] mb-5">You had no position on this one.</div>
        )}

        <div className="flex gap-2 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[11px] border border-[#d97706]/30 text-[#d97706]/70 rounded-sm hover:text-[#d97706] tracking-widest"
          >
            CLOSE
          </button>
          <button
            onClick={onAgain}
            className="px-4 py-2 text-[11px] bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] rounded-sm hover:bg-[#d97706]/25 tracking-widest"
          >
            DEAL ANOTHER
          </button>
        </div>
      </div>
    </div>
  );
}
