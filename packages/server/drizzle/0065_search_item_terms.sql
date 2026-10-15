CREATE TABLE "search_item_terms" (
	"organization_id" uuid NOT NULL,
	"word" text NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "search_item_terms_organization_id_word_item_id_pk" PRIMARY KEY("organization_id","word","item_id")
);
--> statement-breakpoint
ALTER TABLE "search_item_terms" ADD CONSTRAINT "search_item_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_item_terms" ADD CONSTRAINT "search_item_terms_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_item_terms_item_id_index" ON "search_item_terms" USING btree ("item_id");--> statement-breakpoint
CREATE FUNCTION "search_prune_terms"() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER "search_item_terms_removed" AFTER DELETE ON "search_item_terms"
  REFERENCING OLD TABLE AS removed FOR EACH STATEMENT EXECUTE FUNCTION "search_prune_terms"();--> statement-breakpoint
INSERT INTO "search_item_terms" ("organization_id", "word", "item_id")
SELECT DISTINCT c.organization_id, w.word, c.item_id
FROM search_chunks c, unnest(tsvector_to_array(to_tsvector('simple', c.title || ' ' || c.heading || ' ' || c.body))) AS w(word)
WHERE c.organization_id IS NOT NULL AND length(w.word) BETWEEN 4 AND 40 AND w.word ~ '^[[:alpha:]]+$';--> statement-breakpoint
DELETE FROM "search_terms" t
WHERE NOT EXISTS (SELECT 1 FROM search_item_terms i WHERE i.organization_id = t.organization_id AND i.word = t.word);
