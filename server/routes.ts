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
  hasActedToday,
} from "./gameService";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  openRound,
  listMarkets,
  buy as buyContractsService,
  reveal as revealMarket,
  getPositions,
} from "./marketService";
import { runDailyTick } from "./backgroundJobs";
import {
  runFullPipeline,
  runOilWellsCensus,
  runDeadAnimalCensus,
  runCitationHistory,
  runDiagnostics,
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

  // The daily action (expand / upgrade). Validation + costs live in the core.
  async function runDailyAction(req: Request, res: Response, action: Action) {
    const user = req.user as any;
    try {
      if (await hasActedToday(user.id)) {
        return res.status(409).json({ error: "You have already used your action today" });
      }
      const result = await doAction(user.id, action);
      return res.json({ ok: true, crude: result.crude });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message ?? "That move isn't available." });
    }
  }

  app.post("/api/territory/claim", requireAuth, (req: Request, res: Response) => {
    const { h3Index } = req.body;
    if (!h3Index || typeof h3Index !== "string") {
      return res.status(400).json({ error: "h3Index required" });
    }
    return runDailyAction(req, res, { type: "expand", h3: h3Index });
  });

  app.post("/api/territory/upgrade", requireAuth, (req: Request, res: Response) => {
    const { h3Index } = req.body;
    if (!h3Index) return res.status(400).json({ error: "h3Index required" });
    return runDailyAction(req, res, { type: "upgrade", h3: h3Index });
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
    return runDailyAction(req, res, { type: "acquireRelic", relicId });
  });

  // Raids / PvP are temporarily disabled while the core economic loop ships.
  app.post("/api/territory/raid", requireAuth, (_req: Request, res: Response) => {
    res.status(501).json({ error: "Raids are temporarily disabled." });
  });

  // ── Contests (PvP deferred — kept so the frontend doesn't error) ───────────────

  app.get("/api/contests", requireAuth, (_req: Request, res: Response) => res.json([]));
  app.get("/api/contests/recent", (_req: Request, res: Response) => res.json([]));

  // ── Prediction Markets ──────────────────────────────────────────────────────────

  // Open markets, as players see them (no hidden answer).
  app.get("/api/markets", async (_req: Request, res: Response) => {
    try {
      res.json(await listMarkets());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Deal a new round on a fresh hidden historical day.
  app.post("/api/markets/open", requireAuth, async (_req: Request, res: Response) => {
    try {
      res.json(await openRound());
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Spend crude on an outcome (price moves as you buy).
  app.post("/api/markets/:id/buy", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { outcome, budget } = req.body;
    if (typeof outcome !== "number" || typeof budget !== "number") {
      return res.status(400).json({ error: "outcome (number) and budget (number) required" });
    }
    try {
      res.json(await buyContractsService(user.id, req.params.id, outcome, budget));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Reveal the hidden day and settle the market.
  app.post("/api/markets/:id/reveal", requireAuth, async (req: Request, res: Response) => {
    try {
      res.json(await revealMarket(req.params.id));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // The player's open positions.
  app.get("/api/markets/positions", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    res.json(await getPositions(user.id));
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
