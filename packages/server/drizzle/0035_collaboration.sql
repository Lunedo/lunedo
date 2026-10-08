ALTER TYPE "public"."tree_item_kind" ADD VALUE 'blogPost';--> statement-breakpoint
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
	CONSTRAINT "blog_posts_excerpt_length" CHECK (length("blog_posts"."excerpt") <= 500)
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
	CONSTRAINT "comments_reply_has_no_quote" CHECK ("comments"."parent_id" is null or "comments"."quote" is null),
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
CREATE TABLE "reactions" (
	"item_id" uuid NOT NULL,
	"comment_id" uuid,
	"account_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_unique" UNIQUE NULLS NOT DISTINCT("item_id","comment_id","account_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "recent_views" (
	"account_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recent_views_account_id_item_id_pk" PRIMARY KEY("account_id","item_id")
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_scheduled_by_accounts_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_space_pinned_by_accounts_id_fk" FOREIGN KEY ("space_pinned_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_organization_pinned_by_accounts_id_fk" FOREIGN KEY ("organization_pinned_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_accounts_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_by_accounts_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_changes" ADD CONSTRAINT "task_status_changes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_changes" ADD CONSTRAINT "task_status_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_changed_by_accounts_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_notified_assignee_id_accounts_id_fk" FOREIGN KEY ("notified_assignee_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blog_posts_published_at_index" ON "blog_posts" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "blog_posts_scheduled_index" ON "blog_posts" USING btree ("scheduled_at") WHERE "blog_posts"."scheduled_at" is not null;--> statement-breakpoint
CREATE INDEX "blog_posts_scheduled_by_index" ON "blog_posts" USING btree ("scheduled_by");--> statement-breakpoint
CREATE INDEX "blog_posts_space_pinned_by_index" ON "blog_posts" USING btree ("space_pinned_by");--> statement-breakpoint
CREATE INDEX "blog_posts_organization_pinned_by_index" ON "blog_posts" USING btree ("organization_pinned_by");--> statement-breakpoint
CREATE INDEX "comments_item_id_created_at_index" ON "comments" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_id_index" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_author_id_index" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "comments_resolved_by_index" ON "comments" USING btree ("resolved_by");--> statement-breakpoint
CREATE INDEX "comments_deleted_by_index" ON "comments" USING btree ("deleted_by");--> statement-breakpoint
CREATE INDEX "content_mentions_account_id_notified_at_index" ON "content_mentions" USING btree ("account_id","notified_at");--> statement-breakpoint
CREATE INDEX "content_mentions_comment_id_index" ON "content_mentions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "content_mentions_actor_id_index" ON "content_mentions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "content_mentions_pending_index" ON "content_mentions" USING btree ("created_at") WHERE "content_mentions"."notified_at" is null;--> statement-breakpoint
CREATE INDEX "reactions_comment_id_index" ON "reactions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "reactions_account_id_index" ON "reactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "recent_views_account_id_viewed_at_index" ON "recent_views" USING btree ("account_id","viewed_at");--> statement-breakpoint
CREATE INDEX "recent_views_item_id_index" ON "recent_views" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "recent_views_viewed_at_index" ON "recent_views" USING btree ("viewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stars_item_unique" ON "stars" USING btree ("account_id","item_id") WHERE "stars"."item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stars_space_unique" ON "stars" USING btree ("account_id","space_id") WHERE "stars"."space_id" is not null;--> statement-breakpoint
CREATE INDEX "stars_item_id_index" ON "stars" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "stars_space_id_index" ON "stars" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "task_status_changes_task_id_changed_at_index" ON "task_status_changes" USING btree ("task_id","changed_at");--> statement-breakpoint
CREATE INDEX "task_status_changes_actor_id_index" ON "task_status_changes" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "tasks_item_id_index" ON "tasks" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_index" ON "tasks" USING btree ("assignee_id","done","due_date") WHERE "tasks"."published";--> statement-breakpoint
CREATE INDEX "tasks_status_changed_by_index" ON "tasks" USING btree ("status_changed_by");--> statement-breakpoint
CREATE INDEX "tasks_notified_assignee_id_index" ON "tasks" USING btree ("notified_assignee_id");