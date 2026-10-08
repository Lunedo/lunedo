CREATE TYPE "public"."access_request_status" AS ENUM('open', 'approved', 'declined', 'withdrawn', 'satisfied');--> statement-breakpoint
CREATE TYPE "public"."page_restriction_kind" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."share_link_scope" AS ENUM('people', 'organization', 'instance', 'anyone');--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requester_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"item_id" uuid,
	"message" text DEFAULT '' NOT NULL,
	"status" "access_request_status" DEFAULT 'open' NOT NULL,
	"role" "space_role",
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_message_length" CHECK (length("access_requests"."message") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "invitation_shares" (
	"invitation_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"role" "space_role" NOT NULL,
	"include_descendants" boolean DEFAULT false NOT NULL,
	"shared_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_shares_invitation_id_item_id_pk" PRIMARY KEY("invitation_id","item_id"),
	CONSTRAINT "invitation_shares_role" CHECK ("invitation_shares"."role" <> 'admin')
);
--> statement-breakpoint
CREATE TABLE "page_restrictions" (
	"item_id" uuid NOT NULL,
	"kind" "page_restriction_kind" NOT NULL,
	"set_by" uuid,
	"orphaned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_restrictions_item_id_kind_pk" PRIMARY KEY("item_id","kind")
);
--> statement-breakpoint
CREATE TABLE "page_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid NOT NULL,
	"role" "space_role" NOT NULL,
	"include_descendants" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_shares_principal" CHECK ("page_shares"."principal_kind" in ('account', 'group')),
	CONSTRAINT "page_shares_role" CHECK ("page_shares"."role" <> 'admin')
);
--> statement-breakpoint
CREATE TABLE "share_link_accesses" (
	"link_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_link_accesses_link_id_account_id_pk" PRIMARY KEY("link_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "share_link_people" (
	"link_id" uuid NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_link_people_link_id_principal_kind_principal_id_pk" PRIMARY KEY("link_id","principal_kind","principal_id"),
	CONSTRAINT "share_link_people_principal" CHECK ("share_link_people"."principal_kind" in ('account', 'group'))
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"lookup" text NOT NULL,
	"secret_hash" "bytea" NOT NULL,
	"scope" "share_link_scope" NOT NULL,
	"password_hash" text,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_anyone_expires" CHECK ("share_links"."scope" <> 'anyone' or "share_links"."expires_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "discoverable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "path" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_id_accounts_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_shares" ADD CONSTRAINT "invitation_shares_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_shares" ADD CONSTRAINT "invitation_shares_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_shares" ADD CONSTRAINT "invitation_shares_shared_by_accounts_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_set_by_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_shares" ADD CONSTRAINT "page_shares_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_shares" ADD CONSTRAINT "page_shares_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_accesses" ADD CONSTRAINT "share_link_accesses_link_id_share_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_accesses" ADD CONSTRAINT "share_link_accesses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_people" ADD CONSTRAINT "share_link_people_link_id_share_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_revoked_by_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_open_unique" ON "access_requests" USING btree ("requester_id","space_id",coalesce("item_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "access_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX "access_requests_space_id_status_index" ON "access_requests" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "access_requests_item_id_index" ON "access_requests" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "access_requests_decided_by_index" ON "access_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "invitation_shares_item_id_index" ON "invitation_shares" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "invitation_shares_shared_by_index" ON "invitation_shares" USING btree ("shared_by");--> statement-breakpoint
CREATE INDEX "page_restrictions_set_by_index" ON "page_restrictions" USING btree ("set_by");--> statement-breakpoint
CREATE UNIQUE INDEX "page_shares_holder_unique" ON "page_shares" USING btree ("item_id","principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "page_shares_principal_kind_principal_id_index" ON "page_shares" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "page_shares_created_by_index" ON "page_shares" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "share_link_accesses_account_id_index" ON "share_link_accesses" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "share_link_people_principal_kind_principal_id_index" ON "share_link_people" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_lookup_unique" ON "share_links" USING btree ("lookup");--> statement-breakpoint
CREATE INDEX "share_links_item_id_index" ON "share_links" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "share_links_created_by_index" ON "share_links" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "share_links_revoked_by_index" ON "share_links" USING btree ("revoked_by");--> statement-breakpoint
CREATE FUNCTION "tree_items_set_path"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  "parent_path" uuid[];
BEGIN
  IF coalesce(NEW."parent_id", NEW."restore_parent_id") IS NOT NULL THEN
    SELECT "p"."path" INTO "parent_path" FROM "tree_items" "p"
    WHERE "p"."id" = coalesce(NEW."parent_id", NEW."restore_parent_id") FOR SHARE;
  END IF;
  NEW."path" := coalesce("parent_path", '{}'::uuid[]) || NEW."id";
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION "tree_items_propagate_path"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."path" IS DISTINCT FROM OLD."path" THEN
    WITH RECURSIVE "down"("id", "path") AS (
      SELECT "c"."id", NEW."path" || "c"."id" FROM "tree_items" "c"
      WHERE "c"."id" <> NEW."id"
        AND ("c"."parent_id" = NEW."id" OR ("c"."parent_id" IS NULL AND "c"."restore_parent_id" = NEW."id"))
      UNION ALL
      SELECT "c"."id", "d"."path" || "c"."id" FROM "tree_items" "c" JOIN "down" "d"
        ON "c"."parent_id" = "d"."id" OR ("c"."parent_id" IS NULL AND "c"."restore_parent_id" = "d"."id")
      WHERE NOT "c"."id" = ANY("d"."path")
    )
    UPDATE "tree_items" "t" SET "path" = "d"."path" FROM "down" "d"
    WHERE "t"."id" = "d"."id" AND "t"."path" IS DISTINCT FROM "d"."path";
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "tree_items_path_before" BEFORE INSERT OR UPDATE OF "parent_id", "restore_parent_id" ON "tree_items"
  FOR EACH ROW EXECUTE FUNCTION "tree_items_set_path"();--> statement-breakpoint
CREATE TRIGGER "tree_items_path_after" AFTER UPDATE OF "parent_id", "restore_parent_id" ON "tree_items"
  FOR EACH ROW EXECUTE FUNCTION "tree_items_propagate_path"();--> statement-breakpoint
WITH RECURSIVE "walk"("id", "path") AS (
  SELECT "t"."id", ARRAY["t"."id"] FROM "tree_items" "t"
  WHERE coalesce("t"."parent_id", "t"."restore_parent_id") IS NULL
    OR NOT EXISTS (SELECT 1 FROM "tree_items" "p" WHERE "p"."id" = coalesce("t"."parent_id", "t"."restore_parent_id"))
  UNION ALL
  SELECT "c"."id", "w"."path" || "c"."id" FROM "tree_items" "c" JOIN "walk" "w"
    ON "c"."parent_id" = "w"."id" OR ("c"."parent_id" IS NULL AND "c"."restore_parent_id" = "w"."id")
  WHERE NOT "c"."id" = ANY("w"."path")
)
UPDATE "tree_items" "t" SET "path" = "w"."path" FROM "walk" "w" WHERE "t"."id" = "w"."id";--> statement-breakpoint
CREATE FUNCTION "organization_flag"("organization" uuid, "setting_key" text, "fallback" boolean) RETURNS boolean
  STABLE LANGUAGE sql AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM "setting_values" "v" WHERE "v"."level" = 'instance' AND "v"."key" = "setting_key" AND "v"."locked")
      THEN coalesce((SELECT ("v"."value" #>> '{}')::boolean FROM "setting_values" "v"
        WHERE "v"."level" = 'instance' AND "v"."key" = "setting_key" AND "v"."value" IS NOT NULL), "fallback")
    ELSE coalesce(
      (SELECT ("v"."value" #>> '{}')::boolean FROM "setting_values" "v"
        WHERE "v"."level" = 'organization' AND "v"."scope_id" = "organization" AND "v"."key" = "setting_key"
          AND "v"."value" IS NOT NULL),
      (SELECT ("v"."value" #>> '{}')::boolean FROM "setting_values" "v"
        WHERE "v"."level" = 'instance' AND "v"."key" = "setting_key" AND "v"."value" IS NOT NULL),
      "fallback")
  END
$$;
