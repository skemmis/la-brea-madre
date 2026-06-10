import { useState } from "react";
import { X, Zap, ArrowUp, Hammer, Scale, Banknote, Wrench, HardHat } from "lucide-react";
import type { HexData } from "./HexMap";
import {
  useClaimHex,
  useUpgradeHex,
  useAssessHex,
  useBuyoutHex,
  useRepairHex,
  useRetrofitHex,
  useCrewHex,
} from "../hooks/usePlayer";

interface Props {
  hex: HexData;
  viewerUserId?: number;
  workOrders: number;
  viewerCash: number;
  onClose: () => void;
}

const UPGRADE_COST = [200, 400, 800];
// Mirrors core config: tax 0.5%/day of assessment; claims at 30× $/day, $100 floor.
const TAX_RATE = 0.005;
const claimPriceOf = (finePerDay: number) => Math.max(100, Math.round(finePerDay * 30));

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export default function HexPanel({ hex, viewerUserId, workOrders, viewerCash, onClose }: Props) {
  const claim = useClaimHex();
  const upgrade = useUpgradeHex();
  const assess = useAssessHex();
  const buyout = useBuyoutHex();
  const repair = useRepairHex();
  const retrofit = useRetrofitHex();
  const crew = useCrewHex();

  const isOwned = !!hex.ownerId;
  const isMine = hex.ownerId === viewerUserId;
  const isEnemy = isOwned && !isMine;
  const isUnowned = !isOwned;
  const hasOrders = workOrders >= 1;

  const finePerDay = hex.fineDollarsPerDay ?? 0;
  const wells = hex.ambient?.oilWellCount ?? 0;
  const upgradeBonus = [0, 0.5, 1.0, 1.5][hex.upgradeLevel] ?? 0;
  const estimatedYield = Math.floor(
    (finePerDay + wells * 5) * (1 + upgradeBonus) * (1 - hex.degradation / 100)
  );
  const asking = hex.askingPrice ?? claimPriceOf(finePerDay);
  const [price, setPrice] = useState(asking);

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
        </div>

        {/* The ledger */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
          <Datum label="TICKET $/DAY" value={usd(finePerDay)} />
          <Datum label="EST. PAY /DAY" value={usd(estimatedYield)} tone={estimatedYield > finePerDay ? "pine" : undefined} />
          {isOwned && <Datum label="ASKING PRICE" value={usd(asking)} />}
          {isOwned && <Datum label="COUNTY TAX /DAY" value={usd(hex.dailyTax ?? Math.round(asking * TAX_RATE))} />}
          <Datum label="DEAD ANIMALS /MO" value={(hex.deadAnimalPerMonth ?? 0).toFixed(1)} />
          <Datum
            label="UPGRADE LVL"
            value={"▪".repeat(hex.upgradeLevel) + "▫".repeat(3 - hex.upgradeLevel)}
          />
          {isOwned && <Datum label="LAST TICK" value={usd(hex.lastTickYield)} />}
          {(hex.retrofitted || (hex.crewDaysLeft ?? 0) > 0) && (
            <div className="col-span-2 flex gap-2 text-[9px] font-bold" style={{ letterSpacing: "0.1em" }}>
              {hex.retrofitted && <span className="text-[var(--pine)]">⚒ RETROFITTED</span>}
              {(hex.crewDaysLeft ?? 0) > 0 && (
                <span className="text-[var(--ink)]">CREW ON SITE · {hex.crewDaysLeft}D LEFT</span>
              )}
            </div>
          )}
          {hex.degradation > 0 && (
            <div className="col-span-2">
              <div className="text-[var(--sepia-soft)] mb-0.5" style={{ letterSpacing: "0.08em" }}>
                DEGRADATION
              </div>
              <div className="w-full h-1.5 border border-[var(--ink-faint)] overflow-hidden">
                <div className="h-full bg-[var(--brick)]" style={{ width: `${hex.degradation}%` }} />
              </div>
              <div className="text-[var(--brick)] text-[10px] mt-0.5">{hex.degradation}%</div>
            </div>
          )}
        </div>

        {/* Re-assess: free, the tax is the cost of bravado */}
        {isMine && (
          <div className="space-y-1.5 pt-2 border-t border-[var(--ink-faint)]">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.12em" }}>
                YOUR PRICE
              </span>
              <input
                type="number"
                min={100}
                step={100}
                value={price}
                onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
                className="flex-1 bg-transparent border border-[var(--ink-faint)] px-2 py-1 text-[var(--ink)] tabular-nums text-xs"
              />
            </div>
            <button
              onClick={() => assess.mutate({ h3Index: hex.h3Index, price })}
              disabled={assess.isPending || price < 100 || price === asking}
              className="btn-ink w-full flex items-center gap-2 px-3 py-1.5 text-xs"
            >
              <Scale size={12} />
              FILE ASSESSMENT — TAX {usd(Math.round(price * TAX_RATE))}/DAY
            </button>
            <p className="text-[9px] italic text-[var(--sepia-soft)] leading-snug">
              Anyone may buy this parcel at your price, paid to you. Price it high and
              the county taxes your bravado; price it low and someone will take the deal.
            </p>
          </div>
        )}

        {/* Work Order actions */}
        {viewerUserId && (
          <div className="space-y-1.5 pt-2 border-t border-[var(--ink-faint)]">
            <p className="text-[10px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.1em" }}>
              WORK ORDERS: <b className="text-[var(--ink)]">{workOrders}</b>
              {!hasOrders && <span className="italic"> — carrion in your territory earns more</span>}
            </p>

            {/* Claim unowned land at its value */}
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

            {/* Buy out a rival at their own number */}
            {isEnemy && hasOrders && (
              <button
                onClick={() => buyout.mutate(hex.h3Index)}
                disabled={buyout.isPending || viewerCash < asking}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
                style={{ color: "var(--brick)", borderColor: "var(--brick)" }}
              >
                <Banknote size={12} />
                BUY OUT — 1 ORDER + {usd(asking)} TO {hex.ownerName?.toUpperCase() ?? "OWNER"}
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

            {/* Repair quake damage — billed at the land's worth */}
            {isMine && hex.degradation > 0 && hasOrders && (
              <button
                onClick={() => repair.mutate(hex.h3Index)}
                disabled={repair.isPending || viewerCash < (hex.repairBill ?? 0)}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
              >
                <Hammer size={12} />
                REPAIR — 1 ORDER + {usd(hex.repairBill ?? 0)}
              </button>
            )}

            {/* Retrofit against the Madre */}
            {isMine && !hex.retrofitted && hasOrders && (
              <button
                onClick={() => retrofit.mutate(hex.h3Index)}
                disabled={retrofit.isPending || viewerCash < Math.round(claimPriceOf(finePerDay) * 0.05)}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs"
              >
                <Wrench size={12} />
                RETROFIT — 1 ORDER + {usd(Math.round(claimPriceOf(finePerDay) * 0.05))} · ½ QUAKE DAMAGE
              </button>
            )}

            {/* Dispatch a crew */}
            {isMine && (hex.crewDaysLeft ?? 0) === 0 && hasOrders && (
              <button
                onClick={() => crew.mutate(hex.h3Index)}
                disabled={crew.isPending || viewerCash < 250}
                className="btn-ink w-full flex items-center gap-2 px-3 py-2 text-xs"
              >
                <HardHat size={12} />
                DISPATCH CREW — 1 ORDER + $250 · +50% PAY, 7 DAYS
              </button>
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
