import { useState } from "react";
import { Link } from "wouter";
import { Droplets, Package, Sparkles, Lock } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { usePlayer } from "../hooks/usePlayer";
import {
  useCollection,
  useOpenPack,
  type CardDef,
  type OpenPackResult,
} from "../hooks/useDeck";

const RARITY_COLOR: Record<string, string> = {
  common: "#8a8a8a",
  uncommon: "#86d97a",
  rare: "#e0a96d",
};

export default function DeckPage() {
  const { user } = useAuth();
  const { data: player } = usePlayer(!!user);
  const { data: deck } = useCollection(!!user);
  const openPack = useOpenPack();
  const [reveal, setReveal] = useState<OpenPackResult | null>(null);

  const fx = deck?.effects;
  const boost = fx && (fx.payoutMult > 1 || fx.loserRefund > 0);

  return (
    <div className="min-h-screen w-screen bg-[#0a0a0a] text-[#e8dcc8] font-mono">
      <header className="flex items-center justify-between px-5 py-4 border-b border-[#d97706]/20">
        <div>
          <div className="text-[10px] text-[#d97706]/50 tracking-[0.3em] uppercase">La Brea Madre</div>
          <div className="text-sm tracking-[0.2em] text-[#d97706]">THE COLLECTION</div>
        </div>
        <div className="flex items-center gap-4">
          {player && (
            <div className="flex items-center gap-1.5 text-sm">
              <Droplets size={13} className="text-[#d97706]" />
              <span className="text-[#d97706] tabular-nums">{player.crude.toLocaleString()}</span>
              <span className="text-[#888] text-[10px]">CRUDE</span>
            </div>
          )}
          <nav className="flex gap-2 text-[10px] tracking-widest text-[#d97706]/40">
            <Link href="/" className="hover:text-[#d97706]/80">MARKET</Link>
            <Link href="/map" className="hover:text-[#d97706]/80">MAP</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8">
        {!user ? (
          <div className="text-center py-16">
            <a href="/api/login" className="text-sm text-[#d97706]/70 hover:text-[#d97706] tracking-widest">
              LOGIN TO COLLECT →
            </a>
          </div>
        ) : (
          <>
            {/* Active effects + open pack */}
            <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
              <div className="text-[11px] text-[#888]">
                {boost ? (
                  <span>
                    Active:{" "}
                    {fx!.payoutMult > 1 && (
                      <span className="text-[#86d97a]">×{fx!.payoutMult.toFixed(2)} payouts</span>
                    )}
                    {fx!.payoutMult > 1 && fx!.loserRefund > 0 && <span className="text-[#888]"> · </span>}
                    {fx!.loserRefund > 0 && (
                      <span className="text-[#e0a96d]">{Math.round(fx!.loserRefund * 100)}% loss refund</span>
                    )}
                  </span>
                ) : (
                  <span>No cards yet. Crack a pack and bend the odds.</span>
                )}
              </div>
              <button
                onClick={() =>
                  openPack.mutate(undefined, { onSuccess: (data) => setReveal(data) })
                }
                disabled={openPack.isPending || (deck && (player?.crude ?? 0) < deck.packCost)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] text-xs rounded-sm hover:bg-[#d97706]/25 disabled:opacity-40 tracking-widest"
              >
                <Package size={14} />
                OPEN PACK · {deck?.packCost ?? "…"} CRUDE
              </button>
            </div>

            {/* Catalog */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {deck?.catalog.map((c) => (
                <CardTile key={c.id} card={c} />
              ))}
            </div>
          </>
        )}
      </main>

      {reveal && <PackReveal result={reveal} onClose={() => setReveal(null)} />}
    </div>
  );
}

function CardTile({ card, drawnNew }: { card: CardDef; drawnNew?: boolean }) {
  const color = RARITY_COLOR[card.rarity];
  const owned = card.owned ?? true;
  return (
    <div
      className="relative rounded-sm border p-3 h-32 flex flex-col justify-between transition-colors"
      style={{
        borderColor: owned ? `${color}66` : "#ffffff14",
        background: owned ? "#0f0b07" : "#0c0a08",
        opacity: owned ? 1 : 0.55,
      }}
    >
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] tracking-widest uppercase" style={{ color }}>
            {card.rarity}
          </span>
          {!owned && <Lock size={11} className="text-[#555]" />}
          {drawnNew && (
            <span className="text-[8px] tracking-widest text-[#86d97a] border border-[#86d97a]/50 px-1 rounded-sm">
              NEW
            </span>
          )}
        </div>
        <div className="text-sm mt-1" style={{ color: owned ? "#e8dcc8" : "#777" }}>
          {card.name}
        </div>
      </div>
      <div className="text-[10px] leading-snug text-[#888]">{card.text}</div>
    </div>
  );
}

function PackReveal({ result, onClose }: { result: OpenPackResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-lg border border-[#d97706]/40 rounded-sm bg-[#0f0b07] p-6">
        <div className="flex items-center justify-center gap-2 text-[10px] text-[#d97706]/50 tracking-[0.3em] mb-5">
          <Sparkles size={12} /> THE PACK OPENS
        </div>
        <div className="grid grid-cols-3 gap-3 mb-5">
          {result.drawn.map((c, i) => (
            <CardTile key={`${c.id}-${i}`} card={{ ...c, owned: true }} drawnNew={c.isNew} />
          ))}
        </div>
        <div className="text-center text-[11px] text-[#888] mb-5">
          {result.refund > 0
            ? `Duplicates melted down for +${result.refund} crude.`
            : "All new. The deck deepens."}
        </div>
        <div className="flex justify-center">
          <button
            onClick={onClose}
            className="px-5 py-2 text-[11px] bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] rounded-sm hover:bg-[#d97706]/25 tracking-widest"
          >
            TAKE THEM
          </button>
        </div>
      </div>
    </div>
  );
}
