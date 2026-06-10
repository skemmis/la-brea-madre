export default function LoginPage() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-[var(--paper)]">
      <div className="plate text-center max-w-sm px-10 py-8 space-y-6">
        <div className="space-y-2">
          <div className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.25em" }}>
            COMPILED FROM OFFICIAL RECORDS
          </div>
          <h1 className="plate-title text-xl">LA BREA MADRE</h1>
          <div className="mx-auto w-24 border-t border-[var(--ink-soft)]" />
          <p className="text-[10px] text-[var(--ink)]" style={{ letterSpacing: "0.2em" }}>
            TERRITORY CONTROL · LOS ANGELES
          </p>
        </div>

        <div className="text-[var(--sepia)] text-xs leading-relaxed italic max-w-[260px] mx-auto">
          You hold territory on a real map of Los Angeles. Real-world data flows
          through your land. The city adjudicates the war.
        </div>

        <a
          href="/api/login"
          className="btn-ink inline-block px-10 py-2.5 text-xs font-bold"
          data-active="true"
        >
          BEGIN →
        </a>

        <p className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.25em" }}>
          FREE TO PLAY · NO PAY TO WIN
        </p>
      </div>
    </div>
  );
}
