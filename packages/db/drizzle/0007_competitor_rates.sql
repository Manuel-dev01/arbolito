CREATE TABLE "competitor_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"corridor" text NOT NULL,
	"rate" text NOT NULL,
	"send_amount" text NOT NULL,
	"receive_amount" text NOT NULL,
	"source_url" text NOT NULL,
	"payment_tx" text,
	"paid_atomic" numeric(78, 0),
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "competitor_rates_corridor_at_idx" ON "competitor_rates" USING btree ("corridor","at");