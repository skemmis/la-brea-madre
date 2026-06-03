# HANDOFF — La Brea Madre

Context for the next agent/session picking this up. This scaffold was generated in a
session scoped to the sibling repo `Fantasy-Reality`, then transferred here because that
session couldn't push to this repo. Everything below captures the decisions and state so
you can continue without re-deriving them.

---

## How this project relates to Fantasy-Reality

La Brea Madre intentionally **reuses Fantasy-Reality's architecture** — Auth0 + Passport +
Postgres sessions, Drizzle + Neon, the Express/Vite/esbuild build shape, Tailwind + Shadcn
frontend conventions. It does **not** share data or runtime with it.

Decisions locked with the project owner (skemmis):

| Question | Decision |
|----------|----------|
| Database & identity | **Separate DB, same stack/patterns.** Own Neon database, own Auth0 app. Accounts are not shared (can unify later via a shared Auth0 tenant if desired). |
| v1 multiplayer | **Full PvP from day one** — contested borders resolved by real citation data. |
| Map rendering | **deck.gl `H3HexagonLayer` + Mapbox dark basemap** (needs a free Mapbox token). |
| Repo handling | New standalone repo (`skemmis/la-brea-madre`). |
| H3 resolution | **7** (~2,000 cells across LA County — the "low thousands" the doc calls for). |
| Ambient resource (v1) | **Oil wells** (CalGEM) → resource is `crude`. (Trees/jacarandas deferred.) |
| Event feed (v1) | **Parking citations** (LA Socrata dataset `4f5p-udkv`). |

---

## What's built and working

- **Schema** (`shared/schema.ts`): `users`, `hex_cells`, `hex_ambient`, `citation_daily`,
  `player_actions`, `contests`, `daily_ticks`, plus `sessions` for auth.
- **Auth** (`server/auth/auth.ts`): full Auth0 OIDC login/callback/logout, Postgres session
  store, `requireAuth` / `requireAdmin` middleware, optional `/api/dev-login` bypass.
- **REST API** (`server/routes.ts`): map data, player state, the four territory actions
  (claim / upgrade / exploit / raid), contests, leaderboard, admin ops.
- **Data pipeline** (`server/dataPipeline.ts`): pulls LA citations and assigns them to H3
  cells (with make/coordinate normalization); CalGEM oil-well census with a hardcoded
  fallback sample of known LA oil fields if the API is unreachable.
- **Daily tick** (`server/backgroundJobs.ts`): distributes yields (base × upgrade ×
  degradation × exploit), applies exploit degradation, resolves pending contests by
  comparing citation scores, records the tick. Cron-scheduled for 11:59pm PT; also runs a
  6-hourly citation pull.
- **Frontend**: full-screen deck.gl hex map with owner colors, upgrade extrusion, and a
  citation heat-map on unclaimed cells; hex detail/action panel; player HUD; leaderboard;
  admin panel for manual tick/pipeline runs.
- `npx tsc --noEmit` passes clean.

---

## First-run order (do this once env vars are set)

```bash
npm install
npm run db:push          # create tables
npm run pipeline:hexes   # seed the LA hex grid (~2,000 cells)
npm run pipeline:wells   # ambient oil-well yields
npm run dev
```

Set env vars in the **session's environment configuration**, not a committed `.env`
(`.env` is gitignored on purpose). See `.env.example` for the full list. `VITE_MAPBOX_TOKEN`
is a client-side public token — a restricted one is expected there.

---

## Known rough edges / first things to verify

1. **Live data shape.** The Socrata `4f5p-udkv` and CalGEM endpoints are coded against
   their documented schemas but haven't been run against the live APIs in this scaffold.
   First real `pipeline:wells` / citation pull may need field-name tweaks
   (lat/lng vs. State Plane, `WellStatus` filter values). The wells census has a fallback
   sample so the map is never empty.
2. **LA County boundary polygon** in `scripts/initHexes.ts` is a coarse approximation —
   fine for v1, tighten later if hexes spill into the ocean / neighboring counties.
3. **Tick timezone** relies on `process.env.TZ = "America/Los_Angeles"`; verify the host
   respects it, or the midnight-PT boundary will drift.
4. **No tests yet.** Consider a SessionStart hook (there's a `session-start-hook` skill) so
   web sessions can run typecheck/lint automatically.
5. **Contest fairness / runaway-leader** mechanics from design-doc `§2.4` are deferred — the
   current contest is a straight citation-score comparison.

---

## Where to go next (design doc roadmap)

Build `§1` (this) until the core loop is proven fun. Then, roughly in order from `§2`:

- Resource sinks + the full exploit/sustain tuning pass (the spine dilemma must *feel* good).
- The two views: PvP war-room vs. clan macro-map (H3 nested resolutions give this for free).
- Runaway-leader fixes (upkeep, quality-over-acreage, coalitions, seasonal culls).
- Then the bigger swings: three-resource clan cosmology, prediction-market mode, the
  Disco-Elysium-style narrative/disclosure layer, Bobby-Fingers-model monetization, the ARG.

Keep the design doc's `§3` lore as **seepage, never exposition** — named, never explained.

> ⚠️ The design doc (`la_brea_madre_design_doc.docx`) is the source of truth for tone and the
> deferred roadmap. It is **not** in this repo. Re-upload it into the session if you want full
> context on `§2`/`§3` before extending the game.
