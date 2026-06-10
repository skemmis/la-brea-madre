import { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "./auth/auth";
import { getCitationHotspots } from "./storage";
import {
  projectMap,
  getPlayerView,
  getAdjacent,
  getDispatch,
  getLeaderboard,
  getStats,
  doAction,
  outOfOrders,
} from "./gameService";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  getBoard,
  getMarketDetail,
  getActivity,
  getPortfolio,
  getPublicProfile,
  buy as buyExchange,
  sell as sellExchange,
  settleDue,
  rollExchangeDay,
} from "./exchangeService";
import { openPackFor, getCollection } from "./deckService";
import { runDailyTick } from "./backgroundJobs";
import {
  runFullPipeline,
  runOilWellsCensus,
  runDeadAnimalCensus,
  runCitationHistory,
  runMakeHistory,
  runDiagnostics,
  fetchDeadAnimalPoints,
  yesterdayPT,
} from "./dataPipeline";
import type { Action } from "@shared/core";

function todayPT(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .split("T")[0];
}

export function registerRoutes(app: Express) {

  // ── Map ──────────────────────────────────────────────────────────────────────

  // All hex data for the map (ownership, yield, ambient) — projected from the
  // canonical core state merged with the live board/ambient/metrics.
  app.get("/api/map/hexes", async (_req: Request, res: Response) => {
    try {
      res.json(await projectMap());
    } catch (err) {
      console.error("GET /api/map/hexes error:", err);
      res.status(500).json({ error: "Failed to fetch hexes" });
    }
  });

  // Exact dead-animal report locations for one day (default: yesterday PT) —
  // the carrion layer's glowing dots. Experimental, display-only.
  app.get("/api/map/carrion-points", async (req: Request, res: Response) => {
    try {
      const q = req.query.date;
      const date =
        typeof q === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : yesterdayPT();
      const points = await fetchDeadAnimalPoints(date);
      res.json({ date, count: points.length, points });
    } catch (err) {
      console.error("GET /api/map/carrion-points error:", err);
      res.status(500).json({ error: "Failed to fetch carrion points" });
    }
  });

  // The last 48h of shaking, for the map's quake overlay.
  app.get("/api/map/quakes", async (_req: Request, res: Response) => {
    try {
      const { recentQuakes } = await import("./quakeService");
      res.json(await recentQuakes());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Citation hotspots for today
  app.get("/api/map/hotspots", async (req: Request, res: Response) => {
    const date = (req.query.date as string) || todayPT();
    const hotspots = await getCitationHotspots(date, 50);
    res.json(hotspots);
  });

  // ── Player ────────────────────────────────────────────────────────────────────

  app.get("/api/player/me", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const [fresh] = await db.select().from(users).where(eq(users.id, user.id));
    if (!fresh) return res.status(404).json({ error: "User not found" });
    res.json(await getPlayerView(fresh.id, fresh.displayName, fresh.avatarUrl));
  });

  app.get("/api/player/adjacent", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    res.json({ adjacent: await getAdjacent(user.id) });
  });

  // The player's most recent overnight dispatch (the daily reveal).
  app.get("/api/player/dispatch", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    res.json(await getDispatch(user.id));
  });

  // Update display name
  app.patch("/api/player/display-name", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { displayName } = req.body;
    if (!displayName || typeof displayName !== "string" || displayName.trim().length < 2) {
      return res.status(400).json({ error: "Display name must be at least 2 characters" });
    }
    await db
      .update(users)
      .set({ displayName: displayName.trim().slice(0, 32) })
      .where(eq(users.id, user.id));
    res.json({ ok: true });
  });

  // ── Territory Actions ─────────────────────────────────────────────────────────

  // A Work Order action (expand / upgrade / contest). Validation + costs
  // live in the core; this just translates the out-of-orders case nicely.
  async function runOrderAction(req: Request, res: Response, action: Action) {
    const user = req.user as any;
    try {
      if (action.type !== "defend" && (await outOfOrders(user.id))) {
        return res.status(409).json({ error: "No Work Orders left — carrion in your territory earns more." });
      }
      const result = await doAction(user.id, action);
      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ error: err?.message ?? "That move isn't available." });
    }
  }

  app.post("/api/territory/claim", requireAuth, (req: Request, res: Response) => {
    const { h3Index } = req.body;
    if (!h3Index || typeof h3Index !== "string") {
      return res.status(400).json({ error: "h3Index required" });
    }
    return runOrderAction(req, res, { type: "expand", h3: h3Index });
  });

  app.post("/api/territory/upgrade", requireAuth, (req: Request, res: Response) => {
    const { h3Index } = req.body;
    if (!h3Index) return res.status(400).json({ error: "h3Index required" });
    return runOrderAction(req, res, { type: "upgrade", h3: h3Index });
  });

  // Repair a shaken parcel: 1 order + $ per point of degradation.
  app.post("/api/territory/repair", requireAuth, (req: Request, res: Response) => {
    const { h3Index } = req.body;
    if (!h3Index) return res.status(400).json({ error: "h3Index required" });
    return runOrderAction(req, res, { type: "repair", h3: h3Index });
  });

  // Toggle exploit mode — a free stance, not the daily action.
  app.post("/api/territory/exploit", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { h3Index, exploit } = req.body;
    if (!h3Index || typeof exploit !== "boolean") {
      return res.status(400).json({ error: "h3Index and exploit (boolean) required" });
    }
    try {
      await doAction(user.id, { type: "setExploit", h3: h3Index, on: exploit });
      res.json({ ok: true, h3Index, isExploited: exploit });
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? "Can't change exploit stance here." });
    }
  });

  // Acquire a relic — the daily action.
  app.post("/api/player/relic", requireAuth, (req: Request, res: Response) => {
    const { relicId } = req.body;
    if (!relicId || typeof relicId !== "string") {
      return res.status(400).json({ error: "relicId required" });
    }
    return runOrderAction(req, res, { type: "acquireRelic", relicId });
  });

  // Declare a sealed-bid contest on an adjacent enemy hex.
  app.post("/api/territory/contest", requireAuth, (req: Request, res: Response) => {
    const { h3Index, bid } = req.body;
    if (!h3Index || typeof h3Index !== "string" || typeof bid !== "number") {
      return res.status(400).json({ error: "h3Index (string) and bid (number) required" });
    }
    return runOrderAction(req, res, { type: "contest", h3: h3Index, bid });
  });

  // Counter-commit dollars to defend your embattled hex (no order needed).
  app.post("/api/territory/defend", requireAuth, (req: Request, res: Response) => {
    const { h3Index, bid } = req.body;
    if (!h3Index || typeof h3Index !== "string" || typeof bid !== "number") {
      return res.status(400).json({ error: "h3Index (string) and bid (number) required" });
    }
    return runOrderAction(req, res, { type: "defend", h3: h3Index, bid });
  });

  app.post("/api/territory/raid", requireAuth, (_req: Request, res: Response) => {
    res.status(501).json({ error: "Raids are temporarily disabled." });
  });

  // ── Contests (PvP deferred — kept so the frontend doesn't error) ───────────────

  app.get("/api/contests", requireAuth, (_req: Request, res: Response) => res.json([]));
  app.get("/api/contests/recent", (_req: Request, res: Response) => res.json([]));

  // ── Prediction Exchange (the live floor: today's board, tape, portfolio) ─────────

  // Today's board: trading, closed-awaiting-records, and recent results.
  app.get("/api/exchange/board", async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      res.json(await getBoard(user?.id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // One market in full: price history, tape, holders, research desk.
  app.get("/api/exchange/market/:id", async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      res.json(await getMarketDetail(req.params.id, user?.id));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // The public tape: recent fills across the whole floor.
  app.get("/api/exchange/activity", async (_req: Request, res: Response) => {
    try {
      res.json(await getActivity());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // The player's book: open positions, settled history, trades, equity curve.
  app.get("/api/exchange/portfolio", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    try {
      res.json(await getPortfolio(user.id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // A player's public profile (the floor is public).
  app.get("/api/players/:id/profile", async (req: Request, res: Response) => {
    try {
      res.json(await getPublicProfile(Number(req.params.id)));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // Buy YES (0) or NO (1) on a market with crude.
  app.post("/api/exchange/buy", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { marketId, outcome, budget } = req.body;
    if (typeof marketId !== "string" || typeof outcome !== "number" || typeof budget !== "number") {
      return res.status(400).json({ error: "marketId (string), outcome (number), budget (number) required" });
    }
    try {
      res.json(await buyExchange(user.id, marketId, outcome, budget));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Sell shares back to the maker.
  app.post("/api/exchange/sell", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { marketId, outcome, shares } = req.body;
    if (typeof marketId !== "string" || typeof outcome !== "number" || typeof shares !== "number") {
      return res.status(400).json({ error: "marketId (string), outcome (number), shares (number) required" });
    }
    try {
      res.json(await sellExchange(user.id, marketId, outcome, shares));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Admin: settle anything whose records have arrived (cron also does this).
  app.post("/api/admin/exchange/settle", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await settleDue());
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Admin: roll the exchange day (settle due + open today's board).
  app.post("/api/admin/exchange/roll", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await rollExchangeDay());
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Deck / Packs ────────────────────────────────────────────────────────────────

  // The player's collection, combined effects, and the full catalog.
  app.get("/api/deck", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    res.json(await getCollection(user.id));
  });

  // Spend crude to open a pack.
  app.post("/api/deck/open-pack", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    try {
      res.json(await openPackFor(user.id));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Leaderboard ───────────────────────────────────────────────────────────────

  app.get("/api/leaderboard", async (_req: Request, res: Response) => {
    res.json(await getLeaderboard());
  });

  // ── Admin ─────────────────────────────────────────────────────────────────────

  app.post("/api/admin/tick", requireAdmin, async (_req: Request, res: Response) => {
    try {
      await runDailyTick();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/pipeline", requireAdmin, async (_req: Request, res: Response) => {
    try {
      await runFullPipeline();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/pipeline/wells", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await runOilWellsCensus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/pipeline/deadanimals", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await runDeadAnimalCensus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pull the citywide daily citation history that prices/resolves markets.
  app.post("/api/admin/pipeline/history", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await runCitationHistory());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pull per-day Toyota/Honda ticket counts for the face-off market.
  app.post("/api/admin/pipeline/makes", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await runMakeHistory());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Diagnostics: report what the source APIs return and what's in the DB.
  app.get("/api/admin/diag", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await runDiagnostics());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/stats", requireAdmin, async (_req: Request, res: Response) => {
    res.json(await getStats());
  });
}
