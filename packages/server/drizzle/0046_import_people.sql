CREATE TABLE "import_credentials" (
	"import_id" uuid PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"email" text NOT NULL,
	"token" "bytea" NOT NULL,
	"people" integer,
	"with_email" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_directory" (
	"import_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"email" text,
	CONSTRAINT "import_directory_import_id_external_id_pk" PRIMARY KEY("import_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "import_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"item_id" uuid,
	"restriction" text,
	"holder_kind" text NOT NULL,
	"account_id" uuid,
	"group_key" text,
	"role" "space_role",
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"code" text,
	"applied_at" timestamp with time zone,
	CONSTRAINT "import_grants_restriction" CHECK ("import_grants"."restriction" is null or "import_grants"."restriction" in ('view', 'edit')),
	CONSTRAINT "import_grants_holder_kind" CHECK ("import_grants"."holder_kind" in ('account', 'group', 'organizationMembers', 'anonymous')),
	CONSTRAINT "import_grants_status" CHECK ("import_grants"."status" in ('mapped', 'check', 'missing', 'notTaken'))
);
--> statement-breakpoint
CREATE TABLE "import_groups" (
	"import_id" uuid NOT NULL,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"group_id" uuid,
	"mapped_by" uuid,
	"mapped_at" timestamp with time zone,
	CONSTRAINT "import_groups_import_id_name_key_pk" PRIMARY KEY("import_id","name_key")
);
--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "history" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "people_source" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "token_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_credentials" ADD CONSTRAINT "import_credentials_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_directory" ADD CONSTRAINT "import_directory_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_grants" ADD CONSTRAINT "import_grants_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_grants" ADD CONSTRAINT "import_grants_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_grants" ADD CONSTRAINT "import_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_groups" ADD CONSTRAINT "import_groups_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_groups" ADD CONSTRAINT "import_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_groups" ADD CONSTRAINT "import_groups_mapped_by_accounts_id_fk" FOREIGN KEY ("mapped_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_grants_source_unique" ON "import_grants" USING btree ("import_id","source_key");--> statement-breakpoint
CREATE INDEX "import_grants_import_id_group_key_index" ON "import_grants" USING btree ("import_id","group_key");--> statement-breakpoint
CREATE INDEX "import_grants_account_id_index" ON "import_grants" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_grants_item_id_index" ON "import_grants" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "import_groups_group_id_index" ON "import_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "import_groups_mapped_by_index" ON "import_groups" USING btree ("mapped_by");--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_people_source" CHECK ("imports"."people_source" is null or "imports"."people_source" in ('token', 'list', 'skip'));