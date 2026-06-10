/**
 * The Arena — a proving ground against imaginary foes.
 *
 * Runs the REAL battle resolver (shared/core) in the browser: pick your
 * binder's school and your foe's, set the ground, and watch five lanes
 * resolve the way they would at the nightly tick. No money moves, no deeds
 * change hands, nothing is saved — it is a table in the back room where the
 * county lets you practice.
 */
import { useMemo, useRef, useState } from "react";
import ExchangeMasthead from "../components/ExchangeMasthead";
import {
  CATALOG,
  resolveBattle,
  AFFINITY_BONUS,
  COUNTER_BONUS,
  type BattleResult,
  type CardDef,
  type Suit,
  type Terrain,
} from "@shared/core";

// ─── Binder schools (mirrors sim/fights.ts archetypes) ────────────────────────

const CAP = 50;

function copyCap(c: CardDef): number {
  if (c.rarity === "mythic") return 1;
  if (c.rarity === "rare") return 2;
  return 3;
}

function build(score: (c: CardDef) => number, filter?: (c: CardDef) => boolean): CardDef[] {
  const pool = (filter ? CATALOG.filter(filter) : CATALOG.slice()).sort((a, b) => score(b) - score(a));
  const out: CardDef[] = [];
  const counts = new Map<string, number>();
  while (out.length < CAP) {
    let placed = false;
    for (const c of pool) {
      if ((counts.get(c.id) ?? 0) >= copyCap(c)) continue;
      out.push(c);
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
      placed = true;
      if (out.length >= CAP) break;
    }
    if (!placed) break;
  }
  return out;
}

const RITE_VALUE: Record<string, number> = {
  surge: 2, reckless: 2, sink: 1.5, ward: 2.5, bulwark: 2,
  flock: 2, phoenix: 2.5, medic: 2, poach: 3, predator: 2,
};

const SCHOOLS: Record<string, { blurb: string; binder: () => CardDef[] }> = {
  "THE UNDER": {
    blurb: "Black. Kill quickly, no frills. The reckless burn either way.",
    binder: () => build((c) => c.power + (c.rite?.kind === "reckless" ? 3 : 0), (c) => c.suit === "black"),
  },
  "THE ORDINANCE": {
    blurb: "Blue. Wards silence rites; bulwarks hold deeds.",
    binder: () =>
      build((c) => c.power + (c.rite?.kind === "ward" || c.rite?.kind === "bulwark" ? 3 : 0), (c) => c.suit === "blue"),
  },
  "THE FLOCK": {
    blurb: "White. Phoenixes, medics, and poachers who keep what they beat.",
    binder: () => build((c) => (c.rite ? (RITE_VALUE[c.rite.kind] ?? 0) * 2 : 0) + c.power, (c) => c.suit === "white"),
  },
  BALANCED: {
    blurb: "A third of each stratum, rites valued with power.",
    binder: () => {
      const out: CardDef[] = [];
      for (const suit of ["black", "blue", "white"] as Suit[]) {
        out.push(...build((c) => c.power + (c.rite ? (RITE_VALUE[c.rite.kind] ?? 0) * 1.5 : 0), (c) => c.suit === suit).slice(0, 17));
      }
      return out.slice(0, CAP);
    },
  },
  GOODSTUFF: {
    blurb: "The five biggest numbers, every time. No plan, just tonnage.",
    binder: () => build((c) => c.power),
  },
};

// ─── Fates (display-only mirror of game.ts's dawn settlement) ─────────────────

interface Fate {
  side: "attacker" | "defender";
  card: CardDef;
  fate: string;
}

