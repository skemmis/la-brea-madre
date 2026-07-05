CREATE TABLE IF NOT EXISTS "citation_market_daily" (
	"date" date PRIMARY KEY NOT NULL,
	"citation_count" integer DEFAULT 0 NOT NULL,
	"total_fine" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_metric" (
	"metric" text NOT NULL,
	"date" date NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_metric_metric_date_pk" PRIMARY KEY("metric","date")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pulse_seed_at" timestamp;