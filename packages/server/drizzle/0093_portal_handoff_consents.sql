CREATE TABLE "portal_handoff_consents" (
	"account_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_handoff_consents_account_id_domain_pk" PRIMARY KEY("account_id","domain")
);
--> statement-breakpoint
ALTER TABLE "portal_handoff_consents" ADD CONSTRAINT "portal_handoff_consents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_handoff_consents" ADD CONSTRAINT "portal_handoff_consents_domain_portal_domains_domain_fk" FOREIGN KEY ("domain") REFERENCES "public"."portal_domains"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_handoff_consents_domain_index" ON "portal_handoff_consents" USING btree ("domain");