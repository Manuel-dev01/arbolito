CREATE TABLE "desk_rfqs" (
	"rfq_id" text PRIMARY KEY NOT NULL,
	"result" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desk_snapshots" ADD COLUMN "quoting" jsonb;--> statement-breakpoint
CREATE INDEX "desk_rfqs_at_idx" ON "desk_rfqs" USING btree ("at");