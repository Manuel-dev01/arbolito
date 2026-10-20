CREATE TABLE "rule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"amount_in" numeric(78, 0),
	"amount_out" numeric(78, 0),
	"tx_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lang" text DEFAULT 'es' NOT NULL,
	"message" text NOT NULL,
	"signature" text,
	"confirmed_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"cursor_block" bigint,
	"stopped_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rule_runs_rule_trigger_key" ON "rule_runs" USING btree ("rule_id","trigger");--> statement-breakpoint
CREATE INDEX "rule_runs_created_idx" ON "rule_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rules_account_idx" ON "rules" USING btree ("account");--> statement-breakpoint
CREATE INDEX "rules_status_idx" ON "rules" USING btree ("status");