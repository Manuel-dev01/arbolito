CREATE TABLE "agent_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_agent_id" integer,
	"url" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"usd_micros" numeric(78, 0) NOT NULL,
	"status" text NOT NULL,
	"payment_tx" text,
	"used_for" text NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"feedback_tx" text,
	"feedback_score" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource" text NOT NULL,
	"payer" text NOT NULL,
	"asset" text NOT NULL,
	"asset_address" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"usd_micros" numeric(78, 0) NOT NULL,
	"pay_to" text NOT NULL,
	"tx_hash" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_purchases_at_idx" ON "agent_purchases" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "x402_sales_tx_idx" ON "x402_sales" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "x402_sales_at_idx" ON "x402_sales" USING btree ("at");