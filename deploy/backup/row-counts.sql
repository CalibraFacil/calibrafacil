-- Exact row count of every table, as `schema.table|count`, one per line (psql -At).
-- Used by restore.sh (to report what a restore brought back) and by the restore
-- drill (to compare the source with the restored copy). Run it as the table
-- owner: the tenant tables have row-level security for calibra_app only.
select table_schema || '.' || table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text::bigint
from information_schema.tables
where table_schema in ('public', 'drizzle')
  and table_type = 'BASE TABLE'
order by 1;
