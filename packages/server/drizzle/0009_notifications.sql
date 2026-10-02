CREATE TABLE "known_devices" (
	"account_id" uuid NOT NULL,
	"device_hash" "bytea" NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_devices_account_id_device_hash_pk" PRIMARY KEY("account_id","device_hash")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"organization_id" uuid,
	"type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"actor_type" text,
	"actor_id" uuid,
	"params" jsonb NOT NULL,
	"group_key" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_accounts_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_id_updated_at_id_index" ON "notifications" USING btree ("recipient_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "notifications_unread_group_index" ON "notifications" USING btree ("recipient_id","group_key","updated_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_updated_at_index" ON "notifications" USING btree ("updated_at");