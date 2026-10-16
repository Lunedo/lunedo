CREATE TYPE "public"."export_format" AS ENUM('archive', 'html', 'markdown', 'print', 'pdf', 'docx');--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "format" "export_format" DEFAULT 'archive' NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;