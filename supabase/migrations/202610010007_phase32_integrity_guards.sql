-- Serialize operational writes with activation; private callbacks remain unexposed.
create or replace function app_private.guard_archived_cohort() returns trigger language plpgsql security definer set search_path='' as $$
declare yid uuid;st text;
begin
 if tg_table_name in ('groups','assignments') then yid:=new.academic_year_id;
 else select academic_year_id into yid from public.groups where id=new.group_id;end if;
 select status into st from public.academic_years where id=yid for share;
 if st='archived' then raise exception 'academic_year_archived';end if;return new;
end $$;
revoke execute on function app_private.guard_archived_cohort() from public,anon,authenticated;
create or replace function app_private.restore_configuration_backup(payload jsonb) returns void language plpgsql security definer set search_path='' as $$ begin
 if not app_private.is_owner() then raise exception 'access_denied';end if;
 raise exception 'legacy_backup_requires_p31_conversion_to_v6';end $$;
-- Releases created from explicit individual P3.1 grants still require that
-- individual grant. The group does not gain access implicitly.
insert into public.subject_offerings(workspace_id,academic_year_id,track_id,subject_id,status)
select distinct c.workspace_id,g.academic_year_id,g.track_id,c.subject_id,'active'
from public.content_access a join public.content_items c on c.id=a.content_id
join public.enrollments e on e.user_id=a.user_id and e.workspace_id=c.workspace_id
join public.groups g on g.id=e.group_id join public.academic_years y on y.id=g.academic_year_id
where y.status<>'archived' and a.allowed and c.status='published' and not exists(select 1 from public.subject_offerings o where o.academic_year_id=g.academic_year_id and o.track_id=g.track_id and o.subject_id=c.subject_id and o.level_id is null);
insert into public.content_releases(workspace_id,content_id,content_version,academic_year_id,group_id,available_from,available_until,status,created_by)
select distinct c.workspace_id,c.id,(select max(version) from public.content_versions where content_id=c.id),g.academic_year_id,g.id,c.available_from,c.available_until,'published',null::uuid
from public.content_access a join public.content_items c on c.id=a.content_id
join public.enrollments e on e.user_id=a.user_id and e.workspace_id=c.workspace_id
join public.groups g on g.id=e.group_id join public.academic_years y on y.id=g.academic_year_id
where a.allowed and c.status='published' and y.status<>'archived' and exists(select 1 from public.content_versions where content_id=c.id)
and not exists(select 1 from public.content_releases r where r.content_id=c.id and r.group_id=g.id and r.status='published');

