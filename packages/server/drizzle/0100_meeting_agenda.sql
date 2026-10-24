CREATE TABLE "meeting_guests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"attendance" "meeting_attendance",
	"position" integer DEFAULT 0 NOT NULL,
	"added_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_guests_name" CHECK (length("meeting_guests"."name") between 1 and 200),
	CONSTRAINT "meeting_guests_note" CHECK (length("meeting_guests"."note") <= 500)
);
--> statement-breakpoint
DROP INDEX "meetings_one_upcoming";--> statement-breakpoint
ALTER TABLE "meeting_series" ADD COLUMN "overview_layout" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "agenda_position" text COLLATE "C";--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "one_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "extra" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_guests" ADD CONSTRAINT "meeting_guests_meeting_id_meetings_item_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_guests" ADD CONSTRAINT "meeting_guests_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_guests" ADD CONSTRAINT "meeting_guests_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_guests_meeting_id_index" ON "meeting_guests" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_guests_added_by_index" ON "meeting_guests" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "meeting_guests_updated_by_index" ON "meeting_guests" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_one_upcoming" ON "meetings" USING btree ("series_id") WHERE "meetings"."state" = 'upcoming' and not "meetings"."extra";