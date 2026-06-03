# La Brea Madre

A free-to-play web game built on real Los Angeles open data and the city's occult / grotesque history. You hold territory on a real map of Los Angeles; real-world open data — parking citations, oil wells — flows through your land, feeds an engine you build and defend, and the city's data adjudicates the war between players.

> Working title. "La Brea Madre" is the cosmology, not necessarily the product name.

This repo is **v1 (the MVP)**: the smallest loop that is genuinely fun, on real data, on a real map.

---

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | React 19 + Vite + TypeScript + Tailwind v4 |
| Map | deck.gl `H3HexagonLayer` over a Mapbox dark basemap |
| Backend | Express + TypeScript (REST), `node-cron` for scheduled ticks |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Auth | Auth0 OIDC + Passport + Postgres-backed sessions |
| Geo | Uber H3 (`h3-js`), resolution 7 (~2,000 cells over LA County) |

The architecture (auth, DB layer, session handling, build pipeline) is adapted from the sibling project **Fantasy-Reality**. La Brea Madre runs on its **own separate database** — it reuses the *patterns*, not the data.

---

## The v1 game loop

Persistent hex map of LA. A daily tick at **midnight PT** resolves everything.

1. **Ambient yield** — each hex you own produces `crude` per tick, based on its real-world oil wells (CalGEM census).
2. **Events** — real parking-citation data (LA Socrata) spikes/dents activity per hex and is the "dice" for PvP.
3. **One action per day** — claim an adjacent unowned hex, upgrade one you hold, or **raid** an adjacent enemy hex.
4. **Exploit vs. sustain** — toggle a hex into exploit mode for ×2 yield, but it degrades and eventually depletes. *(This is the spine dilemma; cosmically, the greedy move feeds her.)*
5. **PvP contests** — a raid opens a contest resolved at the next tick by whose territory had hotter real citation activity during the window. The city adjudicates the war.

---

## First-run setup

```bash
npm install

# Set env vars first (see .env.example). In Claude Code on the web,
# set these in the session's environment config, NOT a committed file.

npm run db:push          # create tables from shared/schema.ts
npm run pipeline:hexes   # seed ~2,000 H3 cells covering LA County
npm run pipeline:wells   # one-time CalGEM oil-well census -> ambient yields
npm run dev              # backend on :5000, Vite proxies the client
```

Then open the app, log in, and claim your first hex (the first one is free).

### Required environment variables

See `.env.example`. Summary:

- `DATABASE_URL` — Neon Postgres connection string
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `SESSION_SECRET`
- `APP_DOMAIN`, `PORT`, `NODE_ENV`
- `ADMIN_EMAILS` — comma-separated; grants access to `/admin`
- `VITE_MAPBOX_TOKEN` — **client-side** public token (free at mapbox.com); restricted token is fine
- `SOCRATA_APP_TOKEN` — optional, higher rate limits on LA open data
- `ENABLE_DEV_LOGIN` — set `true` to expose `/api/dev-login` for local testing (never in prod)

---

## Project layout

```
client/src/
  pages/        MapPage, LoginPage, AdminPage
  components/   HexMap (deck.gl), HexPanel, PlayerHUD, Leaderboard
  hooks/        useAuth, usePlayer (claim/upgrade/exploit/raid mutations)
server/
  index.ts          Express + session + Vite middleware
  routes.ts         REST API (map, player, territory actions, contests, admin)
  storage.ts        Drizzle data-access layer
  dataPipeline.ts   LA Socrata citations + CalGEM oil wells -> H3 cells
  backgroundJobs.ts daily tick (yield + contest resolution), cron pipeline
  auth/auth.ts      Auth0 OIDC + Passport + Postgres sessions
shared/schema.ts    Drizzle tables (users, hex_cells, hex_ambient,
                    citation_daily, player_actions, contests, daily_ticks)
scripts/            initHexes (seed grid), seedWells, build (esbuild)
```

---

## Guardrails (carried from the design doc)

- **Play money only.** No real-money cash-out, ever.
- **No pay-to-win.** Real money only ever buys flavor/depth, never power.
- **Real-world riddles point only to public, legal locations.** Safety first.
- **Privacy.** Play stays at the archetype level (e.g. "black Jeeps"), never per-plate targeting, even though raw data has those fields.
- **Lore is seepage, never exposition.** None of `§3` of the design doc is explained in-game.

## Explicitly deferred (NOT in v1)

Prediction-market mode, clans/factions, multiple resources, the narrative/disclosure layer, monetization, seasons, the runaway-leader fixes. See `HANDOFF.md` and the design doc `§2`/`§3`.
