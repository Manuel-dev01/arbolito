CREATE TABLE "desk_fills" (
	"tx_hash" text PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"pair" text NOT NULL,
	"side" text NOT NULL,
	"soft_amount" numeric(78, 0) NOT NULL,
	"usdt_amount" numeric(78, 0) NOT NULL,
	"price" text NOT NULL,
	"fair_price" text,
	"edge_bps" numeric(12, 2),
	"taker" text NOT NULL,
	"settlement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desk_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"block_number" bigint NOT NULL,
	"usdt" numeric(78, 0) NOT NULL,
	"wars" numeric(78, 0) NOT NULL,
	"wbrl" numeric(78, 0) NOT NULL,
	"celo" numeric(78, 0) NOT NULL,
	"fair_wars" text,
	"fair_wbrl" text,
	"nav_micros" numeric(78, 0)
);
--> statement-breakpoint
CREATE TABLE "desk_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "desk_fills_at_idx" ON "desk_fills" USING btree ("at");--> statement-breakpoint
CREATE INDEX "desk_snapshots_at_idx" ON "desk_snapshots" USING btree ("at");