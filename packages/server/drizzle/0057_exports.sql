CREATE TYPE "public"."export_scope" AS ENUM('space', 'pages');--> statement-breakpoint
CREATE TYPE "public"."export_state" AS ENUM('queued', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_id" uuid,
	"started_with_token" boolean DEFAULT false NOT NULL,
	"organization_id" uuid,
	"scope" "export_scope" NOT NULL,
	"space_id" uuid,
	"root_item_id" uuid,
	"name" text NOT NULL,
	"state" "export_state" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"file_id" uuid,
	"file_name" text,
	"size" bigint,
	"error_code" text,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_root_item_id_tree_items_id_fk" FOREIGN KEY ("root_item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exports_one_running_per_account" ON "exports" USING btree ("account_id") WHERE "exports"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "exports_account_id_created_at_index" ON "exports" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "exports_state_heartbeat_at_index" ON "exports" USING btree ("state","heartbeat_at");--> statement-breakpoint
CREATE INDEX "exports_expires_at_index" ON "exports" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "exports_token_id_index" ON "exports" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "exports_organization_id_index" ON "exports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "exports_space_id_index" ON "exports" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "exports_root_item_id_index" ON "exports" USING btree ("root_item_id");--> statement-breakpoint
CREATE INDEX "exports_file_id_index" ON "exports" USING btree ("file_id");