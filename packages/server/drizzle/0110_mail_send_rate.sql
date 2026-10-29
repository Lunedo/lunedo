CREATE TABLE "mail_sends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sender" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mail_sends_sender_sent_at_index" ON "mail_sends" USING btree ("sender","sent_at");