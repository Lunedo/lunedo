CREATE TYPE "public"."mapping_target" AS ENUM('organization', 'instance');--> statement-breakpoint
CREATE TYPE "public"."provider_grant_kind" AS ENUM('membership', 'role', 'groupMember');--> statement-breakpoint
CREATE TYPE "public"."provider_sync_status" AS ENUM('running', 'succeeded', 'warnings', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provider_sync_trigger" AS ENUM('schedule', 'manual');--> statement-breakpoint
CREATE TABLE "identity_groups" (
	"identity_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "identity_groups_identity_id_group_id_pk" PRIMARY KEY("identity_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "identity_provider_secrets" (
	"provider_id" uuid PRIMARY KEY NOT NULL,
	"directory_key" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_groups" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"provider_group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapping_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"group_id" uuid NOT NULL,
	"target" "mapping_target" NOT NULL,
	"organization_id" uuid,
	"built_in_role" "built_in_role",
	"custom_role_id" uuid,
	"pagehall_group_id" uuid,
	"home_organization" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_rules_target" CHECK (("mapping_rules"."target" = 'organization') = ("mapping_rules"."organization_id" is not null)),
	CONSTRAINT "mapping_rules_instance" CHECK ("mapping_rules"."target" = 'organization' or ("mapping_rules"."pagehall_group_id" is null and not "mapping_rules"."home_organization" and ("mapping_rules"."built_in_role" is not null or "mapping_rules"."custom_role_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "provider_deactivations" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "provider_grant_kind" NOT NULL,
	"key" text NOT NULL,
	"organization_id" uuid,
	"role_assignment_id" uuid,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"trigger" "provider_sync_trigger" NOT NULL,
	"status" "provider_sync_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "identity_groups" ADD CONSTRAINT "identity_groups_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_groups" ADD CONSTRAINT "identity_groups_group_id_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."provider_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_secrets" ADD CONSTRAINT "identity_provider_secrets_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_groups" ADD CONSTRAINT "managed_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_groups" ADD CONSTRAINT "managed_groups_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_groups" ADD CONSTRAINT "managed_groups_provider_group_id_provider_groups_id_fk" FOREIGN KEY ("provider_group_id") REFERENCES "public"."provider_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_group_id_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."provider_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_pagehall_group_id_groups_id_fk" FOREIGN KEY ("pagehall_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_deactivations" ADD CONSTRAINT "provider_deactivations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_deactivations" ADD CONSTRAINT "provider_deactivations_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_groups" ADD CONSTRAINT "provider_groups_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_groups_group_id_index" ON "identity_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "mapping_rules_provider_id_index" ON "mapping_rules" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "mapping_rules_group_id_index" ON "mapping_rules" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_grants_account_id_key_index" ON "provider_grants" USING btree ("account_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_groups_provider_id_external_id_index" ON "provider_groups" USING btree ("provider_id","external_id");--> statement-breakpoint
CREATE INDEX "provider_sync_runs_provider_id_started_at_index" ON "provider_sync_runs" USING btree ("provider_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_runs_running" ON "provider_sync_runs" USING btree ("provider_id") WHERE "provider_sync_runs"."status" = 'running';