DO $$
DECLARE
  reduced record;
BEGIN
  FOR reduced IN
    WITH changed AS (
      UPDATE "space_permissions" sp SET "role" = 'reader', "updated_at" = now()
      FROM "accounts" a
      WHERE sp.principal_kind = 'account' AND sp.principal_id = a.id AND a.type = 'portal' AND sp.role <> 'reader'
      RETURNING sp.space_id
    )
    SELECT space_id, count(*) AS roles FROM changed GROUP BY space_id ORDER BY space_id
  LOOP
    RAISE NOTICE 'Space %: % role(s) of portal accounts reduced to reader, because portal accounts can only read', reduced.space_id, reduced.roles;
  END LOOP;
END $$;
