CREATE FUNCTION "portal_domains_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM pg_notify('pagehall_portal_domains', '');
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "portal_domains_changed" AFTER INSERT OR UPDATE OR DELETE ON "portal_domains"
	FOR EACH STATEMENT EXECUTE FUNCTION "portal_domains_changed"();
