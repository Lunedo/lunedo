ALTER TABLE "attachment_versions" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "published_version_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "discarded_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "discarded_drafts" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_published_version_id_attachment_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."attachment_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_discarded_draft_id_discarded_drafts_id_fk" FOREIGN KEY ("discarded_draft_id") REFERENCES "public"."discarded_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_published_version_id_index" ON "attachments" USING btree ("published_version_id");--> statement-breakpoint
CREATE INDEX "attachments_discarded_draft_id_index" ON "attachments" USING btree ("discarded_draft_id");--> statement-breakpoint
UPDATE "attachment_versions" SET "published_at" = "created_at";--> statement-breakpoint
UPDATE "attachments" SET "published_version_id" = "current_version_id" WHERE "deleted_at" IS NULL;
