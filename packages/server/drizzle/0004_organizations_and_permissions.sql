CREATE TYPE "public"."built_in_role" AS ENUM('owner', 'administrator', 'member', 'securityAuditor');--> statement-breakpoint
CREATE TYPE "public"."membership_kind" AS ENUM('member', 'collaborator', 'guest');--> statement-breakpoint
CREATE TYPE "public"."principal_kind" AS ENUM('account', 'group', 'organizationMembers', 'instanceUsers');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('instance', 'organization');--> statement-breakpoint
CREATE TABLE "break_glass_accesses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_recorded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "custom_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "role_scope" NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"areas" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_roles_scope" CHECK (("custom_roles"."scope" = 'instance') = ("custom_roles"."organization_id" is null))
);
--> statement-breakpoint
CREATE TABLE "group_managers" (
	"group_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_managers_group_id_account_id_pk" PRIMARY KEY("group_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"expiry_reminded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_account_id_pk" PRIMARY KEY("group_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"kind" "membership_kind" NOT NULL,
	"built_in_role" "built_in_role",
	"custom_role_id" uuid,
	"token_hash" "bytea" NOT NULL,
	"invited_by" uuid,
	"responsible_account_id" uuid,
	"membership_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "membership_kind" NOT NULL,
	"expires_at" timestamp with time zone,
	"responsible_account_id" uuid,
	"expiry_reminded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "role_scope" NOT NULL,
	"organization_id" uuid,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid,
	"built_in_role" "built_in_role",
	"custom_role_id" uuid,
	"expires_at" timestamp with time zone,
	"expiry_reminded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_unique" UNIQUE NULLS NOT DISTINCT("scope","organization_id","principal_kind","principal_id","built_in_role","custom_role_id"),
	CONSTRAINT "role_assignments_one_role" CHECK (("role_assignments"."built_in_role" is null) <> ("role_assignments"."custom_role_id" is null)),
	CONSTRAINT "role_assignments_scope" CHECK (("role_assignments"."scope" = 'instance') = ("role_assignments"."organization_id" is null)),
	CONSTRAINT "role_assignments_principal" CHECK (("role_assignments"."principal_kind" in ('account', 'group')) = ("role_assignments"."principal_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "home_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "inactivity_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "break_glass_accesses" ADD CONSTRAINT "break_glass_accesses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_accesses" ADD CONSTRAINT "break_glass_accesses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_managers" ADD CONSTRAINT "group_managers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_managers" ADD CONSTRAINT "group_managers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_responsible_account_id_accounts_id_fk" FOREIGN KEY ("responsible_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_responsible_account_id_accounts_id_fk" FOREIGN KEY ("responsible_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_tokens" ADD CONSTRAINT "registration_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "break_glass_accesses_account_id_organization_id_index" ON "break_glass_accesses" USING btree ("account_id","organization_id");--> statement-breakpoint
CREATE INDEX "break_glass_accesses_expires_at_index" ON "break_glass_accesses" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_name_unique" ON "custom_roles" USING btree ("scope",coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "group_managers_account_id_index" ON "group_managers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "group_members_account_id_index" ON "group_members" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_unique" ON "groups" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_index" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_organization_id_index" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_organization_id_account_id_index" ON "memberships" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE INDEX "memberships_account_id_index" ON "memberships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "memberships_expires_at_index" ON "memberships" USING btree ("expires_at") WHERE "memberships"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "organization_domains_organization_id_index" ON "organization_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "registration_tokens_token_hash_index" ON "registration_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "role_assignments_principal_kind_principal_id_index" ON "role_assignments" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "role_assignments_organization_id_index" ON "role_assignments" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_home_organization_id_organizations_id_fk" FOREIGN KEY ("home_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_home_organization_id_index" ON "accounts" USING btree ("home_organization_id");