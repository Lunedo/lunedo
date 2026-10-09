CREATE TYPE "public"."meeting_attendance" AS ENUM('present', 'excused', 'absent');--> statement-breakpoint
CREATE TYPE "public"."meeting_state" AS ENUM('upcoming', 'closed', 'reopened', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."meeting_schedule_source" AS ENUM('manual', 'calendar');--> statement-breakpoint
CREATE TYPE "public"."meeting_topic_outcome" AS ENUM('resolved', 'decided', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."meeting_topic_status" AS ENUM('open', 'closed');--> statement-breakpoint
ALTER TYPE "public"."tree_item_kind" ADD VALUE 'meetingSeries';--> statement-breakpoint
ALTER TYPE "public"."tree_item_kind" ADD VALUE 'meetingTopic';--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"topic_id" uuid,
	"published" boolean DEFAULT false NOT NULL,
	"statement" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_attendees" (
	"meeting_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"attendance" "meeting_attendance",
	"position" integer DEFAULT 0 NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_attendees_meeting_id_account_id_pk" PRIMARY KEY("meeting_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_occurrence_overrides" (
	"series_id" uuid NOT NULL,
	"recurrence_id" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone,
	"calendar_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_occurrence_overrides_series_id_recurrence_id_pk" PRIMARY KEY("series_id","recurrence_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_private_notes" (
	"meeting_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"document" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_private_notes_meeting_id_account_id_pk" PRIMARY KEY("meeting_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_series" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"recurrence" text,
	"starts_on" text NOT NULL,
	"start_time" text NOT NULL,
	"time_zone" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"template_id" text NOT NULL,
	"source" "meeting_schedule_source" DEFAULT 'manual' NOT NULL,
	"calendar_uid" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_series_starts_on" CHECK ("meeting_series"."starts_on" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "meeting_series_start_time" CHECK ("meeting_series"."start_time" ~ '^([01]\d|2[0-3]):[0-5]\d$'),
	CONSTRAINT "meeting_series_duration" CHECK ("meeting_series"."duration_minutes" between 5 and 1440),
	CONSTRAINT "meeting_series_recurrence_length" CHECK (length("meeting_series"."recurrence") <= 500)
);
--> statement-breakpoint
CREATE TABLE "meeting_series_members" (
	"series_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_series_members_series_id_account_id_pk" PRIMARY KEY("series_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_topic_updates" (
	"topic_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_topic_updates_topic_id_item_id_pk" PRIMARY KEY("topic_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_topics" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"status" "meeting_topic_status" DEFAULT 'open' NOT NULL,
	"outcome" "meeting_topic_outcome",
	"raised_in_id" uuid,
	"closed_in_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"decision_id" uuid,
	"last_update_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_topics_outcome" CHECK (("meeting_topics"."status" = 'closed') = ("meeting_topics"."outcome" is not null and "meeting_topics"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"recurrence_id" timestamp with time zone,
	"starts_at" timestamp with time zone,
	"duration_minutes" integer NOT NULL,
	"state" "meeting_state" DEFAULT 'upcoming' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"next_meeting_id" uuid,
	"calendar_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_closed" CHECK (("meetings"."state" in ('closed', 'skipped')) = ("meetings"."closed_at" is not null) or "meetings"."state" = 'reopened')
);
--> statement-breakpoint
ALTER TABLE "page_templates" ADD COLUMN "series" jsonb;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "confidential" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "one_on_one" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_topic_id_tree_items_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_item_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_occurrence_overrides" ADD CONSTRAINT "meeting_occurrence_overrides_series_id_meeting_series_item_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."meeting_series"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_private_notes" ADD CONSTRAINT "meeting_private_notes_meeting_id_meetings_item_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_private_notes" ADD CONSTRAINT "meeting_private_notes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series" ADD CONSTRAINT "meeting_series_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series" ADD CONSTRAINT "meeting_series_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series_members" ADD CONSTRAINT "meeting_series_members_series_id_meeting_series_item_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."meeting_series"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series_members" ADD CONSTRAINT "meeting_series_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topic_updates" ADD CONSTRAINT "meeting_topic_updates_topic_id_meeting_topics_item_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."meeting_topics"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topic_updates" ADD CONSTRAINT "meeting_topic_updates_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_series_id_meeting_series_item_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."meeting_series"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_raised_in_id_meetings_item_id_fk" FOREIGN KEY ("raised_in_id") REFERENCES "public"."meetings"("item_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_closed_in_id_meetings_item_id_fk" FOREIGN KEY ("closed_in_id") REFERENCES "public"."meetings"("item_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_closed_by_accounts_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_series_id_meeting_series_item_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."meeting_series"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_closed_by_accounts_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_next_meeting_id_meetings_item_id_fk" FOREIGN KEY ("next_meeting_id") REFERENCES "public"."meetings"("item_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_item_id_index" ON "decisions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "decisions_topic_id_index" ON "decisions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "decisions_published_index" ON "decisions" USING btree ("created_at") WHERE "decisions"."published";--> statement-breakpoint
CREATE INDEX "meeting_attendees_account_id_index" ON "meeting_attendees" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "meeting_attendees_added_by_index" ON "meeting_attendees" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "meeting_private_notes_account_id_index" ON "meeting_private_notes" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_series_calendar_uid_unique" ON "meeting_series" USING btree ("calendar_uid") WHERE "meeting_series"."calendar_uid" is not null;--> statement-breakpoint
CREATE INDEX "meeting_series_created_by_index" ON "meeting_series" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "meeting_series_members_account_id_index" ON "meeting_series_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "meeting_topic_updates_item_id_index" ON "meeting_topic_updates" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "meeting_topics_series_id_status_index" ON "meeting_topics" USING btree ("series_id","status");--> statement-breakpoint
CREATE INDEX "meeting_topics_raised_in_id_index" ON "meeting_topics" USING btree ("raised_in_id");--> statement-breakpoint
CREATE INDEX "meeting_topics_closed_in_id_index" ON "meeting_topics" USING btree ("closed_in_id");--> statement-breakpoint
CREATE INDEX "meeting_topics_closed_by_index" ON "meeting_topics" USING btree ("closed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_one_upcoming" ON "meetings" USING btree ("series_id") WHERE "meetings"."state" = 'upcoming';--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_occurrence_unique" ON "meetings" USING btree ("series_id","recurrence_id") WHERE "meetings"."recurrence_id" is not null;--> statement-breakpoint
CREATE INDEX "meetings_series_id_starts_at_index" ON "meetings" USING btree ("series_id","starts_at");--> statement-breakpoint
CREATE INDEX "meetings_closed_by_index" ON "meetings" USING btree ("closed_by");--> statement-breakpoint
CREATE INDEX "meetings_next_meeting_id_index" ON "meetings" USING btree ("next_meeting_id");--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_confidential_private" CHECK (not "spaces"."confidential" or ("spaces"."visibility" = 'private' and not "spaces"."discoverable" and "spaces"."personal_of" is null));--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_one_on_one_confidential" CHECK (not "spaces"."one_on_one" or "spaces"."confidential");--> statement-breakpoint
CREATE FUNCTION "spaces_keep_confidentiality"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."confidential" <> OLD."confidential" OR NEW."one_on_one" <> OLD."one_on_one" THEN
		RAISE EXCEPTION 'Whether a space is confidential is chosen when it is created'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'spaces_confidential_fixed';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "spaces_confidential_fixed" BEFORE UPDATE OF "confidential", "one_on_one" ON "spaces"
	FOR EACH ROW EXECUTE FUNCTION "spaces_keep_confidentiality"();--> statement-breakpoint
CREATE FUNCTION "space_permissions_confidential_holder"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."principal_kind" <> 'account'
		AND EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "confidential") THEN
		RAISE EXCEPTION 'Confidential spaces give permissions to individual people only'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'space_permissions_confidential_holder';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "space_permissions_confidential_holder" BEFORE INSERT OR UPDATE ON "space_permissions"
	FOR EACH ROW EXECUTE FUNCTION "space_permissions_confidential_holder"();--> statement-breakpoint
CREATE FUNCTION "page_shares_confidential_holder"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."principal_kind" <> 'account' AND EXISTS (
		SELECT 1 FROM "tree_items" t JOIN "spaces" s ON s."id" = t."space_id"
		WHERE t."id" = NEW."item_id" AND s."confidential") THEN
		RAISE EXCEPTION 'Pages of confidential spaces are shared with individual people only'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'page_shares_confidential_holder';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "page_shares_confidential_holder" BEFORE INSERT OR UPDATE ON "page_shares"
	FOR EACH ROW EXECUTE FUNCTION "page_shares_confidential_holder"();--> statement-breakpoint
CREATE FUNCTION "share_links_confidential_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."scope" <> 'people' AND EXISTS (
		SELECT 1 FROM "tree_items" t JOIN "spaces" s ON s."id" = t."space_id"
		WHERE t."id" = NEW."item_id" AND s."confidential") THEN
		RAISE EXCEPTION 'Share links in confidential spaces are limited to specific people'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'share_links_confidential_scope';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "share_links_confidential_scope" BEFORE INSERT OR UPDATE ON "share_links"
	FOR EACH ROW EXECUTE FUNCTION "share_links_confidential_scope"();
