CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
CREATE TYPE "public"."access_request_status" AS ENUM('open', 'approved', 'declined', 'withdrawn', 'satisfied');--> statement-breakpoint
CREATE TYPE "public"."account_state" AS ENUM('invited', 'active', 'deactivated', 'anonymized', 'placeholder');--> statement-breakpoint
CREATE TYPE "public"."account_token_purpose" AS ENUM('passwordReset', 'emailChange');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('standard', 'guest', 'portal', 'service');--> statement-breakpoint
CREATE TYPE "public"."announcement_severity" AS ENUM('information', 'warning');--> statement-breakpoint
CREATE TYPE "public"."article_review_via" AS ENUM('marked', 'published');--> statement-breakpoint
CREATE TYPE "public"."article_type" AS ENUM('howTo', 'troubleshooting');--> statement-breakpoint
CREATE TYPE "public"."meeting_attendance" AS ENUM('present', 'excused', 'absent');--> statement-breakpoint
CREATE TYPE "public"."audit_scope_type" AS ENUM('instance', 'organization');--> statement-breakpoint
CREATE TYPE "public"."backup_alert" AS ENUM('none', 'failing', 'missing');--> statement-breakpoint
CREATE TYPE "public"."backup_class" AS ENUM('daily', 'weekly', 'monthly', 'manual', 'beforeUpdate');--> statement-breakpoint
CREATE TYPE "public"."backup_run_state" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."backup_scope" AS ENUM('all', 'database');--> statement-breakpoint
CREATE TYPE "public"."backup_target_kind" AS ENUM('local', 's3');--> statement-breakpoint
CREATE TYPE "public"."backup_trigger" AS ENUM('scheduled', 'manual', 'beforeUpdate');--> statement-breakpoint
CREATE TYPE "public"."built_in_role" AS ENUM('owner', 'administrator', 'member', 'securityAuditor');--> statement-breakpoint
CREATE TYPE "public"."challenge_purpose" AS ENUM('secondFactor', 'passkeySignIn', 'passkeyRegistration', 'reauthentication', 'identityLink');--> statement-breakpoint
CREATE TYPE "public"."chat_channel_kind" AS ENUM('teams', 'slack', 'matrix', 'discord', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."chat_channel_state" AS ENUM('working', 'failing');--> statement-breakpoint
CREATE TYPE "public"."chat_delivery_state" AS ENUM('pending', 'delivered', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."copy_state" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."discard_reason" AS ENUM('discarded', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."display_version_state" AS ENUM('pending', 'done', 'none', 'tooLarge', 'failed');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('archive', 'html', 'markdown', 'print', 'pdf', 'docx', 'site');--> statement-breakpoint
CREATE TYPE "public"."export_scope" AS ENUM('space', 'pages');--> statement-breakpoint
CREATE TYPE "public"."export_state" AS ENUM('queued', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."identity_credential_kind" AS ENUM('clientSecret', 'certificate', 'samlSigning', 'bindPassword');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_preset" AS ENUM('entraId', 'google', 'generic', 'adfs', 'activeDirectory');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_type" AS ENUM('oidc', 'saml', 'ldap');--> statement-breakpoint
CREATE TYPE "public"."import_state" AS ENUM('draft', 'analyzing', 'ready', 'running', 'held', 'stopping', 'review', 'accepting', 'accepted', 'discarding', 'discarded', 'stopped', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."key_rotation_status" AS ENUM('running', 'completed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_base_audience" AS ENUM('public', 'signedIn', 'groups', 'portal');--> statement-breakpoint
CREATE TYPE "public"."mail_credential_kind" AS ENUM('clientSecret', 'certificate');--> statement-breakpoint
CREATE TYPE "public"."mail_status" AS ENUM('pending', 'sending', 'failed');--> statement-breakpoint
CREATE TYPE "public"."managed_account_source" AS ENUM('identity', 'domain');--> statement-breakpoint
CREATE TYPE "public"."mapping_target" AS ENUM('organization', 'instance');--> statement-breakpoint
CREATE TYPE "public"."meeting_reminder" AS ENUM('off', 'oneDay', 'twoDays', 'oneWeek');--> statement-breakpoint
CREATE TYPE "public"."meeting_state" AS ENUM('upcoming', 'closed', 'reopened', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."membership_kind" AS ENUM('member', 'collaborator', 'guest');--> statement-breakpoint
CREATE TYPE "public"."notification_email_status" AS ENUM('immediate', 'digest', 'sent', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."page_mode" AS ENUM('publish', 'live');--> statement-breakpoint
CREATE TYPE "public"."page_status_color" AS ENUM('neutral', 'accent', 'info', 'success', 'warning', 'danger');--> statement-breakpoint
CREATE TYPE "public"."page_width" AS ENUM('fixed', 'full');--> statement-breakpoint
CREATE TYPE "public"."principal_kind" AS ENUM('account', 'group', 'organizationMembers', 'instanceUsers');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('account', 'anonymous', 'system');--> statement-breakpoint
CREATE TYPE "public"."provider_flow_purpose" AS ENUM('signIn', 'reauthentication', 'test', 'linkConfirmation');--> statement-breakpoint
CREATE TYPE "public"."provider_grant_kind" AS ENUM('membership', 'role', 'groupMember');--> statement-breakpoint
CREATE TYPE "public"."page_restriction_kind" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."review_recipients" AS ENUM('owner', 'ownerAndAdministrators');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('instance', 'organization');--> statement-breakpoint
CREATE TYPE "public"."meeting_schedule_source" AS ENUM('manual', 'calendar');--> statement-breakpoint
CREATE TYPE "public"."search_file_text_state" AS ENUM('extracted', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."search_source" AS ENUM('item', 'comment', 'attachment', 'decision');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('full', 'secondFactorSetup');--> statement-breakpoint
CREATE TYPE "public"."setting_level" AS ENUM('instance', 'organization', 'space', 'user');--> statement-breakpoint
CREATE TYPE "public"."setup_completed_through" AS ENUM('assistant', 'configuration');--> statement-breakpoint
CREATE TYPE "public"."share_link_scope" AS ENUM('people', 'organization', 'instance', 'anyone');--> statement-breakpoint
CREATE TYPE "public"."sign_in_method" AS ENUM('password', 'totp', 'passkey', 'recoveryCode', 'identityProvider');--> statement-breakpoint
CREATE TYPE "public"."sign_in_refusal_reason" AS ENUM('accountCreationDisabled', 'domainNotAllowed', 'emailNotVerified', 'groupRequired', 'accountInactive', 'linkDeclined', 'linkUnavailable', 'invalidResponse', 'secondFactorMissing', 'linkAmbiguous');--> statement-breakpoint
CREATE TYPE "public"."space_role" AS ENUM('reader', 'commenter', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."space_type" AS ENUM('standard', 'knowledgeBase');--> statement-breakpoint
CREATE TYPE "public"."space_visibility" AS ENUM('private', 'organization', 'instance');--> statement-breakpoint
CREATE TYPE "public"."stored_file_state" AS ENUM('pending', 'stored', 'ready', 'orphaned');--> statement-breakpoint
CREATE TYPE "public"."provider_sync_status" AS ENUM('running', 'succeeded', 'warnings', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."provider_sync_trigger" AS ENUM('schedule', 'manual', 'scim', 'reconciliation', 'signIn');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('meetings', 'decisions', 'projects', 'engineering', 'operations', 'knowledge', 'teams');--> statement-breakpoint
CREATE TYPE "public"."template_level" AS ENUM('instance', 'organization', 'space');--> statement-breakpoint
CREATE TYPE "public"."backup_test_restore_stage" AS ENUM('verify', 'restore', 'checks', 'done');--> statement-breakpoint
CREATE TYPE "public"."backup_test_restore_state" AS ENUM('running', 'passed', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_test_restore_trigger" AS ENUM('manual', 'automatic');--> statement-breakpoint
CREATE TYPE "public"."meeting_topic_outcome" AS ENUM('resolved', 'decided', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."meeting_topic_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."trash_entry_kind" AS ENUM('items', 'space');--> statement-breakpoint
CREATE TYPE "public"."tree_item_kind" AS ENUM('page', 'folder', 'link', 'blogPost', 'meetingSeries', 'meetingTopic', 'whiteboard');--> statement-breakpoint
CREATE TYPE "public"."version_reason" AS ENUM('published', 'session', 'restored', 'modeChanged', 'imported', 'importedNotApplied', 'copied');--> statement-breakpoint
CREATE TYPE "public"."watch_state" AS ENUM('watching', 'muted', 'notWatching');--> statement-breakpoint
CREATE SEQUENCE "public"."tree_item_numbers" INCREMENT BY 1 MINVALUE 1000 MAXVALUE 9223372036854775807 START WITH 1000 CACHE 1;--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requester_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"item_id" uuid,
	"message" text DEFAULT '' NOT NULL,
	"status" "access_request_status" DEFAULT 'open' NOT NULL,
	"role" "space_role",
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_message_length" CHECK (length("access_requests"."message") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "account_external_ids" (
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_external_ids_organization_id_source_external_id_pk" PRIMARY KEY("organization_id","source","external_id"),
	CONSTRAINT "account_external_ids_length" CHECK (length("account_external_ids"."external_id") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "account_pictures" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" "account_token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"new_email" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "account_type" NOT NULL,
	"state" "account_state" NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_verified_at" timestamp with time zone,
	"home_organization_id" uuid,
	"last_active_at" timestamp with time zone,
	"inactivity_notified_at" timestamp with time zone,
	"second_factor_reset_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"merged_into_id" uuid,
	"job_title" text,
	"picture_ref" text,
	CONSTRAINT "accounts_job_title_length" CHECK (char_length("accounts"."job_title") between 1 and 100)
);
--> statement-breakpoint
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
	"start_signaled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "announcements_scopeId_unique" UNIQUE("scope_id"),
	CONSTRAINT "announcements_scope" CHECK ("announcements"."scope_id" = coalesce("announcements"."organization_id", '00000000-0000-0000-0000-000000000000'::uuid)),
	CONSTRAINT "announcements_period" CHECK ("announcements"."ends_at" > "announcements"."starts_at"),
	CONSTRAINT "announcements_text_length" CHECK (length("announcements"."text") between 1 and 300),
	CONSTRAINT "announcements_link" CHECK (("announcements"."link_url" is null) = ("announcements"."link_label" is null)
        and ("announcements"."link_url" is null or length("announcements"."link_url") <= 2000)
        and ("announcements"."link_label" is null or length("announcements"."link_label") between 1 and 60))
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"revoked_at" timestamp with time zone,
	"expiry_reminded_at" timestamp with time zone,
	"expiry_recorded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unused_noticed_at" timestamp with time zone,
	"content_level" text DEFAULT 'read' NOT NULL,
	"knowledge_base_ids" uuid[],
	CONSTRAINT "api_tokens_content_level" CHECK ("api_tokens"."content_level" in ('read', 'draft', 'publish')),
	CONSTRAINT "api_tokens_knowledge_bases" CHECK ("api_tokens"."knowledge_base_ids" is null or cardinality("api_tokens"."knowledge_base_ids") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "article_renders" (
	"version_id" uuid NOT NULL,
	"language" text NOT NULL,
	"renderer" integer NOT NULL,
	"html" text NOT NULL,
	"headings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_renders_version_id_language_pk" PRIMARY KEY("version_id","language")
);
--> statement-breakpoint
CREATE TABLE "article_review_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"actor_id" uuid,
	"via" "article_review_via" NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"previous_reviewed_by" uuid,
	"previous_state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_reviews" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"interval_months" smallint,
	"published_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"due_at" timestamp with time zone,
	"lead_reminded_at" timestamp with time zone,
	"due_reminded_at" timestamp with time zone,
	"reminders_queued_at" timestamp with time zone,
	"source_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_reviews_interval" CHECK ("article_reviews"."interval_months" in (0, 3, 6, 12))
);
--> statement-breakpoint
CREATE TABLE "article_sources" (
	"article_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"changed_at" timestamp with time zone,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_sources_article_id_source_id_pk" PRIMARY KEY("article_id","source_id"),
	CONSTRAINT "article_sources_distinct" CHECK ("article_sources"."article_id" <> "article_sources"."source_id")
);
--> statement-breakpoint
CREATE TABLE "article_sync" (
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"number" bigint,
	"language" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	"removed_restricted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "article_sync_space_id_item_id_pk" PRIMARY KEY("space_id","item_id"),
	CONSTRAINT "article_sync_removed" CHECK (("article_sync"."removed_at" is null) = ("article_sync"."removed_reason" is null)
        and ("article_sync"."removed_reason" is null or "article_sync"."removed_reason" in ('deleted', 'unpublished', 'moved')))
);
--> statement-breakpoint
CREATE TABLE "article_titles" (
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_titles_item_id_space_id_title_pk" PRIMARY KEY("item_id","space_id","title")
);
--> statement-breakpoint
CREATE TABLE "attachment_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attachment_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"restored_from" integer,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kept" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"current_version_id" uuid,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_version_id" uuid,
	"discarded_draft_id" uuid,
	CONSTRAINT "attachments_name_length" CHECK (length("attachments"."name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "audit_chains" (
	"scope_type" "audit_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"last_hash" "bytea",
	"anchor_sequence" bigint,
	"anchor_hash" "bytea",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_chains_scope_type_scope_id_pk" PRIMARY KEY("scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "audit_confidential_events" (
	"event_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	CONSTRAINT "audit_confidential_events_event_id_space_id_pk" PRIMARY KEY("event_id","space_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_type" "audit_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"name" text NOT NULL,
	"actor_type" "principal_type" NOT NULL,
	"actor_id" uuid,
	"target_type" text NOT NULL,
	"target_id" text,
	"fields" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"request_id" text,
	"client_ip" text,
	"user_agent" text,
	"previous_hash" "bytea" NOT NULL,
	"hash" "bytea" NOT NULL,
	"labels" jsonb,
	"sealed" jsonb
);
--> statement-breakpoint
CREATE TABLE "audit_subject_keys" (
	"subject_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"key" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"address_digest" text
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "challenge_purpose" NOT NULL,
	"token_hash" "bytea",
	"account_id" uuid,
	"session_id" uuid,
	"challenge" text,
	"methods" "sign_in_method"[] DEFAULT '{}' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"device_hash" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
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
	"restored_at" timestamp with time zone,
	"test_restore_cleanup_at" timestamp with time zone,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_started_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blog_post_announcements" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"delivered_through" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"scheduled_by" uuid,
	"scheduled_time_zone" text,
	"published_at" timestamp with time zone,
	"space_pinned_at" timestamp with time zone,
	"space_pinned_by" uuid,
	"organization_pinned_at" timestamp with time zone,
	"organization_pinned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"held_at" timestamp with time zone,
	"cover_attachment_id" uuid,
	"cover_focus_x" real DEFAULT 0.5 NOT NULL,
	"cover_focus_y" real DEFAULT 0.5 NOT NULL,
	CONSTRAINT "blog_posts_cover_focus" CHECK ("blog_posts"."cover_focus_x" between 0 and 1 and "blog_posts"."cover_focus_y" between 0 and 1),
	CONSTRAINT "blog_posts_excerpt_length" CHECK (length("blog_posts"."excerpt") <= 500)
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
CREATE TABLE "category_responsibilities" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_responsible_groups" (
	"item_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_responsible_groups_item_id_group_id_pk" PRIMARY KEY("item_id","group_id")
);
--> statement-breakpoint
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
	"channel_id" uuid,
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
CREATE TABLE "collaboration_clients" (
	"item_id" uuid NOT NULL,
	"client_id" bigint NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaboration_clients_item_id_client_id_pk" PRIMARY KEY("item_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "collaboration_editors" (
	"item_id" uuid NOT NULL,
	"node" text NOT NULL,
	"account_id" uuid NOT NULL,
	"connections" integer NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaboration_editors_item_id_node_account_id_pk" PRIMARY KEY("item_id","node","account_id")
);
--> statement-breakpoint
CREATE TABLE "collaboration_presence" (
	"item_id" uuid NOT NULL,
	"node" text NOT NULL,
	"connections" integer NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaboration_presence_item_id_node_pk" PRIMARY KEY("item_id","node")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" uuid,
	"body" jsonb,
	"quote" text,
	"quote_prefix" text,
	"quote_suffix" text,
	"quote_public" boolean DEFAULT false NOT NULL,
	"detached_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"element_id" text,
	CONSTRAINT "comments_reply_has_no_quote" CHECK ("comments"."parent_id" is null or "comments"."quote" is null),
	CONSTRAINT "comments_reply_has_no_element" CHECK ("comments"."parent_id" is null or "comments"."element_id" is null),
	CONSTRAINT "comments_element_length" CHECK (length("comments"."element_id") <= 128),
	CONSTRAINT "comments_body_kept" CHECK ("comments"."body" is not null or "comments"."deleted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "content_mentions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"comment_id" uuid,
	"account_id" uuid NOT NULL,
	"actor_id" uuid,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_mentions_unique" UNIQUE NULLS NOT DISTINCT("item_id","comment_id","account_id")
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
CREATE TABLE "deleted_space_administrators" (
	"trash_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "deleted_space_administrators_trash_entry_id_account_id_pk" PRIMARY KEY("trash_entry_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "discarded_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"title" text NOT NULL,
	"document" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"reason" "discard_reason" NOT NULL,
	"contributors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"discarded_by" uuid,
	"discarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "display_versions" (
	"source_file_id" uuid NOT NULL,
	"size" text NOT NULL,
	"file_id" uuid NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "display_versions_source_file_id_size_pk" PRIMARY KEY("source_file_id","size"),
	CONSTRAINT "display_versions_size" CHECK ("display_versions"."size" in ('display', 'preview'))
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_id" uuid,
	"started_with_token" boolean DEFAULT false NOT NULL,
	"organization_id" uuid,
	"scope" "export_scope" NOT NULL,
	"space_id" uuid,
	"root_item_id" uuid,
	"name" text NOT NULL,
	"state" "export_state" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"file_id" uuid,
	"file_name" text,
	"size" bigint,
	"error_code" text,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"estimated_size" bigint DEFAULT 0 NOT NULL,
	"format" "export_format" DEFAULT 'archive' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "give_access_drafts" (
	"account_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "give_access_drafts_account_id_space_id_pk" PRIMARY KEY("account_id","space_id")
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"former_provider" text
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"sign_in_name" text,
	"display_name" text,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"groups_read_at" timestamp with time zone,
	"groups_read_failed_at" timestamp with time zone,
	"groups_withheld_notified_at" timestamp with time zone,
	"scim_user_name" text,
	"scim_external_id" text
);
--> statement-breakpoint
CREATE TABLE "identity_groups" (
	"identity_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "identity_groups_identity_id_group_id_pk" PRIMARY KEY("identity_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "identity_provider_ca_certificates" (
	"provider_id" uuid PRIMARY KEY NOT NULL,
	"certificates" text NOT NULL,
	"fingerprint" text NOT NULL,
	"subject" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"kind" "identity_credential_kind" NOT NULL,
	"secret" "bytea" NOT NULL,
	"certificate" text,
	"key_id" text,
	"expires_at" timestamp with time zone,
	"notified_thirty_days_at" timestamp with time zone,
	"notified_seven_days_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"chosen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_provider_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_logos" (
	"provider_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_secrets" (
	"provider_id" uuid PRIMARY KEY NOT NULL,
	"directory_key" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "identity_provider_type" NOT NULL,
	"preset" "identity_provider_preset" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"draft" jsonb,
	"setup_completed_at" timestamp with time zone,
	"groups_claim_seen_at" timestamp with time zone,
	"groups_claim_missing_since" timestamp with time zone,
	CONSTRAINT "identity_providers_config_or_draft" CHECK (("identity_providers"."config" is null) = ("identity_providers"."draft" is not null))
);
--> statement-breakpoint
CREATE TABLE "import_baselines" (
	"space_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" uuid,
	"import_id" uuid,
	"source_version" integer,
	"checksum" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"local" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kept" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_baselines_space_id_kind_source_id_pk" PRIMARY KEY("space_id","kind","source_id"),
	CONSTRAINT "import_baselines_kind" CHECK ("import_baselines"."kind" in ('page', 'template', 'spacePermission'))
);
--> statement-breakpoint
CREATE TABLE "import_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"change" text NOT NULL,
	"item_id" uuid,
	"target_id" uuid,
	"title" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	CONSTRAINT "import_changes_kind" CHECK ("import_changes"."kind" in ('page', 'template', 'comment', 'attachment', 'spacePermission', 'restriction')),
	CONSTRAINT "import_changes_change" CHECK ("import_changes"."change" in ('new', 'updated', 'conflict', 'deleted', 'moved', 'movedHere', 'labels', 'gone', 'permission')),
	CONSTRAINT "import_changes_decision" CHECK ("import_changes"."decision" is null or "import_changes"."decision" in ('lunedo', 'source', 'both', 'trash', 'keep'))
);
--> statement-breakpoint
CREATE TABLE "import_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"site" text NOT NULL,
	"base_path" text DEFAULT '' NOT NULL,
	"email" text,
	"token" "bytea" NOT NULL,
	"ca_certificates" text,
	"account_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_connections_kind" CHECK ("import_connections"."kind" in ('cloud', 'dataCenter')),
	CONSTRAINT "import_connections_email" CHECK ("import_connections"."kind" = 'dataCenter' or "import_connections"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "import_credentials" (
	"import_id" uuid PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"email" text NOT NULL,
	"token" "bytea" NOT NULL,
	"people" integer,
	"with_email" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_directory" (
	"import_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"email" text,
	CONSTRAINT "import_directory_import_id_external_id_pk" PRIMARY KEY("import_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"import_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_files_import_id_upload_id_pk" PRIMARY KEY("import_id","upload_id")
);
--> statement-breakpoint
CREATE TABLE "import_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"item_id" uuid,
	"restriction" text,
	"holder_kind" text NOT NULL,
	"account_id" uuid,
	"group_key" text,
	"role" "space_role",
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"code" text,
	"applied_at" timestamp with time zone,
	CONSTRAINT "import_grants_restriction" CHECK ("import_grants"."restriction" is null or "import_grants"."restriction" in ('view', 'edit')),
	CONSTRAINT "import_grants_holder_kind" CHECK ("import_grants"."holder_kind" in ('account', 'group', 'organizationMembers', 'anonymous')),
	CONSTRAINT "import_grants_status" CHECK ("import_grants"."status" in ('mapped', 'check', 'missing', 'notTaken'))
);
--> statement-breakpoint
CREATE TABLE "import_groups" (
	"import_id" uuid NOT NULL,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"group_id" uuid,
	"mapped_by" uuid,
	"mapped_at" timestamp with time zone,
	CONSTRAINT "import_groups_import_id_name_key_pk" PRIMARY KEY("import_id","name_key")
);
--> statement-breakpoint
CREATE TABLE "import_items" (
	"import_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_items_import_id_kind_source_id_pk" PRIMARY KEY("import_id","kind","source_id")
);
--> statement-breakpoint
CREATE TABLE "import_problems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"category" text NOT NULL,
	"code" text NOT NULL,
	"key" text NOT NULL,
	"source_kind" text,
	"source_id" text,
	"item_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_records" (
	"import_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"ref" text,
	"parent_id" text,
	"sort" text,
	"ordinal" integer,
	"data" jsonb NOT NULL,
	CONSTRAINT "import_records_import_id_kind_source_id_pk" PRIMARY KEY("import_id","kind","source_id")
);
--> statement-breakpoint
CREATE TABLE "import_reviewers" (
	"import_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_reviewers_import_id_account_id_pk" PRIMARY KEY("import_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "import_titles" (
	"space_id" uuid NOT NULL,
	"space_key" text NOT NULL,
	"title_key" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "import_titles_space_id_space_key_title_key_source_id_pk" PRIMARY KEY("space_id","space_key","title_key","source_id")
);
--> statement-breakpoint
CREATE TABLE "import_upload_parts" (
	"upload_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_upload_parts_upload_id_number_pk" PRIMARY KEY("upload_id","number")
);
--> statement-breakpoint
CREATE TABLE "import_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"part_size" integer NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"digest" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_uploads_size" CHECK ("import_uploads"."size" > 0),
	CONSTRAINT "import_uploads_name" CHECK (length("import_uploads"."name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "imported_spaces" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid,
	"source" text NOT NULL,
	"source_space_id" text NOT NULL,
	"source_space_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"importer_id" uuid NOT NULL,
	"source" text NOT NULL,
	"state" "import_state" DEFAULT 'draft' NOT NULL,
	"draft_step" smallint DEFAULT 0 NOT NULL,
	"file_kind" text,
	"upload_id" uuid,
	"folder_file" text,
	"space_name" text,
	"space_key" text,
	"archived" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"phase" text,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"found" jsonb,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quarantine_space_id" uuid,
	"error_code" text,
	"stop_requested_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"file_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"history" boolean DEFAULT false NOT NULL,
	"people_source" text,
	"token_deleted_at" timestamp with time zone,
	"target_space_id" uuid,
	"folder_key" text,
	"connection_id" uuid,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"staged_bytes" bigint DEFAULT 0 NOT NULL,
	"throttled_until" timestamp with time zone,
	CONSTRAINT "imports_file_kind" CHECK ("imports"."file_kind" is null or "imports"."file_kind" in ('upload', 'folder', 'uploads', 'connection')),
	CONSTRAINT "imports_draft_step" CHECK ("imports"."draft_step" between 0 and 10),
	CONSTRAINT "imports_people_source" CHECK ("imports"."people_source" is null or "imports"."people_source" in ('token', 'list', 'skip', 'source'))
);
--> statement-breakpoint
CREATE TABLE "instance" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"owner_account_id" uuid,
	"setup_completed_at" timestamp with time zone,
	"setup_completed_through" "setup_completed_through",
	"setup_code_hash" "bytea",
	"setup_code_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_single_row" CHECK ("instance"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "instance_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"value" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_shares" (
	"invitation_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"role" "space_role" NOT NULL,
	"include_descendants" boolean DEFAULT false NOT NULL,
	"shared_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_shares_invitation_id_item_id_pk" PRIMARY KEY("invitation_id","item_id"),
	CONSTRAINT "invitation_shares_role" CHECK ("invitation_shares"."role" <> 'admin')
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
CREATE TABLE "item_copies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid,
	"source_item_id" uuid,
	"target_space_id" uuid,
	"target_parent_id" uuid,
	"placement" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"descendants" boolean NOT NULL,
	"title" text NOT NULL,
	"state" "copy_state" DEFAULT 'queued' NOT NULL,
	"access" text DEFAULT '' NOT NULL,
	"wider_access" boolean DEFAULT false NOT NULL,
	"job_id" uuid,
	"total" integer DEFAULT 0 NOT NULL,
	"copied" integer DEFAULT 0 NOT NULL,
	"hidden" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"root_copy_id" uuid,
	"error_code" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_ownership_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"previous_owner_id" uuid,
	"owner_id" uuid,
	"actor_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "knowledge_base_categories" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"icon" text,
	"contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_base_categories_icon" CHECK ("knowledge_base_categories"."icon" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length("knowledge_base_categories"."icon") <= 60),
	CONSTRAINT "knowledge_base_categories_contact_length" CHECK (length("knowledge_base_categories"."contact_email") <= 254)
);
--> statement-breakpoint
CREATE TABLE "knowledge_base_logos" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base_paths" (
	"path" text PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"portal_path" text NOT NULL,
	"portal_domain" text,
	"brand_color" text DEFAULT 'petrol' NOT NULL,
	"brand_light" text,
	"brand_dark" text,
	"welcome_heading" text DEFAULT '' NOT NULL,
	"welcome_text" text DEFAULT '' NOT NULL,
	"top_bar_threshold" integer DEFAULT 10 NOT NULL,
	"powered_by" boolean DEFAULT true NOT NULL,
	"feedback_retention_months" integer DEFAULT 12 NOT NULL,
	"logo_ref" text,
	"review_interval_months" smallint,
	"review_lead_days" smallint DEFAULT 14 NOT NULL,
	"review_recipients" "review_recipients" DEFAULT 'owner' NOT NULL,
	"default_language" text DEFAULT 'en' NOT NULL,
	"languages" text[] DEFAULT '{en}'::text[] NOT NULL,
	CONSTRAINT "knowledge_bases_languages" CHECK ("knowledge_bases"."default_language" = any("knowledge_bases"."languages") and cardinality("knowledge_bases"."languages") between 1 and 30
        and "knowledge_bases"."default_language" ~ '^[a-z]{2}$'),
	CONSTRAINT "knowledge_bases_contact_length" CHECK (length("knowledge_bases"."contact_email") <= 254),
	CONSTRAINT "knowledge_bases_review_interval" CHECK ("knowledge_bases"."review_interval_months" in (3, 6, 12)),
	CONSTRAINT "knowledge_bases_review_lead" CHECK ("knowledge_bases"."review_lead_days" in (0, 7, 14, 30)),
	CONSTRAINT "knowledge_bases_portal_path" CHECK ("knowledge_bases"."portal_path" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("knowledge_bases"."portal_path") <= 60),
	CONSTRAINT "knowledge_bases_brand" CHECK (("knowledge_bases"."brand_color" = 'custom') = ("knowledge_bases"."brand_light" is not null and "knowledge_bases"."brand_dark" is not null)
        and ("knowledge_bases"."brand_light" is null or "knowledge_bases"."brand_light" ~ '^#[0-9A-F]{6}$')
        and ("knowledge_bases"."brand_dark" is null or "knowledge_bases"."brand_dark" ~ '^#[0-9A-F]{6}$')),
	CONSTRAINT "knowledge_bases_welcome_length" CHECK (length("knowledge_bases"."welcome_heading") <= 120 and length("knowledge_bases"."welcome_text") <= 400),
	CONSTRAINT "knowledge_bases_top_bar_threshold" CHECK ("knowledge_bases"."top_bar_threshold" between 1 and 100),
	CONSTRAINT "knowledge_bases_feedback_retention" CHECK ("knowledge_bases"."feedback_retention_months" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "known_devices" (
	"account_id" uuid NOT NULL,
	"device_hash" "bytea" NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_devices_account_id_device_hash_pk" PRIMARY KEY("account_id","device_hash")
);
--> statement-breakpoint
CREATE TABLE "mail_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "mail_credential_kind" NOT NULL,
	"secret" "bytea" NOT NULL,
	"certificate" text,
	"key_id" text,
	"expires_at" timestamp with time zone,
	"notified_thirty_days_at" timestamp with time zone,
	"notified_seven_days_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_delivery_status" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_code" text,
	"last_failure_response_code" integer,
	"last_failure_step" text,
	"failed_attempts" bigint DEFAULT 0 NOT NULL,
	"failed_messages" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "mail_delivery_status_single_row" CHECK ("mail_delivery_status"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"message" "bytea",
	"status" "mail_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_sends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sender" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"block_sign_in" boolean DEFAULT false NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_ended_at" timestamp with time zone,
	CONSTRAINT "maintenance_state_singleton" CHECK ("maintenance_state"."singleton"),
	CONSTRAINT "maintenance_state_message" CHECK (char_length("maintenance_state"."message") <= 500)
);
--> statement-breakpoint
CREATE TABLE "managed_accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"source" "managed_account_source" NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL
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
	"reminder" "meeting_reminder" DEFAULT 'oneDay' NOT NULL,
	"overview_layout" jsonb,
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
	"agenda_position" text COLLATE "C",
	"one_off" boolean DEFAULT false NOT NULL,
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
	"reminded_at" timestamp with time zone,
	"extra" boolean DEFAULT false NOT NULL,
	CONSTRAINT "meetings_closed" CHECK (("meetings"."state" in ('closed', 'skipped')) = ("meetings"."closed_at" is not null) or "meetings"."state" = 'reopened')
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
	"read_at" timestamp with time zone,
	"actor_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email_status" "notification_email_status",
	"email_pending_since" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operations_error_events" (
	"hour" timestamp with time zone NOT NULL,
	"service" text NOT NULL,
	"type" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"count" integer NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operations_error_events_hour_service_type_code_pk" PRIMARY KEY("hour","service","type","code"),
	CONSTRAINT "operations_error_events_count" CHECK ("operations_error_events"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "organization_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_logos" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"ref" text NOT NULL,
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
CREATE TABLE "page_documents" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_title" text,
	"versioned_revision" bigint DEFAULT 0 NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_note" text
);
--> statement-breakpoint
CREATE TABLE "page_excerpts" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_labels" (
	"item_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_labels_item_id_label_pk" PRIMARY KEY("item_id","label"),
	CONSTRAINT "page_labels_format" CHECK ("page_labels"."label" = lower("page_labels"."label") and length("page_labels"."label") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "page_links" (
	"source_item_id" uuid NOT NULL,
	"target_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_links_source_item_id_target_item_id_pk" PRIMARY KEY("source_item_id","target_item_id")
);
--> statement-breakpoint
CREATE TABLE "page_properties" (
	"item_id" uuid NOT NULL,
	"block" integer NOT NULL,
	"position" integer NOT NULL,
	"set_id" text,
	"key" text NOT NULL,
	"key_normalized" text NOT NULL,
	"value" jsonb NOT NULL,
	"text" text NOT NULL,
	"sort_key" text COLLATE "C" NOT NULL,
	CONSTRAINT "page_properties_item_id_block_position_pk" PRIMARY KEY("item_id","block","position"),
	CONSTRAINT "page_properties_key" CHECK (length("page_properties"."key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "page_restriction_holders" (
	"item_id" uuid NOT NULL,
	"kind" "page_restriction_kind" NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_restriction_holders_item_id_kind_principal_kind_principal_id_pk" PRIMARY KEY("item_id","kind","principal_kind","principal_id"),
	CONSTRAINT "page_restriction_holders_principal" CHECK ("page_restriction_holders"."principal_kind" in ('account', 'group'))
);
--> statement-breakpoint
CREATE TABLE "page_restrictions" (
	"item_id" uuid NOT NULL,
	"kind" "page_restriction_kind" NOT NULL,
	"set_by" uuid,
	"orphaned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_restrictions_item_id_kind_pk" PRIMARY KEY("item_id","kind")
);
--> statement-breakpoint
CREATE TABLE "page_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid NOT NULL,
	"role" "space_role" NOT NULL,
	"include_descendants" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_shares_principal" CHECK ("page_shares"."principal_kind" in ('account', 'group')),
	CONSTRAINT "page_shares_role" CHECK ("page_shares"."role" <> 'admin')
);
--> statement-breakpoint
CREATE TABLE "page_status_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"status_id" uuid,
	"built_in" text,
	"name" text,
	"color" "page_status_color",
	"actor_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_status_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"built_in" text,
	"name" text,
	"color" "page_status_color" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_status_values_named" CHECK ("page_status_values"."built_in" is not null or "page_status_values"."name" is not null),
	CONSTRAINT "page_status_values_built_in" CHECK ("page_status_values"."built_in" is null or "page_status_values"."built_in" in ('roughDraft', 'inProgress', 'readyForReview', 'verified')),
	CONSTRAINT "page_status_values_name_length" CHECK ("page_status_values"."name" is null or length("page_status_values"."name") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "page_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"level" "template_level" NOT NULL,
	"organization_id" uuid,
	"space_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "template_category" NOT NULL,
	"title" text NOT NULL,
	"document" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"fields" jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"series" jsonb,
	"files_adopted" boolean DEFAULT true NOT NULL,
	"article_type" "article_type",
	CONSTRAINT "page_templates_scope" CHECK (("page_templates"."level" = 'instance' and "page_templates"."organization_id" is null and "page_templates"."space_id" is null)
        or ("page_templates"."level" = 'organization' and "page_templates"."organization_id" is not null and "page_templates"."space_id" is null)
        or ("page_templates"."level" = 'space' and "page_templates"."space_id" is not null and "page_templates"."organization_id" is null))
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"document" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reason" "version_reason" NOT NULL,
	"restored_from" integer,
	"revision" bigint NOT NULL,
	"state_vector" "bytea" NOT NULL,
	"contributors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"copied_from_id" uuid,
	"copied_from_title" text,
	CONSTRAINT "page_versions_note_length" CHECK (length("page_versions"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "portal_article_views" (
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "portal_article_views_item_id_day_pk" PRIMARY KEY("item_id","day"),
	CONSTRAINT "portal_article_views_positive" CHECK ("portal_article_views"."views" >= 0)
);
--> statement-breakpoint
CREATE TABLE "portal_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_domains_domain" CHECK ("portal_domains"."domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$' and length("portal_domains"."domain") <= 253)
);
--> statement-breakpoint
CREATE TABLE "portal_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "portal_feedback_text" CHECK (length("portal_feedback"."text") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "portal_handoff_consents" (
	"account_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_handoff_consents_account_id_domain_pk" PRIMARY KEY("account_id","domain")
);
--> statement-breakpoint
CREATE TABLE "portal_handoffs" (
	"code_hash" "bytea" PRIMARY KEY NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"domain" text NOT NULL,
	"session_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_invitations" (
	"invitation_id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_path_reservations" (
	"path" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_ratings" (
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"helpful" integer DEFAULT 0 NOT NULL,
	"unhelpful" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "portal_ratings_item_id_day_pk" PRIMARY KEY("item_id","day"),
	CONSTRAINT "portal_ratings_positive" CHECK ("portal_ratings"."helpful" >= 0 and "portal_ratings"."unhelpful" >= 0)
);
--> statement-breakpoint
CREATE TABLE "portal_readers" (
	"space_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_readers_space_id_account_id_pk" PRIMARY KEY("space_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "portal_search_months" (
	"space_id" uuid NOT NULL,
	"term" text NOT NULL,
	"month" date NOT NULL,
	"searches" integer NOT NULL,
	"zero_results" integer NOT NULL,
	CONSTRAINT "portal_search_months_space_id_month_term_pk" PRIMARY KEY("space_id","month","term"),
	CONSTRAINT "portal_search_months_term" CHECK (length("portal_search_months"."term") between 1 and 200),
	CONSTRAINT "portal_search_months_month" CHECK ("portal_search_months"."month" = date_trunc('month', "portal_search_months"."month")),
	CONSTRAINT "portal_search_months_counts" CHECK ("portal_search_months"."searches" > 0 and "portal_search_months"."zero_results" between 0 and "portal_search_months"."searches")
);
--> statement-breakpoint
CREATE TABLE "portal_searches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"term" text NOT NULL,
	"results" integer NOT NULL,
	"category_id" uuid,
	"zero_results" boolean GENERATED ALWAYS AS (results = 0) STORED NOT NULL,
	"searched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_searches_term" CHECK (length("portal_searches"."term") between 1 and 200),
	CONSTRAINT "portal_searches_results" CHECK ("portal_searches"."results" >= 0),
	CONSTRAINT "portal_searches_hour" CHECK ("portal_searches"."searched_at" = date_trunc('hour', "portal_searches"."searched_at"))
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"session_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "private_space_grant_removals" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"grants" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_deactivations" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_flows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "provider_flow_purpose" NOT NULL,
	"provider_id" uuid NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"browser_hash" "bytea" NOT NULL,
	"nonce" text,
	"code_verifier" text,
	"redirect_uri" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"session_id" uuid,
	"return_to" text,
	"result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"saml_response" text,
	"challenge_id" uuid,
	"saml_place_key" text,
	"saml_place_window" text
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_logout_tokens" (
	"provider_id" uuid NOT NULL,
	"token_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_logout_tokens_provider_id_token_id_pk" PRIMARY KEY("provider_id","token_id")
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
	"error" text,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"held_deactivations" integer,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_run_id" uuid
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
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"item_id" uuid NOT NULL,
	"comment_id" uuid,
	"account_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_unique" UNIQUE NULLS NOT DISTINCT("item_id","comment_id","account_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "recent_searches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"query" text NOT NULL,
	"filters" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recent_views" (
	"account_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "recent_views_account_id_item_id_pk" PRIMARY KEY("account_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "knowledge_base_required_sections" (
	"space_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"section_key" text NOT NULL,
	"section_title" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_base_required_sections_space_id_template_id_section_key_pk" PRIMARY KEY("space_id","template_id","section_key"),
	CONSTRAINT "knowledge_base_required_sections_key" CHECK ("knowledge_base_required_sections"."section_key" ~ '^[a-z][a-zA-Z0-9]{0,39}$')
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
CREATE TABLE "saml_assertions" (
	"provider_id" uuid NOT NULL,
	"assertion_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "saml_assertions_provider_id_assertion_id_pk" PRIMARY KEY("provider_id","assertion_id")
);
--> statement-breakpoint
CREATE TABLE "saml_metadata" (
	"provider_id" uuid PRIMARY KEY NOT NULL,
	"xml" text NOT NULL,
	"entity_id" text NOT NULL,
	"sso_url" text NOT NULL,
	"certificates" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"refresh_failed_at" timestamp with time zone,
	"refresh_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"prefix" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"space_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source" "search_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"content_type" text NOT NULL,
	"title" text NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"anchor" text,
	"body" text NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text,
	"language" text NOT NULL,
	"config" text NOT NULL,
	"author_id" uuid,
	"content_created_at" timestamp with time zone NOT NULL,
	"content_updated_at" timestamp with time zone NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"readers" text[] NOT NULL,
	"restrictions" uuid[] NOT NULL,
	"document" "tsvector" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context_item_id" uuid,
	"context_readers" text[],
	"context_restrictions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"attachment" jsonb,
	CONSTRAINT "search_chunks_position" CHECK ("search_chunks"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "search_file_texts" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"extractor_version" integer NOT NULL,
	"state" "search_file_text_state" NOT NULL,
	"reason" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_file_texts_reason" CHECK (("search_file_texts"."state" = 'skipped') = ("search_file_texts"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "search_index_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"building_since" timestamp with time zone,
	"build_total" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_index_state_single_row" CHECK ("search_index_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "search_item_terms" (
	"organization_id" uuid NOT NULL,
	"word" text NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "search_item_terms_organization_id_word_item_id_pk" PRIMARY KEY("organization_id","word","item_id")
);
--> statement-breakpoint
CREATE TABLE "search_pending_items" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_pending_spaces" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_terms" (
	"organization_id" uuid NOT NULL,
	"word" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_terms_organization_id_word_pk" PRIMARY KEY("organization_id","word")
);
--> statement-breakpoint
CREATE TABLE "service_account_responsibles" (
	"service_account_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_account_responsibles_service_account_id_account_id_pk" PRIMARY KEY("service_account_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unattended_notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"kind" "session_kind" NOT NULL,
	"device_hash" "bytea",
	"methods" "sign_in_method"[] NOT NULL,
	"client_ip" text,
	"browser" text,
	"operating_system" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reauthenticated_at" timestamp with time zone,
	"identity_id" uuid,
	"provider_session_id" text
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
CREATE TABLE "setup_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"origin" text NOT NULL,
	CONSTRAINT "setup_sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "setup_steps" (
	"step" text PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_link_accesses" (
	"link_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_link_accesses_link_id_account_id_pk" PRIMARY KEY("link_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "share_link_people" (
	"link_id" uuid NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_link_people_link_id_principal_kind_principal_id_pk" PRIMARY KEY("link_id","principal_kind","principal_id"),
	CONSTRAINT "share_link_people_principal" CHECK ("share_link_people"."principal_kind" in ('account', 'group'))
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"lookup" text NOT NULL,
	"secret_hash" "bytea" NOT NULL,
	"scope" "share_link_scope" NOT NULL,
	"password_hash" text,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"secret" "bytea",
	CONSTRAINT "share_links_anyone_expires" CHECK ("share_links"."scope" <> 'anyone' or "share_links"."expires_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "sign_in_failures" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"first_failure_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"lockouts" integer DEFAULT 0 NOT NULL,
	"last_lockout_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_in_refusals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"provider_id" uuid,
	"reason" "sign_in_refusal_reason" NOT NULL,
	"subject" text,
	"email" text,
	"display_name" text,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_key_aliases" (
	"key" text PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid,
	"role" "space_role" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_permissions_holder_unique" UNIQUE NULLS NOT DISTINCT("space_id","principal_kind","principal_id"),
	CONSTRAINT "space_permissions_principal" CHECK (("space_permissions"."principal_kind" in ('account', 'group')) = ("space_permissions"."principal_id" is not null))
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
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"personal_of" uuid,
	"owner_account_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" "space_visibility" DEFAULT 'private' NOT NULL,
	"overview_item_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"deleted_at" timestamp with time zone,
	"discoverable" boolean DEFAULT false NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"one_on_one" boolean DEFAULT false NOT NULL,
	"quarantined" boolean DEFAULT false NOT NULL,
	"type" "space_type" DEFAULT 'standard' NOT NULL,
	"audience" "knowledge_base_audience",
	"orphaned_at" timestamp with time zone,
	CONSTRAINT "spaces_key_format" CHECK ("spaces"."key" ~ '^[A-Z0-9]{2,10}$'),
	CONSTRAINT "spaces_personal_or_organization" CHECK (("spaces"."personal_of" is null) <> ("spaces"."organization_id" is null)),
	CONSTRAINT "spaces_personal_private" CHECK ("spaces"."personal_of" is null or "spaces"."visibility" = 'private'),
	CONSTRAINT "spaces_confidential_private" CHECK (not "spaces"."confidential" or ("spaces"."visibility" = 'private' and not "spaces"."discoverable" and "spaces"."personal_of" is null)),
	CONSTRAINT "spaces_one_on_one_confidential" CHECK (not "spaces"."one_on_one" or "spaces"."confidential"),
	CONSTRAINT "spaces_knowledge_base_audience" CHECK (("spaces"."type" = 'knowledgeBase') = ("spaces"."audience" is not null)),
	CONSTRAINT "spaces_knowledge_base_visibility" CHECK ("spaces"."audience" is null or "spaces"."visibility" = (case when "spaces"."audience" in ('public', 'signedIn')
        then 'instance' else 'private' end)::space_visibility),
	CONSTRAINT "spaces_knowledge_base_shared" CHECK ("spaces"."type" = 'standard' or (not "spaces"."confidential" and "spaces"."personal_of" is null)),
	CONSTRAINT "spaces_quarantine_private" CHECK (not "spaces"."quarantined" or ("spaces"."visibility" = 'private' and not "spaces"."discoverable" and "spaces"."personal_of" is null and not "spaces"."confidential"))
);
--> statement-breakpoint
CREATE TABLE "stars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"item_id" uuid,
	"space_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stars_one_target" CHECK (("stars"."item_id" is null) <> ("stars"."space_id" is null))
);
--> statement-breakpoint
CREATE TABLE "storage_reconcile_deltas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run" uuid NOT NULL,
	"key" text NOT NULL,
	"delta" bigint NOT NULL,
	"pages" integer NOT NULL,
	"fetching" boolean NOT NULL,
	"done" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reconciled_at" timestamp with time zone,
	"active_level" smallint DEFAULT 0 NOT NULL,
	"reached_level" smallint DEFAULT 0 NOT NULL,
	"notified_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconcile_run" uuid,
	"reconcile_pages" integer DEFAULT 0 NOT NULL,
	"reconcile_fetching" boolean DEFAULT false NOT NULL,
	"reconcile_done" boolean DEFAULT false NOT NULL,
	CONSTRAINT "storage_state_singleton" CHECK ("storage_state"."singleton"),
	CONSTRAINT "storage_state_levels" CHECK ("storage_state"."active_level" between 0 and 3 and "storage_state"."reached_level" between 0 and 3),
	CONSTRAINT "storage_state_used" CHECK ("storage_state"."used_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"master_key_version" integer,
	"state" "stored_file_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_digest" "bytea",
	"display_version_state" "display_version_state",
	"display_version_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_status_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"done" boolean NOT NULL,
	"actor_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"assignee_id" uuid,
	"due_date" date,
	"text" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid,
	"notified_assignee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "template_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_files_name_length" CHECK (length("template_files"."name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "template_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"level" "template_level" NOT NULL,
	"organization_id" uuid,
	"space_id" uuid,
	"file_name" text NOT NULL,
	"templates" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"secret" "bytea" NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trash_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" "trash_entry_kind" NOT NULL,
	"root_item_id" uuid,
	"title" text NOT NULL,
	"item_kind" "tree_item_kind",
	"descendants" integer DEFAULT 0 NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"purging" boolean DEFAULT false NOT NULL,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_two_at" timestamp with time zone,
	CONSTRAINT "trash_entries_stage" CHECK ("trash_entries"."stage" in (1, 2)),
	CONSTRAINT "trash_entries_root" CHECK (("trash_entries"."kind" = 'items') = ("trash_entries"."root_item_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "tree_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "tree_item_kind" NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"width" "page_width" DEFAULT 'fixed' NOT NULL,
	"link_item_id" uuid,
	"link_url" text,
	"creator_id" uuid,
	"owner_id" uuid,
	"content_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" "page_mode" DEFAULT 'live' NOT NULL,
	"published_version_id" uuid,
	"trash_entry_id" uuid,
	"archived_root_id" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"restore_parent_id" uuid,
	"restore_position" text COLLATE "C",
	"reader_visible" boolean DEFAULT true NOT NULL,
	"path" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status_id" uuid,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid,
	"content_language" text,
	"number_headings" boolean DEFAULT false NOT NULL,
	"article_type" "article_type",
	"template_id" text,
	"translation_of" uuid,
	"number" bigint DEFAULT nextval('tree_item_numbers') NOT NULL,
	CONSTRAINT "tree_items_translation" CHECK ("tree_items"."translation_of" is null or ("tree_items"."kind" = 'page' and "tree_items"."content_language" is not null)),
	CONSTRAINT "tree_items_link_target" CHECK (("tree_items"."kind" = 'link') = ("tree_items"."link_item_id" is not null or "tree_items"."link_url" is not null)),
	CONSTRAINT "tree_items_not_own_parent" CHECK ("tree_items"."parent_id" is distinct from "tree_items"."id")
);
--> statement-breakpoint
CREATE TABLE "update_check_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"checked_at" timestamp with time zone,
	"succeeded" boolean DEFAULT false NOT NULL,
	"failure" text,
	"releases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_version" text,
	CONSTRAINT "update_check_state_singleton" CHECK ("update_check_state"."singleton")
);
--> statement-breakpoint
CREATE TABLE "watches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"space_id" uuid,
	"item_id" uuid,
	"state" "watch_state" NOT NULL,
	"keep_actionable" boolean DEFAULT true NOT NULL,
	"automatic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watches_one_target" CHECK (("watches"."space_id" is null) <> ("watches"."item_id" is null))
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint NOT NULL,
	"transports" text[] DEFAULT '{}' NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"name" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whiteboard_documents" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"scene" jsonb NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"versioned_revision" bigint DEFAULT 0 NOT NULL,
	"preview_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whiteboard_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whiteboard_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"scene" jsonb NOT NULL,
	"reason" "version_reason" NOT NULL,
	"restored_from" integer,
	"revision" bigint NOT NULL,
	"state_vector" "bytea" NOT NULL,
	"preview_id" uuid,
	"contributors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"copied_from_id" uuid,
	"copied_from_title" text,
	CONSTRAINT "whiteboard_versions_number_positive" CHECK ("whiteboard_versions"."number" > 0)
);
--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_id_accounts_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_external_ids" ADD CONSTRAINT "account_external_ids_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_external_ids" ADD CONSTRAINT "account_external_ids_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_pictures" ADD CONSTRAINT "account_pictures_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_pictures" ADD CONSTRAINT "account_pictures_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_home_organization_id_organizations_id_fk" FOREIGN KEY ("home_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_merged_into_id_accounts_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_renders" ADD CONSTRAINT "article_renders_version_id_page_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."page_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_review_events" ADD CONSTRAINT "article_review_events_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_review_events" ADD CONSTRAINT "article_review_events_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_review_events" ADD CONSTRAINT "article_review_events_previous_reviewed_by_accounts_id_fk" FOREIGN KEY ("previous_reviewed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_reviewed_by_accounts_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_article_id_tree_items_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_source_id_tree_items_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sync" ADD CONSTRAINT "article_sync_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_titles" ADD CONSTRAINT "article_titles_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_titles" ADD CONSTRAINT "article_titles_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_uploaded_by_accounts_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_current_version_id_attachment_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."attachment_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_published_version_id_attachment_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."attachment_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_discarded_draft_id_discarded_drafts_id_fk" FOREIGN KEY ("discarded_draft_id") REFERENCES "public"."discarded_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_by_accounts_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_confidential_events" ADD CONSTRAINT "audit_confidential_events_event_id_audit_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."audit_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_configuration" ADD CONSTRAINT "backup_configuration_key_confirmed_by_accounts_id_fk" FOREIGN KEY ("key_confirmed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_test_restores" ADD CONSTRAINT "backup_test_restores_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_announcements" ADD CONSTRAINT "blog_post_announcements_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_scheduled_by_accounts_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_cover_attachment_id_attachments_id_fk" FOREIGN KEY ("cover_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_space_pinned_by_accounts_id_fk" FOREIGN KEY ("space_pinned_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_organization_pinned_by_accounts_id_fk" FOREIGN KEY ("organization_pinned_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_subscriptions" ADD CONSTRAINT "blog_subscriptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_subscriptions" ADD CONSTRAINT "blog_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_accesses" ADD CONSTRAINT "break_glass_accesses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_accesses" ADD CONSTRAINT "break_glass_accesses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_responsibilities" ADD CONSTRAINT "category_responsibilities_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_responsibilities" ADD CONSTRAINT "category_responsibilities_set_by_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_responsible_groups" ADD CONSTRAINT "category_responsible_groups_item_id_category_responsibilities_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."category_responsibilities"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_responsible_groups" ADD CONSTRAINT "category_responsible_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD CONSTRAINT "chat_deliveries_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_clients" ADD CONSTRAINT "collaboration_clients_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_clients" ADD CONSTRAINT "collaboration_clients_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_editors" ADD CONSTRAINT "collaboration_editors_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_editors" ADD CONSTRAINT "collaboration_editors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_presence" ADD CONSTRAINT "collaboration_presence_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_accounts_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_by_accounts_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_topic_id_tree_items_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_space_administrators" ADD CONSTRAINT "deleted_space_administrators_trash_entry_id_trash_entries_id_fk" FOREIGN KEY ("trash_entry_id") REFERENCES "public"."trash_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_space_administrators" ADD CONSTRAINT "deleted_space_administrators_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discarded_drafts" ADD CONSTRAINT "discarded_drafts_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discarded_drafts" ADD CONSTRAINT "discarded_drafts_discarded_by_accounts_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_versions" ADD CONSTRAINT "display_versions_source_file_id_stored_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_versions" ADD CONSTRAINT "display_versions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_root_item_id_tree_items_id_fk" FOREIGN KEY ("root_item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "give_access_drafts" ADD CONSTRAINT "give_access_drafts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "give_access_drafts" ADD CONSTRAINT "give_access_drafts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_managers" ADD CONSTRAINT "group_managers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_managers" ADD CONSTRAINT "group_managers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_groups" ADD CONSTRAINT "identity_groups_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_groups" ADD CONSTRAINT "identity_groups_group_id_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."provider_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_ca_certificates" ADD CONSTRAINT "identity_provider_ca_certificates_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_credentials" ADD CONSTRAINT "identity_provider_credentials_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_domains" ADD CONSTRAINT "identity_provider_domains_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_logos" ADD CONSTRAINT "identity_provider_logos_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_secrets" ADD CONSTRAINT "identity_provider_secrets_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_baselines" ADD CONSTRAINT "import_baselines_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_baselines" ADD CONSTRAINT "import_baselines_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_applied_by_accounts_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_connections" ADD CONSTRAINT "import_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_credentials" ADD CONSTRAINT "import_credentials_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_directory" ADD CONSTRAINT "import_directory_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_upload_id_import_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."import_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_grants" ADD CONSTRAINT "import_grants_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_grants" ADD CONSTRAINT "import_grants_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_grants" ADD CONSTRAINT "import_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_groups" ADD CONSTRAINT "import_groups_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_groups" ADD CONSTRAINT "import_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_groups" ADD CONSTRAINT "import_groups_mapped_by_accounts_id_fk" FOREIGN KEY ("mapped_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_problems" ADD CONSTRAINT "import_problems_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_problems" ADD CONSTRAINT "import_problems_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reviewers" ADD CONSTRAINT "import_reviewers_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reviewers" ADD CONSTRAINT "import_reviewers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reviewers" ADD CONSTRAINT "import_reviewers_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_titles" ADD CONSTRAINT "import_titles_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_upload_parts" ADD CONSTRAINT "import_upload_parts_upload_id_import_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."import_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_upload_parts" ADD CONSTRAINT "import_upload_parts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_uploads" ADD CONSTRAINT "import_uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_uploads" ADD CONSTRAINT "import_uploads_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_spaces" ADD CONSTRAINT "imported_spaces_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_spaces" ADD CONSTRAINT "imported_spaces_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_importer_id_accounts_id_fk" FOREIGN KEY ("importer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_upload_id_import_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."import_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_connection_id_import_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."import_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_quarantine_space_id_spaces_id_fk" FOREIGN KEY ("quarantine_space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_target_space_id_spaces_id_fk" FOREIGN KEY ("target_space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance" ADD CONSTRAINT "instance_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_shares" ADD CONSTRAINT "invitation_shares_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_shares" ADD CONSTRAINT "invitation_shares_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_shares" ADD CONSTRAINT "invitation_shares_shared_by_accounts_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_responsible_account_id_accounts_id_fk" FOREIGN KEY ("responsible_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_source_item_id_tree_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_target_space_id_spaces_id_fk" FOREIGN KEY ("target_space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_target_parent_id_tree_items_id_fk" FOREIGN KEY ("target_parent_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_root_copy_id_tree_items_id_fk" FOREIGN KEY ("root_copy_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownership_changes" ADD CONSTRAINT "item_ownership_changes_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownership_changes" ADD CONSTRAINT "item_ownership_changes_previous_owner_id_accounts_id_fk" FOREIGN KEY ("previous_owner_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownership_changes" ADD CONSTRAINT "item_ownership_changes_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownership_changes" ADD CONSTRAINT "item_ownership_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_categories" ADD CONSTRAINT "knowledge_base_categories_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_logos" ADD CONSTRAINT "knowledge_base_logos_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_paths" ADD CONSTRAINT "knowledge_base_paths_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_portal_domain_portal_domains_domain_fk" FOREIGN KEY ("portal_domain") REFERENCES "public"."portal_domains"("domain") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_state" ADD CONSTRAINT "maintenance_state_changed_by_accounts_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_accounts" ADD CONSTRAINT "managed_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_accounts" ADD CONSTRAINT "managed_accounts_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_groups" ADD CONSTRAINT "managed_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_groups" ADD CONSTRAINT "managed_groups_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_groups" ADD CONSTRAINT "managed_groups_provider_group_id_provider_groups_id_fk" FOREIGN KEY ("provider_group_id") REFERENCES "public"."provider_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_group_id_provider_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."provider_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_pagehall_group_id_groups_id_fk" FOREIGN KEY ("pagehall_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_item_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_guests" ADD CONSTRAINT "meeting_guests_meeting_id_meetings_item_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_guests" ADD CONSTRAINT "meeting_guests_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_guests" ADD CONSTRAINT "meeting_guests_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_responsible_account_id_accounts_id_fk" FOREIGN KEY ("responsible_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_accounts_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_documents" ADD CONSTRAINT "page_documents_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_documents" ADD CONSTRAINT "page_documents_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_excerpts" ADD CONSTRAINT "page_excerpts_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_source_item_id_tree_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_target_item_id_tree_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_properties" ADD CONSTRAINT "page_properties_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_restriction_holders" ADD CONSTRAINT "page_restriction_holders_item_id_kind_page_restrictions_item_id_kind_fk" FOREIGN KEY ("item_id","kind") REFERENCES "public"."page_restrictions"("item_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_set_by_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_shares" ADD CONSTRAINT "page_shares_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_shares" ADD CONSTRAINT "page_shares_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_changes" ADD CONSTRAINT "page_status_changes_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_changes" ADD CONSTRAINT "page_status_changes_status_id_page_status_values_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."page_status_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_changes" ADD CONSTRAINT "page_status_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_values" ADD CONSTRAINT "page_status_values_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_copied_from_id_tree_items_id_fk" FOREIGN KEY ("copied_from_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_article_views" ADD CONSTRAINT "portal_article_views_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_article_views" ADD CONSTRAINT "portal_article_views_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_domains" ADD CONSTRAINT "portal_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_domains" ADD CONSTRAINT "portal_domains_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_feedback" ADD CONSTRAINT "portal_feedback_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_feedback" ADD CONSTRAINT "portal_feedback_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_handoff_consents" ADD CONSTRAINT "portal_handoff_consents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_handoff_consents" ADD CONSTRAINT "portal_handoff_consents_domain_portal_domains_domain_fk" FOREIGN KEY ("domain") REFERENCES "public"."portal_domains"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_handoffs" ADD CONSTRAINT "portal_handoffs_domain_portal_domains_domain_fk" FOREIGN KEY ("domain") REFERENCES "public"."portal_domains"("domain") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "portal_handoffs" ADD CONSTRAINT "portal_handoffs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_path_reservations" ADD CONSTRAINT "portal_path_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_ratings" ADD CONSTRAINT "portal_ratings_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_ratings" ADD CONSTRAINT "portal_ratings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_readers" ADD CONSTRAINT "portal_readers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_readers" ADD CONSTRAINT "portal_readers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_search_months" ADD CONSTRAINT "portal_search_months_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_searches" ADD CONSTRAINT "portal_searches_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_searches" ADD CONSTRAINT "portal_searches_category_id_tree_items_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_domain_portal_domains_domain_fk" FOREIGN KEY ("domain") REFERENCES "public"."portal_domains"("domain") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "provider_deactivations" ADD CONSTRAINT "provider_deactivations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_deactivations" ADD CONSTRAINT "provider_deactivations_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_flows" ADD CONSTRAINT "provider_flows_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_groups" ADD CONSTRAINT "provider_groups_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_logout_tokens" ADD CONSTRAINT "provider_logout_tokens_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_confirmed_by_accounts_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_recipient_id_accounts_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_searches" ADD CONSTRAINT "recent_searches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_searches" ADD CONSTRAINT "recent_searches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_tokens" ADD CONSTRAINT "registration_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_required_sections" ADD CONSTRAINT "knowledge_base_required_sections_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_required_sections" ADD CONSTRAINT "knowledge_base_required_sections_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saml_assertions" ADD CONSTRAINT "saml_assertions_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saml_metadata" ADD CONSTRAINT "saml_metadata_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_context_item_id_tree_items_id_fk" FOREIGN KEY ("context_item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_file_texts" ADD CONSTRAINT "search_file_texts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_item_terms" ADD CONSTRAINT "search_item_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_item_terms" ADD CONSTRAINT "search_item_terms_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_responsibles" ADD CONSTRAINT "service_account_responsibles_service_account_id_service_accounts_account_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_responsibles" ADD CONSTRAINT "service_account_responsibles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_accesses" ADD CONSTRAINT "share_link_accesses_link_id_share_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_accesses" ADD CONSTRAINT "share_link_accesses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_people" ADD CONSTRAINT "share_link_people_link_id_share_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_revoked_by_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_refusals" ADD CONSTRAINT "sign_in_refusals_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_refusals" ADD CONSTRAINT "sign_in_refusals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_key_aliases" ADD CONSTRAINT "space_key_aliases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_shortcuts" ADD CONSTRAINT "space_shortcuts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_shortcuts" ADD CONSTRAINT "space_shortcuts_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_shortcuts" ADD CONSTRAINT "space_shortcuts_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_personal_of_accounts_id_fk" FOREIGN KEY ("personal_of") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_overview_item_id_tree_items_id_fk" FOREIGN KEY ("overview_item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_archived_by_accounts_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_changes" ADD CONSTRAINT "task_status_changes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_changes" ADD CONSTRAINT "task_status_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_changed_by_accounts_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_notified_assignee_id_accounts_id_fk" FOREIGN KEY ("notified_assignee_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_by_id_accounts_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_files" ADD CONSTRAINT "template_files_template_id_page_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."page_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_files" ADD CONSTRAINT "template_files_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_files" ADD CONSTRAINT "template_files_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_imports" ADD CONSTRAINT "template_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_imports" ADD CONSTRAINT "template_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_imports" ADD CONSTRAINT "template_imports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_credentials" ADD CONSTRAINT "totp_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_deleted_by_accounts_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_parent_id_tree_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_link_item_id_tree_items_id_fk" FOREIGN KEY ("link_item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_published_version_id_page_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."page_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_trash_entry_id_trash_entries_id_fk" FOREIGN KEY ("trash_entry_id") REFERENCES "public"."trash_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_archived_root_id_tree_items_id_fk" FOREIGN KEY ("archived_root_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_archived_by_accounts_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_creator_id_accounts_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_translation_of_tree_items_id_fk" FOREIGN KEY ("translation_of") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_status_id_page_status_values_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."page_status_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_status_changed_by_accounts_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_documents" ADD CONSTRAINT "whiteboard_documents_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_documents" ADD CONSTRAINT "whiteboard_documents_preview_id_whiteboard_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."whiteboard_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_documents" ADD CONSTRAINT "whiteboard_documents_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_previews" ADD CONSTRAINT "whiteboard_previews_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_previews" ADD CONSTRAINT "whiteboard_previews_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_previews" ADD CONSTRAINT "whiteboard_previews_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_copied_from_id_tree_items_id_fk" FOREIGN KEY ("copied_from_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_preview_id_whiteboard_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."whiteboard_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_open_unique" ON "access_requests" USING btree ("requester_id","space_id",coalesce("item_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "access_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX "access_requests_space_id_status_index" ON "access_requests" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "access_requests_item_id_index" ON "access_requests" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "access_requests_decided_by_index" ON "access_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "account_external_ids_account_id_index" ON "account_external_ids" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_pictures_file_unique" ON "account_pictures" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_tokens_token_hash_index" ON "account_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_tokens_account_id_purpose_index" ON "account_tokens" USING btree ("account_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_unique" ON "accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "accounts_home_organization_id_index" ON "accounts" USING btree ("home_organization_id");--> statement-breakpoint
CREATE INDEX "accounts_name_id_index" ON "accounts" USING btree (lower("name"),"id");--> statement-breakpoint
CREATE INDEX "announcement_dismissals_account_id_index" ON "announcement_dismissals" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "announcements_organization_id_index" ON "announcements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "announcements_updated_by_index" ON "announcements" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_index" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_account_id_id_index" ON "api_tokens" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "api_tokens_organization_id_id_index" ON "api_tokens" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "article_review_events_item_id_reviewed_at_index" ON "article_review_events" USING btree ("item_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "article_review_events_actor_id_index" ON "article_review_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "article_review_events_previous_reviewed_by_index" ON "article_review_events" USING btree ("previous_reviewed_by");--> statement-breakpoint
CREATE INDEX "article_reviews_reviewed_by_index" ON "article_reviews" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "article_reviews_due_index" ON "article_reviews" USING btree ("due_at") WHERE "article_reviews"."due_at" is not null;--> statement-breakpoint
CREATE INDEX "article_reviews_unqueued_index" ON "article_reviews" USING btree ("item_id") WHERE "article_reviews"."due_at" is not null and "article_reviews"."reminders_queued_at" is null;--> statement-breakpoint
CREATE INDEX "article_sources_source_id_index" ON "article_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "article_sources_added_by_index" ON "article_sources" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "article_sync_item_id_index" ON "article_sync" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "article_sync_space_id_changed_at_item_id_index" ON "article_sync" USING btree ("space_id","changed_at","item_id");--> statement-breakpoint
CREATE INDEX "article_sync_removed_index" ON "article_sync" USING btree ("removed_at") WHERE "article_sync"."removed_at" is not null;--> statement-breakpoint
CREATE INDEX "article_titles_space_id_index" ON "article_titles" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_versions_number_unique" ON "attachment_versions" USING btree ("attachment_id","number");--> statement-breakpoint
CREATE INDEX "attachment_versions_file_id_index" ON "attachment_versions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "attachment_versions_uploaded_by_index" ON "attachment_versions" USING btree ("uploaded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_name_unique" ON "attachments" USING btree ("item_id","name_key") WHERE "attachments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "attachments_item_id_index" ON "attachments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "attachments_current_version_id_index" ON "attachments" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "attachments_published_version_id_index" ON "attachments" USING btree ("published_version_id");--> statement-breakpoint
CREATE INDEX "attachments_discarded_draft_id_index" ON "attachments" USING btree ("discarded_draft_id");--> statement-breakpoint
CREATE INDEX "attachments_created_by_index" ON "attachments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "attachments_deleted_by_index" ON "attachments" USING btree ("deleted_by");--> statement-breakpoint
CREATE INDEX "audit_confidential_events_space_id_index" ON "audit_confidential_events" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_scope_type_scope_id_sequence_index" ON "audit_events" USING btree ("scope_type","scope_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_index" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_index" ON "audit_events" USING btree ("actor_id") WHERE "audit_events"."actor_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_events_target_type_target_id_index" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_subject_keys_account_id_index" ON "audit_subject_keys" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "audit_subject_keys_address_digest_index" ON "audit_subject_keys" USING btree ("address_digest") WHERE "audit_subject_keys"."address_digest" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_token_hash_index" ON "auth_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_at_index" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_challenges_session_id_index" ON "auth_challenges" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "backup_runs_started_at_index" ON "backup_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "backup_runs_state_finished_at_index" ON "backup_runs" USING btree ("state","finished_at");--> statement-breakpoint
CREATE INDEX "backup_test_restores_backup_name_started_at_index" ON "backup_test_restores" USING btree ("backup_name","started_at");--> statement-breakpoint
CREATE INDEX "blog_posts_published_at_index" ON "blog_posts" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "blog_posts_scheduled_index" ON "blog_posts" USING btree ("scheduled_at") WHERE "blog_posts"."scheduled_at" is not null;--> statement-breakpoint
CREATE INDEX "blog_posts_scheduled_by_index" ON "blog_posts" USING btree ("scheduled_by");--> statement-breakpoint
CREATE INDEX "blog_posts_space_pinned_by_index" ON "blog_posts" USING btree ("space_pinned_by");--> statement-breakpoint
CREATE INDEX "blog_posts_organization_pinned_by_index" ON "blog_posts" USING btree ("organization_pinned_by");--> statement-breakpoint
CREATE INDEX "blog_posts_cover_attachment_id_index" ON "blog_posts" USING btree ("cover_attachment_id");--> statement-breakpoint
CREATE INDEX "blog_subscriptions_account_id_index" ON "blog_subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "break_glass_accesses_account_id_organization_id_index" ON "break_glass_accesses" USING btree ("account_id","organization_id");--> statement-breakpoint
CREATE INDEX "break_glass_accesses_expires_at_index" ON "break_glass_accesses" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "category_responsibilities_set_by_index" ON "category_responsibilities" USING btree ("set_by");--> statement-breakpoint
CREATE INDEX "category_responsible_groups_group_id_index" ON "category_responsible_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "chat_channels_organization_id_index" ON "chat_channels" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "chat_channels_space_id_index" ON "chat_channels" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "chat_channels_created_by_index" ON "chat_channels" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "chat_deliveries_channel_id_index" ON "chat_deliveries" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "chat_deliveries_state_queued_at_index" ON "chat_deliveries" USING btree ("state","queued_at");--> statement-breakpoint
CREATE INDEX "chat_deliveries_updated_at_index" ON "chat_deliveries" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_deliveries_pending_combine_index" ON "chat_deliveries" USING btree ("channel_id","combine_key") WHERE "chat_deliveries"."state" = 'pending' and "chat_deliveries"."combine_key" is not null;--> statement-breakpoint
CREATE INDEX "collaboration_clients_account_id_index" ON "collaboration_clients" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "collaboration_editors_account_id_index" ON "collaboration_editors" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "comments_item_id_created_at_index" ON "comments" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_id_index" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_author_id_index" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "comments_resolved_by_index" ON "comments" USING btree ("resolved_by");--> statement-breakpoint
CREATE INDEX "comments_deleted_by_index" ON "comments" USING btree ("deleted_by");--> statement-breakpoint
CREATE INDEX "content_mentions_account_id_notified_at_index" ON "content_mentions" USING btree ("account_id","notified_at");--> statement-breakpoint
CREATE INDEX "content_mentions_comment_id_index" ON "content_mentions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "content_mentions_actor_id_index" ON "content_mentions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "content_mentions_pending_index" ON "content_mentions" USING btree ("created_at") WHERE "content_mentions"."notified_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_name_unique" ON "custom_roles" USING btree ("scope",coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "decisions_item_id_index" ON "decisions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "decisions_topic_id_index" ON "decisions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "decisions_published_index" ON "decisions" USING btree ("created_at") WHERE "decisions"."published";--> statement-breakpoint
CREATE INDEX "deleted_space_administrators_account_id_index" ON "deleted_space_administrators" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "discarded_drafts_item_id_index" ON "discarded_drafts" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "discarded_drafts_discarded_by_index" ON "discarded_drafts" USING btree ("discarded_by");--> statement-breakpoint
CREATE INDEX "discarded_drafts_expires_at_index" ON "discarded_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "display_versions_file_unique" ON "display_versions" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exports_one_running_per_account" ON "exports" USING btree ("account_id") WHERE "exports"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "exports_account_id_created_at_index" ON "exports" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "exports_state_heartbeat_at_index" ON "exports" USING btree ("state","heartbeat_at");--> statement-breakpoint
CREATE INDEX "exports_expires_at_index" ON "exports" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "exports_token_id_index" ON "exports" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "exports_organization_id_index" ON "exports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "exports_space_id_index" ON "exports" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "exports_root_item_id_index" ON "exports" USING btree ("root_item_id");--> statement-breakpoint
CREATE INDEX "exports_file_id_index" ON "exports" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "give_access_drafts_space_id_index" ON "give_access_drafts" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "group_managers_account_id_index" ON "group_managers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "group_members_account_id_index" ON "group_members" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_unique" ON "groups" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_id_subject_index" ON "identities" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE INDEX "identities_account_id_index" ON "identities" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_scim_user_name_unique" ON "identities" USING btree ("provider_id",lower("scim_user_name")) WHERE "identities"."scim_user_name" is not null;--> statement-breakpoint
CREATE INDEX "identity_groups_group_id_index" ON "identity_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "identity_provider_credentials_provider_id_index" ON "identity_provider_credentials" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "identity_provider_credentials_expires_at_index" ON "identity_provider_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "identity_provider_domains_provider_id_index" ON "identity_provider_domains" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "import_baselines_kind_source_id_index" ON "import_baselines" USING btree ("kind","source_id");--> statement-breakpoint
CREATE INDEX "import_baselines_target_id_index" ON "import_baselines" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "import_baselines_import_id_index" ON "import_baselines" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_changes_unique" ON "import_changes" USING btree ("import_id","kind","source_id","change");--> statement-breakpoint
CREATE INDEX "import_changes_import_id_change_index" ON "import_changes" USING btree ("import_id","change");--> statement-breakpoint
CREATE INDEX "import_changes_item_id_index" ON "import_changes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "import_changes_decided_by_index" ON "import_changes" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "import_changes_applied_by_index" ON "import_changes" USING btree ("applied_by");--> statement-breakpoint
CREATE INDEX "import_connections_organization_id_index" ON "import_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_files_position_unique" ON "import_files" USING btree ("import_id","position");--> statement-breakpoint
CREATE INDEX "import_files_upload_id_index" ON "import_files" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_grants_source_unique" ON "import_grants" USING btree ("import_id","source_key");--> statement-breakpoint
CREATE INDEX "import_grants_import_id_group_key_index" ON "import_grants" USING btree ("import_id","group_key");--> statement-breakpoint
CREATE INDEX "import_grants_account_id_index" ON "import_grants" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_grants_item_id_index" ON "import_grants" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "import_groups_group_id_index" ON "import_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "import_groups_mapped_by_index" ON "import_groups" USING btree ("mapped_by");--> statement-breakpoint
CREATE INDEX "import_items_target_id_index" ON "import_items" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "import_items_kind_source_id_index" ON "import_items" USING btree ("kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_problems_key_unique" ON "import_problems" USING btree ("import_id","key");--> statement-breakpoint
CREATE INDEX "import_problems_import_id_category_code_index" ON "import_problems" USING btree ("import_id","category","code");--> statement-breakpoint
CREATE INDEX "import_problems_item_id_index" ON "import_problems" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "import_records_import_id_kind_ref_index" ON "import_records" USING btree ("import_id","kind","ref");--> statement-breakpoint
CREATE INDEX "import_records_import_id_kind_ordinal_index" ON "import_records" USING btree ("import_id","kind","ordinal");--> statement-breakpoint
CREATE INDEX "import_reviewers_account_id_index" ON "import_reviewers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_reviewers_created_by_index" ON "import_reviewers" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "import_titles_space_key_title_key_index" ON "import_titles" USING btree ("space_key","title_key");--> statement-breakpoint
CREATE INDEX "import_upload_parts_file_id_index" ON "import_upload_parts" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "import_uploads_organization_id_index" ON "import_uploads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_uploads_created_by_index" ON "import_uploads" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "import_uploads_expires_at_index" ON "import_uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "imported_spaces_import_id_index" ON "imported_spaces" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "imported_spaces_source_space_key_index" ON "imported_spaces" USING btree ("source_space_key");--> statement-breakpoint
CREATE INDEX "imports_organization_id_created_at_index" ON "imports" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "imports_importer_id_index" ON "imports" USING btree ("importer_id");--> statement-breakpoint
CREATE INDEX "imports_upload_id_index" ON "imports" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "imports_decided_by_index" ON "imports" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "imports_file_expires_at_index" ON "imports" USING btree ("file_expires_at");--> statement-breakpoint
CREATE INDEX "imports_connection_id_index" ON "imports" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_quarantine_space_unique" ON "imports" USING btree ("quarantine_space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_active_reimport_unique" ON "imports" USING btree ("target_space_id") WHERE "imports"."state" in ('running', 'held', 'review');--> statement-breakpoint
CREATE INDEX "instance_owner_account_id_index" ON "instance" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "invitation_shares_item_id_index" ON "invitation_shares" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "invitation_shares_shared_by_index" ON "invitation_shares" USING btree ("shared_by");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_index" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_organization_email_id_index" ON "invitations" USING btree ("organization_id",lower("email"),"id");--> statement-breakpoint
CREATE INDEX "item_copies_account_id_created_at_index" ON "item_copies" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "item_copies_finished_at_index" ON "item_copies" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "item_copies_organization_id_index" ON "item_copies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "item_copies_source_item_id_index" ON "item_copies" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "item_copies_target_space_id_index" ON "item_copies" USING btree ("target_space_id");--> statement-breakpoint
CREATE INDEX "item_copies_target_parent_id_index" ON "item_copies" USING btree ("target_parent_id");--> statement-breakpoint
CREATE INDEX "item_copies_root_copy_id_index" ON "item_copies" USING btree ("root_copy_id");--> statement-breakpoint
CREATE INDEX "item_copies_open_index" ON "item_copies" USING btree ("created_at") WHERE "item_copies"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "item_ownership_changes_item_id_changed_at_index" ON "item_ownership_changes" USING btree ("item_id","changed_at");--> statement-breakpoint
CREATE INDEX "item_ownership_changes_previous_owner_id_index" ON "item_ownership_changes" USING btree ("previous_owner_id");--> statement-breakpoint
CREATE INDEX "item_ownership_changes_owner_id_index" ON "item_ownership_changes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "item_ownership_changes_actor_id_index" ON "item_ownership_changes" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "item_ownership_changes_changed_at_index" ON "item_ownership_changes" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "key_rotations_target_version_index" ON "key_rotations" USING btree ("target_version");--> statement-breakpoint
CREATE INDEX "knowledge_base_paths_space_id_index" ON "knowledge_base_paths" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_bases_portal_path_unique" ON "knowledge_bases" USING btree ("portal_path");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_bases_portal_domain_unique" ON "knowledge_bases" USING btree ("portal_domain");--> statement-breakpoint
CREATE INDEX "mail_credentials_expires_at_index" ON "mail_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mail_outbox_status_created_at_index" ON "mail_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "mail_sends_sender_sent_at_index" ON "mail_sends" USING btree ("sender","sent_at");--> statement-breakpoint
CREATE INDEX "managed_accounts_provider_id_index" ON "managed_accounts" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "mapping_rules_provider_id_index" ON "mapping_rules" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "mapping_rules_group_id_index" ON "mapping_rules" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "meeting_attendees_account_id_index" ON "meeting_attendees" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "meeting_attendees_added_by_index" ON "meeting_attendees" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "meeting_guests_meeting_id_index" ON "meeting_guests" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_guests_added_by_index" ON "meeting_guests" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "meeting_guests_updated_by_index" ON "meeting_guests" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "meeting_private_notes_account_id_index" ON "meeting_private_notes" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_series_calendar_uid_unique" ON "meeting_series" USING btree ("calendar_uid") WHERE "meeting_series"."calendar_uid" is not null;--> statement-breakpoint
CREATE INDEX "meeting_series_created_by_index" ON "meeting_series" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "meeting_series_members_account_id_index" ON "meeting_series_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "meeting_topic_updates_item_id_index" ON "meeting_topic_updates" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "meeting_topics_series_id_status_index" ON "meeting_topics" USING btree ("series_id","status");--> statement-breakpoint
CREATE INDEX "meeting_topics_raised_in_id_index" ON "meeting_topics" USING btree ("raised_in_id");--> statement-breakpoint
CREATE INDEX "meeting_topics_closed_in_id_index" ON "meeting_topics" USING btree ("closed_in_id");--> statement-breakpoint
CREATE INDEX "meeting_topics_closed_by_index" ON "meeting_topics" USING btree ("closed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_one_upcoming" ON "meetings" USING btree ("series_id") WHERE "meetings"."state" = 'upcoming' and not "meetings"."extra";--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_occurrence_unique" ON "meetings" USING btree ("series_id","recurrence_id") WHERE "meetings"."recurrence_id" is not null;--> statement-breakpoint
CREATE INDEX "meetings_series_id_starts_at_index" ON "meetings" USING btree ("series_id","starts_at");--> statement-breakpoint
CREATE INDEX "meetings_reminder_due_index" ON "meetings" USING btree ("starts_at") WHERE "meetings"."state" = 'upcoming' and "meetings"."reminded_at" is null;--> statement-breakpoint
CREATE INDEX "meetings_closed_by_index" ON "meetings" USING btree ("closed_by");--> statement-breakpoint
CREATE INDEX "meetings_next_meeting_id_index" ON "meetings" USING btree ("next_meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_organization_id_account_id_index" ON "memberships" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE INDEX "memberships_account_id_index" ON "memberships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "memberships_expires_at_index" ON "memberships" USING btree ("expires_at") WHERE "memberships"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "notifications_recipient_id_updated_at_id_index" ON "notifications" USING btree ("recipient_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "notifications_email_pending_index" ON "notifications" USING btree ("recipient_id","email_pending_since") WHERE "notifications"."email_status" in ('immediate', 'digest');--> statement-breakpoint
CREATE INDEX "notifications_unread_group_index" ON "notifications" USING btree ("recipient_id","group_key","updated_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_updated_at_index" ON "notifications" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "organization_domains_organization_id_index" ON "organization_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "organizations_name_id_index" ON "organizations" USING btree (lower("name"),"id");--> statement-breakpoint
CREATE INDEX "page_labels_label_index" ON "page_labels" USING btree ("label");--> statement-breakpoint
CREATE INDEX "page_labels_created_by_index" ON "page_labels" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "page_links_target_item_id_index" ON "page_links" USING btree ("target_item_id");--> statement-breakpoint
CREATE INDEX "page_properties_key_normalized_item_id_index" ON "page_properties" USING btree ("key_normalized","item_id");--> statement-breakpoint
CREATE INDEX "page_restriction_holders_principal_kind_principal_id_index" ON "page_restriction_holders" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "page_restrictions_set_by_index" ON "page_restrictions" USING btree ("set_by");--> statement-breakpoint
CREATE UNIQUE INDEX "page_shares_holder_unique" ON "page_shares" USING btree ("item_id","principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "page_shares_principal_kind_principal_id_index" ON "page_shares" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "page_shares_created_by_index" ON "page_shares" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "page_status_changes_item_id_changed_at_index" ON "page_status_changes" USING btree ("item_id","changed_at");--> statement-breakpoint
CREATE INDEX "page_status_changes_status_id_index" ON "page_status_changes" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "page_status_changes_actor_id_index" ON "page_status_changes" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "page_status_changes_changed_at_index" ON "page_status_changes" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "page_status_values_space_id_position_index" ON "page_status_values" USING btree ("space_id","position");--> statement-breakpoint
CREATE INDEX "page_templates_organization_id_index" ON "page_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "page_templates_space_id_index" ON "page_templates" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "page_templates_created_by_index" ON "page_templates" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "page_templates_updated_by_index" ON "page_templates" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "page_templates_files_pending_index" ON "page_templates" USING btree ("id") WHERE not "page_templates"."files_adopted";--> statement-breakpoint
CREATE UNIQUE INDEX "page_versions_number_unique" ON "page_versions" USING btree ("item_id","number");--> statement-breakpoint
CREATE INDEX "page_versions_created_by_index" ON "page_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "page_versions_copied_from_id_index" ON "page_versions" USING btree ("copied_from_id");--> statement-breakpoint
CREATE INDEX "portal_article_views_space_id_day_index" ON "portal_article_views" USING btree ("space_id","day");--> statement-breakpoint
CREATE INDEX "portal_domains_organization_id_index" ON "portal_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "portal_domains_created_by_index" ON "portal_domains" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "portal_feedback_space_id_day_index" ON "portal_feedback" USING btree ("space_id","day");--> statement-breakpoint
CREATE INDEX "portal_feedback_item_id_index" ON "portal_feedback" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "portal_handoff_consents_domain_index" ON "portal_handoff_consents" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "portal_handoffs_session_id_index" ON "portal_handoffs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "portal_handoffs_domain_index" ON "portal_handoffs" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "portal_handoffs_expires_at_index" ON "portal_handoffs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "portal_invitations_space_id_index" ON "portal_invitations" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "portal_path_reservations_organization_id_index" ON "portal_path_reservations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "portal_ratings_space_id_day_index" ON "portal_ratings" USING btree ("space_id","day");--> statement-breakpoint
CREATE INDEX "portal_readers_account_id_index" ON "portal_readers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "portal_searches_space_id_searched_at_index" ON "portal_searches" USING btree ("space_id","searched_at");--> statement-breakpoint
CREATE INDEX "portal_searches_category_id_index" ON "portal_searches" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_session_id_index" ON "portal_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_domain_index" ON "portal_sessions" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_flows_state_hash_index" ON "provider_flows" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "provider_flows_expires_at_index" ON "provider_flows" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_grants_account_id_key_index" ON "provider_grants" USING btree ("account_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_groups_provider_id_external_id_index" ON "provider_groups" USING btree ("provider_id","external_id");--> statement-breakpoint
CREATE INDEX "provider_logout_tokens_expires_at_index" ON "provider_logout_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_sync_runs_provider_id_started_at_index" ON "provider_sync_runs" USING btree ("provider_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_runs_running" ON "provider_sync_runs" USING btree ("provider_id") WHERE "provider_sync_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "push_outbox_recipient_id_index" ON "push_outbox" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "push_outbox_organization_id_index" ON "push_outbox" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "push_outbox_queued_at_index" ON "push_outbox" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_account_id_index" ON "push_subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_session_id_index" ON "push_subscriptions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_index" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "reactions_comment_id_index" ON "reactions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "reactions_account_id_index" ON "reactions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recent_searches_organization_id_account_id_fingerprint_index" ON "recent_searches" USING btree ("organization_id","account_id","fingerprint");--> statement-breakpoint
CREATE INDEX "recent_searches_organization_id_account_id_searched_at_index" ON "recent_searches" USING btree ("organization_id","account_id","searched_at");--> statement-breakpoint
CREATE INDEX "recent_searches_account_id_index" ON "recent_searches" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "recent_views_account_id_viewed_at_index" ON "recent_views" USING btree ("account_id","viewed_at");--> statement-breakpoint
CREATE INDEX "recent_views_item_id_index" ON "recent_views" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "recent_views_viewed_at_index" ON "recent_views" USING btree ("viewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_codes_account_id_code_hash_index" ON "recovery_codes" USING btree ("account_id","code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_tokens_token_hash_index" ON "registration_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "knowledge_base_required_sections_created_by_index" ON "knowledge_base_required_sections" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "role_assignments_principal_kind_principal_id_index" ON "role_assignments" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "role_assignments_organization_id_id_index" ON "role_assignments" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "saml_assertions_expires_at_index" ON "saml_assertions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "saved_searches_organization_id_account_id_index" ON "saved_searches" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE INDEX "saved_searches_account_id_index" ON "saved_searches" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_tokens_token_hash_index" ON "scim_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "scim_tokens_provider_id_index" ON "scim_tokens" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_chunks_source_unique" ON "search_chunks" USING btree ("source","source_id","position");--> statement-breakpoint
CREATE INDEX "search_chunks_item_id_index" ON "search_chunks" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "search_chunks_space_id_index" ON "search_chunks" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "search_chunks_author_id_index" ON "search_chunks" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "search_chunks_context_item_id_index" ON "search_chunks" USING btree ("context_item_id");--> statement-breakpoint
CREATE INDEX "search_chunks_organization_config_index" ON "search_chunks" USING btree ("organization_id","config");--> statement-breakpoint
CREATE INDEX "search_chunks_organization_updated_index" ON "search_chunks" USING btree ("organization_id","content_updated_at");--> statement-breakpoint
CREATE INDEX "search_chunks_updated_index" ON "search_chunks" USING btree ("content_updated_at","id");--> statement-breakpoint
CREATE INDEX "search_chunks_document_index" ON "search_chunks" USING gin ("document");--> statement-breakpoint
CREATE INDEX "search_chunks_readers_index" ON "search_chunks" USING gin ("readers");--> statement-breakpoint
CREATE INDEX "search_chunks_labels_index" ON "search_chunks" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "search_item_terms_item_id_index" ON "search_item_terms" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "search_pending_items_due_at_index" ON "search_pending_items" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "service_account_responsibles_account_id_index" ON "service_account_responsibles" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "service_accounts_organization_id_index" ON "service_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_index" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_id_last_used_at_index" ON "sessions" USING btree ("account_id","last_used_at");--> statement-breakpoint
CREATE INDEX "sessions_device_hash_index" ON "sessions" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "sessions_identity_id_index" ON "sessions" USING btree ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_values_level_scope_id_key_index" ON "setting_values" USING btree ("level","scope_id","key");--> statement-breakpoint
CREATE INDEX "setting_values_key_index" ON "setting_values" USING btree ("key");--> statement-breakpoint
CREATE INDEX "share_link_accesses_account_id_index" ON "share_link_accesses" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "share_link_people_principal_kind_principal_id_index" ON "share_link_people" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_lookup_unique" ON "share_links" USING btree ("lookup");--> statement-breakpoint
CREATE INDEX "share_links_item_id_index" ON "share_links" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "share_links_created_by_index" ON "share_links" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "share_links_revoked_by_index" ON "share_links" USING btree ("revoked_by");--> statement-breakpoint
CREATE INDEX "sign_in_failures_updated_at_index" ON "sign_in_failures" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sign_in_refusals_reference_index" ON "sign_in_refusals" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "sign_in_refusals_created_at_index" ON "sign_in_refusals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "space_key_aliases_space_id_index" ON "space_key_aliases" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_permissions_principal_kind_principal_id_index" ON "space_permissions" USING btree ("principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "space_permissions_created_by_index" ON "space_permissions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "space_shortcuts_space_id_position_index" ON "space_shortcuts" USING btree ("space_id","position");--> statement-breakpoint
CREATE INDEX "space_shortcuts_item_id_index" ON "space_shortcuts" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "space_shortcuts_created_by_index" ON "space_shortcuts" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_key_unique" ON "spaces" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_personal_of_unique" ON "spaces" USING btree ("personal_of");--> statement-breakpoint
CREATE INDEX "spaces_organization_name_index" ON "spaces" USING btree ("organization_id",lower("name"),"id");--> statement-breakpoint
CREATE INDEX "spaces_owner_account_id_index" ON "spaces" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "spaces_overview_item_id_index" ON "spaces" USING btree ("overview_item_id");--> statement-breakpoint
CREATE INDEX "spaces_created_by_index" ON "spaces" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "spaces_archived_by_index" ON "spaces" USING btree ("archived_by");--> statement-breakpoint
CREATE UNIQUE INDEX "stars_item_unique" ON "stars" USING btree ("account_id","item_id") WHERE "stars"."item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stars_space_unique" ON "stars" USING btree ("account_id","space_id") WHERE "stars"."space_id" is not null;--> statement-breakpoint
CREATE INDEX "stars_item_id_index" ON "stars" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "stars_space_id_index" ON "stars" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "storage_reconcile_deltas_run_index" ON "storage_reconcile_deltas" USING btree ("run");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_storage_key_unique" ON "stored_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "stored_files_display_versions_pending" ON "stored_files" USING btree ("id") WHERE "stored_files"."display_version_state" = 'pending';--> statement-breakpoint
CREATE INDEX "stored_files_state_updated_at_index" ON "stored_files" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "stored_files_master_key_version_index" ON "stored_files" USING btree ("master_key_version");--> statement-breakpoint
CREATE INDEX "stored_files_content_digest_index" ON "stored_files" USING btree ("content_digest");--> statement-breakpoint
CREATE INDEX "task_status_changes_task_id_changed_at_index" ON "task_status_changes" USING btree ("task_id","changed_at");--> statement-breakpoint
CREATE INDEX "task_status_changes_actor_id_index" ON "task_status_changes" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "tasks_item_id_index" ON "tasks" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_index" ON "tasks" USING btree ("assignee_id","done","due_date") WHERE "tasks"."published";--> statement-breakpoint
CREATE INDEX "tasks_status_changed_by_index" ON "tasks" USING btree ("status_changed_by");--> statement-breakpoint
CREATE INDEX "tasks_notified_assignee_id_index" ON "tasks" USING btree ("notified_assignee_id");--> statement-breakpoint
CREATE INDEX "template_files_template_id_index" ON "template_files" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "template_files_file_id_index" ON "template_files" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "template_files_created_by_index" ON "template_files" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "template_imports_account_id_index" ON "template_imports" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "template_imports_organization_id_index" ON "template_imports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "template_imports_space_id_index" ON "template_imports" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "template_imports_created_at_index" ON "template_imports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "totp_credentials_account_id_index" ON "totp_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "trash_entries_space_id_stage_index" ON "trash_entries" USING btree ("space_id","stage");--> statement-breakpoint
CREATE INDEX "trash_entries_deleted_by_index" ON "trash_entries" USING btree ("deleted_by");--> statement-breakpoint
CREATE UNIQUE INDEX "trash_entries_space_unique" ON "trash_entries" USING btree ("space_id") WHERE "trash_entries"."kind" = 'space';--> statement-breakpoint
CREATE UNIQUE INDEX "tree_items_position_unique" ON "tree_items" USING btree ("space_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),"position") WHERE "tree_items"."trash_entry_id" is null and "tree_items"."archived_root_id" is distinct from "tree_items"."id";--> statement-breakpoint
CREATE UNIQUE INDEX "tree_items_number_unique" ON "tree_items" USING btree ("number");--> statement-breakpoint
CREATE INDEX "tree_items_title_index" ON "tree_items" USING btree ("space_id",lower("title"));--> statement-breakpoint
CREATE INDEX "tree_items_newest_index" ON "tree_items" USING btree ("space_id","content_updated_at" desc,"id" desc) WHERE "tree_items"."trash_entry_id" is null and "tree_items"."archived_root_id" is null;--> statement-breakpoint
CREATE INDEX "tree_items_parent_id_index" ON "tree_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tree_items_restore_parent_index" ON "tree_items" USING btree ("restore_parent_id") WHERE "tree_items"."parent_id" is null and "tree_items"."restore_parent_id" is not null;--> statement-breakpoint
CREATE INDEX "tree_items_link_item_id_index" ON "tree_items" USING btree ("link_item_id");--> statement-breakpoint
CREATE INDEX "tree_items_creator_id_index" ON "tree_items" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "tree_items_owner_id_index" ON "tree_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "tree_items_status_id_index" ON "tree_items" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "tree_items_status_changed_by_index" ON "tree_items" USING btree ("status_changed_by");--> statement-breakpoint
CREATE INDEX "tree_items_published_version_id_index" ON "tree_items" USING btree ("published_version_id");--> statement-breakpoint
CREATE INDEX "tree_items_trash_entry_id_index" ON "tree_items" USING btree ("trash_entry_id");--> statement-breakpoint
CREATE INDEX "tree_items_archived_root_id_index" ON "tree_items" USING btree ("archived_root_id");--> statement-breakpoint
CREATE INDEX "tree_items_archived_by_index" ON "tree_items" USING btree ("archived_by");--> statement-breakpoint
CREATE INDEX "tree_items_translation_of_index" ON "tree_items" USING btree ("translation_of");--> statement-breakpoint
CREATE UNIQUE INDEX "tree_items_translation_unique" ON "tree_items" USING btree ("translation_of","content_language") WHERE "tree_items"."translation_of" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "watches_account_space_index" ON "watches" USING btree ("account_id","space_id") WHERE "watches"."item_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "watches_account_item_index" ON "watches" USING btree ("account_id","item_id") WHERE "watches"."item_id" is not null;--> statement-breakpoint
CREATE INDEX "watches_space_id_state_index" ON "watches" USING btree ("space_id","state");--> statement-breakpoint
CREATE INDEX "watches_item_id_state_index" ON "watches" USING btree ("item_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_index" ON "webauthn_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_account_id_index" ON "webauthn_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "whiteboard_documents_preview_id_index" ON "whiteboard_documents" USING btree ("preview_id");--> statement-breakpoint
CREATE INDEX "whiteboard_documents_updated_by_index" ON "whiteboard_documents" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "whiteboard_previews_item_id_revision_index" ON "whiteboard_previews" USING btree ("item_id","revision");--> statement-breakpoint
CREATE INDEX "whiteboard_previews_file_id_index" ON "whiteboard_previews" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "whiteboard_previews_created_by_index" ON "whiteboard_previews" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "whiteboard_versions_number_unique" ON "whiteboard_versions" USING btree ("item_id","number");--> statement-breakpoint
CREATE INDEX "whiteboard_versions_preview_id_index" ON "whiteboard_versions" USING btree ("preview_id");--> statement-breakpoint
CREATE INDEX "whiteboard_versions_created_by_index" ON "whiteboard_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "whiteboard_versions_copied_from_id_index" ON "whiteboard_versions" USING btree ("copied_from_id");--> statement-breakpoint
CREATE FUNCTION article_reviews_due() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
	"months" smallint;
	"base" timestamptz;
	"due" timestamptz;
BEGIN
	SELECT coalesce(NEW."interval_months", kb."review_interval_months") INTO "months"
		FROM "tree_items" t JOIN "spaces" s ON s."id" = t."space_id" AND s."type" = 'knowledgeBase'
		LEFT JOIN "knowledge_bases" kb ON kb."space_id" = s."id"
		WHERE t."id" = NEW."item_id" AND t."kind" = 'page';
	"base" := coalesce(NEW."reviewed_at", NEW."published_at");
	IF "months" IS NULL OR "months" = 0 OR "base" IS NULL THEN
		"due" := NULL;
	ELSE
		"due" := date_trunc('milliseconds', "base" + make_interval(months => "months"));
	END IF;
	IF TG_OP = 'INSERT' THEN
		NEW."due_at" := "due";
		NEW."lead_reminded_at" := NULL;
		NEW."due_reminded_at" := NULL;
		NEW."reminders_queued_at" := NULL;
	ELSIF "due" IS DISTINCT FROM OLD."due_at" THEN
		NEW."due_at" := "due";
		IF NEW."lead_reminded_at" IS NOT DISTINCT FROM OLD."lead_reminded_at" THEN
			NEW."lead_reminded_at" := NULL;
		END IF;
		IF NEW."due_reminded_at" IS NOT DISTINCT FROM OLD."due_reminded_at" THEN
			NEW."due_reminded_at" := NULL;
		END IF;
		NEW."reminders_queued_at" := NULL;
	END IF;
	IF NEW."due_at" IS NOT NULL AND NEW."reminders_queued_at" IS NULL THEN
		PERFORM pg_notify('pagehall_review_changes', '');
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION article_reviews_sync_article() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	UPDATE "article_sync" SET "changed_at" = now() WHERE "item_id" = NEW."item_id" AND "removed_at" IS NULL;
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION article_sync_language(item uuid, space uuid, translation uuid, language text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
	SELECT CASE WHEN "translation" IS NOT NULL THEN "language"
		ELSE (SELECT "default_language" FROM "knowledge_bases" WHERE "space_id" = "space") END
$$;--> statement-breakpoint
CREATE FUNCTION article_view_restricted(path uuid[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
	SELECT EXISTS (SELECT 1 FROM "page_restrictions" WHERE "item_id" = ANY("path") AND "kind" = 'view')
$$;--> statement-breakpoint
CREATE FUNCTION attachment_versions_release_file() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM 1 FROM "stored_files" WHERE "id" = OLD."file_id" FOR UPDATE;
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "whiteboard_previews" "p" WHERE "p"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "template_files" "t" WHERE "t"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION audit_events_reject_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF TG_OP = 'DELETE' AND current_setting('pagehall.audit_retention', true) = 'on' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE FUNCTION import_upload_parts_release_file() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready';
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION knowledge_base_default_path() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "base" text;
  "candidate" text;
  "n" integer := 1;
BEGIN
  IF NEW."portal_path" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pagehall.knowledge-base.paths', 0));
  SELECT coalesce(nullif(trim(BOTH '-' FROM left(regexp_replace(lower("key"), '[^a-z0-9]+', '-', 'g'), 50)), ''), 'help')
    INTO "base" FROM "spaces" WHERE "id" = NEW."space_id";
  "candidate" := "base";
  WHILE EXISTS (SELECT 1 FROM "knowledge_bases" WHERE "portal_path" = "candidate")
    OR EXISTS (SELECT 1 FROM "knowledge_base_paths" WHERE "path" = "candidate")
    OR EXISTS (SELECT 1 FROM "portal_path_reservations" WHERE "path" = "candidate") LOOP
    "n" := "n" + 1;
    "candidate" := "base" || '-' || "n";
  END LOOP;
  NEW."portal_path" := "candidate";
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION knowledge_bases_review_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND NEW."review_interval_months" IS NOT DISTINCT FROM OLD."review_interval_months"
		AND NEW."review_lead_days" IS NOT DISTINCT FROM OLD."review_lead_days" THEN
		RETURN NEW;
	END IF;
	UPDATE "article_reviews" ar SET "updated_at" = now(),
		"reminders_queued_at" = CASE WHEN TG_OP = 'UPDATE' AND NEW."review_lead_days" = OLD."review_lead_days"
			THEN ar."reminders_queued_at" END
		FROM "tree_items" t WHERE t."id" = ar."item_id" AND t."space_id" = NEW."space_id";
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION knowledge_bases_sync_articles() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	UPDATE "article_sync" "a" SET "changed_at" = now(),
		"language" = article_sync_language("t"."id", "t"."space_id", "t"."translation_of", "t"."content_language")
		FROM "tree_items" "t"
		WHERE "a"."space_id" = NEW."space_id" AND "a"."item_id" = "t"."id" AND "a"."removed_at" IS NULL;
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION organization_flag(organization uuid, setting_key text, fallback boolean) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM "setting_values" "v" WHERE "v"."level" = 'instance' AND "v"."key" = "setting_key" AND "v"."locked")
      THEN coalesce((SELECT ("v"."value" #>> '{}')::boolean FROM "setting_values" "v"
        WHERE "v"."level" = 'instance' AND "v"."key" = "setting_key" AND "v"."value" IS NOT NULL), "fallback")
    ELSE coalesce(
      (SELECT ("v"."value" #>> '{}')::boolean FROM "setting_values" "v"
        WHERE "v"."level" = 'organization' AND "v"."scope_id" = "organization" AND "v"."key" = "setting_key"
          AND "v"."value" IS NOT NULL),
      (SELECT ("v"."value" #>> '{}')::boolean FROM "setting_values" "v"
        WHERE "v"."level" = 'instance' AND "v"."key" = "setting_key" AND "v"."value" IS NOT NULL),
      "fallback")
  END
$$;--> statement-breakpoint
CREATE FUNCTION page_restrictions_sync_articles() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
	"changed" uuid;
BEGIN
	"changed" := CASE WHEN TG_OP = 'DELETE' THEN OLD."item_id" ELSE NEW."item_id" END;
	UPDATE "article_sync" "a" SET "changed_at" = now() FROM "tree_items" "t"
		WHERE "a"."item_id" = "t"."id" AND "a"."space_id" = "t"."space_id" AND "a"."removed_at" IS NULL
			AND "t"."space_id" = (SELECT "space_id" FROM "tree_items" WHERE "id" = "changed") AND "changed" = ANY("t"."path");
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION page_shares_confidential_holder() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF NEW."principal_kind" <> 'account' AND EXISTS (
		SELECT 1 FROM "tree_items" t JOIN "spaces" s ON s."id" = t."space_id"
		WHERE t."id" = NEW."item_id" AND s."confidential") THEN
		RAISE EXCEPTION 'Pages of confidential spaces are shared with individual people only'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'page_shares_confidential_holder';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION portal_domains_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	PERFORM pg_notify('pagehall_portal_domains', '');
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_comments_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = OLD."item_id") THEN
      PERFORM "search_mark_item"(OLD."item_id", interval '0');
      PERFORM "search_mark_space"((SELECT "space_id" FROM "tree_items" WHERE "id" = OLD."item_id"));
    END IF;
    RETURN NULL;
  END IF;
  PERFORM "search_mark_item"(NEW."item_id", interval '0');
  IF TG_OP = 'UPDATE' AND (OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" OR OLD."quote_public" <> NEW."quote_public"
      OR OLD."parent_id" IS DISTINCT FROM NEW."parent_id" OR OLD."item_id" <> NEW."item_id") THEN
    PERFORM "search_mark_space"((SELECT "space_id" FROM "tree_items" WHERE "id" = NEW."item_id"));
    IF OLD."item_id" <> NEW."item_id" THEN
      PERFORM "search_mark_item"(OLD."item_id", interval '0');
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_item_access_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "search_mark_space"((SELECT "space_id" FROM "tree_items" WHERE "id" = OLD."item_id"));
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "search_mark_space"((SELECT "space_id" FROM "tree_items" WHERE "id" = NEW."item_id"));
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_item_content_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = OLD."item_id") THEN
    PERFORM "search_mark_item"(OLD."item_id", interval '0');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "search_mark_item"(NEW."item_id", interval '0');
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_live_document_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = NEW."item_id" AND "mode" = 'live') THEN
    PERFORM "search_mark_item"(NEW."item_id", interval '5 seconds');
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_mark_item(item uuid, delay interval) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "search_pending_items" ("item_id", "due_at") VALUES ("item", now() + "delay")
  ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1,
    "due_at" = least("search_pending_items"."due_at", EXCLUDED."due_at"), "attempts" = 0, "updated_at" = now();
  PERFORM pg_notify('pagehall_search_changes', '');
END $$;--> statement-breakpoint
CREATE FUNCTION search_mark_space(space uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF "space" IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO "search_pending_spaces" ("space_id") VALUES ("space")
  ON CONFLICT ("space_id") DO UPDATE SET "generation" = "search_pending_spaces"."generation" + 1, "updated_at" = now();
  PERFORM pg_notify('pagehall_search_changes', '');
END $$;--> statement-breakpoint
CREATE FUNCTION search_meeting_state_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM "search_mark_item"("u"."topic_id", interval '0')
  FROM "meeting_topic_updates" "u" WHERE "u"."item_id" = NEW."item_id";
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_prune_terms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  organization uuid;
BEGIN
  FOR organization IN SELECT DISTINCT organization_id FROM removed ORDER BY organization_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('pagehall.search.terms:' || organization, 0));
  END LOOP;
  DELETE FROM search_terms t USING (SELECT DISTINCT organization_id, word FROM removed) r
  WHERE t.organization_id = r.organization_id AND t.word = r.word
    AND NOT EXISTS (SELECT 1 FROM search_item_terms i WHERE i.organization_id = r.organization_id AND i.word = r.word);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_setting_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "changed" "setting_values";
BEGIN
  IF TG_OP = 'DELETE' THEN
    "changed" := OLD;
  ELSE
    "changed" := NEW;
  END IF;
  IF "changed"."key" NOT IN ('content.language', 'locale.language', 'pages.status') THEN
    RETURN NULL;
  END IF;
  INSERT INTO "search_pending_items" ("item_id")
  SELECT "t"."id" FROM "tree_items" "t" JOIN "spaces" "s" ON "s"."id" = "t"."space_id"
  WHERE "t"."kind"::text IN ('page', 'blogPost', 'meetingTopic', 'whiteboard') AND "t"."trash_entry_id" IS NULL AND (
    "changed"."level" = 'instance'
    OR ("changed"."level" = 'organization' AND "s"."organization_id" = "changed"."scope_id")
    OR ("changed"."level" = 'space' AND "s"."id" = "changed"."scope_id"))
  ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1,
    "due_at" = least("search_pending_items"."due_at", EXCLUDED."due_at"), "updated_at" = now();
  PERFORM pg_notify('pagehall_search_changes', '');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_space_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM "search_mark_space"(NEW."id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_space_permissions_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "search_mark_space"(OLD."space_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "search_mark_space"(NEW."space_id");
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_topic_updates_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = OLD."topic_id") THEN
    PERFORM "search_mark_item"(OLD."topic_id", interval '0');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "search_mark_item"(NEW."topic_id", interval '0');
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_tree_items_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM "search_mark_item"(NEW."id", interval '0');
  IF TG_OP = 'UPDATE' THEN
    PERFORM "search_mark_item"("u"."topic_id", interval '0')
    FROM "meeting_topic_updates" "u" WHERE "u"."item_id" = NEW."id";
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD."path" IS DISTINCT FROM NEW."path" OR OLD."space_id" <> NEW."space_id"
      OR OLD."trash_entry_id" IS DISTINCT FROM NEW."trash_entry_id" OR OLD."reader_visible" <> NEW."reader_visible") THEN
    PERFORM "search_mark_space"(OLD."space_id");
    IF OLD."space_id" <> NEW."space_id" THEN
      PERFORM "search_mark_space"(NEW."space_id");
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION search_whiteboard_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM "search_mark_item"(NEW."item_id", interval '5 seconds');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION share_links_confidential_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF NEW."scope" <> 'people' AND EXISTS (
		SELECT 1 FROM "tree_items" t JOIN "spaces" s ON s."id" = t."space_id"
		WHERE t."id" = NEW."item_id" AND s."confidential") THEN
		RAISE EXCEPTION 'Share links in confidential spaces are limited to specific people'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'share_links_confidential_scope';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION space_permissions_confidential_holder() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF NEW."principal_kind" <> 'account'
		AND EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "confidential") THEN
		RAISE EXCEPTION 'Confidential spaces give permissions to individual people only'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'space_permissions_confidential_holder';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION space_permissions_quarantine_holder() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "spaces" "s" WHERE "s"."id" = NEW."space_id" AND "s"."quarantined")
    AND (NEW."principal_kind" <> 'account' OR NEW."role" <> 'reader') THEN
    RAISE EXCEPTION 'A quarantine space can only be read by individual people' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION spaces_keep_confidentiality() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF NEW."confidential" <> OLD."confidential" OR NEW."one_on_one" <> OLD."one_on_one" THEN
		RAISE EXCEPTION 'Whether a space is confidential is chosen when it is created'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'spaces_confidential_fixed';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION spaces_keep_type() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF NEW."type" <> OLD."type" THEN
		RAISE EXCEPTION 'The type of a space is chosen when it is created'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'spaces_type_fixed';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION spaces_reserve_portal_paths() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF OLD."type" = 'knowledgeBase' AND OLD."organization_id" IS NOT NULL THEN
		INSERT INTO "portal_path_reservations" ("path", "organization_id")
		SELECT "kb"."portal_path", OLD."organization_id" FROM "knowledge_bases" "kb" WHERE "kb"."space_id" = OLD."id"
		UNION SELECT "p"."path", OLD."organization_id" FROM "knowledge_base_paths" "p" WHERE "p"."space_id" = OLD."id"
		ON CONFLICT ("path") DO NOTHING;
	END IF;
	RETURN OLD;
END $$;--> statement-breakpoint
CREATE FUNCTION spaces_sync_articles() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	UPDATE "article_sync" SET "changed_at" = now() WHERE "space_id" = NEW."id" AND "removed_at" IS NULL;
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION template_files_release_file() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM 1 FROM "stored_files" WHERE "id" = OLD."file_id" FOR UPDATE;
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "whiteboard_previews" "p" WHERE "p"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "template_files" "t" WHERE "t"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION tree_items_article_review() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF NEW."kind" = 'page'
		AND EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
		INSERT INTO "article_reviews" ("item_id", "published_at")
			VALUES (NEW."id", (SELECT min("created_at") FROM "page_versions" WHERE "item_id" = NEW."id"))
			ON CONFLICT ("item_id") DO UPDATE
				SET "published_at" = coalesce("article_reviews"."published_at", excluded."published_at"),
					"updated_at" = now();
	ELSIF TG_OP = 'UPDATE' THEN
		UPDATE "article_reviews" SET "updated_at" = now() WHERE "item_id" = NEW."id";
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION tree_items_article_titles() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF NEW."kind" <> 'page'
		OR NOT EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
		RETURN NEW;
	END IF;
	INSERT INTO "article_titles" ("item_id", "space_id", "title")
		SELECT NEW."id", NEW."space_id", "v"."title" FROM "page_versions" "v"
		WHERE "v"."id" = NEW."published_version_id"
		ON CONFLICT ("item_id", "space_id", "title") DO UPDATE SET "created_at" = now();
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION tree_items_knowledge_base_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
	"knowledge_base" boolean;
BEGIN
	"knowledge_base" := EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase');
	IF NEW."translation_of" IS NOT NULL AND (NOT "knowledge_base"
		OR coalesce(NEW."parent_id", NEW."restore_parent_id") IS DISTINCT FROM NEW."translation_of") THEN
		IF "knowledge_base" AND EXISTS (SELECT 1 FROM "tree_items" "s"
			WHERE "s"."id" = NEW."translation_of" AND "s"."trash_entry_id" IS NULL) THEN
			RAISE EXCEPTION 'A translation stays with the article it translates'
				USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_translation_placement';
		END IF;
		NEW."translation_of" := NULL;
	END IF;
	IF NEW."translation_of" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."translation_of" IS DISTINCT FROM NEW."translation_of")
		AND NOT EXISTS (SELECT 1 FROM "tree_items" "s" WHERE "s"."id" = NEW."translation_of" AND "s"."kind" = 'page'
			AND "s"."translation_of" IS NULL AND "s"."space_id" = NEW."space_id") THEN
		RAISE EXCEPTION 'Only articles of the same knowledge base are translated'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_translation_source';
	END IF;
	IF NOT "knowledge_base" THEN
		RETURN NEW;
	END IF;
	IF NEW."kind" NOT IN ('page', 'folder') THEN
		RAISE EXCEPTION 'Knowledge bases contain only articles and categories'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_knowledge_base_kind';
	END IF;
	IF NEW."kind" = 'page' AND NEW."mode" <> 'publish' THEN
		RAISE EXCEPTION 'Articles are always published with versions'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_knowledge_base_mode';
	END IF;
	IF NEW."parent_id" IS NOT NULL AND NEW."parent_id" IS DISTINCT FROM NEW."translation_of"
		AND NOT EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = NEW."parent_id" AND "kind" = 'folder') THEN
		RAISE EXCEPTION 'Articles and categories are placed in categories'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_knowledge_base_parent';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION tree_items_lock_space() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF coalesce(current_setting('pagehall.tree_settled_later', true), '') <> 'on' THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('pagehall.tree:' || NEW."space_id"::text, 0));
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION tree_items_propagate_path() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."path" IS DISTINCT FROM OLD."path" THEN
    WITH RECURSIVE "down"("id", "path") AS (
      SELECT "c"."id", NEW."path" || "c"."id" FROM "tree_items" "c"
      WHERE "c"."id" <> NEW."id"
        AND ("c"."parent_id" = NEW."id" OR ("c"."parent_id" IS NULL AND "c"."restore_parent_id" = NEW."id"))
      UNION ALL
      SELECT "c"."id", "d"."path" || "c"."id" FROM "tree_items" "c" JOIN "down" "d"
        ON "c"."parent_id" = "d"."id" OR ("c"."parent_id" IS NULL AND "c"."restore_parent_id" = "d"."id")
      WHERE NOT "c"."id" = ANY("d"."path")
    )
    UPDATE "tree_items" "t" SET "path" = "d"."path" FROM "down" "d"
    WHERE "t"."id" = "d"."id" AND "t"."path" IS DISTINCT FROM "d"."path";
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION tree_items_set_path() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "parent_path" uuid[];
BEGIN
  IF coalesce(NEW."parent_id", NEW."restore_parent_id") IS NOT NULL THEN
    SELECT "p"."path" INTO "parent_path" FROM "tree_items" "p"
    WHERE "p"."id" = coalesce(NEW."parent_id", NEW."restore_parent_id") FOR SHARE;
  END IF;
  NEW."path" := coalesce("parent_path", '{}'::uuid[]) || NEW."id";
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION tree_items_sync_article() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF TG_OP <> 'INSERT' AND OLD."kind" = 'page' AND (TG_OP = 'DELETE' OR OLD."space_id" <> NEW."space_id") THEN
		UPDATE "article_sync" SET "removed_at" = now(), "changed_at" = now(),
			"removed_reason" = CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'moved' END,
			"removed_restricted" = TG_OP = 'DELETE' OR article_view_restricted(OLD."path")
			WHERE "space_id" = OLD."space_id" AND "item_id" = OLD."id" AND "removed_at" IS NULL;
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
		RETURN NEW;
	END IF;
	IF NEW."kind" = 'folder' THEN
		IF TG_OP = 'UPDATE' AND (OLD."title" IS DISTINCT FROM NEW."title" OR OLD."path" IS DISTINCT FROM NEW."path") THEN
			UPDATE "article_sync" "a" SET "changed_at" = now() FROM "tree_items" "t"
				WHERE "a"."space_id" = NEW."space_id" AND "a"."item_id" = "t"."id" AND "a"."removed_at" IS NULL
					AND NEW."id" = ANY("t"."path") AND "t"."id" <> NEW."id";
		END IF;
		RETURN NEW;
	END IF;
	IF NEW."kind" <> 'page' THEN
		RETURN NEW;
	END IF;
	IF NEW."published_version_id" IS NOT NULL AND NEW."trash_entry_id" IS NULL AND NEW."archived_root_id" IS NULL
		AND NEW."reader_visible" THEN
		INSERT INTO "article_sync" ("space_id", "item_id", "number", "language", "changed_at")
		VALUES (NEW."space_id", NEW."id",
			(SELECT "number" FROM "tree_items" WHERE "id" = coalesce(NEW."translation_of", NEW."id")),
			article_sync_language(NEW."id", NEW."space_id", NEW."translation_of", NEW."content_language"), now())
		ON CONFLICT ("space_id", "item_id") DO UPDATE SET "changed_at" = now(), "removed_at" = NULL,
			"removed_reason" = NULL, "removed_restricted" = false, "number" = excluded."number", "language" = excluded."language";
	ELSE
		UPDATE "article_sync" SET "removed_at" = now(), "changed_at" = now(),
			"removed_reason" = CASE WHEN NEW."trash_entry_id" IS NOT NULL THEN 'deleted' ELSE 'unpublished' END,
			"removed_restricted" = article_view_restricted(NEW."path")
			WHERE "space_id" = NEW."space_id" AND "item_id" = NEW."id" AND "removed_at" IS NULL;
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION whiteboard_previews_release_file() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM 1 FROM "stored_files" WHERE "id" = OLD."file_id" FOR UPDATE;
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "whiteboard_previews" "p" WHERE "p"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "template_files" "t" WHERE "t"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;--> statement-breakpoint
CREATE INDEX search_terms_word_trigram_index ON search_terms USING gin (word gin_trgm_ops);--> statement-breakpoint
CREATE TRIGGER article_reviews_due BEFORE INSERT OR UPDATE ON article_reviews FOR EACH ROW EXECUTE FUNCTION article_reviews_due();--> statement-breakpoint
CREATE TRIGGER article_reviews_sync_article AFTER UPDATE OF reviewed_at, interval_months ON article_reviews FOR EACH ROW WHEN (((old.reviewed_at IS DISTINCT FROM new.reviewed_at) OR (old.interval_months IS DISTINCT FROM new.interval_months))) EXECUTE FUNCTION article_reviews_sync_article();--> statement-breakpoint
CREATE TRIGGER attachment_versions_release_file AFTER DELETE ON attachment_versions FOR EACH ROW EXECUTE FUNCTION attachment_versions_release_file();--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE DELETE OR UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_reject_changes();--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_events_reject_changes();--> statement-breakpoint
CREATE TRIGGER import_upload_parts_release_file AFTER DELETE ON import_upload_parts FOR EACH ROW EXECUTE FUNCTION import_upload_parts_release_file();--> statement-breakpoint
CREATE TRIGGER knowledge_bases_default_path BEFORE INSERT ON knowledge_bases FOR EACH ROW EXECUTE FUNCTION knowledge_base_default_path();--> statement-breakpoint
CREATE TRIGGER knowledge_bases_review_changed AFTER INSERT OR UPDATE OF review_interval_months, review_lead_days ON knowledge_bases FOR EACH ROW EXECUTE FUNCTION knowledge_bases_review_changed();--> statement-breakpoint
CREATE TRIGGER knowledge_bases_sync_articles AFTER UPDATE OF default_language, portal_path, portal_domain ON knowledge_bases FOR EACH ROW WHEN (((old.default_language IS DISTINCT FROM new.default_language) OR (old.portal_path IS DISTINCT FROM new.portal_path) OR (old.portal_domain IS DISTINCT FROM new.portal_domain))) EXECUTE FUNCTION knowledge_bases_sync_articles();--> statement-breakpoint
CREATE TRIGGER page_restrictions_sync_articles AFTER INSERT OR DELETE OR UPDATE ON page_restrictions FOR EACH ROW EXECUTE FUNCTION page_restrictions_sync_articles();--> statement-breakpoint
CREATE TRIGGER page_shares_confidential_holder BEFORE INSERT OR UPDATE ON page_shares FOR EACH ROW EXECUTE FUNCTION page_shares_confidential_holder();--> statement-breakpoint
CREATE TRIGGER portal_domains_changed AFTER INSERT OR DELETE OR UPDATE ON portal_domains FOR EACH STATEMENT EXECUTE FUNCTION portal_domains_changed();--> statement-breakpoint
CREATE TRIGGER search_attachments_deleted AFTER DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION search_item_content_changed();--> statement-breakpoint
CREATE TRIGGER search_attachments_published AFTER UPDATE OF published_version_id, item_id ON attachments FOR EACH ROW WHEN (((old.published_version_id IS DISTINCT FROM new.published_version_id) OR (old.item_id <> new.item_id))) EXECUTE FUNCTION search_item_content_changed();--> statement-breakpoint
CREATE TRIGGER search_comments_changed AFTER INSERT OR DELETE OR UPDATE OF body, deleted_at, quote_public, parent_id, item_id, author_id ON comments FOR EACH ROW EXECUTE FUNCTION search_comments_changed();--> statement-breakpoint
CREATE TRIGGER search_decisions_changed AFTER INSERT OR DELETE OR UPDATE OF published, text, topic_id, item_id ON decisions FOR EACH ROW EXECUTE FUNCTION search_item_content_changed();--> statement-breakpoint
CREATE TRIGGER search_item_terms_removed AFTER DELETE ON search_item_terms REFERENCING OLD TABLE AS removed FOR EACH STATEMENT EXECUTE FUNCTION search_prune_terms();--> statement-breakpoint
CREATE TRIGGER search_meetings_state_changed AFTER UPDATE OF state ON meetings FOR EACH ROW WHEN ((old.state IS DISTINCT FROM new.state)) EXECUTE FUNCTION search_meeting_state_changed();--> statement-breakpoint
CREATE TRIGGER search_page_documents_changed AFTER INSERT OR UPDATE OF snapshot ON page_documents FOR EACH ROW EXECUTE FUNCTION search_live_document_changed();--> statement-breakpoint
CREATE TRIGGER search_page_labels_changed AFTER INSERT OR DELETE OR UPDATE ON page_labels FOR EACH ROW EXECUTE FUNCTION search_item_content_changed();--> statement-breakpoint
CREATE TRIGGER search_page_restrictions_changed AFTER INSERT OR DELETE OR UPDATE ON page_restrictions FOR EACH ROW EXECUTE FUNCTION search_item_access_changed();--> statement-breakpoint
CREATE TRIGGER search_page_shares_changed AFTER INSERT OR DELETE OR UPDATE ON page_shares FOR EACH ROW EXECUTE FUNCTION search_item_access_changed();--> statement-breakpoint
CREATE TRIGGER search_setting_values_changed AFTER INSERT OR DELETE OR UPDATE ON setting_values FOR EACH ROW EXECUTE FUNCTION search_setting_changed();--> statement-breakpoint
CREATE TRIGGER search_space_permissions_changed AFTER INSERT OR DELETE OR UPDATE ON space_permissions FOR EACH ROW EXECUTE FUNCTION search_space_permissions_changed();--> statement-breakpoint
CREATE TRIGGER search_spaces_updated AFTER UPDATE OF visibility, audience, deleted_at, archived_at, quarantined ON spaces FOR EACH ROW WHEN (((old.visibility IS DISTINCT FROM new.visibility) OR (old.audience IS DISTINCT FROM new.audience) OR (old.deleted_at IS DISTINCT FROM new.deleted_at) OR (old.archived_at IS DISTINCT FROM new.archived_at) OR (old.quarantined IS DISTINCT FROM new.quarantined))) EXECUTE FUNCTION search_space_changed();--> statement-breakpoint
CREATE TRIGGER search_topic_updates_changed AFTER INSERT OR DELETE OR UPDATE ON meeting_topic_updates FOR EACH ROW EXECUTE FUNCTION search_topic_updates_changed();--> statement-breakpoint
CREATE TRIGGER search_tree_items_inserted AFTER INSERT ON tree_items FOR EACH ROW EXECUTE FUNCTION search_tree_items_changed();--> statement-breakpoint
CREATE TRIGGER search_tree_items_updated AFTER UPDATE OF title, kind, mode, published_version_id, reader_visible, path, space_id, trash_entry_id, archived_root_id, content_language, creator_id, status_id ON tree_items FOR EACH ROW WHEN (((old.title IS DISTINCT FROM new.title) OR (old.kind IS DISTINCT FROM new.kind) OR (old.mode IS DISTINCT FROM new.mode) OR (old.published_version_id IS DISTINCT FROM new.published_version_id) OR (old.reader_visible IS DISTINCT FROM new.reader_visible) OR (old.path IS DISTINCT FROM new.path) OR (old.space_id IS DISTINCT FROM new.space_id) OR (old.trash_entry_id IS DISTINCT FROM new.trash_entry_id) OR (old.archived_root_id IS DISTINCT FROM new.archived_root_id) OR (old.content_language IS DISTINCT FROM new.content_language) OR (old.creator_id IS DISTINCT FROM new.creator_id) OR (old.status_id IS DISTINCT FROM new.status_id))) EXECUTE FUNCTION search_tree_items_changed();--> statement-breakpoint
CREATE TRIGGER search_whiteboard_documents_changed AFTER INSERT OR UPDATE OF scene ON whiteboard_documents FOR EACH ROW EXECUTE FUNCTION search_whiteboard_changed();--> statement-breakpoint
CREATE TRIGGER share_links_confidential_scope BEFORE INSERT OR UPDATE ON share_links FOR EACH ROW EXECUTE FUNCTION share_links_confidential_scope();--> statement-breakpoint
CREATE TRIGGER space_permissions_confidential_holder BEFORE INSERT OR UPDATE ON space_permissions FOR EACH ROW EXECUTE FUNCTION space_permissions_confidential_holder();--> statement-breakpoint
CREATE TRIGGER space_permissions_quarantine_holder BEFORE INSERT OR UPDATE ON space_permissions FOR EACH ROW EXECUTE FUNCTION space_permissions_quarantine_holder();--> statement-breakpoint
CREATE TRIGGER spaces_confidential_fixed BEFORE UPDATE OF confidential, one_on_one ON spaces FOR EACH ROW EXECUTE FUNCTION spaces_keep_confidentiality();--> statement-breakpoint
CREATE TRIGGER spaces_reserve_portal_paths BEFORE DELETE ON spaces FOR EACH ROW EXECUTE FUNCTION spaces_reserve_portal_paths();--> statement-breakpoint
CREATE TRIGGER spaces_sync_articles AFTER UPDATE OF audience, key ON spaces FOR EACH ROW WHEN (((old.audience IS DISTINCT FROM new.audience) OR (old.key IS DISTINCT FROM new.key))) EXECUTE FUNCTION spaces_sync_articles();--> statement-breakpoint
CREATE TRIGGER spaces_type_fixed BEFORE UPDATE OF type ON spaces FOR EACH ROW EXECUTE FUNCTION spaces_keep_type();--> statement-breakpoint
CREATE TRIGGER template_files_release_file AFTER DELETE ON template_files FOR EACH ROW EXECUTE FUNCTION template_files_release_file();--> statement-breakpoint
CREATE TRIGGER tree_items_article_review_insert AFTER INSERT ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_article_review();--> statement-breakpoint
CREATE TRIGGER tree_items_article_review_update AFTER UPDATE OF space_id, kind, published_version_id ON tree_items FOR EACH ROW WHEN (((old.space_id IS DISTINCT FROM new.space_id) OR (old.kind IS DISTINCT FROM new.kind) OR (old.published_version_id IS DISTINCT FROM new.published_version_id))) EXECUTE FUNCTION tree_items_article_review();--> statement-breakpoint
CREATE TRIGGER tree_items_article_titles_insert AFTER INSERT ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_article_titles();--> statement-breakpoint
CREATE TRIGGER tree_items_article_titles_update AFTER UPDATE OF space_id, kind, published_version_id ON tree_items FOR EACH ROW WHEN (((old.space_id IS DISTINCT FROM new.space_id) OR (old.kind IS DISTINCT FROM new.kind) OR (old.published_version_id IS DISTINCT FROM new.published_version_id))) EXECUTE FUNCTION tree_items_article_titles();--> statement-breakpoint
CREATE TRIGGER tree_items_knowledge_base_rules BEFORE INSERT OR UPDATE OF space_id, kind, parent_id, mode, translation_of, restore_parent_id ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_knowledge_base_rules();--> statement-breakpoint
CREATE TRIGGER tree_items_lock_space BEFORE INSERT OR UPDATE OF space_id ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_lock_space();--> statement-breakpoint
CREATE TRIGGER tree_items_path_after AFTER UPDATE OF parent_id, restore_parent_id ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_propagate_path();--> statement-breakpoint
CREATE TRIGGER tree_items_path_before BEFORE INSERT OR UPDATE OF parent_id, restore_parent_id ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_set_path();--> statement-breakpoint
CREATE TRIGGER tree_items_sync_article_delete AFTER DELETE ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_sync_article();--> statement-breakpoint
CREATE TRIGGER tree_items_sync_article_insert AFTER INSERT ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_sync_article();--> statement-breakpoint
CREATE TRIGGER tree_items_sync_article_update AFTER UPDATE OF title, description, path, space_id, published_version_id, article_type, trash_entry_id, archived_root_id, reader_visible, translation_of, content_language ON tree_items FOR EACH ROW EXECUTE FUNCTION tree_items_sync_article();--> statement-breakpoint
CREATE TRIGGER whiteboard_previews_release_file AFTER DELETE ON whiteboard_previews FOR EACH ROW EXECUTE FUNCTION whiteboard_previews_release_file();--> statement-breakpoint
INSERT INTO "search_index_state" ("id", "building_since", "build_total") VALUES (1, now(), 0);
