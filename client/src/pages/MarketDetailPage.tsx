import { useState } from "react";
import { useRoute, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { usePlayer } from "../hooks/usePlayer";
import {
  useMarketDetail,
  useBuyExchange,
  useSellExchange,
  type SeriesPanel,
} from "../hooks/useExchange";
import ExchangeMasthead from "../components/ExchangeMasthead";
import { InkLine, InkBars } from "../components/charts";

const cents = (p: number) => `${Math.round(p * 100)}¢`;
const num = (n: number) => n.toLocaleString("en-US");
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export default function MarketDetailPage() {
  const [, params] = useRoute("/market/:id");
  const { user } = useAuth();
  const { data: player } = usePlayer(!!user);
  const { data, isLoading } = useMarketDetail(params?.id ?? null);

  return (
    <div className="h-screen w-screen overflow-y-auto bg-[var(--paper)] text-[var(--sepia)]">
      <ExchangeMasthead active="floor" />

      <main className="max-w-4xl mx-auto px-5 py-6 pb-20">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[10px] text-[var(--ink)] opacity-70 hover:opacity-100 hover:underline mb-4"
          style={{ letterSpacing: "0.2em" }}
        >
          <ArrowLeft size={11} /> BACK TO THE FLOOR
        </Link>

        {isLoading && <p className="text-[var(--sepia-soft)] italic text-sm">Pulling the file…</p>}

        {data && (
          <>
            {/* Header */}
            <div className="mb-5">
              <div className="flex items-center gap-3 text-[9px]" style={{ letterSpacing: "0.25em" }}>
                <span className="text-[var(--sepia-soft)]">{data.market.category.toUpperCase()}</span>
                <StateBadge state={data.market.state} outcome={data.market.outcome} />
                <span className="text-[var(--sepia-soft)]">FOR {data.market.targetDate}</span>
              </div>
              <h1 className="text-xl text-[var(--ink)] mt-1 leading-snug">{data.question}</h1>
              <div className="flex gap-5 mt-2 text-[10px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.1em" }}>
                <span>VOLUME ${num(data.market.volume)}</span>
                <span>{data.market.traders} TRADER{data.market.traders === 1 ? "" : "S"}</span>
                <span>OPENED AT {cents(data.market.baseRateYes)}</span>
                {data.market.state === "settled" && data.market.kind !== "faceoff" && (
                  <span className="font-bold text-[var(--ink)]">ACTUAL: {num(data.market.actualA ?? 0)}</span>
                )}
                {data.market.state === "settled" && data.market.kind === "faceoff" && (
                  <span className="font-bold text-[var(--ink)]">
                    {data.market.labelA} {num(data.market.actualA ?? 0)} — {data.market.labelB}{" "}
                    {num(data.market.actualB ?? 0)}
                  </span>
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-[1fr_260px] gap-5">
              {/* Left column: price chart + research + tape */}
              <div className="space-y-5 min-w-0">
                {/* Price history */}
                <div className="plate p-4">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="plate-title text-[9px]">PRICE OF YES</span>
                    <div className="flex gap-4 text-sm font-bold tabular-nums">
                      <span style={{ color: "var(--pine)" }}>YES {cents(data.market.prices[0])}</span>
                      <span style={{ color: "var(--brick)" }}>NO {cents(data.market.prices[1])}</span>
                    </div>
                  </div>
                  <InkLine
                    points={data.priceHistory.map((p, i) => ({
                      x: data.priceHistory.length > 1 ? i / (data.priceHistory.length - 1) : 0,
                      y: p.yes,
                    }))}
                    yMin={0}
                    yMax={1}
                    step
                    percent
                    height={170}
                  />
                  <div className="text-[9px] text-[var(--sepia-soft)] italic mt-1">
                    Opening odds from the trailing 30 days; each step is a fill on the floor.
                  </div>
                </div>

                {/* The research desk */}
                {data.research.map((panel) => (
                  <ResearchPanel key={panel.metric} panel={panel} line={data.market.kind !== "faceoff" ? data.market.line : undefined} />
                ))}

                {/* Settlement rules */}
                <div className="plate p-4">
                  <div className="plate-title text-[9px] mb-2">SETTLEMENT RULES</div>
                  <p className="text-[11px] leading-relaxed italic">{data.rules}</p>
                  <p className="text-[10px] text-[var(--sepia-soft)] mt-2">
                    Trading closes at midnight PT on the market day. Each winning share pays $1.
                  </p>
                </div>

                {/* The tape, this market */}
                <div className="plate">
                  <div className="plate-title text-[9px] px-4 py-2.5 border-b border-[var(--ink-faint)]">
                    THE TAPE
                  </div>
                  {data.trades.length === 0 ? (
                    <p className="text-[10px] text-[var(--sepia-soft)] italic p-4">No fills yet — fresh paper.</p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      {data.trades.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--ink-faint)] last:border-b-0 text-[11px]"
                        >
                          <span className="truncate">
                            <b>{t.user}</b>{" "}
                            <span className="italic opacity-75">{t.action === "buy" ? "bought" : "sold"}</span>{" "}
                            <b style={{ color: t.outcome === "YES" ? "var(--pine)" : "var(--brick)" }}>
                              {t.shares.toFixed(1)} {t.outcome}
                            </b>
                          </span>
                          <span className="tabular-nums text-[10px] text-[var(--sepia-soft)] shrink-0 ml-3">
                            {cents(t.yesPrice)} ·{" "}
                            {new Date(t.at).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                              timeZone: "America/Los_Angeles",
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right column: trade panel + position + holders */}
              <div className="space-y-5">
                <TradePanel
                  marketId={data.market.id}
                  prices={data.market.prices}
                  tradable={data.market.state === "trading"}
                  loggedIn={!!user}
                  crude={player?.crude ?? 0}
                  myShares={data.market.myShares ?? [0, 0]}
                  mySpent={data.market.mySpent ?? 0}
                />

                <div className="plate">
                  <div className="plate-title text-[9px] px-4 py-2.5 border-b border-[var(--ink-faint)]">
                    HOLDERS OF RECORD
                  </div>
                  {data.holders.length === 0 ? (
                    <p className="text-[10px] text-[var(--sepia-soft)] italic p-4">No positions yet.</p>
                  ) : (
                    data.holders.map((h) => (
                      <div
                        key={h.userId}
                        className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--ink-faint)] last:border-b-0 text-[11px]"
                      >
                        <span className="truncate font-bold">{h.user}</span>
                        <span className="tabular-nums text-[10px] shrink-0 ml-2">
                          {h.yes > 1e-6 && <b style={{ color: "var(--pine)" }}>{h.yes.toFixed(1)}Y</b>}
                          {h.yes > 1e-6 && h.no > 1e-6 && " · "}
                          {h.no > 1e-6 && <b style={{ color: "var(--brick)" }}>{h.no.toFixed(1)}N</b>}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function StateBadge({ state, outcome }: { state: string; outcome?: string | null }) {
  if (state === "trading")
    return (
      <span className="border border-[var(--pine)] text-[var(--pine)] px-1.5 py-0.5 font-bold">TRADING</span>
    );
  if (state === "closed")
    return (
      <span className="border border-[var(--brick)] text-[var(--brick)] px-1.5 py-0.5 font-bold">
        CLOSED · AWAITING RECORDS
      </span>
    );
  return (
    <span
      className="border-2 px-1.5 py-0.5 font-bold"
      style={{
        color: outcome === "YES" ? "var(--pine)" : "var(--brick)",
        borderColor: outcome === "YES" ? "var(--pine)" : "var(--brick)",
      }}
    >
      SETTLED {outcome}
    </span>
  );
}

function ResearchPanel({ panel, line }: { panel: SeriesPanel; line?: number }) {
  const pts = panel.series.map((p, i) => ({
    x: panel.series.length > 1 ? i / (panel.series.length - 1) : 0,
    y: p.value,
  }));
  const first = panel.series[0]?.date;
  const last = panel.series[panel.series.length - 1]?.date;
  const todayDow = new Date().getDay();

  return (
    <div className="plate p-4">
      <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
        <span className="plate-title text-[9px]">THE RECORD — {panel.label.toUpperCase()}</span>
        <span className="text-[9px] text-[var(--sepia-soft)] italic">last 180 days of city records</span>
      </div>
      <InkLine
        points={pts}
        height={150}
        refY={line && line > 0 ? line : undefined}
        refLabel={line && line > 0 ? `the line: ${num(line)}` : undefined}
        xLabels={
          first && last
            ? [
                { x: 0.02, label: first.slice(5) },
                { x: 0.98, label: last.slice(5) },
              ]
            : undefined
        }
      />
      <div className="grid sm:grid-cols-[1fr_260px] gap-4 mt-3 items-end">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Datum label="MEAN" value={num(panel.stats.mean)} />
          <Datum label="MEDIAN" value={num(panel.stats.median)} />
          <Datum label="LAST" value={num(panel.stats.last)} sub={panel.stats.lastDate.slice(5)} />
          <Datum label="RECORD DAY" value={num(panel.stats.max)} sub={panel.stats.maxDate} wide />
        </div>
        <div>
          <div className="text-[8.5px] text-[var(--sepia-soft)] mb-1" style={{ letterSpacing: "0.2em" }}>
            BY DAY OF WEEK
          </div>
          <InkBars
            values={panel.dow.map((d) => d.avg)}
            labels={DOW}
            highlight={todayDow}
          />
        </div>
      </div>
    </div>
  );
}

function Datum({ label, value, sub, wide }: { label: string; value: string; sub?: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-3 border-t border-[var(--ink-faint)] pt-1.5" : undefined}>
      <div className="text-[8.5px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.18em" }}>
        {label}
      </div>
      <div className="text-sm font-bold text-[var(--ink)] tabular-nums">
        {value}
        {sub && <span className="text-[9px] font-normal text-[var(--sepia-soft)] ml-1.5">{sub}</span>}
      </div>
    </div>
  );
}

function TradePanel({
  marketId,
  prices,
  tradable,
  loggedIn,
  crude,
  myShares,
  mySpent,
}: {
  marketId: string;
  prices: number[];
  tradable: boolean;
  loggedIn: boolean;
  crude: number;
  myShares: number[];
  mySpent: number;
}) {
  const [side, setSide] = useState<0 | 1>(0);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState(20);
  const buy = useBuyExchange();
  const sell = useSellExchange();

  const price = prices[side];
  const held = myShares[side] ?? 0;
  const positionValue = (myShares[0] ?? 0) * prices[0] + (myShares[1] ?? 0) * prices[1];
  const estShares = mode === "buy" && price > 0 ? amount / price : 0;
  const estProceeds = mode === "sell" ? amount * price : 0;

  const submit = () => {
    if (mode === "buy") buy.mutate({ marketId, outcome: side, budget: amount });
    else sell.mutate({ marketId, outcome: side, shares: amount });
  };

  const disabled =
    !tradable ||
    (mode === "buy" && (amount <= 0 || amount > crude)) ||
    (mode === "sell" && (amount <= 0 || amount > held + 1e-6)) ||
    buy.isPending ||
    sell.isPending;

  return (
    <div className="plate p-4">
      <div className="plate-title text-[9px] mb-3">PLACE AN ORDER</div>

      {!loggedIn ? (
        <a
          href="/api/login"
          className="block text-center text-[10px] hover:underline py-2"
          style={{ letterSpacing: "0.2em" }}
        >
          LOGIN TO TRADE →
        </a>
      ) : (
        <>
          {/* Side */}
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            {([0, 1] as const).map((i) => (
              <button
                key={i}
                onClick={() => {
                  setSide(i);
                  if (mode === "sell") setAmount(Math.floor((myShares[i] ?? 0) * 10) / 10);
                }}
                className="btn-ink py-2 text-center"
                data-active={side === i}
                style={{
                  color: i === 0 ? "var(--pine)" : "var(--brick)",
                  borderColor: side === i ? (i === 0 ? "var(--pine)" : "var(--brick)") : undefined,
                }}
              >
                <div className="text-[9px] font-bold" style={{ letterSpacing: "0.15em" }}>
                  {i === 0 ? "YES" : "NO"}
                </div>
                <div className="text-base font-bold tabular-nums leading-tight">{cents(prices[i])}</div>
              </button>
            ))}
          </div>

          {/* Mode */}
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <button className="btn-ink py-1 text-[10px] font-bold" data-active={mode === "buy"} onClick={() => setMode("buy")}>
              BUY
            </button>
            <button
              className="btn-ink py-1 text-[10px] font-bold"
              data-active={mode === "sell"}
              onClick={() => {
                setMode("sell");
                setAmount(Math.floor(held * 10) / 10);
              }}
            >
              SELL
            </button>
          </div>

          {/* Amount */}
          <label className="block text-[9px] text-[var(--sepia-soft)] mb-1" style={{ letterSpacing: "0.15em" }}>
            {mode === "buy" ? `STAKE ($) — BANK $${num(Math.floor(crude))}` : `SHARES — HELD ${held.toFixed(1)}`}
          </label>
          <input
            type="number"
            min={0}
            step={mode === "buy" ? 5 : 0.1}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
            className="w-full bg-transparent border border-[var(--ink-faint)] px-2 py-1.5 text-[var(--ink)] tabular-nums text-sm mb-2"
          />

          <div className="text-[10px] text-[var(--sepia-soft)] italic mb-3">
            {mode === "buy"
              ? `≈ ${estShares.toFixed(1)} shares · pays $${estShares.toFixed(1)} if ${side === 0 ? "YES" : "NO"}`
              : `≈ $${estProceeds.toFixed(1)} returned at the current price`}
          </div>

          <button
            onClick={submit}
            disabled={disabled}
            className="btn-ink w-full py-2.5 text-xs font-bold"
            data-active="true"
            style={{
              color: side === 0 ? "var(--pine)" : "var(--brick)",
              borderColor: side === 0 ? "var(--pine)" : "var(--brick)",
            }}
          >
            {tradable
              ? `${mode.toUpperCase()} ${side === 0 ? "YES" : "NO"}`
              : "TRADING CLOSED"}
          </button>

          {/* My book */}
          {(myShares[0] > 1e-6 || myShares[1] > 1e-6) && (
            <div className="mt-3 pt-3 border-t border-[var(--ink-faint)] text-[10px] space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--sepia-soft)]" style={{ letterSpacing: "0.1em" }}>YOUR BOOK</span>
                <span className="tabular-nums font-bold">
                  {myShares[0] > 1e-6 && <span style={{ color: "var(--pine)" }}>{myShares[0].toFixed(1)} YES</span>}
                  {myShares[0] > 1e-6 && myShares[1] > 1e-6 && " · "}
                  {myShares[1] > 1e-6 && <span style={{ color: "var(--brick)" }}>{myShares[1].toFixed(1)} NO</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--sepia-soft)]">Cost basis</span>
                <span className="tabular-nums">${mySpent.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--sepia-soft)]">Mark value</span>
                <span
                  className="tabular-nums font-bold"
                  style={{ color: positionValue >= mySpent ? "var(--pine)" : "var(--brick)" }}
                >
                  ${positionValue.toFixed(1)}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