function fatesOf(result: BattleResult, mySide: "attacker" | "defender"): Fate[] {
  const out: Fate[] = [];
  for (const lane of result.lanes) {
    for (const side of ["attacker", "defender"] as const) {
      const card = side === "attacker" ? lane.attacker : lane.defender;
      if (!card) continue;
      const myWarded = side === "attacker" ? lane.attackerWarded : lane.defenderWarded;
      const foe = side === "attacker" ? lane.defender : lane.attacker;
      const foeWarded = side === "attacker" ? lane.defenderWarded : lane.attackerWarded;
      if (card.rite?.kind === "phoenix" && !myWarded) {
        if (lane.sunk || (lane.winner !== "none" && lane.winner !== side))
          out.push({ side, card, fate: "walks away (phoenix)" });
        continue;
      }
      const beaten = lane.sunk || (lane.winner !== "none" && lane.winner !== side);
      const reckless = card.rite?.kind === "reckless" && !myWarded;
      if (beaten) {
        if (!lane.sunk && foe?.rite?.kind === "poach" && !foeWarded) {
          out.push({ side, card, fate: "STOLEN — it serves the enemy now" });
        } else if (lane.sunk) {
          out.push({ side, card, fate: card.rarity === "rare" || card.rarity === "mythic" ? "taken by the tar — fossilized" : "taken by the tar" });
        } else if (reckless) {
          out.push({ side, card, fate: "burned by its own nature" });
        } else if (side === "attacker") {
          out.push({ side, card, fate: card.rarity === "rare" || card.rarity === "mythic" ? "burned — a fossil for the gallery" : "burned" });
        } else {
          out.push({ side, card, fate: "wounded — rests 3 days" });
        }
      } else if (reckless) {
        out.push({ side, card, fate: "won, and burned anyway" });
      } else if (card.rite?.kind === "medic" && !myWarded) {
        out.push({ side, card, fate: "survives — heals a wounded card at dawn" });
      }
    }
  }
  return out.sort((a) => (a.side === mySide ? -1 : 1));
}

// ─── Visual bits ──────────────────────────────────────────────────────────────

const SUIT_STYLE: Record<Suit, { bg: string; fg: string; edge: string; label: string }> = {
  black: { bg: "#221a12", fg: "#e8ddc6", edge: "#0e0a06", label: "THE UNDER" },
  blue: { bg: "var(--ink)", fg: "#ece4d0", edge: "#1b2447", label: "THE ORDER" },
  white: { bg: "#f2ecdb", fg: "#473423", edge: "#b8ab8c", label: "THE UPPER" },
};

function riteText(c: CardDef): string {
  const r = c.rite;
  if (!r) return "no rite — it is what it is";
  switch (r.kind) {
    case "surge": return `SURGE +${r.n} on home ground`;
    case "reckless": return `RECKLESS +${r.n} — burns after the fight, win or lose`;
    case "sink": return "SINK — the lane swallows both";
    case "ward": return "WARD — the opposing rite does not fire";
    case "bulwark": return `BULWARK +${r.n} when holding the deed`;
    case "flock": return `FLOCK +${r.n} per other White card here`;
    case "phoenix": return "PHOENIX — never burned, wounded, or stolen";
    case "medic": return "MEDIC — if it survives, heals a wounded card";
    case "poach": return "POACH — keeps what it beats, forever";
    case "predator": return `PREDATOR +${r.n} vs ${SUIT_STYLE[r.vs].label.toLowerCase()}`;
  }
}