-- One authorized item for deep links/search, independent of catalog pagination.
create function app_private.content_catalog_item(cid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.content_items%rowtype;r public.content_releases%rowtype;doc jsonb;
begin
 select * into c from public.content_items where id=cid and workspace_id=app_private.current_workspace();if not found then return null;end if;
 if app_private.can_edit_subject(c.subject_id) then return to_jsonb(c)||jsonb_build_object('release_id',null,'content_version',null);end if;
 select * into r from public.content_releases where content_id=cid and app_private.release_eligible(auth.uid(),id) order by created_at desc limit 1;if not found then return null;end if;
 select document into doc from public.content_versions where content_id=cid and version=r.content_version;
 return jsonb_build_object('id',c.id,'subject_id',c.subject_id,'slug',doc->>'slug','title',doc->>'title','summary',doc->>'summary','level_code',coalesce(doc->>'levelCode',doc->>'year'),'module',doc->>'module','topic',doc->>'topic','tags',doc->'tags','status','published','sort_order',doc->'order','available_from',r.available_from,'available_until',r.available_until,'release_id',r.id,'content_version',r.content_version);
end $$;
create function app_private.resolve_lesson(content_slug text,subject_slug text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare matches jsonb;
begin
 if length(content_slug)>200 or length(coalesce(subject_slug,''))>200 then raise exception 'invalid_slug';end if;
 select coalesce(jsonb_agg(item),'[]') into matches from (select app_private.content_catalog_item(c.id) item from public.content_items c join public.subjects s on s.id=c.subject_id where c.workspace_id=app_private.current_workspace() and (subject_slug is null or s.slug=subject_slug) and ((c.slug=content_slug and app_private.can_edit_subject(c.subject_id)) or exists(select 1 from public.content_releases r join public.content_versions v on v.content_id=r.content_id and v.version=r.content_version where r.content_id=c.id and v.document->>'slug'=content_slug and app_private.release_eligible(auth.uid(),r.id)))) v where item is not null;
 if jsonb_array_length(matches)<>1 then return null;end if;return matches->0;
end $$;
create function public.resolve_lesson(content_slug text,subject_slug text default null) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.resolve_lesson(content_slug,subject_slug) $$;
create function app_private.search_catalog(query_text text,page_number int default 0,subject_id_filter uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if page_number<0 or page_number>1000 then raise exception 'invalid_page';end if;
 if length(trim(query_text))<2 or length(query_text)>200 then return '[]';end if;
 return coalesce((select jsonb_agg(item) from (
 select item from (select app_private.content_catalog_item(c.id) item from public.content_items c where c.workspace_id=app_private.current_workspace() and (subject_id_filter is null or c.subject_id=subject_id_filter)) v
 where item is not null and (strpos(lower(coalesce(item->>'title','')||' '||coalesce(item->>'summary','')||' '||coalesce(item->>'module','')||' '||coalesce(item->>'topic','')||' '||coalesce(item->>'tags','')),lower(trim(query_text)))>0
 or exists(select 1 from jsonb_array_elements(app_private.lesson_resources((item->>'id')::uuid,(item->>'release_id')::uuid)) resources cross join lateral jsonb_array_elements(resources->'blocks') b where strpos(lower(b::text),lower(trim(query_text)))>0))
 order by item->>'title',item->>'id' limit 50 offset page_number*50) results),'[]');
end $$;
create function public.search_catalog(query_text text,page_number int default 0,subject_id_filter uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.search_catalog(query_text,page_number,subject_id_filter) $$;
revoke execute on function app_private.content_catalog_item(uuid),app_private.resolve_lesson(text,text),public.resolve_lesson(text,text),app_private.search_catalog(text,int,uuid),public.search_catalog(text,int,uuid) from public,anon;
revoke execute on function app_private.content_catalog_item(uuid) from authenticated;
grant execute on function app_private.resolve_lesson(text,text),public.resolve_lesson(text,text),app_private.search_catalog(text,int,uuid),public.search_catalog(text,int,uuid) to authenticated;

create function app_private.group_release_state(gid uuid,cids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g public.groups%rowtype;c public.content_items%rowtype;r public.content_releases%rowtype;doc jsonb;reason text;result jsonb:='[]';module_on boolean;lesson_on boolean;resource_state jsonb;year_state text;resource_kind text;
begin
 if not app_private.is_manager() or cardinality(cids)>100 then raise exception 'access_denied';end if;
 select * into g from public.groups where id=gid and workspace_id=app_private.current_workspace();if not found then raise exception 'access_denied';end if;
 select status into year_state from public.academic_years where id=g.academic_year_id;
 for c in select * from public.content_items where id=any(cids) and workspace_id=g.workspace_id loop
 select * into r from public.content_releases where group_id=gid and content_id=c.id and status='published';
 reason:='Accesso effettivo del gruppo';module_on:=false;lesson_on:=false;resource_state:='{}';
 if r.id is null then reason:='Nessuna release al gruppo';
 else
 select document into doc from public.content_versions where content_id=c.id and version=r.content_version;
 select coalesce((select allowed from public.module_access where group_id=gid and subject_id=c.subject_id and level_code=coalesce(doc->>'levelCode',doc->>'year','') and module=doc->>'module'),false) into module_on;
 select coalesce((select allowed from public.content_access where group_id=gid and content_id=c.id),false) into lesson_on;
 if year_state<>'active' then reason:=case when year_state='archived' then 'Anno archiviato' else 'Anno non attivo' end;
 elsif not exists(select 1 from public.academic_years where id=g.academic_year_id and current_date between start_date and end_date) then reason:='Periodo anno non corrente';
 elsif g.archived_at is not null then reason:='Gruppo archiviato';
 elsif c.status='archived' then reason:='Contenuto archiviato';
 elsif exists(select 1 from public.subjects where id=c.subject_id and archived_at is not null) then reason:='Materia archiviata';
 elsif not exists(select 1 from public.subject_offerings where academic_year_id=g.academic_year_id and track_id=g.track_id and subject_id=c.subject_id and status='active' and (level_id is null or level_id=g.level_id)) then reason:='Offerta annuale non attiva';
 elsif r.available_from>now() then reason:='Pubblicazione programmata';elsif r.available_until<=now() then reason:='Disponibilità terminata';
 elsif not module_on then reason:='Bloccato dal modulo della release';elsif not lesson_on then reason:='Lezione disabilitata';end if;
 foreach resource_kind in array array['theory','simulation','exercise'] loop resource_state:=resource_state||jsonb_build_object(resource_kind,reason='Accesso effettivo del gruppo' and coalesce((select allowed from public.resource_access where group_id=gid and content_id=c.id and public.resource_access.kind=resource_kind),false));end loop;
 end if;
 result:=result||jsonb_build_array(jsonb_build_object('content_id',c.id,'content_version',r.content_version,'effective',reason='Accesso effettivo del gruppo','reason',reason,'resources',resource_state));
 end loop;return result;
end $$;
create function public.group_release_state(gid uuid,cids uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.group_release_state(gid,cids) $$;
revoke execute on function app_private.group_release_state(uuid,uuid[]),public.group_release_state(uuid,uuid[]) from public,anon;
grant execute on function app_private.group_release_state(uuid,uuid[]),public.group_release_state(uuid,uuid[]) to authenticated;
