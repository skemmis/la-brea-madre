import { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "./auth/auth";
import {
  getAllHexes,
  getHexByIndex,
  getPlayerHexes,
  getAdjacentUnownedHexes,
  isAdjacentToPlayer,
  claimHex,
  upgradeHex,
  setHexExploited,
  getTodayAction,
  logPlayerAction,
  createContest,
  hasPendingContest,
  getLeaderboard,
  getCitationHotspots,
  updateUserResources,
} from "./storage";
import { db } from "./db";
import { users, hexCells, hexAmbient, contests, playerActions } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { gridDisk } from "h3-js";
import { runDailyTick } from "./backgroundJobs";
import { runFullPipeline, runOilWellsCensus, runDeadAnimalCensus, runDiagnostics } from "./dataPipeline";

// ─── Costs (crude) ────────────────────────────────────────────────────────────
const COST_CLAIM = 10;
const COST_UPGRADE = [0, 20, 40, 80]; // cost to go from level N to N+1
const COST_EXPLOIT = 0; // free mode toggle
const COST_RAID = 30;
const STARTING_HEX_COST = 0; // first hex is free

function todayPT(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .split("T")[0];
}

export function registerRoutes(app: Express) {

  // ── Map ──────────────────────────────────────────────────────────────────────

  // All hex data for the map (ownership, yield, ambient)
  app.get("/api/map/hexes", async (_req: Request, res: Response) => {
    try {
      const hexes = await getAllHexes();
      res.json(hexes);
    } catch (err) {
      console.error("GET /api/map/hexes error:", err);
      res.status(500).json({ error: "Failed to fetch hexes" });
    }
  });

  // Single hex detail
  app.get("/api/map/hexes/:h3Index", async (req: Request, res: Response) => {
    try {
      const { h3Index } = req.params;
      const hex = await getHexByIndex(h3Index);
      if (!hex) return res.status(404).json({ error: "Hex not found" });

      const [ambient] = await db
        .select()
        .from(hexAmbient)
        .where(eq(hexAmbient.h3Index, h3Index));

      let owner = null;
      if (hex.ownerId) {
        const [u] = await db
          .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
          .from(users)
          .where(eq(users.id, hex.ownerId));
        owner = u;
      }

      const pending = await hasPendingContest(h3Index);

      const todayHotspots = await getCitationHotspots(todayPT(), 1);
      const citationToday = todayHotspots.find((h) => h.h3Index === h3Index)?.citationCount ?? 0;

      res.json({ ...hex, ambient, owner, pendingContest: pending, citationToday });
    } catch (err) {
      console.error("GET /api/map/hexes/:h3 error:", err);
      res.status(500).json({ error: "Failed to fetch hex detail" });
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

    const myHexes = await getPlayerHexes(user.id);
    const tickDate = todayPT();
    const todayAction = await getTodayAction(user.id, tickDate);

    res.json({
      id: fresh.id,
      displayName: fresh.displayName,
      avatarUrl: fresh.avatarUrl,
      crude: fresh.crude,
      totalHexes: fresh.totalHexes,
      hexIndexes: myHexes,
      todayAction,
      tickDate,
    });
  });

  app.get("/api/player/adjacent", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const adjacent = await getAdjacentUnownedHexes(user.id);
    res.json({ adjacent });
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

  // Claim an unowned adjacent hex
  app.post("/api/territory/claim", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { h3Index } = req.body;
    if (!h3Index || typeof h3Index !== "string") {
      return res.status(400).json({ error: "h3Index required" });
    }

    const tickDate = todayPT();
    const existingAction = await getTodayAction(user.id, tickDate);
    if (existingAction) {
      return res.status(409).json({
        error: "You have already used your action today",
        action: existingAction,
      });
    }

    const hex = await getHexByIndex(h3Index);
    if (!hex) return res.status(404).json({ error: "Hex not found" });
    if (hex.ownerId !== null) {
      return res.status(409).json({ error: "Hex is already claimed. Use /raid to contest it." });
    }

    const [freshUser] = await db.select().from(users).where(eq(users.id, user.id));
    const myHexes = await getPlayerHexes(user.id);
    const isFirstHex = myHexes.length === 0;
    const cost = isFirstHex ? STARTING_HEX_COST : COST_CLAIM;

    if (!isFirstHex) {
      const adjacent = await isAdjacentToPlayer(h3Index, user.id);
      if (!adjacent) {
        return res.status(400).json({ error: "Hex is not adjacent to your territory" });
      }
    }

    if (freshUser.crude < cost) {
      return res.status(402).json({ error: `Not enough crude (need ${cost}, have ${freshUser.crude})` });
    }

    await claimHex(h3Index, user.id);
    if (cost > 0) await updateUserResources(user.id, -cost);
    if (isFirstHex) {
      await db.update(users).set({ startHex: h3Index }).where(eq(users.id, user.id));
    }
    await logPlayerAction(user.id, "claim", h3Index, tickDate, cost, 0);

    res.json({ ok: true, h3Index, cost, crudeBefore: freshUser.crude, crudeAfter: freshUser.crude - cost });
  });

  // Upgrade an owned hex
  app.post("/api/territory/upgrade", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { h3Index } = req.body;
    if (!h3Index) return res.status(400).json({ error: "h3Index required" });

    const tickDate = todayPT();
    const existingAction = await getTodayAction(user.id, tickDate);
    if (existingAction) {
      return res.status(409).json({ error: "You have already used your action today" });
    }

    const hex = await getHexByIndex(h3Index);
    if (!hex) return res.status(404).json({ error: "Hex not found" });
    if (hex.ownerId !== user.id) return res.status(403).json({ error: "You don't own this hex" });
    if (hex.upgradeLevel >= 3) return res.status(400).json({ error: "Hex is already at max upgrade level" });

    const cost = COST_UPGRADE[hex.upgradeLevel];
    const [freshUser] = await db.select().from(users).where(eq(users.id, user.id));
    if (freshUser.crude < cost) {
      return res.status(402).json({ error: `Not enough crude (need ${cost}, have ${freshUser.crude})` });
    }

    await upgradeHex(h3Index);
    await updateUserResources(user.id, -cost);
    await logPlayerAction(user.id, "upgrade", h3Index, tickDate, cost, 0, {
      fromLevel: hex.upgradeLevel,
      toLevel: hex.upgradeLevel + 1,
    });

    res.json({ ok: true, newLevel: hex.upgradeLevel + 1, cost });
  });

  // Toggle exploit mode on an owned hex
  app.post("/api/territory/exploit", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { h3Index, exploit } = req.body;
    if (!h3Index || typeof exploit !== "boolean") {
      return res.status(400).json({ error: "h3Index and exploit (boolean) required" });
    }

    const hex = await getHexByIndex(h3Index);
    if (!hex) return res.status(404).json({ error: "Hex not found" });
    if (hex.ownerId !== user.id) return res.status(403).json({ error: "You don't own this hex" });
    if (hex.degradation >= 100) {
      return res.status(400).json({ error: "This hex is fully depleted and cannot be exploited" });
    }

    await setHexExploited(h3Index, exploit);
    // Toggling exploit does NOT cost an action (it's a stance, not a move)
    res.json({ ok: true, h3Index, isExploited: exploit });
  });

  // Raid an opponent's adjacent hex (initiates a contest)
  app.post("/api/territory/raid", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { h3Index } = req.body;
    if (!h3Index) return res.status(400).json({ error: "h3Index required" });

    const tickDate = todayPT();
    const existingAction = await getTodayAction(user.id, tickDate);
    if (existingAction) {
      return res.status(409).json({ error: "You have already used your action today" });
    }

    const hex = await getHexByIndex(h3Index);
    if (!hex) return res.status(404).json({ error: "Hex not found" });
    if (!hex.ownerId) return res.status(400).json({ error: "Hex is unowned — use /claim instead" });
    if (hex.ownerId === user.id) return res.status(400).json({ error: "You already own this hex" });

    const adjacent = await isAdjacentToPlayer(h3Index, user.id);
    if (!adjacent) {
      return res.status(400).json({ error: "Hex is not adjacent to your territory" });
    }

    const alreadyContested = await hasPendingContest(h3Index);
    if (alreadyContested) {
      return res.status(409).json({ error: "This hex is already in an active contest" });
    }

    const [freshUser] = await db.select().from(users).where(eq(users.id, user.id));
    if (freshUser.crude < COST_RAID) {
      return res.status(402).json({ error: `Not enough crude (need ${COST_RAID}, have ${freshUser.crude})` });
    }

    await updateUserResources(user.id, -COST_RAID);
    const contest = await createContest(h3Index, user.id, hex.ownerId);
    await logPlayerAction(user.id, "raid", h3Index, tickDate, COST_RAID, 0, {
      contestId: contest.id,
      defenderId: hex.ownerId,
    });

    res.json({
      ok: true,
      contestId: contest.id,
      h3Index,
      defenderId: hex.ownerId,
      resolvesAt: contest.windowEnd,
      message: "Contest initiated. City data will adjudicate at midnight PT.",
    });
  });

  // ── Contests ──────────────────────────────────────────────────────────────────

  app.get("/api/contests", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const activeContests = await db
      .select()
      .from(contests)
      .where(
        and(
          eq(contests.status, "pending"),
          sql`(challenger_id = ${user.id} OR defender_id = ${user.id})`
        )
      );
    res.json(activeContests);
  });

  app.get("/api/contests/recent", async (_req: Request, res: Response) => {
    const recent = await db
      .select()
      .from(contests)
      .where(eq(contests.status, "resolved"))
      .orderBy(desc(contests.resolvedAt))
      .limit(20);
    res.json(recent);
  });

  // ── Leaderboard ───────────────────────────────────────────────────────────────

  app.get("/api/leaderboard", async (_req: Request, res: Response) => {
    const board = await getLeaderboard();
    res.json(board);
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
      const result = await runOilWellsCensus();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/pipeline/deadanimals", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await runDeadAnimalCensus();
      res.json(result);
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
    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [hexCount] = await db.select({ count: sql<number>`count(*)::int` }).from(hexCells);
    const [ownedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(hexCells)
      .where(sql`owner_id IS NOT NULL`);
    const [pendingCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contests)
      .where(eq(contests.status, "pending"));

    res.json({
      users: userCount.count,
      hexes: hexCount.count,
      ownedHexes: ownedCount.count,
      pendingContests: pendingCount.count,
    });
  });
}
