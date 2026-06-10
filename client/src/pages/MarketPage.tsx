import { Link } from "wouter";
import { useAuth } from "../hooks/useAuth";
import { useBoard, type ExchangeMarket } from "../hooks/useExchange";
import ExchangeMasthead from "../components/ExchangeMasthead";
import { Spark } from "../components/charts";

const cents = (p: number) => `${Math.round(p * 100)}¢`;
const num = (n: number) => n.toLocaleString("en-US");

const CATEGORIES: { key: string; label: string }[] = [
  { key: "totals", label: "CITY TOTALS" },
  { key: "makes", label: "MAKES & MARQUES" },
  { key: "colors", label: "COLORS" },
  { key: "violations", label: "VIOLATIONS" },
  { key: "specials", label: "SPECIALS" },
];

function closesIn(): string {
  // Markets close at midnight PT; render the countdown in the floor's clock.
  const now = new Date();
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const mins = (23 - pt.getHours()) * 60 + (60 - pt.getMinutes());
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
}

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
  const { data: board, isLoading } = useBoard();

  const markets = board?.markets ?? [];
  const byCategory = new Map<string, ExchangeMarket[]>();
  for (const m of markets) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  const totalVolume = markets.reduce((a, m) => a + m.volume, 0);

  return (
    <div className="h-screen w-screen overflow-y-auto bg-[var(--paper)] text-[var(--sepia)]">
      <ExchangeMasthead active="floor" />

      <main className="max-w-3xl mx-auto px-5 py-7 pb-20">
        {/* The day's banner */}
        {board?.day && (
          <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-[10px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.3em" }}>
                TODAY'S BOARD
              </div>
              <div className="text-lg text-[var(--ink)]">{fullDate(board.day)}</div>
              <p className="text-[11px] text-[var(--sepia-soft)] italic mt-0.5">
                Markets close at midnight PT and settle when the city's records land.
              </p>
            </div>
            <div className="flex gap-5 text-right">
              <Stat label="MARKETS" value={String(markets.length)} />
              <Stat label="VOLUME" value={`${num(totalVolume)} cr`} />
              <Stat label="CLOSES" value={closesIn()} />
            </div>
          </div>
        )}

        {isLoading && <p className="text-[var(--sepia-soft)] text-sm italic">Opening the exchange…</p>}
        {board?.empty && (
          <div className="plate p-8 text-center text-[var(--sepia-soft)] text-sm italic">{board.empty}</div>
        )}

        {/* The board, by section */}
        {CATEGORIES.map(({ key, label }) => {
          const list = byCategory.get(key);
          if (!list?.length) return null;
          return (
            <section key={key} className="mb-7">
              <h2
                className="text-[10px] font-bold text-[var(--ink)] border-b border-[var(--ink-soft)] pb-1 mb-2"
                style={{ letterSpacing: "0.3em" }}
              >
                {label}
              </h2>
              <div className="space-y-2">
                {list.map((m) => (
                  <MarketRow key={m.id} m={m} loggedIn={!!user} />
                ))}
              </div>
            </section>
          );
        })}

        {/* Closed, awaiting the city */}
        {!!board?.closed.length && (
          <section className="mb-7">
            <h2
              className="text-[10px] font-bold text-[var(--brick)] border-b border-[var(--ink-soft)] pb-1 mb-2"
              style={{ letterSpacing: "0.3em" }}
            >
              CLOSED — AWAITING CITY RECORDS
            </h2>
            <div className="space-y-2">
              {board.closed.map((m) => (
                <MarketRow key={m.id} m={m} loggedIn={!!user} />
              ))}
            </div>
          </section>
        )}

        {/* Recent results */}
        {!!board?.settled.length && (
          <section>
            <h2
              className="text-[10px] font-bold text-[var(--sepia-soft)] border-b border-[var(--ink-soft)] pb-1 mb-2"
              style={{ letterSpacing: "0.3em" }}
            >
              RECENT SETTLEMENTS
            </h2>
            <div className="space-y-2">
              {board.settled.map((m) => (
                <MarketRow key={m.id} m={m} loggedIn={!!user} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.2em" }}>
        {label}
      </div>
      <div className="text-sm font-bold text-[var(--ink)] tabular-nums">{value}</div>
    </div>
  );
}

function MarketRow({ m, loggedIn }: { m: ExchangeMarket; loggedIn: boolean }) {
  const yes = m.prices[0];
  const held = (m.myShares?.[0] ?? 0) + (m.myShares?.[1] ?? 0);
  const settledStamp = m.state === "settled" && m.outcome;

  return (
    <Link
      href={`/market/${m.id}`}
      className="plate flex items-center gap-4 px-4 py-3 hover:bg-[var(--paper-deep)] transition-colors cursor-pointer no-underline"
    >
      {/* Question + meta */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--ink)] leading-snug">{m.question}</div>
        <div className="flex items-center gap-3 mt-1 text-[9.5px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.08em" }}>
          <span>VOL {num(m.volume)}</span>
          <span>·</span>
          <span>{m.traders} TRADER{m.traders === 1 ? "" : "S"}</span>
          {m.state === "closed" && (
            <>
              <span>·</span>
              <span className="text-[var(--brick)] italic">awaiting records for {m.targetDate}</span>
            </>
          )}
          {settledStamp && (
            <>
              <span>·</span>
              <span>
                settled {m.targetDate}
                {m.kind === "faceoff"
                  ? ` — ${num(m.actualA ?? 0)} vs ${num(m.actualB ?? 0)}`
                  : ` — actual ${num(m.actualA ?? 0)}`}
              </span>
            </>
          )}
          {loggedIn && held > 1e-6 && (
            <>
              <span>·</span>
              <span className="font-bold text-[var(--ink)] not-italic">
                YOUR BOOK: {(m.myShares?.[0] ?? 0) > 1e-6 && `${(m.myShares![0]).toFixed(1)} YES`}
                {(m.myShares?.[0] ?? 0) > 1e-6 && (m.myShares?.[1] ?? 0) > 1e-6 && " / "}
                {(m.myShares?.[1] ?? 0) > 1e-6 && `${(m.myShares![1]).toFixed(1)} NO`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Spark */}
      <div className="hidden sm:block shrink-0">
        <Spark values={m.spark} />
      </div>

      {/* Prices or the verdict stamp */}
      {settledStamp ? (
        <div
          className="shrink-0 border-2 px-2.5 py-1 text-[11px] font-bold rotate-[-4deg]"
          style={{
            color: m.outcome === "YES" ? "var(--pine)" : "var(--brick)",
            borderColor: m.outcome === "YES" ? "var(--pine)" : "var(--brick)",
            letterSpacing: "0.15em",
          }}
        >
          {m.outcome}
        </div>
      ) : (
        <div className="flex gap-1.5 shrink-0">
          <PriceChip label="YES" price={yes} tone="var(--pine)" />
          <PriceChip label="NO" price={1 - yes} tone="var(--brick)" />
        </div>
      )}
    </Link>
  );
}

function PriceChip({ label, price, tone }: { label: string; price: number; tone: string }) {
  return (
    <div
      className="border px-2 py-1 text-center min-w-[52px]"
      style={{ borderColor: tone, color: tone }}
    >
      <div className="text-[8px] font-bold" style={{ letterSpacing: "0.15em" }}>
        {label}
      </div>
      <div className="text-[13px] font-bold tabular-nums leading-none">{cents(price)}</div>
    </div>
  );
}