function ArenaCard({ card, dim }: { card: CardDef | null; dim?: boolean }) {
  if (!card)
    return (
      <div className="w-36 h-44 border border-dashed border-[var(--ink-faint)] flex items-center justify-center text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.2em" }}>
        EMPTY LANE
      </div>
    );
  const s = SUIT_STYLE[card.suit];
  return (
    <div
      className="w-36 h-44 flex flex-col select-none"
      style={{
        background: s.bg,
        color: s.fg,
        border: `2px solid ${s.edge}`,
        boxShadow: `inset 0 0 0 2px ${s.bg}, inset 0 0 0 3px ${s.fg}33`,
        opacity: dim ? 0.45 : 1,
        transition: "opacity 400ms",
      }}
    >
      <div className="px-2 pt-1.5 text-[8px] opacity-80" style={{ letterSpacing: "0.18em" }}>
        {s.label} · {card.rarity.toUpperCase()}
      </div>
      <div className="px-2 pt-0.5 text-[10px] font-bold leading-tight" style={{ fontFamily: "var(--serif)" }}>
        {card.name}
      </div>
      <div className="flex-1 flex items-center justify-center">
        <span className="text-4xl font-bold tabular-nums" style={{ fontFamily: "var(--serif)" }}>
          {card.power}
        </span>
      </div>
      <div className="px-2 pb-2 text-[8px] leading-snug opacity-90">{riteText(card)}</div>
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function ArenaPage() {
  const [mySchool, setMySchool] = useState("BALANCED");
  const [foeSchool, setFoeSchool] = useState("GOODSTUFF");
  const [side, setSide] = useState<"attacker" | "defender">("attacker");
  const [ground, setGround] = useState<Terrain>({ black: false, blue: true, white: false });
  const [result, setResult] = useState<BattleResult | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [tally, setTally] = useState({ won: 0, fought: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const myBinder = useMemo(() => SCHOOLS[mySchool].binder(), [mySchool]);
  const foeBinder = useMemo(() => SCHOOLS[foeSchool].binder(), [foeSchool]);

  const draw = (binder: CardDef[]): CardDef[] => {
    const pool = binder.slice();
    const hand: CardDef[] = [];
    for (let i = 0; i < 5 && pool.length; i++) {
      hand.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return hand;
  };

  const fight = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const mine = draw(myBinder);
    const theirs = draw(foeBinder);
    const r =
      side === "attacker"
        ? resolveBattle(mine, theirs, ground, 5)
        : resolveBattle(theirs, mine, ground, 5);
    setResult(r);
    setRevealed(0);
    // The nightfall reveal: one lane at a time, then the verdict.
    for (let i = 1; i <= 6; i++) {
      timers.current.push(
        setTimeout(() => {
          setRevealed(i);
          if (i === 6) setTally((t) => ({ fought: t.fought + 1, won: t.won + (r.winner === side ? 1 : 0) }));
        }, 450 * i)
      );
    }
  };

  const iWon = result && result.winner === side;
  const groundNames: [keyof Terrain, string][] = [
    ["black", "BROKEN GROUND"],
    ["blue", "TICKET CORRIDOR"],
    ["white", "CARRION FRINGE"],
  ];

  return (
    <div className="h-screen overflow-y-auto bg-[var(--paper)]">
      <ExchangeMasthead active="arena" />
      <main className="max-w-5xl mx-auto px-5 py-6">
        <div className="text-[9px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.3em" }}>
          THE BACK ROOM · NO MONEY MOVES · NO DEEDS CHANGE HANDS
        </div>
        <h1 className="plate-title text-xl text-[var(--ink)] mb-5">THE ARENA</h1>

        {/* Setup */}
        <div className="grid md:grid-cols-3 gap-4 mb-5">
          <div className="border border-[var(--ink-faint)] p-3">
            <div className="text-[9px] text-[var(--sepia-soft)] mb-2" style={{ letterSpacing: "0.25em" }}>
              YOUR BINDER ({side === "attacker" ? "RAIDING" : "HOLDING THE DEED"})
            </div>
            {Object.entries(SCHOOLS).map(([name, s]) => (
              <button
                key={name}
                onClick={() => setMySchool(name)}
                className={`block w-full text-left px-2 py-1 mb-1 text-[11px] border ${
                  mySchool === name ? "border-[var(--ink-strong)] font-bold" : "border-transparent opacity-60 hover:opacity-100"
                }`}
                style={{ fontFamily: "var(--serif)", color: "var(--ink)" }}
              >
                {name}
                <span className="block text-[8px] font-normal text-[var(--sepia-soft)]">{s.blurb}</span>
              </button>
            ))}
            <button
              onClick={() => setSide(side === "attacker" ? "defender" : "attacker")}
              className="mt-2 w-full text-[10px] border border-[var(--ink-strong)] py-1.5 text-[var(--ink)] hover:bg-[var(--paper-deep)]"
              style={{ letterSpacing: "0.2em" }}
            >
              {side === "attacker" ? "⚔ YOU ARE RAIDING — tap to defend" : "🛡 YOU HOLD THE DEED — tap to raid"}
            </button>
          </div>

          <div className="border border-[var(--ink-faint)] p-3">
            <div className="text-[9px] text-[var(--sepia-soft)] mb-2" style={{ letterSpacing: "0.25em" }}>
              THE IMAGINARY FOE
            </div>
            {Object.entries(SCHOOLS).map(([name, s]) => (
              <button
                key={name}
                onClick={() => setFoeSchool(name)}
                className={`block w-full text-left px-2 py-1 mb-1 text-[11px] border ${
                  foeSchool === name ? "border-[var(--ink-strong)] font-bold" : "border-transparent opacity-60 hover:opacity-100"
                }`}
                style={{ fontFamily: "var(--serif)", color: "var(--ink)" }}
              >
                {name}
                <span className="block text-[8px] font-normal text-[var(--sepia-soft)]">{s.blurb}</span>
              </button>
            ))}
          </div>

          <div className="border border-[var(--ink-faint)] p-3 flex flex-col">
            <div className="text-[9px] text-[var(--sepia-soft)] mb-2" style={{ letterSpacing: "0.25em" }}>
              THE GROUND (a parcel can be several at once)
            </div>
            {groundNames.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setGround({ ...ground, [key]: !ground[key] })}
                className={`block w-full text-left px-2 py-1.5 mb-1 text-[10px] border ${
                  ground[key] ? "border-[var(--ink-strong)] font-bold" : "border-[var(--ink-faint)] opacity-60 hover:opacity-100"
                }`}
                style={{ letterSpacing: "0.15em", color: "var(--ink)" }}
              >
                {ground[key] ? "■ " : "□ "}
                {label}
              </button>
            ))}
            <div className="text-[8px] text-[var(--sepia-soft)] leading-snug mt-1 mb-3">
              Home ground pays +{AFFINITY_BONUS} and lets surges fire. The triangle pays +{COUNTER_BONUS}: black breaks
              blue, blue tickets white, white eats black.
            </div>
            <button
              onClick={fight}
              className="mt-auto w-full border-2 border-[var(--ink-strong)] py-2.5 text-xs font-bold text-[var(--ink)] hover:bg-[var(--paper-deep)]"
              style={{ letterSpacing: "0.3em" }}
            >
              FIGHT AT NIGHTFALL
            </button>
            {tally.fought > 0 && (
              <div className="text-center text-[9px] text-[var(--sepia-soft)] mt-2" style={{ letterSpacing: "0.2em" }}>
                RECORD {tally.won}–{tally.fought - tally.won}
              </div>
            )}
          </div>
        </div>

        {/* The night */}
        {result && (
          <div className="border-2 border-[var(--ink-strong)] p-4" style={{ boxShadow: "inset 0 0 0 3px var(--paper), inset 0 0 0 4px var(--ink-soft)" }}>
            <div className="flex justify-between text-[9px] text-[var(--sepia-soft)] mb-3" style={{ letterSpacing: "0.25em" }}>
              <span>{side === "attacker" ? "YOU RAID" : `${foeSchool} RAIDS YOUR DEED`}</span>
              <span>
                {groundNames.filter(([k]) => ground[k]).map(([, l]) => l).join(" + ") || "NEUTRAL GROUND"}
              </span>
            </div>

            {result.lanes.map((lane, i) => {
              const mine = side === "attacker" ? lane.attacker : lane.defender;
              const myPower = side === "attacker" ? lane.attackerPower : lane.defenderPower;
              const foeCard = side === "attacker" ? lane.defender : lane.attacker;
              const foePower = side === "attacker" ? lane.defenderPower : lane.attackerPower;
              const mineWon = lane.winner === side;
              const foeWon = lane.winner !== "none" && !mineWon && !lane.sunk;
              const shown = revealed > i;
              return (
                <div
                  key={i}
                  className="flex items-center gap-4 py-2 border-b border-[var(--ink-faint)] last:border-b-0"
                  style={{ opacity: shown ? 1 : 0.08, transition: "opacity 500ms" }}
                >
                  <span className="text-[9px] w-12 text-[var(--sepia-soft)]" style={{ letterSpacing: "0.2em" }}>
                    LANE {i + 1}
                  </span>
                  <ArenaCard card={mine} dim={shown && (foeWon || lane.sunk)} />
                  <div className="flex-1 text-center">
                    <div className="text-lg font-bold tabular-nums text-[var(--ink)]" style={{ fontFamily: "var(--serif)" }}>
                      {shown ? (lane.sunk ? "∅" : `${myPower} — ${foePower}`) : "· — ·"}
                    </div>
                    {shown && (
                      <div className="text-[8px] text-[var(--sepia-soft)] leading-snug max-w-[220px] mx-auto">
                        {lane.sunk ? "the tar accepts both parties" : lane.notes.join(" · ") || "plain arithmetic"}
                      </div>
                    )}
                    {shown && (
                      <div className="text-[9px] font-bold mt-0.5" style={{ letterSpacing: "0.25em", color: lane.sunk ? "var(--sepia)" : mineWon ? "var(--pine)" : foeWon ? "var(--brick)" : "var(--sepia-soft)" }}>
                        {lane.sunk ? "SUNK" : mineWon ? "YOURS" : foeWon ? "THEIRS" : "STANDOFF"}
                      </div>
                    )}
                  </div>
                  <ArenaCard card={foeCard} dim={shown && (mineWon || lane.sunk)} />
                </div>
              );
            })}

            {/* Verdict + fates */}
            <div style={{ opacity: revealed >= 6 ? 1 : 0, transition: "opacity 600ms" }} className="pt-4 text-center">
              <div
                className="inline-block border-2 px-6 py-2 text-sm font-bold"
                style={{
                  fontFamily: "var(--serif)",
                  letterSpacing: "0.3em",
                  color: iWon ? "var(--pine)" : "var(--brick)",
                  borderColor: iWon ? "var(--pine)" : "var(--brick)",
                  transform: "rotate(-2deg)",
                }}
              >
                {iWon
                  ? side === "attacker" ? "THE DEED FALLS" : "THE WALLS HOLD"
                  : side === "attacker" ? "THE RAID BREAKS" : "THE DEED IS LOST"}
              </div>
              <div className="text-[9px] text-[var(--sepia-soft)] mt-1" style={{ letterSpacing: "0.2em" }}>
                {result.attackerLanes}–{result.defenderLanes} ON LANES · EVERY TIE DEFENDS
              </div>
              {revealed >= 6 && (
                <div className="mt-3 text-left max-w-md mx-auto">
                  <div className="text-[9px] text-[var(--sepia-soft)] mb-1" style={{ letterSpacing: "0.25em" }}>
                    AT DAWN
                  </div>
                  {fatesOf(result, side).map((f, i) => (
                    <div key={i} className="text-[10px] text-[var(--sepia)] leading-relaxed">
                      <span className="font-bold">{f.side === side ? "YOURS" : "THEIRS"}</span> · {f.card.name} —{" "}
                      {f.fate}
                    </div>
                  ))}
                  {fatesOf(result, side).length === 0 && (
                    <div className="text-[10px] text-[var(--sepia-soft)] italic">everyone walks away tonight</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!result && (
          <div className="border border-dashed border-[var(--ink-faint)] p-10 text-center text-[10px] text-[var(--sepia-soft)]" style={{ letterSpacing: "0.25em" }}>
            PICK YOUR SCHOOL, NAME YOUR FOE, AND FIGHT AT NIGHTFALL
          </div>
        )}
      </main>
    </div>
  );
}
