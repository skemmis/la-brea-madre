export default function LoginPage() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0a0a0a] font-mono">
      <div className="text-center space-y-6 max-w-sm px-6">
        <div className="space-y-1">
          <h1 className="text-[#d97706] text-xl tracking-[0.3em] uppercase">
            La Brea Madre
          </h1>
          <p className="text-[#888] text-[10px] tracking-[0.2em]">
            TERRITORY CONTROL · LOS ANGELES · REAL DATA
          </p>
        </div>

        <div className="text-[#e8dcc8]/60 text-xs leading-relaxed max-w-[260px] mx-auto">
          You hold territory on a real map of Los Angeles. Real-world data flows
          through your land. The city adjudicates the war.
        </div>

        <a
          href="/api/login"
          className="inline-block px-8 py-2.5 bg-[#d97706]/15 border border-[#d97706]/50 text-[#d97706] text-xs tracking-widest hover:bg-[#d97706]/25 transition-colors rounded-sm"
        >
          BEGIN →
        </a>

        <p className="text-[#555] text-[9px] tracking-widest">
          FREE TO PLAY · NO PAY TO WIN
        </p>
      </div>
    </div>
  );
}
