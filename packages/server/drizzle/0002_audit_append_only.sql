CREATE FUNCTION "audit_events_reject_changes"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND current_setting('pagehall.audit_retention', true) = 'on' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE ON "audit_events"
	FOR EACH ROW EXECUTE FUNCTION "audit_events_reject_changes"();--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit_events"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_reject_changes"();
