CREATE TYPE "public"."action_type" AS ENUM('claim', 'upgrade', 'exploit', 'fortify', 'raid');--> statement-breakpoint
CREATE TYPE "public"."contest_status" AS ENUM('pending', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TABLE "citation_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"h3_index" text NOT NULL,
	"date" date NOT NULL,
	"citation_count" integer DEFAULT 0 NOT NULL,
	"total_fine" integer DEFAULT 0 NOT NULL,
	"unique_makes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contests" (
	"id" serial PRIMARY KEY NOT NULL,
	"h3_index" text NOT NULL,
	"challenger_id" integer NOT NULL,
	"defender_id" integer NOT NULL,
	"status" "contest_status" DEFAULT 'pending' NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp,
	"challenger_score" integer,
	"defender_score" integer,
	"winner_id" integer,
	"initiated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "daily_ticks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tick_date" date NOT NULL,
	"ran_at" timestamp DEFAULT now() NOT NULL,
	"cells_processed" integer DEFAULT 0 NOT NULL,
	"total_yield_distributed" integer DEFAULT 0 NOT NULL,
	"contests_resolved" integer DEFAULT 0 NOT NULL,
	"pipeline_run_at" timestamp,
	CONSTRAINT "daily_ticks_tick_date_unique" UNIQUE("tick_date")
);
--> statement-breakpoint
CREATE TABLE "hex_ambient" (
	"h3_index" text PRIMARY KEY NOT NULL,
	"oil_well_count" integer DEFAULT 0 NOT NULL,
	"tree_count" integer DEFAULT 0 NOT NULL,
	"base_yield_per_tick" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hex_cells" (
	"h3_index" text PRIMARY KEY NOT NULL,
	"owner_id" integer,
	"claimed_at" timestamp,
	"upgrade_level" integer DEFAULT 0 NOT NULL,
	"is_exploited" boolean DEFAULT false NOT NULL,
	"degradation" integer DEFAULT 0 NOT NULL,
	"neighborhood" text,
	"last_tick_yield" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action_type" "action_type" NOT NULL,
	"h3_index" text NOT NULL,
	"tick_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resource_cost" integer DEFAULT 0 NOT NULL,
	"resource_gain" integer DEFAULT 0 NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth0_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"crude" integer DEFAULT 50 NOT NULL,
	"total_hexes" integer DEFAULT 0 NOT NULL,
	"start_hex" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth0_id_unique" UNIQUE("auth0_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_challenger_id_users_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_defender_id_users_id_fk" FOREIGN KEY ("defender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_cells" ADD CONSTRAINT "hex_cells_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_actions" ADD CONSTRAINT "player_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;