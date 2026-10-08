CREATE TABLE "give_access_drafts" (
	"account_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "give_access_drafts_account_id_space_id_pk" PRIMARY KEY("account_id","space_id")
);
--> statement-breakpoint
ALTER TABLE "give_access_drafts" ADD CONSTRAINT "give_access_drafts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "give_access_drafts" ADD CONSTRAINT "give_access_drafts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "give_access_drafts_space_id_index" ON "give_access_drafts" USING btree ("space_id");