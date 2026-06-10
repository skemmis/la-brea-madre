import { X, Zap, ArrowUp, Flame } from "lucide-react";
import type { HexData } from "./HexMap";
import { useClaimHex, useUpgradeHex, useExploitHex } from "../hooks/usePlayer";

interface Props {
  hex: HexData;
  viewerUserId?: number;
  hasActionToday: boolean;
  viewerCrude: number;
  onClose: () => void;
}

const UPGRADE_COST = [20, 40, 80];
const CLAIM_COST = 10;

export default function HexPanel({ hex, viewerUserId, hasActionToday, viewerCrude, onClose }: Props) {
  const claim = useClaimHex();
  const upgrade = useUpgradeHex();
  const exploit = useExploitHex();

  const isOwned = !!hex.ownerId;
  const isMine = hex.ownerId === viewerUserId;
  const isEnemy = isOwned && !isMine;
  const isUnowned = !isOwned;
  const canAct = !hasActionToday && !!viewerUserId;
  const depleted = hex.degradation >= 100;

  const baseYield = hex.ambient?.baseYieldPerTick ?? 1;
  const upgradeBonus = [0, 0.5, 1.0, 1.5][hex.upgradeLevel] ?? 0;
  const estimatedYield = Math.floor(baseYield * (1 + upgradeBonus) * (1 - hex.degradation / 100) * (hex.isExploited ? 2 : 1));

  return (
    <div className="plate absolute top-28 right-4 w-72 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--ink-faint)]">
        <span className="plate-title text-[10px]">PARCEL {hex.h3Index.slice(-6).toUpperCase()}</span>
        <button onClick={onClose} className="opacity-50 hover:opacity-100 text-[var(--ink)]">
          <X size={14} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Ownership */}
        <div>
          {isMine && (
            <span className="text-xs font-bold" style={{ letterSpacing: "0.12em" }}>
              YOUR TERRITORY
            </span>
          )}
          {isEnemy && hex.ownerName && (
            <span className="text-xs font-bold text-[var(--brick)]" style={{ letterSpacing: "0.12em" }}>
              HELD BY {hex.ownerName.toUpperCase()}
            </span>
          )}
          {isUnowned && (
            <span className="text-xs italic text-[var(--sepia-soft)]" style={{ letterSpacing: "0.08em" }}>
              Unclaimed
            </span>
          )}
          {hex.pendingContest && (
            <div className="mt-1 text-[var(--brick)] text-[10px]" style={{ letterSpacing: "0.08em" }}>
              ⚡ CONTESTED — resolves at midnight PT
            </div>
          )}
        </div>

        {/* Resource data: a little printed table */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
          <Datum label="OIL WELLS" value={String(hex.ambient?.oilWellCount ?? 0)} />
          <Datum label="BASE YIELD" value={`${baseYield} crude/tick`} />
          <Datum label="CITATIONS /DAY" value={(hex.citationPerDay ?? 0).toFixed(1)} />
          <Datum label="DEAD ANIMALS /MO" value={(hex.deadAnimalPerMonth ?? 0).toFixed(1)} />
          <Datum
            label="UPGRADE LVL"
            value={"▪".repeat(hex.upgradeLevel) + "▫".repeat(3 - hex.upgradeLevel)}
          />
          <Datum
            label="EST. YIELD"
            value={`${estimatedYield} crude/tick`}
            tone={estimatedYield > baseYield ? "pine" : undefined}
          />
          {hex.degradation > 0 && (
            <div className="col-span-2">
              <div className="text-[var(--sepia-soft)] mb-0.5" style={{ letterSpacing: "0.08em" }}>
                DEGRADATION
              </div>
              <div className="w-full h-1.5 border border-[var(--ink-faint)] overflow-hidden">
                <div className="h-full bg-[var(--brick)]" style={{ width: `${hex.degradation}%` }} />
              </div>
              <div className="text-[var(--brick)] text-[10px] mt-0.5">
                {hex.degradation}%{depleted ? " — DEPLETED" : ""}
              </div>
            </div>
          )}
          {isOwned && <Datum label="LAST TICK" value={`${hex.lastTickYield} crude`} wide />}
        </div>

        {/* Exploit toggle (mine only, no action cost) */}
        {isMine && !depleted && (
          <button
            onClick={() => exploit.mutate({ h3Index: hex.h3Index, exploit: !hex.isExploited })}
            className="btn-ink w-full flex items-center gap-2 px-3 py-1.5 text-xs"
            style={
              hex.isExploited
                ? { color: "var(--brick)", borderColor: "rgba(166,84,60,0.6)", background: "rgba(166,84,60,0.08)" }
                : undefined
            }
          >
            <Flame size={12} />
            {hex.isExploited ? "EXPLOITING — disable?" : "Enable exploit (×2 yield, degrades)"}
          </button>
        )}

        {/* Action buttons */}
        {viewerUserId && (
          <div className="space-y-1.5 pt-2 border-t border-[var(--ink-faint)]">
            {hasActionToday && (
              <p className="text-[10px] italic text-[var(--sepia-soft)]">
                Action used today — returns at midnight PT.
              </p>
            )}

            {/* Claim */}
            {isUnowned && canAct && (
              <button
                onClick={() => claim.mutate(hex.h3Index)}
                disabled={claim.isPending}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
                data-active="true"
              >
                <Zap size={12} />
                CLAIM — {CLAIM_COST} CRUDE
              </button>
            )}

            {/* Upgrade */}
            {isMine && hex.upgradeLevel < 3 && canAct && (
              <button
                onClick={() => upgrade.mutate(hex.h3Index)}
                disabled={upgrade.isPending || viewerCrude < UPGRADE_COST[hex.upgradeLevel]}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
                style={{ color: "var(--pine)", borderColor: "rgba(60,110,80,0.5)" }}
              >
                <ArrowUp size={12} />
                UPGRADE LVL {hex.upgradeLevel + 1} — {UPGRADE_COST[hex.upgradeLevel]} CRUDE
              </button>
            )}

            {/* Raid / PvP is temporarily disabled while the core loop ships. */}
            {isEnemy && (
              <p className="text-[10px] italic text-[var(--sepia-soft)]">
                Raids are temporarily disabled.
              </p>
            )}
          </div>
        )}

        {!viewerUserId && (
          <a
            href="/api/login"
            className="block text-center text-[10px] hover:underline pt-2 border-t border-[var(--ink-faint)]"
            style={{ letterSpacing: "0.2em" }}
          >
            LOGIN TO PLAY
          </a>
        )}
      </div>
    </div>
  );
}

function Datum({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: string;
  tone?: "pine";
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <div className="text-[var(--sepia-soft)] mb-0.5" style={{ letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div className={`font-bold tabular-nums ${tone === "pine" ? "text-[var(--pine)]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
