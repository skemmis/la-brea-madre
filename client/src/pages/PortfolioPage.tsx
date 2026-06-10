import { Link } from "wouter";
import { useAuth } from "../hooks/useAuth";
import { usePortfolio } from "../hooks/useExchange";
import ExchangeMasthead from "../components/ExchangeMasthead";
import { InkLine } from "../components/charts";

const num = (n: number) => n.toLocaleString("en-US");
const cents = (p: number) => `${Math.round(p * 100)}¢`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--pine)" : "var(--brick)");

export default function PortfolioPage() {
  const { user } = useAuth();
  const { data: pf, isLoading } = usePortfolio(!!user);

  return (
    <div className="h-screen w-screen overflow-y-auto bg-[var(--paper)] text-[var(--sepia)]">
      <ExchangeMasthead active="portfolio" />

      <main className="max-w-4xl mx-auto px-5 py-7 pb-20">
        <div className="mb-5">
          <div className="text-[10px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.3em" }}>
            ACCOUNT STATEMENT
          </div>
          <h1 className="plate-title text-lg text-[var(--ink)]">YOUR BOOK</h1>
        </div>

        {!user && (
          <div className="plate p-10 text-center">
            <a href="/api/login" className="text-sm hover:underline" style={{ letterSpacing: "0.15em" }}>
              LOGIN TO SEE YOUR STATEMENT →
            </a>
          </div>
        )}

        {isLoading && user && <p className="italic text-sm text-[var(--sepia-soft)]">Balancing the ledger…</p>}

        {pf && (
          <>
            {/* Headline figures */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
              <Headline label="CASH" value={`$${num(Math.floor(pf.crude))}`} />
              <Headline
                label="AT MARK"
                value={`$${pf.stats.openValue.toFixed(1)}`}
                sub={`on $${pf.stats.openSpent.toFixed(1)} staked`}
              />
              <Headline
                label="REALIZED P&L"
                value={`${signed(pf.stats.realized)}`}
                tone={pnlColor(pf.stats.realized)}
              />
              <Headline label="LIFETIME VOLUME" value={`$${num(pf.stats.volume)}`} />
              <Headline
                label="RECORD"
                value={`${pf.stats.wins}–${pf.stats.settledMarkets - pf.stats.wins}`}
                sub={
                  pf.stats.settledMarkets
                    ? `${Math.round((pf.stats.wins / pf.stats.settledMarkets) * 100)}% hit rate`
                    : "no settlements yet"
                }
              />
            </div>

            {/* Equity curve */}
            <div className="plate p-4 mb-6">
              <div className="plate-title text-[9px] mb-2">REALIZED P&L, CUMULATIVE</div>
              {pf.equity.length < 2 ? (
                <p className="text-[10px] italic text-[var(--sepia-soft)] py-6 text-center">
                  The curve begins once your markets start settling.
                </p>
              ) : (
                <InkLine
                  points={pf.equity.map((e, i) => ({
                    x: pf.equity.length > 1 ? i / (pf.equity.length - 1) : 0,
                    y: e.realized,
                  }))}
                  height={150}
                  hoverLabels={pf.equity.map((e) => e.date)}
                  color={pf.stats.realized >= 0 ? "#3c6e50" : "#a6543c"}
                  refY={0}
                  xLabels={[
                    { x: 0.02, label: pf.equity[0].date.slice(5) },
                    { x: 0.98, label: pf.equity[pf.equity.length - 1].date.slice(5) },
                  ]}
                />
              )}
            </div>

            {/* Open positions */}
            <Section title="OPEN POSITIONS">
              {pf.open.length === 0 ? (
                <Empty>No open positions. The floor is open — go take a view.</Empty>
              ) : (
                pf.open.map((p) => {
                  const pnl = p.value - p.spent;
                  return (
                    <Link
                      key={p.marketId}
                      href={`/market/${p.marketId}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--ink-faint)] last:border-b-0 hover:bg-[var(--paper-deep)] no-underline text-[var(--sepia)]"
                    >
                      <div className="min-w-0">
                        <div className="text-[12px] text-[var(--ink)] truncate">{p.question}</div>
                        <div className="text-[9.5px] text-[var(--sepia-soft)] mt-0.5" style={{ letterSpacing: "0.06em" }}>
                          {p.shares[0] > 1e-6 && `${p.shares[0].toFixed(1)} YES @ ${cents(p.prices[0])}`}
                          {p.shares[0] > 1e-6 && p.shares[1] > 1e-6 && " · "}
                          {p.shares[1] > 1e-6 && `${p.shares[1].toFixed(1)} NO @ ${cents(p.prices[1])}`}
                          {p.state === "closed" && (
                            <span className="text-[var(--brick)] italic"> · awaiting records</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-[12px] font-bold">${p.value.toFixed(1)}</div>
                        <div className="text-[10px] font-bold" style={{ color: pnlColor(pnl) }}>
                          {signed(pnl)}
                        </div>
                      </div>
                    </Link>
                  );
                })
              )}
            </Section>

            {/* Settled history */}
            <Section title="SETTLEMENTS">
              {pf.history.length === 0 ? (
                <Empty>Nothing settled yet.</Empty>
              ) : (
                pf.history.map((h) => (
                  <div
                    key={`${h.marketId}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--ink-faint)] last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="text-[12px] text-[var(--ink)] truncate">{h.question}</div>
                      <div className="text-[9.5px] text-[var(--sepia-soft)] mt-0.5">
                        {h.targetDate} · settled{" "}
                        <b style={{ color: h.outcome === "YES" ? "var(--pine)" : "var(--brick)" }}>{h.outcome}</b> ·
                        staked ${h.spent.toFixed(1)}, paid ${h.payout.toFixed(1)}
                      </div>
                    </div>
                    <div
                      className="text-[12px] font-bold tabular-nums shrink-0"
                      style={{ color: pnlColor(h.profit) }}
                    >
                      {signed(h.profit)}
                    </div>
                  </div>
                ))
              )}
            </Section>

            {/* Trade log */}
            <Section title="TRADE LOG">
              {pf.trades.length === 0 ? (
                <Empty>No fills yet.</Empty>
              ) : (
                pf.trades.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-4 py-1.5 border-b border-[var(--ink-faint)] last:border-b-0 text-[11px]"
                  >
                    <span className="truncate">
                      <span className="italic opacity-75">{t.action === "buy" ? "Bought" : "Sold"}</span>{" "}
                      <b style={{ color: t.outcome === "YES" ? "var(--pine)" : "var(--brick)" }}>
                        {t.shares.toFixed(1)} {t.outcome}
                      </b>{" "}
                      <span className="opacity-75">— {t.question ?? t.marketId}</span>
                    </span>
                    <span className="tabular-nums text-[10px] text-[var(--sepia-soft)] shrink-0">
                      ${Math.abs(t.cost).toFixed(1)} ·{" "}
                      {new Date(t.at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        timeZone: "America/Los_Angeles",
                      })}
                    </span>
                  </div>
                ))
              )}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

function Headline({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="plate p-3">
      <div className="text-[8.5px] text-[var(--sepia-soft)] mb-1" style={{ letterSpacing: "0.18em" }}>
        {label}
      </div>
      <div className="text-base font-bold tabular-nums leading-tight" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-[var(--sepia-soft)] italic mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="plate mb-6">
      <div className="plate-title text-[9px] px-4 py-2.5 border-b border-[var(--ink-faint)]">{title}</div>
      <div className="max-h-96 overflow-y-auto">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-[var(--sepia-soft)] italic p-4">{children}</p>;
}
