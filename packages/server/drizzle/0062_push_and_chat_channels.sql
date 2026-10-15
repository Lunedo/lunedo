CREATE TYPE "public"."chat_channel_kind" AS ENUM('teams', 'slack', 'matrix', 'discord', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."chat_channel_state" AS ENUM('working', 'failing');--> statement-breakpoint
CREATE TYPE "public"."chat_delivery_state" AS ENUM('pending', 'delivered', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "chat_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid,
	"kind" "chat_channel_kind" NOT NULL,
	"name" text NOT NULL,
	"events" text[] NOT NULL,
	"target" "bytea" NOT NULL,
	"signing_secret" "bytea",
	"state" "chat_channel_state" DEFAULT 'working' NOT NULL,
	"failure_reason" text,
	"failure_status" integer,
	"failure_code" text,
	"failed_at" timestamp with time zone,
	"failure_announced" boolean DEFAULT false NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_delivered_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_channels_name_length" CHECK (length("chat_channels"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "chat_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"event" text NOT NULL,
	"subject_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"combine_key" text,
	"count" integer DEFAULT 1 NOT NULL,
	"state" "chat_delivery_state" DEFAULT 'pending' NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"organization_id" uuid,
	"type" text NOT NULL,
	"target_id" text,
	"actor_id" uuid,
	"actor_count" integer DEFAULT 0 NOT NULL,
	"params" jsonb NOT NULL,
	"queued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"endpoint_hash" "bytea" NOT NULL,
	"subscription" "bytea" NOT NULL,
	"browser" text,
	"operating_system" text,
	"last_delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpointHash_unique" UNIQUE("endpoint_hash")
);
--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD CONSTRAINT "chat_deliveries_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_recipient_id_accounts_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_channels_organization_id_index" ON "chat_channels" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "chat_channels_space_id_index" ON "chat_channels" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "chat_channels_created_by_index" ON "chat_channels" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "chat_deliveries_channel_id_index" ON "chat_deliveries" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "chat_deliveries_state_queued_at_index" ON "chat_deliveries" USING btree ("state","queued_at");--> statement-breakpoint
CREATE INDEX "chat_deliveries_updated_at_index" ON "chat_deliveries" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_deliveries_pending_combine_index" ON "chat_deliveries" USING btree ("channel_id","combine_key") WHERE "chat_deliveries"."state" = 'pending' and "chat_deliveries"."combine_key" is not null;--> statement-breakpoint
CREATE INDEX "push_outbox_recipient_id_index" ON "push_outbox" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "push_outbox_organization_id_index" ON "push_outbox" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "push_outbox_queued_at_index" ON "push_outbox" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_account_id_index" ON "push_subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_session_id_index" ON "push_subscriptions" USING btree ("session_id");