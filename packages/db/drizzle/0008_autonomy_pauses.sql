CREATE TABLE "autonomy_pauses" (
	"account" text PRIMARY KEY NOT NULL,
	"paused" boolean NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
