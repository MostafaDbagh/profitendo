-- The original method/reference check was created without an explicit name.
DO $$
DECLARE
  reference_check name;
BEGIN
  SELECT c.conname INTO STRICT reference_check
  FROM pg_constraint c
  WHERE c.conrelid = 'money_entries'::regclass AND c.contype = 'c'
    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
         FROM pg_attribute a
         WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey))
        = ARRAY['method', 'reference'];
  EXECUTE format('ALTER TABLE money_entries DROP CONSTRAINT %I', reference_check);
END $$;
