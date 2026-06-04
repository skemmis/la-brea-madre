import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  boolean,
  real,
  date,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Auth / Identity ──────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  auth0Id: text("auth0_id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  crude: integer("crude").notNull().default(50), // starting resources
  totalHexes: integer("total_hexes").notNull().default(0), // cached count
  startHex: text("start_hex"), // first hex claimed (used for initial placement)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
});

// NOTE: the "sessions" table is created and managed at runtime by
// connect-pg-simple (see server/auth/auth.ts, createTableIfMissing: true),
// so it is intentionally not defined here or in the migrations.

// ─── Map / Territory ─────────────────────────────────────────────────────────

// One row per H3 cell covering LA. Populated at boot by initHexes script.
export const hexCells = pgTable("hex_cells", {
  h3Index: text("h3_index").primaryKey(),
  // Ownership
  ownerId: integer("owner_id").references(() => users.id, {
    onDelete: "set null",
  }),
  claimedAt: timestamp("claimed_at"),
  upgradeLevel: integer("upgrade_level").notNull().default(0), // 0-3
  // Exploit / sustain
  isExploited: boolean("is_exploited").notNull().default(false),
  degradation: integer("degradation").notNull().default(0), // 0-100; 100 = depleted
  // Neighborhood label (overlay from neighborhood data)
  neighborhood: text("neighborhood"),
  // Cached yield stats
  lastTickYield: integer("last_tick_yield").notNull().default(0),
});

// Pre-computed ambient features per cell (from one-time geographic census).
export const hexAmbient = pgTable("hex_ambient", {
  h3Index: text("h3_index").primaryKey(),
  oilWellCount: integer("oil_well_count").notNull().default(0),
  treeCount: integer("tree_count").notNull().default(0),
  deadAnimalCount: integer("dead_animal_count").notNull().default(0),
  // Derived base yield: (wells * 3) + (trees * 0.5), floored to int
  baseYieldPerTick: integer("base_yield_per_tick").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Pre-aggregated parking citation data (per cell, per date).
export const citationDaily = pgTable("citation_daily", {
  id: serial("id").primaryKey(),
  h3Index: text("h3_index").notNull(),
  date: date("date").notNull(),
  citationCount: integer("citation_count").notNull().default(0),
  totalFine: integer("total_fine").notNull().default(0),
  uniqueMakes: integer("unique_makes").notNull().default(0),
});

// ─── Player Actions ──────────────────────────────────────────────────────────

export const actionTypeEnum = pgEnum("action_type", [
  "claim",
  "upgrade",
  "exploit",
  "fortify",
  "raid",
]);

// One row per player action. Enforces one meaningful action per day per player.
export const playerActions = pgTable("player_actions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  actionType: actionTypeEnum("action_type").notNull(),
  h3Index: text("h3_index").notNull(),
  tickDate: date("tick_date").notNull(), // YYYY-MM-DD in PT
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resourceCost: integer("resource_cost").notNull().default(0),
  resourceGain: integer("resource_gain").notNull().default(0),
  metadata: text("metadata"), // JSON string for extra context
});

// ─── PvP Contests ────────────────────────────────────────────────────────────

export const contestStatusEnum = pgEnum("contest_status", [
  "pending",
  "resolved",
  "cancelled",
]);

// A "raid" initiates a contest on an opponent's hex. Resolved at next tick.
export const contests = pgTable("contests", {
  id: serial("id").primaryKey(),
  h3Index: text("h3_index").notNull(), // the hex being raided
  challengerId: integer("challenger_id")
    .notNull()
    .references(() => users.id),
  defenderId: integer("defender_id")
    .notNull()
    .references(() => users.id),
  status: contestStatusEnum("status").notNull().default("pending"),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end"),
  challengerScore: integer("challenger_score"), // total citations in challenger's territory during window
  defenderScore: integer("defender_score"),
  winnerId: integer("winner_id").references(() => users.id),
  initiatedAt: timestamp("initiated_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── Daily Ticks ─────────────────────────────────────────────────────────────

export const dailyTicks = pgTable("daily_ticks", {
  id: serial("id").primaryKey(),
  tickDate: date("tick_date").notNull().unique(),
  ranAt: timestamp("ran_at").notNull().defaultNow(),
  cellsProcessed: integer("cells_processed").notNull().default(0),
  totalYieldDistributed: integer("total_yield_distributed").notNull().default(0),
  contestsResolved: integer("contests_resolved").notNull().default(0),
  pipelineRunAt: timestamp("pipeline_run_at"),
});

// Small key/value store for pipeline metadata, e.g. how many days each
// event feed currently spans (used to normalize counts to per-day rates).
export const pipelineMeta = pgTable("pipeline_meta", {
  key: text("key").primaryKey(),
  value: real("value").notNull().default(0),
});

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  crude: true,
  totalHexes: true,
  createdAt: true,
  lastActiveAt: true,
});

export const insertPlayerActionSchema = createInsertSchema(playerActions).omit({
  id: true,
  createdAt: true,
});

export const insertContestSchema = createInsertSchema(contests).omit({
  id: true,
  initiatedAt: true,
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type HexCell = typeof hexCells.$inferSelect;
export type HexAmbient = typeof hexAmbient.$inferSelect;
export type CitationDaily = typeof citationDaily.$inferSelect;
export type PlayerAction = typeof playerActions.$inferSelect;
export type Contest = typeof contests.$inferSelect;
export type DailyTick = typeof dailyTicks.$inferSelect;

export type HexWithDetails = HexCell & {
  ambient: HexAmbient | null;
  citationToday?: number;
  citationPerDay?: number;
  deadAnimalPerDay?: number;
  ownerName?: string;
  ownerColor?: string;
  pendingContest?: boolean;
};
