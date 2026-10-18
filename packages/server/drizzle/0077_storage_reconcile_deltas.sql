CREATE TABLE "storage_reconcile_deltas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run" uuid NOT NULL,
	"key" text NOT NULL,
	"delta" bigint NOT NULL,
	"pages" integer NOT NULL,
	"fetching" boolean NOT NULL,
	"done" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_state" ADD COLUMN "reconcile_run" uuid;--> statement-breakpoint
ALTER TABLE "storage_state" ADD COLUMN "reconcile_pages" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_state" ADD COLUMN "reconcile_fetching" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_state" ADD COLUMN "reconcile_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "storage_reconcile_deltas_run_index" ON "storage_reconcile_deltas" USING btree ("run");