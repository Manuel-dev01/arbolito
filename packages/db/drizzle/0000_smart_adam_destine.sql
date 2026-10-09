CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"address" text,
	"contact_user_id" uuid,
	"preferred_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"receipt_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"bundle_hash" text NOT NULL,
	"bundle" jsonb NOT NULL,
	"token_in" text NOT NULL,
	"token_out" text NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"amount_out" numeric(78, 0) NOT NULL,
	"usd_micros" numeric(78, 0) NOT NULL,
	"taker" text NOT NULL,
	"execution_tx" text NOT NULL,
	"execution_block" bigint NOT NULL,
	"anchor_tx" text,
	"anchor_block" bigint,
	"savings_bps" integer,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_bundleHash_unique" UNIQUE("bundle_hash"),
	CONSTRAINT "receipts_executionTx_unique" UNIQUE("execution_tx")
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"day" date NOT NULL,
	"purpose" text NOT NULL,
	"usd_micros" numeric(78, 0) NOT NULL,
	"status" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"telegram_username" text,
	"display_name" text,
	"language" text DEFAULT 'es' NOT NULL,
	"wallet_address" text,
	"wallet_kind" text,
	"max_action_micros" numeric(78, 0) DEFAULT '25000000' NOT NULL,
	"max_daily_micros" numeric(78, 0) DEFAULT '100000000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegramId_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_user_id_users_id_fk" FOREIGN KEY ("contact_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_name_key" ON "contacts" USING btree ("user_id","name_key");--> statement-breakpoint
CREATE INDEX "messages_user_created_idx" ON "messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "pending_actions_user_status_idx" ON "pending_actions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "receipts_user_idx" ON "receipts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "receipts_created_idx" ON "receipts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "spend_ledger_scope_day_idx" ON "spend_ledger" USING btree ("scope","day");