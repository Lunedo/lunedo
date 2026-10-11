ALTER TYPE "public"."import_state" ADD VALUE 'superseded';--> statement-breakpoint
ALTER TYPE "public"."version_reason" ADD VALUE 'imported';--> statement-breakpoint
ALTER TYPE "public"."version_reason" ADD VALUE 'importedNotApplied';--> statement-breakpoint
CREATE TABLE "import_baselines" (
	"space_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" uuid,
	"import_id" uuid,
	"source_version" integer,
	"checksum" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"local" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kept" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_baselines_space_id_kind_source_id_pk" PRIMARY KEY("space_id","kind","source_id"),
	CONSTRAINT "import_baselines_kind" CHECK ("import_baselines"."kind" in ('page', 'template', 'spacePermission'))
);
--> statement-breakpoint
CREATE TABLE "import_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"change" text NOT NULL,
	"item_id" uuid,
	"target_id" uuid,
	"title" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	CONSTRAINT "import_changes_kind" CHECK ("import_changes"."kind" in ('page', 'template', 'comment', 'attachment', 'spacePermission', 'restriction')),
	CONSTRAINT "import_changes_change" CHECK ("import_changes"."change" in ('new', 'updated', 'conflict', 'deleted', 'moved', 'movedHere', 'labels', 'gone', 'permission')),
	CONSTRAINT "import_changes_decision" CHECK ("import_changes"."decision" is null or "import_changes"."decision" in ('pagehall', 'source', 'both', 'trash', 'keep'))
);
--> statement-breakpoint
CREATE TABLE "import_titles" (
	"space_id" uuid NOT NULL,
	"space_key" text NOT NULL,
	"title_key" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "import_titles_space_id_space_key_title_key_source_id_pk" PRIMARY KEY("space_id","space_key","title_key","source_id")
);
--> statement-breakpoint
CREATE TABLE "imported_spaces" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid,
	"source" text NOT NULL,
	"source_space_id" text NOT NULL,
	"source_space_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "target_space_id" uuid;--> statement-breakpoint
ALTER TABLE "import_baselines" ADD CONSTRAINT "import_baselines_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_baselines" ADD CONSTRAINT "import_baselines_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_applied_by_accounts_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_titles" ADD CONSTRAINT "import_titles_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_spaces" ADD CONSTRAINT "imported_spaces_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_spaces" ADD CONSTRAINT "imported_spaces_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_baselines_kind_source_id_index" ON "import_baselines" USING btree ("kind","source_id");--> statement-breakpoint
CREATE INDEX "import_baselines_target_id_index" ON "import_baselines" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "import_baselines_import_id_index" ON "import_baselines" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_changes_unique" ON "import_changes" USING btree ("import_id","kind","source_id","change");--> statement-breakpoint
CREATE INDEX "import_changes_import_id_change_index" ON "import_changes" USING btree ("import_id","change");--> statement-breakpoint
CREATE INDEX "import_changes_item_id_index" ON "import_changes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "import_changes_decided_by_index" ON "import_changes" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "import_changes_applied_by_index" ON "import_changes" USING btree ("applied_by");--> statement-breakpoint
CREATE INDEX "import_titles_space_key_title_key_index" ON "import_titles" USING btree ("space_key","title_key");--> statement-breakpoint
CREATE INDEX "imported_spaces_import_id_index" ON "imported_spaces" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "imported_spaces_source_space_key_index" ON "imported_spaces" USING btree ("source_space_key");--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_target_space_id_spaces_id_fk" FOREIGN KEY ("target_space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_items_kind_source_id_index" ON "import_items" USING btree ("kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_active_reimport_unique" ON "imports" USING btree ("target_space_id") WHERE "imports"."state" in ('running', 'held', 'review');