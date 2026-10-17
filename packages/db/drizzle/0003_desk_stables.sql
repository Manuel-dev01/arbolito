ALTER TABLE "desk_snapshots" ADD COLUMN "usdc" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "desk_snapshots" ADD COLUMN "usat" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "desk_snapshots" ADD COLUMN "fairs" jsonb;