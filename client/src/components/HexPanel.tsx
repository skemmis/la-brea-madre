import { useState } from "react";
import { X, Zap, ArrowUp, Flame, Swords, Shield, Hammer } from "lucide-react";
import type { HexData } from "./HexMap";
import {
  useClaimHex,
  useUpgradeHex,
  useExploitHex,
  useContestHex,
  useDefendHex,
  useRepairHex,
} from "../hooks/usePlayer";

interface Props {
  hex: HexData;
  viewerUserId?: number;
  workOrders: number;
  viewerCash: number;
  onClose: () => void;
}

const UPGRADE_COST = [200, 400, 800];
const MIN_BID = 50;
// Land is priced at its value (mirrors core config: floor $100, 30× $/day).
const claimPriceOf = (finePerDay: number) => Math.max(100, Math.round(finePerDay * 30));

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export default function HexPanel({ hex, viewerUserId, workOrders, viewerCash, onClose }: Props) {
  const claim = useClaimHex();
  const upgrade = useUpgradeHex();
  const exploit = useExploitHex();
  const contest = useContestHex();
  const defend = useDefendHex();
  const repair = useRepairHex();
  const [bid, setBid] = useState(200);

  const isOwned = !!hex.ownerId;
  const isMine = hex.ownerId === viewerUserId;
  const isEnemy = isOwned && !isMine;
  const isUnowned = !isOwned;
  const hasOrders = workOrders >= 1;
  const depleted = hex.degradation >= 100;

  // The purse: a parcel pays the ticket dollars written inside it.
  const finePerDay = hex.fineDollarsPerDay ?? 0;
  const wells = hex.ambient?.oilWellCount ?? 0;
  const upgradeBonus = [0, 0.5, 1.0, 1.5][hex.upgradeLevel] ?? 0;
  const estimatedYield = Math.floor(
    (finePerDay + wells * 5) *
      (1 + upgradeBonus) *
      (1 - hex.degradation / 100) *
      (hex.isExploited ? 2 : 1)
  );

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
            <div className="mt-1 text-[var(--brick)] text-[10px] font-bold" style={{ letterSpacing: "0.08em" }}>
              ⚔ EMBATTLED — sealed bids open at midnight PT
            </div>
          )}
        </div>

        {/* The ledger */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
          <Datum label="TICKET $/DAY" value={usd(finePerDay)} />
          <Datum label="EST. PAY /DAY" value={usd(estimatedYield)} tone={estimatedYield > finePerDay ? "pine" : undefined} />
          <Datum label="DEAD ANIMALS /MO" value={(hex.deadAnimalPerMonth ?? 0).toFixed(1)} />
          <Datum
            label="UPGRADE LVL"
            value={"▪".repeat(hex.upgradeLevel) + "▫".repeat(3 - hex.upgradeLevel)}
          />
          <Datum label="OIL WELLS" value={String(wells)} />
          {isOwned && <Datum label="LAST TICK" value={usd(hex.lastTickYield)} />}
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
        </div>

        {/* Exploit toggle (mine only, no order cost) */}
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
            {hex.isExploited ? "EXPLOITING — disable?" : "Enable exploit (×2 pay, degrades)"}
          </button>
        )}

        {/* Work Order actions */}
        {viewerUserId && (
          <div className="space-y-1.5 pt-2 border-t border-[var(--ink-faint)]">
            <p className="text-[10px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.1em" }}>
              WORK ORDERS: <b className="text-[var(--ink)]">{workOrders}</b>
              {!hasOrders && <span className="italic"> — carrion in your territory earns more</span>}
            </p>

            {/* Claim — land is priced at its value */}
            {isUnowned && hasOrders && (
              <button
                onClick={() => claim.mutate(hex.h3Index)}
                disabled={claim.isPending || viewerCash < claimPriceOf(finePerDay)}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
                data-active="true"
              >
                <Zap size={12} />
                CLAIM — 1 ORDER + {usd(claimPriceOf(finePerDay))}
              </button>
            )}

            {/* Upgrade */}
            {isMine && hex.upgradeLevel < 3 && hasOrders && (
              <button
                onClick={() => upgrade.mutate(hex.h3Index)}
                disabled={upgrade.isPending || viewerCash < UPGRADE_COST[hex.upgradeLevel]}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
                style={{ color: "var(--pine)", borderColor: "rgba(60,110,80,0.5)" }}
              >
                <ArrowUp size={12} />
                UPGRADE LVL {hex.upgradeLevel + 1} — 1 ORDER + {usd(UPGRADE_COST[hex.upgradeLevel])}
              </button>
            )}

            {/* Repair a shaken parcel */}
            {isMine && hex.degradation > 0 && hasOrders && (
              <button
                onClick={() => repair.mutate(hex.h3Index)}
                disabled={repair.isPending || viewerCash < hex.degradation * 2}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
              >
                <Hammer size={12} />
                REPAIR — 1 ORDER + {usd(hex.degradation * 2)}
              </button>
            )}

            {/* Contest: declare war on a neighbor */}
            {isEnemy && !hex.pendingContest && hasOrders && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.12em" }}>
                    WAR CHEST
                  </span>
                  <input
                    type="number"
                    min={MIN_BID}
                    step={50}
                    value={bid}
                    onChange={(e) => setBid(Math.max(0, Number(e.target.value)))}
                    className="flex-1 bg-transparent border border-[var(--ink-faint)] px-2 py-1 text-[var(--ink)] tabular-nums text-xs"
                  />
                </div>
                <button
                  onClick={() => contest.mutate({ h3Index: hex.h3Index, bid })}
                  disabled={contest.isPending || bid < MIN_BID || bid > viewerCash}
                  className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
                  style={{ color: "var(--brick)", borderColor: "var(--brick)" }}
                >
                  <Swords size={12} />
                  CONTEST — 1 ORDER + {usd(bid)} SEALED
                </button>
                <p className="text-[9px] italic text-[var(--sepia-soft)] leading-snug">
                  Sealed bids open at midnight. Higher purse takes the parcel; ties hold;
                  the loser recovers half their chest. Must border your territory.
                </p>
              </div>
            )}

            {/* Defend your embattled parcel (no order needed) */}
            {isMine && hex.pendingContest && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--brick)] font-bold" style={{ letterSpacing: "0.12em" }}>
                    DEFENSE
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={50}
                    value={bid}
                    onChange={(e) => setBid(Math.max(0, Number(e.target.value)))}
                    className="flex-1 bg-transparent border border-[var(--ink-faint)] px-2 py-1 text-[var(--ink)] tabular-nums text-xs"
                  />
                </div>
                <button
                  onClick={() => defend.mutate({ h3Index: hex.h3Index, bid })}
                  disabled={defend.isPending || bid <= 0 || bid > viewerCash}
                  className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
                  data-active="true"
                >
                  <Shield size={12} />
                  COMMIT {usd(bid)} TO THE DEFENSE
                </button>
                <p className="text-[9px] italic text-[var(--sepia-soft)] leading-snug">
                  Commitments stack and stay sealed. You hold on a tie; if the parcel
                  falls, half your commitment comes back.
                </p>
              </div>
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
}: {
  label: string;
  value: string;
  tone?: "pine";
}) {
  return (
    <div>
      <div className="text-[var(--sepia-soft)] mb-0.5" style={{ letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div className={`font-bold tabular-nums ${tone === "pine" ? "text-[var(--pine)]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
