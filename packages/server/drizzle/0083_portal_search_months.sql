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
ALTER TABLE "portal_search_months" ADD CONSTRAINT "portal_search_months_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;