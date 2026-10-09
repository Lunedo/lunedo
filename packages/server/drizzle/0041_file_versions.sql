ALTER TABLE "attachment_versions" ADD COLUMN "kept" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "content_digest" "bytea";--> statement-breakpoint
CREATE INDEX "stored_files_content_digest_index" ON "stored_files" USING btree ("content_digest");--> statement-breakpoint
ALTER TABLE "stored_files" DROP COLUMN "sha256";
