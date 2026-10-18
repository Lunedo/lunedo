CREATE FUNCTION "tree_items_lock_space"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('pagehall.tree_settled_later', true), '') <> 'on' THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('pagehall.tree:' || NEW."space_id"::text, 0));
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tree_items_lock_space" BEFORE INSERT OR UPDATE OF "space_id" ON "tree_items"
  FOR EACH ROW EXECUTE FUNCTION "tree_items_lock_space"();
