-- A schema snapshot that does not depend on how the database got there
-- (roadmap 2 G4): one sorted line per column, constraint, index, trigger,
-- function, policy, RLS flag and table privilege of the public schema. Two
-- databases with the same schema print the same text whatever the column order
-- of their CREATE TABLEs (a migration's ADD COLUMN appends; schema.ts may not).
\pset format unaligned
\pset tuples_only on
SELECT line FROM (
  SELECT format('column %s.%s %s null=%s default=%s', c.table_name, c.column_name,
                c.data_type || coalesce('(' || c.character_maximum_length || ')', ''),
                c.is_nullable, coalesce(c.column_default, '-')) AS line
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
  UNION ALL
  SELECT format('constraint %s %s %s', t.relname, con.conname, pg_get_constraintdef(con.oid))
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
  UNION ALL
  SELECT format('index %s %s', tablename, indexdef)
    FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT format('trigger %s %s', t.relname, pg_get_triggerdef(tg.oid))
    FROM pg_trigger tg
    JOIN pg_class t ON t.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND NOT tg.tgisinternal
  UNION ALL
  SELECT format('function %s(%s) %s', p.proname, pg_get_function_identity_arguments(p.oid),
                md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  UNION ALL
  SELECT format('policy %s %s %s %s using=%s check=%s', tablename, policyname, cmd,
                roles::text, coalesce(qual, '-'), coalesce(with_check, '-'))
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  SELECT format('rls %s enabled=%s forced=%s', c.relname, c.relrowsecurity, c.relforcerowsecurity)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT format('grant %s %s %s', table_name, grantee, privilege_type)
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee NOT IN ('postgres', 'PUBLIC')
  UNION ALL
  SELECT format('sequence %s %s', sequence_name, data_type)
    FROM information_schema.sequences WHERE sequence_schema = 'public'
) AS snapshot
ORDER BY line;
