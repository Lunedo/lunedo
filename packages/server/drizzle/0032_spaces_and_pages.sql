CREATE TYPE "public"."page_width" AS ENUM('fixed', 'full');--> statement-breakpoint
CREATE TYPE "public"."space_role" AS ENUM('reader', 'commenter', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."space_visibility" AS ENUM('private', 'organization', 'instance');--> statement-breakpoint
CREATE TYPE "public"."tree_item_kind" AS ENUM('page', 'folder', 'link');--> statement-breakpoint
CREATE TABLE "collaboration_clients" (
	"item_id" uuid NOT NULL,
	"client_id" bigint NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaboration_clients_item_id_client_id_pk" PRIMARY KEY("item_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "page_documents" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_labels" (
	"item_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_labels_item_id_label_pk" PRIMARY KEY("item_id","label"),
	CONSTRAINT "page_labels_format" CHECK ("page_labels"."label" = lower("page_labels"."label") and length("page_labels"."label") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "page_links" (
	"source_item_id" uuid NOT NULL,
	"target_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_links_source_item_id_target_item_id_pk" PRIMARY KEY("source_item_id","target_item_id")
);
--> statement-breakpoint
CREATE TABLE "space_key_aliases" (
	"key" text PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid,
	"role" "space_role" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_permissions_holder_unique" UNIQUE NULLS NOT DISTINCT("space_id","principal_kind","principal_id"),
	CONSTRAINT "space_permissions_principal" CHECK (("space_permissions"."principal_kind" in ('account', 'group')) = ("space_permissions"."principal_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"personal_of" uuid,
	"owner_account_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" "space_visibility" DEFAULT 'private' NOT NULL,
	"overview_item_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_key_format" CHECK ("spaces"."key" ~ '^[A-Z0-9]{2,10}$'),
	CONSTRAINT "spaces_personal_or_organization" CHECK (("spaces"."personal_of" is null) <> ("spaces"."organization_id" is null)),
	CONSTRAINT "spaces_personal_private" CHECK ("spaces"."personal_of" is null or "spaces"."visibility" = 'private')
);
--> statement-breakpoint
CREATE TABLE "tree_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "tree_item_kind" NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"width" "page_width" DEFAULT 'fixed' NOT NULL,
	"link_item_id" uuid,
	"link_url" text,
	"creator_id" uuid,
	"owner_id" uuid,
	"content_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tree_items_link_target" CHECK (("tree_items"."kind" = 'link') = ("tree_items"."link_item_id" is not null or "tree_items"."link_url" is not null)),
	CONSTRAINT "tree_items_not_own_parent" CHECK ("tree_items"."parent_id" is distinct from "tree_items"."id")
);
--> statement-breakpoint
ALTER TABLE "collaboration_clients" ADD CONSTRAINT "collaboration_clients_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_clients" ADD CONSTRAINT "collaboration_clients_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_documents" ADD CONSTRAINT "page_documents_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_documents" ADD CONSTRAINT "page_documents_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_source_item_id_tree_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_target_item_id_tree_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_key_aliases" ADD CONSTRAINT "space_key_aliases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_personal_of_accounts_id_fk" FOREIGN KEY ("personal_of") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_overview_item_id_tree_items_id_fk" FOREIGN KEY ("overview_item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_parent_id_tree_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_link_item_id_tree_items_id_fk" FOREIGN KEY ("link_item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_creator_id_accounts_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collaboration_clients_account_id_index" ON "collaboration_clients" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "page_labels_label_index" ON "page_labels" USING btree ("label");--> statement-breakpoint
CREATE INDEX "page_labels_created_by_index" ON "page_labels" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "page_links_target_item_id_index" ON "page_links" USING btree ("target_item_id");--> statement-breakpoint
CREATE INDEX "space_key_aliases_space_id_index" ON "space_key_aliases" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_permissions_principal_kind_principal_id_index" ON "space_permissions" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "space_permissions_created_by_index" ON "space_permissions" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_key_unique" ON "spaces" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_personal_of_unique" ON "spaces" USING btree ("personal_of");--> statement-breakpoint
CREATE INDEX "spaces_organization_name_index" ON "spaces" USING btree ("organization_id",lower("name"),"id");--> statement-breakpoint
CREATE INDEX "spaces_owner_account_id_index" ON "spaces" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "spaces_overview_item_id_index" ON "spaces" USING btree ("overview_item_id");--> statement-breakpoint
CREATE INDEX "spaces_created_by_index" ON "spaces" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "tree_items_position_unique" ON "tree_items" USING btree ("space_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),"position");--> statement-breakpoint
CREATE INDEX "tree_items_title_index" ON "tree_items" USING btree ("space_id",lower("title"));--> statement-breakpoint
CREATE INDEX "tree_items_parent_id_index" ON "tree_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tree_items_link_item_id_index" ON "tree_items" USING btree ("link_item_id");--> statement-breakpoint
CREATE INDEX "tree_items_creator_id_index" ON "tree_items" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "tree_items_owner_id_index" ON "tree_items" USING btree ("owner_id");