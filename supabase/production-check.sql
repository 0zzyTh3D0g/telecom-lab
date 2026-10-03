-- Read-only deployment inspection. No reset, seed or mutation.
select json_build_object(
  'migration_versions', (select json_agg(version order by version) from supabase_migrations.schema_migrations),
  'tables_without_rls', (select coalesce(json_agg(c.relname), '[]'::json) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),
  'public_security_definer', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef),
  'private_nonempty_search_path', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'],false)),
  'private_function_owners', (select json_agg(distinct pg_get_userbyid(p.proowner)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'),
  'anon_application_rpc_execute', (select coalesce(json_agg(p.proname), '[]'::json) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') and has_function_privilege('anon',p.oid,'EXECUTE')),
  'anon_table_select', (select coalesce(json_agg(c.relname), '[]'::json) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and has_table_privilege('anon',c.oid,'SELECT')),
  'contents', (select count(*) from public.content_items),
  'profiles', (select count(*) from public.profiles),
  'auth_identities', (select count(*) from auth.users),
  'owners', (select count(*) from public.workspace_memberships where role='owner')
) as production_verification;
