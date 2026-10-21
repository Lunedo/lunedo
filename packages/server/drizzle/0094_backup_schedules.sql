CREATE TYPE "public"."backup_alert" AS ENUM('none', 'failing', 'missing');--> statement-breakpoint
CREATE TYPE "public"."backup_class" AS ENUM('daily', 'weekly', 'monthly', 'manual', 'beforeUpdate');--> statement-breakpoint
CREATE TYPE "public"."backup_run_state" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."backup_scope" AS ENUM('all', 'database');--> statement-breakpoint
CREATE TYPE "public"."backup_target_kind" AS ENUM('local', 's3');--> statement-breakpoint
CREATE TYPE "public"."backup_trigger" AS ENUM('scheduled', 'manual', 'beforeUpdate');--> statement-breakpoint
CREATE TYPE "public"."backup_test_restore_stage" AS ENUM('verify', 'restore', 'checks', 'done');--> statement-breakpoint
CREATE TYPE "public"."backup_test_restore_state" AS ENUM('running', 'passed', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_test_restore_trigger" AS ENUM('manual', 'automatic');--> statement-breakpoint
CREATE TABLE "backup_configuration" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"daily_time" text DEFAULT '02:00' NOT NULL,
	"weekly_day" smallint,
	"monthly_day" smallint,
	"keep_daily" integer DEFAULT 7 NOT NULL,
	"keep_weekly" integer DEFAULT 4 NOT NULL,
	"keep_monthly" integer DEFAULT 6 NOT NULL,
	"keep_before_update" integer DEFAULT 3 NOT NULL,
	"scope" "backup_scope" DEFAULT 'all' NOT NULL,
	"before_update" boolean DEFAULT true NOT NULL,
	"missing_days" integer DEFAULT 2 NOT NULL,
	"auto_test_restore" boolean DEFAULT true NOT NULL,
	"target_kind" "backup_target_kind",
	"target_path" text,
	"s3_endpoint" text,
	"s3_region" text,
	"s3_bucket" text,
	"s3_prefix" text DEFAULT '' NOT NULL,
	"s3_force_path_style" boolean DEFAULT false NOT NULL,
	"s3_access_key_id" text,
	"key_confirmed_at" timestamp with time zone,
	"key_confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_configuration_singleton" CHECK ("backup_configuration"."singleton"),
	CONSTRAINT "backup_configuration_time" CHECK ("backup_configuration"."daily_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "backup_configuration_weekly" CHECK ("backup_configuration"."weekly_day" between 1 and 7),
	CONSTRAINT "backup_configuration_monthly" CHECK ("backup_configuration"."monthly_day" between 1 and 31),
	CONSTRAINT "backup_configuration_counts" CHECK ("backup_configuration"."keep_daily" between 1 and 1000 and "backup_configuration"."keep_weekly" between 1 and 1000
        and "backup_configuration"."keep_monthly" between 1 and 1000 and "backup_configuration"."keep_before_update" between 1 and 1000
        and "backup_configuration"."missing_days" between 1 and 365),
	CONSTRAINT "backup_configuration_target" CHECK (("backup_configuration"."target_kind" is null)
        or ("backup_configuration"."target_kind" = 'local' and "backup_configuration"."target_path" is not null)
        or ("backup_configuration"."target_kind" = 's3' and "backup_configuration"."s3_bucket" is not null and "backup_configuration"."s3_region" is not null
          and "backup_configuration"."s3_access_key_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trigger" "backup_trigger" NOT NULL,
	"backup_class" "backup_class" NOT NULL,
	"state" "backup_run_state" NOT NULL,
	"name" text,
	"target" text,
	"size_bytes" bigint,
	"error" text,
	"actor_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"last_slot" timestamp with time zone,
	"enabled_at" timestamp with time zone,
	"alert" "backup_alert" DEFAULT 'none' NOT NULL,
	"alert_notified_at" timestamp with time zone,
	"last_automatic_test_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_state_singleton" CHECK ("backup_state"."singleton")
);
--> statement-breakpoint
CREATE TABLE "backup_test_restores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"backup_name" text NOT NULL,
	"trigger" "backup_test_restore_trigger" NOT NULL,
	"state" "backup_test_restore_state" NOT NULL,
	"stage" "backup_test_restore_stage" NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"actor_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_configuration" ADD CONSTRAINT "backup_configuration_key_confirmed_by_accounts_id_fk" FOREIGN KEY ("key_confirmed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_test_restores" ADD CONSTRAINT "backup_test_restores_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_runs_started_at_index" ON "backup_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "backup_runs_state_finished_at_index" ON "backup_runs" USING btree ("state","finished_at");--> statement-breakpoint
CREATE INDEX "backup_test_restores_backup_name_started_at_index" ON "backup_test_restores" USING btree ("backup_name","started_at");