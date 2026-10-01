CREATE TABLE "service_account_responsibles" (
	"service_account_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_account_responsibles_service_account_id_account_id_pk" PRIMARY KEY("service_account_id","account_id")
);
--> statement-breakpoint
DROP INDEX "api_tokens_account_id_index";--> statement-breakpoint
DROP INDEX "api_tokens_organization_id_index";--> statement-breakpoint
DROP INDEX "invitations_organization_id_index";--> statement-breakpoint
DROP INDEX "role_assignments_organization_id_index";--> statement-breakpoint
DROP INDEX "service_accounts_responsible_account_id_index";--> statement-breakpoint
ALTER TABLE "service_accounts" ADD COLUMN "unattended_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_account_responsibles" ADD CONSTRAINT "service_account_responsibles_service_account_id_service_accounts_account_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_responsibles" ADD CONSTRAINT "service_account_responsibles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_account_responsibles_account_id_index" ON "service_account_responsibles" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "accounts_name_id_index" ON "accounts" USING btree (lower("name"),"id");--> statement-breakpoint
CREATE INDEX "api_tokens_account_id_id_index" ON "api_tokens" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "api_tokens_organization_id_id_index" ON "api_tokens" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "invitations_organization_email_id_index" ON "invitations" USING btree ("organization_id",lower("email"),"id");--> statement-breakpoint
CREATE INDEX "organizations_name_id_index" ON "organizations" USING btree (lower("name"),"id");--> statement-breakpoint
CREATE INDEX "role_assignments_organization_id_id_index" ON "role_assignments" USING btree ("organization_id","id");