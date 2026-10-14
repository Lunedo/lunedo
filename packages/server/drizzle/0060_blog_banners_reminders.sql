CREATE TYPE "public"."announcement_severity" AS ENUM('information', 'warning');--> statement-breakpoint
CREATE TYPE "public"."meeting_reminder" AS ENUM('off', 'oneDay', 'twoDays', 'oneWeek');--> statement-breakpoint
CREATE TABLE "announcement_dismissals" (
	"announcement_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"version" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_dismissals_announcement_id_account_id_pk" PRIMARY KEY("announcement_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_id" uuid NOT NULL,
	"organization_id" uuid,
	"version" uuid NOT NULL,
	"severity" "announcement_severity" NOT NULL,
	"text" text NOT NULL,
	"link_url" text,
	"link_label" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_scopeId_unique" UNIQUE("scope_id"),
	CONSTRAINT "announcements_scope" CHECK ("announcements"."scope_id" = coalesce("announcements"."organization_id", '00000000-0000-0000-0000-000000000000'::uuid)),
	CONSTRAINT "announcements_period" CHECK ("announcements"."ends_at" > "announcements"."starts_at"),
	CONSTRAINT "announcements_text_length" CHECK (length("announcements"."text") between 1 and 300),
	CONSTRAINT "announcements_link" CHECK (("announcements"."link_url" is null) = ("announcements"."link_label" is null)
        and ("announcements"."link_url" is null or length("announcements"."link_url") <= 2000)
        and ("announcements"."link_label" is null or length("announcements"."link_label") between 1 and 60))
);
--> statement-breakpoint
CREATE TABLE "blog_post_announcements" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"delivered_through" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_subscriptions" (
	"space_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_subscriptions_space_id_account_id_pk" PRIMARY KEY("space_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "space_shortcuts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"label" text NOT NULL,
	"item_id" uuid,
	"url" text,
	"position" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_shortcuts_one_target" CHECK (("space_shortcuts"."item_id" is null) <> ("space_shortcuts"."url" is null)),
	CONSTRAINT "space_shortcuts_label_length" CHECK (length("space_shortcuts"."label") between 1 and 80),
	CONSTRAINT "space_shortcuts_url_length" CHECK ("space_shortcuts"."url" is null or length("space_shortcuts"."url") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "meeting_series" ADD COLUMN "reminder" "meeting_reminder" DEFAULT 'oneDay' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_announcements" ADD CONSTRAINT "blog_post_announcements_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_subscriptions" ADD CONSTRAINT "blog_subscriptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_subscriptions" ADD CONSTRAINT "blog_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_shortcuts" ADD CONSTRAINT "space_shortcuts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_shortcuts" ADD CONSTRAINT "space_shortcuts_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_shortcuts" ADD CONSTRAINT "space_shortcuts_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_dismissals_account_id_index" ON "announcement_dismissals" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "announcements_organization_id_index" ON "announcements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "announcements_updated_by_index" ON "announcements" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "blog_subscriptions_account_id_index" ON "blog_subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "space_shortcuts_space_id_position_index" ON "space_shortcuts" USING btree ("space_id","position");--> statement-breakpoint
CREATE INDEX "space_shortcuts_item_id_index" ON "space_shortcuts" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "space_shortcuts_created_by_index" ON "space_shortcuts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "meetings_reminder_due_index" ON "meetings" USING btree ("starts_at") WHERE "meetings"."state" = 'upcoming' and "meetings"."reminded_at" is null;--> statement-breakpoint
UPDATE "meetings" SET "reminded_at" = now() WHERE "state" = 'upcoming' AND "starts_at" IS NOT NULL AND "starts_at" - interval '1 day' <= now();