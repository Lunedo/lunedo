CREATE TYPE "public"."key_rotation_status" AS ENUM('running', 'completed');--> statement-breakpoint
CREATE TYPE "public"."setting_level" AS ENUM('instance', 'organization', 'space', 'user');--> statement-breakpoint
CREATE TABLE "job_progress" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"done" integer NOT NULL,
	"total" integer,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_rotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_version" integer NOT NULL,
	"status" "key_rotation_status" DEFAULT 'running' NOT NULL,
	"rewrapped" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"level" "setting_level" NOT NULL,
	"scope_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "key_rotations_target_version_index" ON "key_rotations" USING btree ("target_version");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_values_level_scope_id_key_index" ON "setting_values" USING btree ("level","scope_id","key");--> statement-breakpoint
CREATE INDEX "setting_values_key_index" ON "setting_values" USING btree ("key");