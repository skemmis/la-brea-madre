import { X, Zap, ArrowUp, Swords, Flame } from "lucide-react";
import type { HexData } from "./HexMap";
import { useClaimHex, useUpgradeHex, useExploitHex, useRaidHex } from "../hooks/usePlayer";

interface Props {
  hex: HexData;
  viewerUserId?: number;
  hasActionToday: boolean;
  viewerCrude: number;
  onClose: () => void;
}

const UPGRADE_COST = [20, 40, 80];
const CLAIM_COST = 10;
const RAID_COST = 30;

export default function HexPanel({ hex, viewerUserId, hasActionToday, viewerCrude, onClose }: Props) {
  const claim = useClaimHex();
  const upgrade = useUpgradeHex();
  const exploit = useExploitHex();
  const raid = useRaidHex();

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
    <div className="absolute top-4 right-4 w-72 bg-[#0f0b07] border border-[#d97706]/40 rounded-sm text-[#e8dcc8] font-mono text-sm shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[#d97706]/20">
        <span className="text-[10px] text-[#d97706]/60 tracking-[0.2em] uppercase">
          CELL {hex.h3Index.slice(-6)}
        </span>
        <button onClick={onClose} className="text-[#d97706]/40 hover:text-[#d97706]">
          <X size={14} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Ownership */}
        <div>
          {isMine && (
            <span className="text-[#d97706] text-xs tracking-wide">YOUR TERRITORY</span>
          )}
          {isEnemy && hex.ownerName && (
            <span className="text-[#e87070] text-xs tracking-wide">HELD BY {hex.ownerName.toUpperCase()}</span>
          )}
          {isUnowned && (
            <span className="text-[#888] text-xs tracking-wide">UNCLAIMED</span>
          )}
          {hex.pendingContest && (
            <div className="mt-1 text-[#e87070] text-[10px] tracking-wide">
              ⚡ CONTESTED — resolves at midnight PT
            </div>
          )}
        </div>

        {/* Resource data */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <div className="text-[#888] mb-0.5">OIL WELLS</div>
            <div className="text-[#d97706]">{hex.ambient?.oilWellCount ?? 0}</div>
          </div>
          <div>
            <div className="text-[#888] mb-0.5">BASE YIELD</div>
            <div className="text-[#d97706]">{baseYield} crude/tick</div>
          </div>
          <div>
            <div className="text-[#888] mb-0.5">UPGRADE LVL</div>
            <div className="text-[#d97706]">{"▪".repeat(hex.upgradeLevel)}{"▫".repeat(3 - hex.upgradeLevel)}</div>
          </div>
          <div>
            <div className="text-[#888] mb-0.5">EST. YIELD</div>
            <div className={estimatedYield > baseYield ? "text-[#86d97a]" : "text-[#d97706]"}>
              {estimatedYield} crude/tick
            </div>
          </div>
          {hex.degradation > 0 && (
            <div className="col-span-2">
              <div className="text-[#888] mb-0.5">DEGRADATION</div>
              <div className="w-full bg-[#1a0f05] h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#e87070]"
                  style={{ width: `${hex.degradation}%` }}
                />
              </div>
              <div className="text-[#e87070] text-[10px] mt-0.5">{hex.degradation}%{depleted ? " — DEPLETED" : ""}</div>
            </div>
          )}
          {isOwned && (
            <div className="col-span-2">
              <div className="text-[#888] mb-0.5">LAST TICK</div>
              <div className="text-[#d97706]">{hex.lastTickYield} crude</div>
            </div>
          )}
        </div>

        {/* Exploit toggle (mine only, no action cost) */}
        {isMine && !depleted && (
          <button
            onClick={() => exploit.mutate({ h3Index: hex.h3Index, exploit: !hex.isExploited })}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs border rounded-sm transition-colors ${
              hex.isExploited
                ? "border-[#e87070]/60 bg-[#e87070]/10 text-[#e87070] hover:bg-[#e87070]/20"
                : "border-[#d97706]/40 text-[#d97706]/70 hover:bg-[#d97706]/10"
            }`}
          >
            <Flame size={12} />
            {hex.isExploited ? "EXPLOITING — disable?" : "Enable exploit (×2 yield, degrades)"}
          </button>
        )}

        {/* Action buttons */}
        {viewerUserId && (
          <div className="space-y-1.5 pt-1 border-t border-[#d97706]/10">
            {hasActionToday && (
              <p className="text-[10px] text-[#888] tracking-wide">
                ACTION USED TODAY — returns at midnight PT
              </p>
            )}

            {/* Claim */}
            {isUnowned && canAct && (
              <button
                onClick={() => claim.mutate(hex.h3Index)}
                disabled={claim.isPending}
                className="w-full flex items-center gap-2 px-3 py-2 bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] text-xs rounded-sm hover:bg-[#d97706]/25 disabled:opacity-50 transition-colors"
              >
                <Zap size={12} />
                CLAIM — {CLAIM_COST} crude
              </button>
            )}

            {/* Upgrade */}
            {isMine && hex.upgradeLevel < 3 && canAct && (
              <button
                onClick={() => upgrade.mutate(hex.h3Index)}
                disabled={upgrade.isPending || viewerCrude < UPGRADE_COST[hex.upgradeLevel]}
                className="w-full flex items-center gap-2 px-3 py-2 bg-[#86d97a]/10 border border-[#86d97a]/40 text-[#86d97a] text-xs rounded-sm hover:bg-[#86d97a]/20 disabled:opacity-40 transition-colors"
              >
                <ArrowUp size={12} />
                UPGRADE LVL {hex.upgradeLevel + 1} — {UPGRADE_COST[hex.upgradeLevel]} crude
              </button>
            )}

            {/* Raid */}
            {isEnemy && canAct && !hex.pendingContest && (
              <button
                onClick={() => raid.mutate(hex.h3Index)}
                disabled={raid.isPending || viewerCrude < RAID_COST}
                className="w-full flex items-center gap-2 px-3 py-2 bg-[#e87070]/10 border border-[#e87070]/40 text-[#e87070] text-xs rounded-sm hover:bg-[#e87070]/20 disabled:opacity-40 transition-colors"
              >
                <Swords size={12} />
                RAID — {RAID_COST} crude
              </button>
            )}
          </div>
        )}

        {!viewerUserId && (
          <a
            href="/api/login"
            className="block text-center text-[10px] text-[#d97706]/60 hover:text-[#d97706] tracking-widest pt-1 border-t border-[#d97706]/10"
          >
            LOGIN TO PLAY
          </a>
        )}
      </div>
    </div>
  );
}
