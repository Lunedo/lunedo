ALTER TABLE "import_changes" DROP CONSTRAINT "import_changes_decision";--> statement-breakpoint
UPDATE "import_changes" SET "decision" = 'lunedo' WHERE "decision" = 'pagehall';--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_decision" CHECK ("import_changes"."decision" is null or "import_changes"."decision" in ('lunedo', 'source', 'both', 'trash', 'keep'));
