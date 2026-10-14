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
ALTER TABLE "recent_views" ADD COLUMN "views" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recent_searches" ADD CONSTRAINT "recent_searches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_searches" ADD CONSTRAINT "recent_searches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recent_searches_organization_id_account_id_fingerprint_index" ON "recent_searches" USING btree ("organization_id","account_id","fingerprint");--> statement-breakpoint
CREATE INDEX "recent_searches_organization_id_account_id_searched_at_index" ON "recent_searches" USING btree ("organization_id","account_id","searched_at");--> statement-breakpoint
CREATE INDEX "recent_searches_account_id_index" ON "recent_searches" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "saved_searches_organization_id_account_id_index" ON "saved_searches" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE INDEX "saved_searches_account_id_index" ON "saved_searches" USING btree ("account_id");