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

// Rarities as inks on the sheet: quiet sepia, pine, brick.
const RARITY_COLOR: Record<string, string> = {
  common: "rgba(71,52,35,0.55)",
  uncommon: "#3c6e50",
  rare: "#a6543c",
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
    <div className="h-screen w-screen overflow-y-auto bg-[var(--paper)] text-[var(--sepia)]">
      <header className="flex items-center justify-between px-5 py-4 border-b-2 border-[var(--ink-strong)]">
        <div>
          <div className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.3em" }}>
            LA BREA MADRE
          </div>
          <div className="plate-title text-sm text-[var(--ink)]">THE COLLECTION</div>
        </div>
        <div className="flex items-center gap-4">
          {player && (
            <div className="flex items-center gap-1.5 text-sm text-[var(--ink)]">
              <Droplets size={13} />
              <span className="font-bold tabular-nums">{player.crude.toLocaleString()}</span>
              <span className="text-[var(--sepia-soft)] text-[10px]">CRUDE</span>
            </div>
          )}
          <nav className="flex gap-3 text-[10px] text-[var(--ink)]" style={{ letterSpacing: "0.2em" }}>
            <Link href="/" className="opacity-60 hover:opacity-100 hover:underline">MARKET</Link>
            <Link href="/map" className="opacity-60 hover:opacity-100 hover:underline">MAP</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8">
        {!user ? (
          <div className="text-center py-16">
            <a
              href="/api/login"
              className="text-sm text-[var(--ink)] hover:underline"
              style={{ letterSpacing: "0.15em" }}
            >
              LOGIN TO COLLECT →
            </a>
          </div>
        ) : (
          <>
            {/* Active effects + open pack */}
            <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
              <div className="text-[11px] text-[var(--sepia-soft)] italic">
                {boost ? (
                  <span>
                    Active:{" "}
                    {fx!.payoutMult > 1 && (
                      <span className="text-[var(--pine)] not-italic font-bold">
                        ×{fx!.payoutMult.toFixed(2)} payouts
                      </span>
                    )}
                    {fx!.payoutMult > 1 && fx!.loserRefund > 0 && <span> · </span>}
                    {fx!.loserRefund > 0 && (
                      <span className="text-[var(--brick)] not-italic font-bold">
                        {Math.round(fx!.loserRefund * 100)}% loss refund
                      </span>
                    )}
                  </span>
                ) : (
                  <span>No cards yet. Crack a pack and bend the odds.</span>
                )}
              </div>
              <button
                onClick={() => openPack.mutate(undefined, { onSuccess: (data) => setReveal(data) })}
                disabled={openPack.isPending || (deck && (player?.crude ?? 0) < deck.packCost)}
                className="btn-ink inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"
                data-active="true"
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
      className="relative border p-3 h-32 flex flex-col justify-between bg-[var(--paper)]"
      style={{
        borderColor: owned ? color : "var(--ink-faint)",
        boxShadow: owned ? `inset 0 0 0 1px var(--paper), inset 0 0 0 2px ${color}` : undefined,
        opacity: owned ? 1 : 0.5,
      }}
    >
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase font-bold" style={{ color, letterSpacing: "0.2em" }}>
            {card.rarity}
          </span>
          {!owned && <Lock size={11} className="text-[var(--sepia-soft)]" />}
          {drawnNew && (
            <span
              className="text-[8px] text-[var(--pine)] border border-[var(--pine)] px-1"
              style={{ letterSpacing: "0.15em" }}
            >
              NEW
            </span>
          )}
        </div>
        <div className="text-sm mt-1 text-[var(--ink)] font-bold">{card.name}</div>
      </div>
      <div className="text-[10px] leading-snug text-[var(--sepia-soft)] italic">{card.text}</div>
    </div>
  );
}

function PackReveal({ result, onClose }: { result: OpenPackResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-[rgba(40,30,16,0.55)] flex items-center justify-center p-4 z-50">
      <div className="plate w-full max-w-lg p-6">
        <div className="plate-title flex items-center justify-center gap-2 text-[10px] mb-5">
          <Sparkles size={12} /> THE PACK OPENS
        </div>
        <div className="grid grid-cols-3 gap-3 mb-5">
          {result.drawn.map((c, i) => (
            <CardTile key={`${c.id}-${i}`} card={{ ...c, owned: true }} drawnNew={c.isNew} />
          ))}
        </div>
        <div className="text-center text-[11px] text-[var(--sepia-soft)] italic mb-5">
          {result.refund > 0
            ? `Duplicates melted down for +${result.refund} crude.`
            : "All new. The deck deepens."}
        </div>
        <div className="flex justify-center">
          <button onClick={onClose} className="btn-ink px-5 py-2 text-[11px] font-bold" data-active="true">
            TAKE THEM
          </button>
        </div>
      </div>
    </div>
  );
}
