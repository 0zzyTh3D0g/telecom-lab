-- P3.1. Account identity is global; authority belongs to an institution membership.
alter table public.workspaces add column archived_at timestamptz;
create table public.workspace_memberships (
 workspace_id uuid not null references public.workspaces(id), user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null check(role in ('owner','manager','editor','reviewer','member')), disabled boolean not null default false,
 created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
insert into public.workspace_memberships(workspace_id,user_id,role) select workspace_id,id,role from public.profiles;
create index workspace_memberships_user_idx on public.workspace_memberships(user_id,workspace_id);
create table public.academic_years (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 label text not null check(length(label) between 2 and 80), start_date date not null, end_date date not null,
 status text not null default 'upcoming' check(status in ('upcoming','active','archived')),
 check(end_date>start_date), unique(workspace_id,label)
);
create table public.tracks (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(name) between 2 and 100), description text not null default '', archived_at timestamptz,
 unique(workspace_id,name)
);
create table public.track_subjects (
 track_id uuid not null references public.tracks(id), subject_id uuid not null references public.subjects(id), primary key(track_id,subject_id)
);
-- Preserve the existing cohort, without inserting teaching content or cloning people.
insert into public.academic_years(workspace_id,label,start_date,end_date,status)
 select id,'2026/2027','2026-09-01','2027-08-31','active' from public.workspaces;
insert into public.tracks(workspace_id,name) select id,'Da configurare' from public.workspaces;
alter table public.groups add column academic_year_id uuid references public.academic_years(id);
alter table public.groups add column track_id uuid references public.tracks(id);
update public.groups g set academic_year_id=y.id,track_id=t.id from public.academic_years y,public.tracks t where y.workspace_id=g.workspace_id and t.workspace_id=g.workspace_id;
alter table public.groups drop constraint groups_workspace_name_key;
alter table public.groups add unique(workspace_id,academic_year_id,name);
alter table public.assignments add column academic_year_id uuid references public.academic_years(id);
update public.assignments a set academic_year_id=y.id from public.subjects s,public.academic_years y where s.id=a.subject_id and y.workspace_id=s.workspace_id;
alter table public.content_items add column workspace_id uuid references public.workspaces(id);
update public.content_items c set workspace_id=s.workspace_id from public.subjects s where s.id=c.subject_id;
alter table public.content_items alter column workspace_id set not null;
alter table public.content_items drop constraint content_items_slug_key;
drop index if exists public.content_items_source_id_unique;
alter table public.content_items add unique(workspace_id,slug);
create unique index content_identity_workspace_idx on public.content_items(workspace_id,source_id) where source_id is not null;
create index groups_context_idx on public.groups(workspace_id,academic_year_id,track_id);
create index assignments_year_idx on public.assignments(academic_year_id,subject_id);

create or replace function app_private.current_workspace() returns uuid language plpgsql stable security definer set search_path='' as $$
declare wid uuid; raw text;
begin
 raw:=nullif(pg_catalog.current_setting('request.headers',true),'');
 begin wid:=(raw::jsonb->>'x-workspace-id')::uuid; exception when others then return null; end;
 if exists(select 1 from public.workspace_memberships m join public.profiles p on p.id=m.user_id join public.workspaces w on w.id=m.workspace_id
 where m.user_id=auth.uid() and m.workspace_id=wid and not m.disabled and not p.disabled and not p.must_change_password and w.archived_at is null) then return wid; end if;
 return null;
end $$;
create function app_private.current_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.workspace_memberships where user_id=auth.uid() and workspace_id=app_private.current_workspace() $$;
create or replace function app_private.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(app_private.current_role()='owner',false) $$;
create or replace function app_private.is_manager() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(app_private.current_role() in ('owner','manager'),false) $$;
create or replace function app_private.can_edit_subject(sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subjects s where s.id=sid and s.workspace_id=app_private.current_workspace() and
 (app_private.is_manager() or (app_private.current_role()='editor' and s.archived_at is null and exists(select 1 from public.staff_subjects ss where ss.subject_id=s.id and ss.user_id=auth.uid())))) $$;
create function app_private.can_read_curriculum_subject(sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subjects s where s.id=sid and s.workspace_id=app_private.current_workspace() and
 (app_private.is_manager() or (app_private.current_role() in ('editor','reviewer') and s.archived_at is null and exists(select 1 from public.staff_subjects ss where ss.subject_id=s.id and ss.user_id=auth.uid())))) $$;
create or replace function app_private.can_review_assignment(aid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.assignments a where a.id=aid and app_private.same_workspace_subject(a.subject_id) and
 (app_private.is_manager() or (app_private.current_role()='reviewer' and app_private.can_read_curriculum_subject(a.subject_id)))) $$;
create or replace function app_private.can_read_profile(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select uid=auth.uid() or exists(select 1 from public.workspace_memberships m where m.user_id=uid and m.workspace_id=app_private.current_workspace() and
 (app_private.is_owner() or (app_private.is_manager() and m.role='member') or exists(select 1 from public.attempts a where a.user_id=uid and app_private.can_review_attempt(a.id)))) $$;
create or replace function app_private.can_read_group(gid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.groups g where g.id=gid and g.workspace_id=app_private.current_workspace() and
 (app_private.is_manager() or app_private.current_role()='editor' or exists(select 1 from public.group_memberships where group_id=g.id and user_id=auth.uid())
 or exists(select 1 from public.assignment_targets where group_id=g.id and app_private.can_review_assignment(assignment_id)))) $$;

drop trigger protect_workspace_owner on public.profiles;
create or replace function app_private.protect_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.user_id<>old.user_id) then raise exception 'membership_identity_immutable'; end if;
 if old.role='owner' and not old.disabled and (tg_op='DELETE' or new.role<>'owner' or new.disabled) then
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(old.workspace_id::text));
  if not exists(select 1 from public.workspace_memberships m join public.profiles p on p.id=m.user_id where m.workspace_id=old.workspace_id and m.role='owner' and not m.disabled and not p.disabled and m.user_id<>old.user_id) then raise exception 'last_owner_required'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger protect_workspace_owner before update or delete on public.workspace_memberships for each row execute function app_private.protect_owner();

create or replace function app_private.guard_workspace_relations() returns trigger language plpgsql security definer set search_path='' as $$
declare wid uuid; target_wid uuid;
begin
 if tg_table_name='groups' then
  if new.academic_year_id is null then select id into new.academic_year_id from public.academic_years where workspace_id=new.workspace_id and status='active' order by start_date desc limit 1; end if;
  if new.track_id is null then select id into new.track_id from public.tracks where workspace_id=new.workspace_id and archived_at is null order by name limit 1; end if;
  if not exists(select 1 from public.academic_years where id=new.academic_year_id and workspace_id=new.workspace_id) or not exists(select 1 from public.tracks where id=new.track_id and workspace_id=new.workspace_id) then raise exception 'workspace_mismatch'; end if;
  if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.academic_year_id<>old.academic_year_id or new.track_id<>old.track_id) then raise exception 'group_context_immutable'; end if;
 elsif tg_table_name in ('group_memberships','staff_subjects') then
  if tg_table_name='group_memberships' then select workspace_id into wid from public.groups where id=new.group_id;
  else select workspace_id into wid from public.subjects where id=new.subject_id; end if;
  if not exists(select 1 from public.workspace_memberships where workspace_id=wid and user_id=new.user_id) then raise exception 'workspace_mismatch'; end if;
 elsif tg_table_name='content_items' then
  select workspace_id into new.workspace_id from public.subjects where id=new.subject_id;
  if tg_op='UPDATE' and new.subject_id<>old.subject_id then raise exception 'subject_move_requires_migration'; end if;
 elsif tg_table_name='assignments' then
  if new.content_id is not null then select subject_id into new.subject_id from public.content_items where id=new.content_id; end if;
  select workspace_id into wid from public.subjects where id=new.subject_id;
  if new.academic_year_id is null then select id into new.academic_year_id from public.academic_years where workspace_id=wid and status='active' order by start_date desc limit 1; end if;
  if not exists(select 1 from public.academic_years where id=new.academic_year_id and workspace_id=wid) then raise exception 'workspace_mismatch'; end if;
  if tg_op='UPDATE' and (new.subject_id<>old.subject_id or new.academic_year_id<>old.academic_year_id) then raise exception 'assignment_context_immutable'; end if;
 elsif tg_table_name in ('module_access','content_access','resource_access','assignment_targets') then
  if tg_table_name='module_access' then select workspace_id into wid from public.subjects where id=new.subject_id;
  elsif tg_table_name='assignment_targets' then select s.workspace_id into wid from public.assignments a join public.subjects s on s.id=a.subject_id where a.id=new.assignment_id;
  else select workspace_id into wid from public.content_items where id=new.content_id; end if;
  if new.group_id is not null then
   select workspace_id into target_wid from public.groups where id=new.group_id;
   if wid is distinct from target_wid then raise exception 'workspace_mismatch'; end if;
   if tg_table_name='assignment_targets' then
    if not exists(select 1 from public.groups g join public.assignments a on a.academic_year_id=g.academic_year_id where g.id=new.group_id and a.id=new.assignment_id) then raise exception 'academic_year_mismatch'; end if;
   end if;
  elsif not exists(select 1 from public.workspace_memberships where workspace_id=wid and user_id=new.user_id) then raise exception 'workspace_mismatch'; end if;
 elsif tg_table_name='track_subjects' then
  if (select workspace_id from public.tracks where id=new.track_id) is distinct from (select workspace_id from public.subjects where id=new.subject_id) then raise exception 'workspace_mismatch'; end if;
 elsif tg_table_name='audit_log' then new.workspace_id:=coalesce(new.workspace_id,app_private.current_workspace());
 end if;
 return new;
end $$;
create trigger p31_group_context before insert or update on public.groups for each row execute function app_private.guard_workspace_relations();
create trigger p31_track_context before insert or update on public.track_subjects for each row execute function app_private.guard_workspace_relations();
alter table public.audit_log alter column workspace_id set default app_private.current_workspace();

create function app_private.my_workspaces() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'role',m.role,'disabled',m.disabled,'archived_at',w.archived_at) order by w.name),'[]'::jsonb)
 from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id where m.user_id=auth.uid() and app_private.account_ready() $$;
create function public.my_workspaces() returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.my_workspaces() $$;
create function app_private.workspace_accounts(page_number int default 0,member_only boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if page_number<0 or page_number>1000 or app_private.current_workspace() is null then raise exception 'access_denied'; end if;
 return coalesce((select jsonb_agg(to_jsonb(v)) from (select p.id,p.username,p.first_name,p.last_name,p.must_change_password,m.workspace_id,m.role,(p.disabled or m.disabled) disabled
 from public.profiles p join public.workspace_memberships m on m.user_id=p.id where m.workspace_id=app_private.current_workspace() and app_private.can_read_profile(p.id) and (not member_only or m.role='member') order by p.username limit 50 offset page_number*50) v),'[]'::jsonb);
end $$;
create function public.workspace_accounts(page_number int default 0,member_only boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.workspace_accounts(page_number,member_only) $$;
create function app_private.attach_workspace_account(username_value text) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 if not app_private.is_owner() then raise exception 'access_denied'; end if;
 select id into uid from public.profiles where username=username_value and not disabled;
 if uid is null then raise exception 'account_not_available'; end if;
 insert into public.workspace_memberships(workspace_id,user_id,role) values(app_private.current_workspace(),uid,'member') on conflict do nothing;
 return uid;
end $$;
create function public.attach_workspace_account(username_value text) returns uuid language sql security invoker set search_path='' as $$ select app_private.attach_workspace_account(username_value) $$;
create function app_private.create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 if not app_private.is_owner() then raise exception 'access_denied'; end if;
 insert into public.workspaces(name) values(workspace_name) returning id into wid;
 insert into public.workspace_memberships(workspace_id,user_id,role) values(wid,auth.uid(),'owner');
 return wid;
end $$;
create function public.create_workspace(workspace_name text) returns uuid language sql security invoker set search_path='' as $$ select app_private.create_workspace(workspace_name) $$;

create function app_private.save_academic_year(year_id uuid,year_label text,start_on date,end_on date,year_status text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not app_private.is_manager() then raise exception 'access_denied'; end if;
 if year_id is null then insert into public.academic_years(workspace_id,label,start_date,end_date,status) values(app_private.current_workspace(),year_label,start_on,end_on,year_status) returning id into result;
 else update public.academic_years set label=year_label,start_date=start_on,end_date=end_on,status=year_status where id=year_id and workspace_id=app_private.current_workspace() returning id into result; end if;
 if result is null then raise exception 'access_denied'; end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),case when year_status='archived' then 'academic_year_archived' else 'academic_year_saved' end,result::text);
 return result;
end $$;
create function public.save_academic_year(year_id uuid,year_label text,start_on date,end_on date,year_status text) returns uuid language sql security invoker set search_path='' as $$ select app_private.save_academic_year(year_id,year_label,start_on,end_on,year_status) $$;
create function app_private.save_track(track_name text,track_description text,subject_ids uuid[] default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid;
begin
 if not app_private.is_manager() or exists(select 1 from unnest(subject_ids) sid where not app_private.same_workspace_subject(sid)) then raise exception 'access_denied'; end if;
 insert into public.tracks(workspace_id,name,description) values(app_private.current_workspace(),track_name,track_description) on conflict(workspace_id,name) do update set description=excluded.description returning id into tid;
 delete from public.track_subjects where track_id=tid;
 insert into public.track_subjects select tid,sid from (select distinct unnest(subject_ids) sid) v;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'track_saved',tid::text);
 return tid;
end $$;
create function public.save_track(track_name text,track_description text,subject_ids uuid[] default '{}') returns uuid language sql security invoker set search_path='' as $$ select app_private.save_track(track_name,track_description,subject_ids) $$;
create function app_private.update_track(track_id uuid,track_name text,track_description text,subject_ids uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not app_private.is_manager() or not exists(select 1 from public.tracks where id=track_id and workspace_id=app_private.current_workspace())
 or exists(select 1 from unnest(subject_ids) sid where not app_private.same_workspace_subject(sid)) then raise exception 'access_denied'; end if;
 update public.tracks set name=track_name,description=track_description where id=track_id;
 delete from public.track_subjects where track_subjects.track_id=update_track.track_id;
 insert into public.track_subjects select track_id,sid from (select distinct unnest(subject_ids) sid) v;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'track_saved',track_id::text);
 return track_id;
end $$;
create function public.update_track(track_id uuid,track_name text,track_description text,subject_ids uuid[]) returns uuid language sql security invoker set search_path='' as $$ select app_private.update_track(track_id,track_name,track_description,subject_ids) $$;

create table public.personal_library_items (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('content','module','exercise','assignmentTemplate','simulationConfig','plot','curriculumTemplate')),
 title text not null check(length(title) between 1 and 200), document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=1000000),
 provenance text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index personal_library_owner_idx on public.personal_library_items(owner_id,updated_at desc);
alter table public.content_items add column source_library_id uuid references public.personal_library_items(id) on delete set null;
create table public.curriculum_sources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),workspace_id uuid references public.workspaces(id),subject_id uuid references public.subjects(id),
 title text not null check(length(title) between 1 and 200), issuer text not null default '',discipline text not null default '',track text not null default '', articulation text not null default '',level text not null default '',
 document_year text not null default '',document_version text not null default '',document_date date,url text check(url is null or url ~ '^https?://'),
 source_type text not null default 'manual' check(source_type in ('official','manual')),text_content text not null default '' check(length(text_content)<=200000),notes text not null default '',metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.curriculum_plans (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id),workspace_id uuid references public.workspaces(id),academic_year_id uuid references public.academic_years(id),track_id uuid references public.tracks(id),subject_id uuid references public.subjects(id),
 title text not null,status text not null check(status in ('draft','proposed','approved','archived')),version int not null default 1,document jsonb not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.curriculum_plan_versions (
 plan_id uuid not null references public.curriculum_plans(id) on delete cascade,version int not null,document jsonb not null,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),primary key(plan_id,version)
);
create index curriculum_sources_context_idx on public.curriculum_sources(workspace_id,subject_id,created_at desc);
create index curriculum_plans_context_idx on public.curriculum_plans(workspace_id,academic_year_id,subject_id,updated_at desc);

create function app_private.can_read_plan(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.curriculum_plans where id=pid and app_private.account_ready() and ((workspace_id is null and owner_id=auth.uid()) or (workspace_id=app_private.current_workspace() and app_private.can_read_curriculum_subject(subject_id)))) $$;
create function app_private.can_edit_plan(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.curriculum_plans p where p.id=pid and app_private.account_ready() and ((p.workspace_id is null and p.owner_id=auth.uid()) or (p.workspace_id=app_private.current_workspace() and app_private.can_edit_subject(p.subject_id) and exists(select 1 from public.academic_years y where y.id=p.academic_year_id and y.status<>'archived')))) $$;
create function app_private.save_curriculum_source(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare wid uuid:=(payload->>'workspaceId')::uuid; sid uuid:=(payload->>'subjectId')::uuid; result uuid;
begin
 if not app_private.account_ready() or (wid is not null and (wid is distinct from app_private.current_workspace() or not app_private.can_edit_subject(sid))) or (wid is null and sid is not null) then raise exception 'access_denied'; end if;
 insert into public.curriculum_sources(owner_id,workspace_id,subject_id,title,issuer,discipline,track,articulation,level,document_year,document_version,document_date,url,source_type,text_content,notes,metadata)
 values(auth.uid(),wid,sid,payload->>'title',coalesce(payload->>'issuer',''),coalesce(payload->>'discipline',''),coalesce(payload->>'track',''),coalesce(payload->>'articulation',''),coalesce(payload->>'level',''),coalesce(payload->>'documentYear',''),coalesce(payload->>'documentVersion',''),nullif(payload->>'documentDate','')::date,nullif(payload->>'url',''),coalesce(payload->>'sourceType','manual'),coalesce(payload->>'text',''),coalesce(payload->>'notes',''),coalesce(payload->'metadata','{}')) returning id into result;
 return result;
end $$;
create function public.save_curriculum_source(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select app_private.save_curriculum_source(payload) $$;
create function app_private.delete_curriculum_source(source_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.curriculum_sources%rowtype;
begin
 select * into s from public.curriculum_sources where id=source_id;
 if not found or not app_private.account_ready() or (s.workspace_id is null and s.owner_id<>auth.uid()) or (s.workspace_id is not null and not app_private.can_edit_subject(s.subject_id)) then raise exception 'access_denied'; end if;
 if exists(select 1 from public.curriculum_plans where document->'sourceIds' @> jsonb_build_array(source_id::text)) then raise exception 'source_used_by_plan'; end if;
 delete from public.curriculum_sources where id=source_id;
 if s.workspace_id is not null then insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'curriculum_source_deleted',source_id::text); end if;
end $$;
create function public.delete_curriculum_source(source_id uuid) returns void language sql security invoker set search_path='' as $$ select app_private.delete_curriculum_source(source_id) $$;

create function app_private.save_curriculum_plan(doc jsonb,plan_id uuid default null,expected_version int default 0,operation text default 'save') returns uuid language plpgsql security definer set search_path='' as $$
declare wid uuid:=(doc->'context'->>'workspaceId')::uuid; sid uuid:=(doc->'context'->>'subjectId')::uuid; yid uuid:=(doc->'context'->>'academicYearId')::uuid; tid uuid:=(doc->'context'->>'trackId')::uuid;
 p public.curriculum_plans%rowtype; result uuid; v int; state text; entry jsonb; module jsonb; topic jsonb; source_id uuid;
begin
 if not app_private.account_ready() then raise exception 'access_denied'; end if;
 if wid is null then if sid is not null or yid is not null or tid is not null then raise exception 'invalid_personal_context'; end if;
 elsif wid is distinct from app_private.current_workspace() or not app_private.can_edit_subject(sid) then raise exception 'access_denied';
 elsif not exists(select 1 from public.academic_years where id=yid and workspace_id=wid and status<>'archived') or not exists(select 1 from public.tracks where id=tid and workspace_id=wid and archived_at is null) then raise exception 'curriculum_context_unavailable'; end if;
 if doc->>'schemaVersion' is distinct from '1' or jsonb_typeof(doc->'modules') is distinct from 'array' or jsonb_typeof(doc->'sourceIds') is distinct from 'array' or length(coalesce(doc->>'title','')) not between 1 and 200 or octet_length(doc::text)>1000000 then raise exception 'invalid_curriculum_plan'; end if;
 if jsonb_typeof(doc->'hours') is distinct from 'object' or jsonb_typeof(doc->'hours'->'weekly') is distinct from 'number' or jsonb_typeof(doc->'hours'->'weeks') is distinct from 'number'
 or (doc->'hours'->>'weekly')::numeric not between 0 and 60 or (doc->'hours'->>'weeks')::numeric not between 1 and 60 or (doc->'hours'->>'weeks')::numeric<>floor((doc->'hours'->>'weeks')::numeric) then raise exception 'invalid_curriculum_hours'; end if;
 for entry in select to_jsonb(reserve_field.name) from unnest(array['assessmentPercent','assessmentHours','recoveryHours','activityHours']) reserve_field(name) loop
 if jsonb_typeof(doc->'hours'->(entry#>>'{}')) is distinct from 'number' or (doc->'hours'->>(entry#>>'{}'))::numeric not between 0 and (case when entry#>>'{}'='assessmentPercent' then 100 else 2000 end) then raise exception 'invalid_curriculum_hours'; end if;
 end loop;
 if jsonb_typeof(doc->'hours'->'excludedPeriods') is distinct from 'array' then raise exception 'invalid_excluded_periods'; end if;
 for entry in select value from jsonb_array_elements(doc->'hours'->'excludedPeriods') loop
 if entry->>'start' is null or entry->>'end' is null or (entry->>'start')::date>(entry->>'end')::date then raise exception 'invalid_excluded_period'; end if;
 end loop;
 if exists(select 1 from (select m->>'id' ident from jsonb_array_elements(doc->'modules') m union all select t->>'id' ident from jsonb_array_elements(doc->'modules') m cross join lateral jsonb_array_elements(m->'topics') t) all_ids group by ident having count(*)>1) then raise exception 'duplicate_curriculum_id'; end if;
 for entry in select value from jsonb_array_elements(doc->'sourceIds') loop
 source_id:=(entry#>>'{}')::uuid;
 if not exists(select 1 from public.curriculum_sources s where s.id=source_id and ((s.workspace_id is null and s.owner_id=auth.uid()) or (s.workspace_id=wid and s.subject_id=sid and app_private.can_read_curriculum_subject(s.subject_id)))) then raise exception 'source_access_denied'; end if;
 end loop;
 for module in select value from jsonb_array_elements(doc->'modules') loop
 if length(coalesce(module->>'id',''))=0 or length(coalesce(module->>'title',''))=0 or jsonb_typeof(module->'durationHours') is distinct from 'number' or (module->>'durationHours')::numeric not between 0 and 2000 or jsonb_typeof(module->'topics') is distinct from 'array'
 or (module->>'startMonth')::int not between 1 and 12 or (module->>'endMonth')::int not between 1 and 12 or module->>'startMonth' is null or module->>'endMonth' is null then raise exception 'invalid_curriculum_module'; end if;
 for entry in select value from jsonb_array_elements(coalesce(module->'origins','[]')) loop
 if not (doc->'sourceIds' @> jsonb_build_array(entry->>'sourceId')) then raise exception 'invalid_source_reference'; end if;
 end loop;
 for topic in select value from jsonb_array_elements(module->'topics') loop
 if length(coalesce(topic->>'id',''))=0 or length(coalesce(topic->>'title',''))=0 or coalesce(topic->>'progress','not_started') not in ('not_started','in_progress','treated','skipped','deferred') then raise exception 'invalid_curriculum_topic'; end if;
 end loop;
 end loop;
 if operation not in ('save','import','approve','restore') then raise exception 'invalid_operation'; end if;
 state:=coalesce(doc->>'status','draft');
 if operation='import' then state:='proposed'; elsif operation='approve' then
 if wid is not null and not app_private.is_manager() then raise exception 'approval_requires_manager'; end if; state:='approved';
 elsif state='approved' then state:='proposed'; end if;
 if state not in ('draft','proposed','approved','archived') then raise exception 'invalid_plan_status'; end if;
 if plan_id is not null then
 select * into p from public.curriculum_plans where id=plan_id for update;
 if not found or not app_private.can_edit_plan(plan_id) or p.workspace_id is distinct from wid or p.subject_id is distinct from sid or p.academic_year_id is distinct from yid or p.track_id is distinct from tid then raise exception 'access_denied'; end if;
 if p.version<>expected_version then raise exception 'plan_version_conflict'; end if;
 result:=p.id;v:=p.version+1;
 else v:=1;result:=gen_random_uuid(); end if;
 doc:=doc||jsonb_build_object('version',v,'status',state);
 if plan_id is null then insert into public.curriculum_plans(id,owner_id,workspace_id,academic_year_id,track_id,subject_id,title,status,version,document) values(result,auth.uid(),wid,yid,tid,sid,doc->>'title',state,v,doc);
 else update public.curriculum_plans set title=doc->>'title',status=state,version=v,document=doc,updated_at=clock_timestamp() where id=result; end if;
 insert into public.curriculum_plan_versions(plan_id,version,document,created_by) values(result,v,doc,auth.uid());
 if wid is not null and operation in ('approve','restore') then insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'curriculum_'||operation,result::text); end if;
 return result;
end $$;
create function public.save_curriculum_plan(doc jsonb,plan_id uuid default null,expected_version int default 0,operation text default 'save') returns uuid language sql security invoker set search_path='' as $$ select app_private.save_curriculum_plan(doc,plan_id,expected_version,operation) $$;
create function app_private.restore_curriculum_plan(plan_id uuid,source_version int,expected_version int) returns uuid language plpgsql security definer set search_path='' as $$
declare doc jsonb;
begin
 if not app_private.can_edit_plan(plan_id) then raise exception 'access_denied'; end if;
 select document into doc from public.curriculum_plan_versions where curriculum_plan_versions.plan_id=restore_curriculum_plan.plan_id and version=source_version;
 if doc is null then raise exception 'version_not_found'; end if;
 return app_private.save_curriculum_plan(doc,plan_id,expected_version,'restore');
end $$;
create function public.restore_curriculum_plan(plan_id uuid,source_version int,expected_version int) returns uuid language sql security invoker set search_path='' as $$ select app_private.restore_curriculum_plan(plan_id,source_version,expected_version) $$;
create function app_private.fork_personal_content(item_id uuid,subject_id uuid,new_slug text) returns jsonb language plpgsql security definer set search_path='' as $$
declare doc jsonb; result jsonb;
begin
 if not app_private.can_edit_subject(subject_id) then raise exception 'access_denied'; end if;
 select document into doc from public.personal_library_items where id=item_id and owner_id=auth.uid() and kind='content';
 if doc is null then raise exception 'personal_item_not_found'; end if;
 doc:=doc||jsonb_build_object('id',gen_random_uuid()::text,'slug',new_slug,'subject',(select slug from public.subjects where id=subject_id));
 result:=app_private.save_content_document(doc,null);
 update public.content_items set source_library_id=item_id where id=(result->>'contentId')::uuid;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'personal_content_forked',result->>'contentId');
 return result;
end $$;
create function public.fork_personal_content(item_id uuid,subject_id uuid,new_slug text) returns jsonb language sql security invoker set search_path='' as $$ select app_private.fork_personal_content(item_id,subject_id,new_slug) $$;

alter table public.workspace_memberships enable row level security;
alter table public.academic_years enable row level security;
alter table public.tracks enable row level security;
alter table public.track_subjects enable row level security;
alter table public.personal_library_items enable row level security;
alter table public.curriculum_sources enable row level security;
alter table public.curriculum_plans enable row level security;
alter table public.curriculum_plan_versions enable row level security;
create policy institution_memberships_read on public.workspace_memberships for select to authenticated using(workspace_id=app_private.current_workspace() and app_private.can_read_profile(user_id));
create policy academic_years_read on public.academic_years for select to authenticated using(workspace_id=app_private.current_workspace());
create policy tracks_read on public.tracks for select to authenticated using(workspace_id=app_private.current_workspace());
create policy track_subjects_read on public.track_subjects for select to authenticated using(app_private.can_read_subject(subject_id) and exists(select 1 from public.tracks where id=track_id));
create policy personal_library_read on public.personal_library_items for select to authenticated using(owner_id=auth.uid() and app_private.account_ready());
create policy personal_library_insert on public.personal_library_items for insert to authenticated with check(owner_id=auth.uid() and app_private.account_ready());
create policy personal_library_update on public.personal_library_items for update to authenticated using(owner_id=auth.uid() and app_private.account_ready()) with check(owner_id=auth.uid() and app_private.account_ready());
create policy personal_library_delete on public.personal_library_items for delete to authenticated using(owner_id=auth.uid() and app_private.account_ready());
create policy curriculum_sources_read on public.curriculum_sources for select to authenticated using(app_private.account_ready() and ((workspace_id is null and owner_id=auth.uid()) or (workspace_id=app_private.current_workspace() and app_private.can_read_curriculum_subject(subject_id))));
create policy curriculum_plans_read on public.curriculum_plans for select to authenticated using(app_private.can_read_plan(id));
create policy curriculum_versions_read on public.curriculum_plan_versions for select to authenticated using(app_private.can_read_plan(plan_id));
drop policy staff_scopes_read on public.staff_subjects;
create policy staff_scopes_read on public.staff_subjects for select to authenticated using(app_private.same_workspace_subject(subject_id) and (user_id=auth.uid() or app_private.is_owner()));
drop policy memberships_read on public.group_memberships;
create policy memberships_read on public.group_memberships for select to authenticated using(app_private.can_read_group(group_id) and (user_id=auth.uid() or app_private.is_manager()));
drop policy attempts_read on public.attempts;
create policy attempts_read on public.attempts for select to authenticated using((app_private.account_ready() and user_id=auth.uid() and exists(select 1 from public.questions q join public.assignments a on a.id=q.assignment_id where q.id=question_id and app_private.same_workspace_subject(a.subject_id))) or app_private.can_review_attempt(id));
drop policy reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to authenticated using(app_private.can_review_attempt(attempt_id) or exists(select 1 from public.attempts a where a.id=attempt_id and a.user_id=auth.uid()));
drop policy activity_read on public.lesson_activity;
create policy activity_read on public.lesson_activity for select to authenticated using(exists(select 1 from public.content_items c where c.id=content_id and c.workspace_id=app_private.current_workspace()) and ((app_private.account_ready() and user_id=auth.uid()) or app_private.is_manager()));
drop policy practice_read on public.practice_progress;
create policy practice_read on public.practice_progress for select to authenticated using(exists(select 1 from public.content_items c where c.id=content_id and c.workspace_id=app_private.current_workspace()) and ((app_private.account_ready() and user_id=auth.uid()) or app_private.is_manager()));

revoke all on public.workspace_memberships,public.academic_years,public.tracks,public.track_subjects,public.personal_library_items,public.curriculum_sources,public.curriculum_plans,public.curriculum_plan_versions from public,anon,authenticated;
grant select on public.workspace_memberships,public.academic_years,public.tracks,public.track_subjects,public.personal_library_items,public.curriculum_sources,public.curriculum_plans,public.curriculum_plan_versions to authenticated;
grant insert,delete on public.personal_library_items to authenticated;
grant update(title,document,updated_at) on public.personal_library_items to authenticated;
grant all on public.workspace_memberships,public.academic_years,public.tracks,public.track_subjects,public.personal_library_items,public.curriculum_sources,public.curriculum_plans,public.curriculum_plan_versions to service_role;

-- Existing transactional operations, re-scoped to memberships.
create or replace function app_private.can_read_content(cid uuid) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare c public.content_items%rowtype; module_allowed boolean; lesson_allowed boolean;
begin
  if not app_private.account_ready() then return false; end if;
  select * into c from public.content_items where id=cid;
  if not found or not app_private.same_workspace_subject(c.subject_id) then return false; end if;
  if app_private.can_edit_subject(c.subject_id) then return true; end if;
  if exists(select 1 from public.subjects where id=c.subject_id and archived_at is not null) then return false; end if;
  if c.status<>'published' or (c.available_from is not null and c.available_from>now())
    or (c.available_until is not null and c.available_until<=now()) then return false; end if;
  select allowed into module_allowed from public.module_access
    where user_id=auth.uid() and subject_id=c.subject_id and year=c.year and module=c.module;
  if not found then
    select coalesce(bool_or(ma.allowed),false) into module_allowed from public.module_access ma
      join public.groups g on g.id=ma.group_id and g.archived_at is null and exists(select 1 from public.academic_years y where y.id=g.academic_year_id and y.status='active')
      join public.group_memberships gm on gm.group_id=g.id
      where gm.user_id=auth.uid() and ma.subject_id=c.subject_id and ma.year=c.year and ma.module=c.module;
  end if;
  if not coalesce(module_allowed,false) then return false; end if;
  select allowed into lesson_allowed from public.content_access where content_id=cid and user_id=auth.uid();
  if found then return lesson_allowed; end if;
  return exists(select 1 from public.content_access ca
    join public.groups g on g.id=ca.group_id and g.archived_at is null and exists(select 1 from public.academic_years y where y.id=g.academic_year_id and y.status='active')
    join public.group_memberships gm on gm.group_id=g.id
    where gm.user_id=auth.uid() and ca.content_id=cid and ca.allowed);
end $$;

create or replace function app_private.can_read_resource(cid uuid, rkind text) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare direct_allowed boolean;
begin
  if exists(select 1 from public.content_items where id=cid and app_private.can_edit_subject(subject_id)) then return true; end if;
  if not app_private.can_read_content(cid) then return false; end if;
  select allowed into direct_allowed from public.resource_access where content_id=cid and kind=rkind and user_id=auth.uid();
  if found then return direct_allowed; end if;
  return exists(select 1 from public.resource_access ra
    join public.groups g on g.id=ra.group_id and g.archived_at is null and exists(select 1 from public.academic_years y where y.id=g.academic_year_id and y.status='active')
    join public.group_memberships gm on gm.group_id=g.id
    where ra.content_id=cid and ra.kind=rkind and ra.allowed and gm.user_id=auth.uid());
end $$;

create or replace function app_private.can_read_assignment(aid uuid) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare a public.assignments%rowtype; direct_allowed boolean;
begin
  if not app_private.account_ready() then return false; end if;
  select * into a from public.assignments where id=aid;
  if not found or not app_private.same_workspace_subject(a.subject_id) then return false; end if;
  if app_private.can_edit_subject(a.subject_id) or app_private.can_review_assignment(a.id) then return true; end if;
  if exists(select 1 from public.subjects where id=a.subject_id and archived_at is not null) then return false; end if;
  if not exists(select 1 from public.academic_years y where y.id=a.academic_year_id and y.status='active') then return false; end if;
  if a.status<>'published' or (a.available_from is not null and a.available_from>now()) then return false; end if;
  select allowed into direct_allowed from public.assignment_targets where assignment_id=aid and user_id=auth.uid();
  if found then return direct_allowed; end if;
  return exists(select 1 from public.assignment_targets t
    join public.groups g on g.id=t.group_id and g.archived_at is null and exists(select 1 from public.academic_years y where y.id=g.academic_year_id and y.status='active')
    join public.group_memberships gm on gm.group_id=g.id
    where t.assignment_id=aid and t.allowed and gm.user_id=auth.uid());
end $$;

create or replace function app_private.user_can_read_content(uid uuid,cid uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare item public.content_items%rowtype; module_allowed boolean; lesson_allowed boolean;
begin
  if not exists(select 1 from public.profiles p join public.workspace_memberships m on m.user_id=p.id where p.id=uid and m.workspace_id=app_private.current_workspace() and m.role='member' and not m.disabled
    and not p.disabled and not p.must_change_password) then return false; end if;
  select * into item from public.content_items where id=cid;
  if not found or not exists(select 1 from public.subjects s join public.workspace_memberships p on p.workspace_id=s.workspace_id where s.workspace_id=app_private.current_workspace() and s.id=item.subject_id and p.user_id=uid and s.archived_at is null) then return false; end if;
  if item.status<>'published' or (item.available_from is not null and item.available_from>now())
    or (item.available_until is not null and item.available_until<=now()) then return false; end if;
  select allowed into module_allowed from public.module_access where user_id=uid and subject_id=item.subject_id and year=item.year and module=item.module;
  if not found then select coalesce(bool_or(ma.allowed),false) into module_allowed from public.module_access ma
    join public.groups g on g.id=ma.group_id and g.archived_at is null and exists(select 1 from public.academic_years y where y.id=g.academic_year_id and y.status='active')
    join public.group_memberships gm on gm.group_id=g.id
    where gm.user_id=uid and ma.subject_id=item.subject_id and ma.year=item.year and ma.module=item.module; end if;
  if not coalesce(module_allowed,false) then return false; end if;
  select allowed into lesson_allowed from public.content_access where content_id=cid and user_id=uid;
  if found then return lesson_allowed; end if;
  return exists(select 1 from public.content_access ca
    join public.groups g on g.id=ca.group_id and g.archived_at is null and exists(select 1 from public.academic_years y where y.id=g.academic_year_id and y.status='active')
    join public.group_memberships gm on gm.group_id=g.id
    where gm.user_id=uid and ca.content_id=cid and ca.allowed);
end $$;

create or replace function app_private.save_content_document(doc jsonb, expected_content_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid uuid; cid uuid; next_version int; old_slug text; kind_name text; resource_blocks jsonb; searchable text;
begin
  select id into sid from public.subjects where workspace_id=app_private.current_workspace() and slug=coalesce(doc->>'subject','telecomunicazioni') and archived_at is null;
  if sid is null or not app_private.can_edit_subject(sid) then raise exception 'subject_access_denied'; end if;
  doc:=doc||pg_catalog.jsonb_build_object('subject',(select slug from public.subjects where id=sid));
  if doc->>'schemaVersion' is distinct from '2' or pg_catalog.jsonb_typeof(doc->'blocks') is distinct from 'array'
    or pg_catalog.jsonb_array_length(doc->'blocks')<1 or doc->>'slug' is null
    or doc->>'title' is null or doc->>'module' is null then raise exception 'invalid_content_document'; end if;
  if doc->>'id' is null then raise exception 'missing_content_id'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(app_private.current_workspace()::text||':id:'||(doc->>'id')));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(app_private.current_workspace()::text||':slug:'||(doc->>'slug')));
  if (select count(*) from public.content_items where workspace_id=app_private.current_workspace() and (slug=doc->>'slug' or source_id=doc->>'id'))>1
    then raise exception 'content_identity_conflict'; end if;
  select id into cid from public.content_items where workspace_id=app_private.current_workspace() and (slug=doc->>'slug' or source_id=doc->>'id') for update;
  if cid is not null and not exists(select 1 from public.content_items where id=cid and subject_id=sid) then raise exception 'content_identity_conflict'; end if;
  if expected_content_id is not null and cid is distinct from expected_content_id then raise exception 'content_identity_mismatch'; end if;
  if cid is not null and expected_content_id is null then raise exception 'content_already_exists'; end if;
  if cid is null then
    insert into public.content_items(subject_id,source_id,slug,title,summary,year,module,topic,tags,sort_order,status)
      values(sid,doc->>'id',doc->>'slug',doc->>'title',doc->>'summary',(doc->>'year')::int,doc->>'module',doc->>'topic',
        array(select pg_catalog.jsonb_array_elements_text(doc->'tags')),(doc->>'order')::int,'draft') returning id into cid;
    next_version:=1;
  else
    select slug into old_slug from public.content_items where id=cid;
    if exists(select 1 from public.content_items where id=cid and source_id is not null and source_id<>doc->>'id')
      then raise exception 'content_identity_mismatch'; end if;
    if exists(select 1 from public.content_versions where content_id=cid and document->>'id' is not null
      and document->>'id'<>doc->>'id') then raise exception 'content_identity_mismatch'; end if;
    if old_slug is distinct from doc->>'slug' and not exists
      (select 1 from public.content_items where id=cid and source_id=doc->>'id') then raise exception 'content_identity_mismatch'; end if;
    update public.content_items set source_id=doc->>'id',slug=doc->>'slug',title=doc->>'title',summary=doc->>'summary',year=(doc->>'year')::int,
      module=doc->>'module',topic=doc->>'topic',tags=array(select pg_catalog.jsonb_array_elements_text(doc->'tags')),
      sort_order=(doc->>'order')::int,status='draft',updated_at=pg_catalog.clock_timestamp() where id=cid;
    select coalesce(max(version),0)+1 into next_version from public.content_versions where content_id=cid;
  end if;
  insert into public.content_versions(content_id,version,document,created_by)
    values(cid,next_version,doc,auth.uid());
  foreach kind_name in array array['theory','simulation','exercise'] loop
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('block',b.value,'position',b.ordinality-1)
        order by b.ordinality),'[]'::jsonb),
      coalesce(pg_catalog.left(pg_catalog.string_agg(b.value::text,' ' order by b.ordinality),25000),'')
      into resource_blocks,searchable
      from pg_catalog.jsonb_array_elements(doc->'blocks') with ordinality as b(value,ordinality)
      where case when b.value->>'type'='simulation' or pg_catalog.right(b.value->>'type',4)='Plot' then 'simulation'
        when b.value->>'type' in ('exercise','guidedExercise','parametricExercise','practiceQuestion','exerciseGroup',
          'exerciseStep','hint','solution') then 'exercise' else 'theory' end = kind_name;
    insert into public.content_resources(content_id,kind,blocks,search_text) values(cid,kind_name,resource_blocks,searchable)
      on conflict(content_id,kind) do update set blocks=excluded.blocks,search_text=excluded.search_text;
  end loop;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'content_version_saved',cid::text);
  return pg_catalog.jsonb_build_object('contentId',cid,'version',next_version);
end $$;

create or replace function app_private.management_account_activity(uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.workspace_memberships where user_id=uid and workspace_id=app_private.current_workspace()) then raise exception 'access_denied'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'contentId',c.id,'title',c.title,'subjectId',c.subject_id,'firstOpen',la.opened_at,'lastOpen',la.last_opened_at,
    'openCount',coalesce(la.open_count,0),'activeSeconds',coalesce(la.active_seconds,0),
    'practiceAttempted',(select count(*) from public.practice_progress pp where pp.user_id=uid and pp.content_id=c.id),
    'practiceCompleted',(select count(*) from public.practice_progress pp where pp.user_id=uid and pp.content_id=c.id and pp.completed),
    'assignmentAttempts',(select count(*) from public.attempts a join public.questions q on q.id=a.question_id
      join public.assignments ass on ass.id=q.assignment_id where a.user_id=uid and ass.content_id=c.id),
    'pendingReviews',(select count(*) from public.reviews r join public.attempts a on a.id=r.attempt_id
      join public.questions q on q.id=a.question_id join public.assignments ass on ass.id=q.assignment_id
      where a.user_id=uid and ass.content_id=c.id and r.status<>'reviewed'),
    'feedback',(select r.feedback from public.reviews r join public.attempts a on a.id=r.attempt_id
      join public.questions q on q.id=a.question_id join public.assignments ass on ass.id=q.assignment_id
      where a.user_id=uid and ass.content_id=c.id and r.status='reviewed' and r.feedback is not null
      order by r.updated_at desc limit 1)
  ) order by c.year,c.module,c.sort_order) from public.content_items c
    left join public.lesson_activity la on la.user_id=uid and la.content_id=c.id
    where c.workspace_id=app_private.current_workspace() and (app_private.user_can_read_content(uid,c.id) or la.content_id is not null)),'[]'::jsonb);
end $$;

create or replace function app_private.management_group_activity(gid uuid,sid uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not app_private.is_manager() or not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace())
 or (sid is not null and not app_private.same_workspace_subject(sid)) then raise exception 'access_denied'; end if;
 with members as (select p.id from public.profiles p join public.group_memberships gm on gm.user_id=p.id
   join public.workspace_memberships wm on wm.user_id=p.id and wm.workspace_id=app_private.current_workspace() where gm.group_id=gid and wm.role='member' and not p.disabled and not p.must_change_password),
 eligible as (select m.id uid,c.id cid from members m join public.content_items c on c.workspace_id=app_private.current_workspace() and (app_private.user_can_read_content(m.id,c.id) or exists(select 1 from public.content_access ca where ca.content_id=c.id and ca.group_id=gid and ca.allowed))
   where sid is null or c.subject_id=sid),
 practice as (select pp.* from public.practice_progress pp join eligible e on e.uid=pp.user_id and e.cid=pp.content_id),
 attempt_data as (select a.id,a.correct,q.id qid,q.prompt from public.attempts a join members m on m.id=a.user_id
   join public.questions q on q.id=a.question_id join public.assignments ass on ass.id=q.assignment_id where app_private.same_workspace_subject(ass.subject_id) and (sid is null or ass.subject_id=sid) and exists(select 1 from public.assignment_targets t where t.assignment_id=ass.id and t.group_id=gid))
 select pg_catalog.jsonb_build_object(
 'eligible',(select count(*) from eligible),
 'opened',(select count(*) from eligible e join public.lesson_activity la on la.user_id=e.uid and la.content_id=e.cid),
 'practiceAttempted',(select count(*) from practice),'practiceCompleted',(select count(*) from practice where completed),
 'practiceAttempts',(select coalesce(sum(attempts),0) from practice),
 'pendingReviews',(select count(*) from public.reviews r join attempt_data a on a.id=r.attempt_id where r.status<>'reviewed'),
 'averageAssignmentAttempts',coalesce(pg_catalog.round((select count(*)::numeric from attempt_data)/nullif((select count(*) from members),0),1),0),
 'topErrors',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('question',v.prompt,'errors',v.n)) from
  (select qid,prompt,count(*) n from attempt_data where correct=false group by qid,prompt order by n desc limit 5) v),'[]'::jsonb)) into result;
 return result;
end $$;

create or replace function app_private.delete_member_activity(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.workspace_memberships where user_id=uid and workspace_id=app_private.current_workspace()) then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.workspace_memberships where user_id=uid and workspace_id=app_private.current_workspace() and role='member') then raise exception 'member_target_required'; end if;
  delete from public.lesson_activity where user_id=uid and content_id in (select id from public.content_items where workspace_id=app_private.current_workspace());
  delete from public.practice_progress where user_id=uid and content_id in (select id from public.content_items where workspace_id=app_private.current_workspace());
  delete from public.attempts where user_id=uid and question_id in (select q.id from public.questions q join public.assignments a on a.id=q.assignment_id where app_private.same_workspace_subject(a.subject_id));
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'activity_deleted',uid::text);
end $$;

create or replace function app_private.management_reviews(filter_status text, filter_group uuid, filter_assignment uuid,
  filter_user uuid, page_number int, filter_subject uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.account_ready() or not exists(select 1 where app_private.current_role() in ('owner','manager','reviewer')) then raise exception 'access_denied'; end if;
  if page_number<0 or page_number>1000 then raise exception 'invalid_page'; end if;
  return pg_catalog.jsonb_build_object('rows',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'attemptId',v.attempt_id,'status',v.status,'judgment',v.judgment,'feedback',v.feedback,
    'score',v.score,'reviewerId',v.reviewer_id,'updatedAt',v.updated_at,
    'answer',v.answer,'attemptNumber',v.attempt_number,'submittedAt',v.submitted_at,
    'username',v.username,'prompt',v.prompt,'assignmentTitle',v.assignment_title,'rubric',v.rubric
  )) from (select r.*,a.answer,a.attempt_number,a.submitted_at,p.username,q.prompt,
    ass.title as assignment_title,k.rubric
    from public.reviews r join public.attempts a on a.id=r.attempt_id
    join public.profiles p on p.id=a.user_id join public.questions q on q.id=a.question_id
    join public.assignments ass on ass.id=q.assignment_id
    left join public.private_answer_keys k on k.question_id=q.id
    where app_private.can_review_attempt(a.id) and (filter_subject is null or ass.subject_id=filter_subject) and (filter_status is null or r.status=filter_status)
      and (filter_user is null or a.user_id=filter_user)
      and (filter_assignment is null or q.assignment_id=filter_assignment)
      and (filter_group is null or exists(select 1 from public.group_memberships gm
        where gm.user_id=a.user_id and gm.group_id=filter_group))
    order by case r.status when 'pending' then 0 when 'in_review' then 1 else 2 end,r.updated_at desc
    limit 25 offset page_number*25) v),'[]'::jsonb));
end $$;

create or replace function app_private.submit_assignment_answer(qid uuid, response jsonb, used_hints int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.questions%rowtype; a public.assignments%rowtype; keyrow public.private_answer_keys%rowtype;
 n int; result boolean; aid uuid; normalized_response numeric; normalized_key numeric;
begin
  if not exists(select 1 where app_private.current_role()='member') then raise exception 'member_required'; end if;
  if not app_private.account_ready() then raise exception 'access_denied'; end if;
  select * into q from public.questions where id=qid; if not found then raise exception 'question_not_found'; end if;
  select * into a from public.assignments where id=q.assignment_id;
  if not app_private.can_read_assignment(a.id) or (a.due_at is not null and pg_catalog.clock_timestamp()>a.due_at)
    then raise exception 'assignment_unavailable'; end if;
  if used_hints is null or used_hints<0 or used_hints>pg_catalog.array_length(q.hints,1)
    or (used_hints>0 and not a.hints_allowed) then raise exception 'hints_not_allowed'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(auth.uid()::text || qid::text));
  select count(*) into n from public.attempts where question_id=qid and user_id=auth.uid();
  if n>=a.max_attempts then raise exception 'attempt_limit'; end if;
  select * into keyrow from public.private_answer_keys where question_id=qid;
  if not found then raise exception 'answer_key_missing'; end if;
  if q.kind='numeric' then
    if response->>'value' is null or (response->>'value') !~ '^[+-]?(\d+\.?\d*|\.\d+)$'
      or app_private.unit_family(response->>'unit') is distinct from app_private.unit_family(keyrow.unit)
      or app_private.unit_scale(response->>'unit') is null then result:=false;
    else
      normalized_response:=(response->>'value')::numeric * app_private.unit_scale(response->>'unit');
      normalized_key:=(keyrow.answer->>'value')::numeric * app_private.unit_scale(keyrow.unit);
      result:=pg_catalog.abs(normalized_response-normalized_key)<=coalesce(keyrow.tolerance,0)*app_private.unit_scale(keyrow.unit);
    end if;
  elsif q.kind='singleChoice' or q.kind='trueFalse' then result:=(response=keyrow.answer);
  elsif q.kind='multipleChoice' then
    if pg_catalog.jsonb_typeof(response)<>'array' then result:=false;
    else result:=(select pg_catalog.array_agg(v order by v) from pg_catalog.jsonb_array_elements_text(response) v)=
      (select pg_catalog.array_agg(v order by v) from pg_catalog.jsonb_array_elements_text(keyrow.answer) v); end if;
  elsif q.kind='matching' then result:=(response=keyrow.answer);
  else result:=null; end if;
  insert into public.attempts(question_id,user_id,attempt_number,answer,correct,hints_used)
    values(qid,auth.uid(),n+1,response,result,used_hints) returning id into aid;
  if q.kind in ('shortOpen','extendedOpen') then insert into public.reviews(attempt_id) values(aid); end if;
  return pg_catalog.jsonb_build_object('attemptId',aid,'attemptNumber',n+1,'correct',result,
    'reviewStatus',case when result is null then 'pending' else null end);
end $$;

create or replace function app_private.create_assignment_bundle(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare draft jsonb; q jsonb; keyrow jsonb; aid uuid; qid uuid; gid uuid; content_id uuid; position int:=0;
begin
  if not exists(select 1 from public.content_items where id=(payload->>'contentId')::uuid and app_private.can_edit_subject(subject_id)) then raise exception 'access_denied'; end if;
  draft:=payload->'draft'; gid:=(payload->>'groupId')::uuid; content_id:=(payload->>'contentId')::uuid;
  if pg_catalog.jsonb_typeof(draft->'questions')<>'array' or pg_catalog.jsonb_array_length(draft->'questions')<1
    or (payload->>'maxAttempts')::int not between 1 and 20
    or not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null and exists(select 1 from public.academic_years y where y.id=groups.academic_year_id and y.status<>'archived'))
    or not exists(select 1 from public.content_items where id=content_id) then raise exception 'invalid_assignment_bundle'; end if;
  insert into public.assignments(academic_year_id,content_id,title,description,status,due_at,max_attempts,hints_allowed,solution_release)
    values((select academic_year_id from public.groups where id=gid),content_id,draft->>'title',coalesce(draft->>'description',''),'draft',
      (payload->>'dueAt')::timestamptz,(payload->>'maxAttempts')::int,
      coalesce((payload->>'hintsAllowed')::boolean,false),payload->>'solutionRelease') returning id into aid;
  for q in select value from pg_catalog.jsonb_array_elements(draft->'questions') loop
    keyrow:=draft->'privateKeys'->(q->>'id');
    if keyrow is null or not (keyrow ? 'answer') then raise exception 'answer_key_missing'; end if;
    insert into public.questions(assignment_id,kind,prompt,difficulty,options,pairs,hints,points,sort_order)
      values(aid,q->>'type',q->>'prompt',q->>'difficulty',q->'options',
        case when q ? 'pairs' then pg_catalog.jsonb_build_object('left',q->'pairs'->'left',
          'right',case when pg_catalog.jsonb_array_length(q->'pairs'->'right')>1 then
            (q->'pairs'->'right')-0 || pg_catalog.jsonb_build_array(q->'pairs'->'right'->0)
          else q->'pairs'->'right' end) else null end,
        array(select pg_catalog.jsonb_array_elements_text(coalesce(q->'hints','[]'::jsonb))),
        coalesce((q->>'points')::numeric,1),position) returning id into qid;
    insert into public.private_answer_keys(question_id,answer,tolerance,unit,solution,rubric)
      values(qid,keyrow->'answer',(keyrow->>'tolerance')::numeric,keyrow->>'unit',keyrow->>'solution',keyrow->>'rubric');
    position:=position+1;
  end loop;
  insert into public.assignment_targets(assignment_id,group_id,allowed) values(aid,gid,true);
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'assignment_created',aid::text);
  return aid;
end $$;

create or replace function app_private.set_staff_role(uid uuid,new_role text,subject_ids uuid[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare wid uuid:=app_private.current_workspace();
begin
 if not app_private.is_owner() then raise exception 'access_denied'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(wid::text));
 if new_role not in ('owner','manager','editor','reviewer','member') or not exists
 (select 1 from public.workspace_memberships where user_id=uid and workspace_id=wid) then raise exception 'invalid_staff_target'; end if;
 if new_role in ('editor','reviewer') and coalesce(pg_catalog.cardinality(subject_ids),0)=0 then raise exception 'subject_scope_required'; end if;
 if exists(select 1 from pg_catalog.unnest(subject_ids) sid where not exists
 (select 1 from public.subjects s where s.id=sid and s.workspace_id=wid and s.archived_at is null)) then raise exception 'invalid_subject_scope'; end if;
 update public.workspace_memberships set role=new_role where user_id=uid and workspace_id=wid;
 delete from public.staff_subjects where user_id=uid and subject_id in(select id from public.subjects where workspace_id=wid);
 if new_role in ('editor','reviewer') then insert into public.staff_subjects(user_id,subject_id) select uid,sid from (select distinct pg_catalog.unnest(subject_ids) sid) scopes; end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'staff_role_changed',uid::text||':'||new_role);
end $$;

create or replace function app_private.set_member_group(uid uuid, gid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.workspace_memberships where user_id=uid and workspace_id=app_private.current_workspace() and role='member' and workspace_id=app_private.current_workspace()) then raise exception 'invalid_member'; end if;
  if gid is not null and not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null and exists(select 1 from public.academic_years y where y.id=groups.academic_year_id and y.status<>'archived')) then raise exception 'invalid_group'; end if;
  delete from public.group_memberships where user_id=uid and group_id in(select id from public.groups where workspace_id=app_private.current_workspace() and (gid is null or academic_year_id=(select academic_year_id from public.groups where id=gid)));
  if gid is not null then insert into public.group_memberships(user_id,group_id) values(uid,gid); end if;
end $$;

create or replace function app_private.audit_membership_or_group() returns trigger language plpgsql security definer set search_path = '' as $$
declare wid uuid;
begin
  if tg_table_name='groups' then
    wid:=new.workspace_id;
    insert into public.audit_log(workspace_id,actor_id,action,target_id) values(wid,auth.uid(),
      case when tg_op='INSERT' then 'group_created' else 'group_changed' end,new.id::text);
    return new;
  end if;
  select workspace_id into wid from public.groups where id=case when tg_op='DELETE' then old.group_id else new.group_id end;
  if wid is null then return old; end if;
  insert into public.audit_log(workspace_id,actor_id,action,target_id) values(wid,auth.uid(),
    case when tg_op='INSERT' then 'membership_added' else 'membership_removed' end,
    case when tg_op='DELETE' then old.user_id::text||':'||old.group_id::text
      else new.user_id::text||':'||new.group_id::text end);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create function app_private.audit_institution_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_log(workspace_id,actor_id,action,target_id) values(case when tg_op='DELETE' then old.workspace_id else new.workspace_id end,auth.uid(),'workspace_membership_'||lower(tg_op),case when tg_op='DELETE' then old.user_id::text else new.user_id::text end);
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger audit_institution_membership after insert or update or delete on public.workspace_memberships for each row execute function app_private.audit_institution_membership();
alter table public.groups alter column academic_year_id set not null;
alter table public.groups alter column track_id set not null;
alter table public.profiles drop column role;
alter table public.profiles drop column workspace_id;
-- Explicit privileges for the new wrappers and the RLS helpers; trigger-only helpers stay private.
revoke execute on all functions in schema app_private from public,anon;
revoke execute on all functions in schema public from public,anon;
grant execute on function app_private.current_role(),app_private.can_read_curriculum_subject(uuid),app_private.can_read_plan(uuid),app_private.can_edit_plan(uuid) to authenticated;
grant execute on function app_private.my_workspaces(),public.my_workspaces() to authenticated;
grant execute on function app_private.workspace_accounts(int,boolean),public.workspace_accounts(int,boolean) to authenticated;
grant execute on function app_private.attach_workspace_account(text),public.attach_workspace_account(text) to authenticated;
grant execute on function app_private.create_workspace(text),public.create_workspace(text) to authenticated;
grant execute on function app_private.save_academic_year(uuid,text,date,date,text),public.save_academic_year(uuid,text,date,date,text) to authenticated;
grant execute on function app_private.save_track(text,text,uuid[]),public.save_track(text,text,uuid[]) to authenticated;
grant execute on function app_private.update_track(uuid,text,text,uuid[]),public.update_track(uuid,text,text,uuid[]) to authenticated;
grant execute on function app_private.save_curriculum_source(jsonb),public.save_curriculum_source(jsonb) to authenticated;
grant execute on function app_private.delete_curriculum_source(uuid),public.delete_curriculum_source(uuid) to authenticated;
grant execute on function app_private.save_curriculum_plan(jsonb,uuid,int,text),public.save_curriculum_plan(jsonb,uuid,int,text) to authenticated;
grant execute on function app_private.restore_curriculum_plan(uuid,int,int),public.restore_curriculum_plan(uuid,int,int) to authenticated;
grant execute on function app_private.fork_personal_content(uuid,uuid,text),public.fork_personal_content(uuid,uuid,text) to authenticated;

-- Backup v5 records academic structure. Restore remains configuration-only and atomic.
create or replace function app_private.restore_configuration_backup(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare section text;
begin
  if not app_private.is_owner() then raise exception 'access_denied'; end if;
  if ((payload->>'format'='telecomlab-backup-v3' and payload->>'schemaVersion'='3') or (payload->>'format'='telecomlab-backup-v4' and payload->>'schemaVersion'='4') or (payload->>'format'='telecomlab-backup-v5' and payload->>'schemaVersion'='5')) is not true then raise exception 'incompatible_backup'; end if;
  foreach section in array array['groups','content_items','content_versions','content_resources',
    'module_access','content_access','resource_access'] loop
    if pg_catalog.jsonb_typeof(payload->section) is distinct from 'array' then raise exception 'invalid_backup_section: %',section; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_populate_recordset(null::public.groups,payload->'groups') g
      join public.groups existing on existing.id=g.id or (existing.workspace_id=app_private.current_workspace() and existing.name=g.name))
    or exists(select 1 from pg_catalog.jsonb_populate_recordset(null::public.content_items,payload->'content_items') c
      join public.content_items existing on existing.id=c.id or (existing.workspace_id=app_private.current_workspace() and existing.slug=c.slug))
    then raise exception 'backup_conflict_existing_data'; end if;
  if payload->>'schemaVersion' in ('4','5') then
    if pg_catalog.jsonb_typeof(payload->'subjects') is distinct from 'array' then raise exception 'missing_subjects'; end if;
    insert into public.subjects(workspace_id,slug,name,description,color)
      select app_private.current_workspace(),s.slug,s.name,s.description,s.color
      from pg_catalog.jsonb_populate_recordset(null::public.subjects,payload->'subjects') s
      on conflict(workspace_id,slug) do nothing;
  end if;
  if payload->>'schemaVersion'='5' then
   if jsonb_typeof(payload->'academic_years') is distinct from 'array' or jsonb_typeof(payload->'tracks') is distinct from 'array' then raise exception 'missing_academic_structure'; end if;
   insert into public.academic_years(workspace_id,label,start_date,end_date,status) select app_private.current_workspace(),label,start_date,end_date,status from jsonb_populate_recordset(null::public.academic_years,payload->'academic_years') on conflict(workspace_id,label) do nothing;
   insert into public.tracks(workspace_id,name,description) select app_private.current_workspace(),name,description from jsonb_populate_recordset(null::public.tracks,payload->'tracks') on conflict(workspace_id,name) do nothing;
   insert into public.groups(id,name,level,archived_at,workspace_id,academic_year_id,track_id)
   select g.id,g.name,g.level,g.archived_at,app_private.current_workspace(),
    (select y.id from public.academic_years y where y.workspace_id=app_private.current_workspace() and y.label=(select v->>'label' from jsonb_array_elements(payload->'academic_years') v where v->>'id'=g.academic_year_id::text)),
    (select t.id from public.tracks t where t.workspace_id=app_private.current_workspace() and t.name=(select v->>'name' from jsonb_array_elements(payload->'tracks') v where v->>'id'=g.track_id::text))
   from jsonb_populate_recordset(null::public.groups,payload->'groups') g;
  else
   insert into public.groups(id,name,level,archived_at,workspace_id) select id,name,level,archived_at,app_private.current_workspace() from jsonb_populate_recordset(null::public.groups,payload->'groups');
  end if;
  insert into public.content_items(subject_id,id,source_id,slug,title,summary,year,module,topic,tags,status,available_from,available_until,
    sort_order,created_at,updated_at)
    select (select s.id from public.subjects s where s.workspace_id=app_private.current_workspace() and s.slug=coalesce((select v.document->>'subject' from pg_catalog.jsonb_populate_recordset(null::public.content_versions,payload->'content_versions') v where v.content_id=c.id order by v.version desc limit 1),'telecomunicazioni')),c.id,coalesce(c.source_id,(select v.document->>'id' from
      pg_catalog.jsonb_populate_recordset(null::public.content_versions,payload->'content_versions') v
      where v.content_id=c.id order by v.version desc limit 1)),
      c.slug,c.title,c.summary,c.year,c.module,c.topic,c.tags,'draft',c.available_from,c.available_until,
      c.sort_order,c.created_at,c.updated_at
    from pg_catalog.jsonb_populate_recordset(null::public.content_items,payload->'content_items') c;
  insert into public.content_versions(id,content_id,version,document,created_at,created_by)
    select id,content_id,version,document,created_at,null
    from pg_catalog.jsonb_populate_recordset(null::public.content_versions,payload->'content_versions');
  insert into public.content_resources(content_id,kind,blocks,search_text)
    select content_id,kind,blocks,search_text
    from pg_catalog.jsonb_populate_recordset(null::public.content_resources,payload->'content_resources');
  insert into public.module_access(id,group_id,subject_id,year,module,allowed)
    select id,group_id,coalesce((select s.id from public.subjects s where s.workspace_id=app_private.current_workspace() and s.slug=coalesce((select entry->>'slug' from pg_catalog.jsonb_array_elements(coalesce(payload->'subjects','[]')) entry where entry->>'id'=ma.subject_id::text),'telecomunicazioni')),'20000000-0000-4000-8000-000000000001'::uuid),year,module,allowed
    from pg_catalog.jsonb_populate_recordset(null::public.module_access,payload->'module_access') ma where group_id is not null;
  insert into public.content_access(id,content_id,group_id,allowed)
    select id,content_id,group_id,allowed
    from pg_catalog.jsonb_populate_recordset(null::public.content_access,payload->'content_access') where group_id is not null;
  insert into public.resource_access(id,content_id,kind,group_id,allowed)
    select id,content_id,kind,group_id,allowed
    from pg_catalog.jsonb_populate_recordset(null::public.resource_access,payload->'resource_access') where group_id is not null;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'backup_configuration_restored',null);
end $$;

-- Year archival freezes operational grants and new cohort writes, preserving history.
drop policy groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated with check(app_private.is_manager() and workspace_id=app_private.current_workspace() and exists(select 1 from public.academic_years y where y.id=academic_year_id and y.status<>'archived'));
drop policy groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated using((workspace_id=app_private.current_workspace() and app_private.is_manager()) or app_private.can_read_group(id));
create function app_private.guard_archived_cohort() returns trigger language plpgsql security definer set search_path='' as $$
declare yid uuid;
begin
 if tg_table_name='group_memberships' then select academic_year_id into yid from public.groups where id=new.group_id;
 elsif tg_table_name='groups' then yid:=new.academic_year_id;
 elsif tg_table_name='assignments' then yid:=new.academic_year_id;
 else select academic_year_id into yid from public.groups where id=new.group_id; end if;
 if exists(select 1 from public.academic_years where id=yid and status='archived') then raise exception 'academic_year_archived'; end if;
 return new;
end $$;
create trigger z_archived_group before insert on public.groups for each row execute function app_private.guard_archived_cohort();
create trigger z_archived_membership before insert or update on public.group_memberships for each row execute function app_private.guard_archived_cohort();
create trigger z_archived_assignment before insert or update on public.assignments for each row execute function app_private.guard_archived_cohort();
do $$ declare tab text; begin foreach tab in array array['module_access','content_access','resource_access','assignment_targets'] loop
 execute format('create trigger z_archived_grant before insert or update on public.%I for each row execute function app_private.guard_archived_cohort()',tab);
end loop; end $$;

create or replace function app_private.my_assignment_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.account_ready() then raise exception 'access_denied'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',a.id,'title',a.title,'subject_id',a.subject_id,'academic_year_id',a.academic_year_id,'group_ids',(select coalesce(jsonb_agg(group_id),'[]'::jsonb) from public.assignment_targets where assignment_id=a.id and allowed and group_id is not null),'due_at',a.due_at,
    'status',case when s.pending>0 then 'Da correggere'
      when s.questions>0 and s.answered=s.questions and s.corrected=s.questions then 'Corretto'
      when a.due_at is not null and a.due_at<now() then 'Scaduto'
      when s.questions>0 and s.answered=s.questions then 'Completato'
      when s.answered>0 then 'In corso' else 'Non iniziato' end
  ) order by a.due_at nulls last,a.title)
  from public.assignments a cross join lateral (
    select count(*) as questions,
      count(*) filter(where exists(select 1 from public.attempts t where t.question_id=q.id and t.user_id=auth.uid())) as answered,
      count(*) filter(where exists(select 1 from public.attempts t left join public.reviews r on r.attempt_id=t.id
        where t.question_id=q.id and t.user_id=auth.uid() and (t.correct=true or r.status='reviewed'))) as corrected,
      (select count(*) from public.reviews r join public.attempts t on t.id=r.attempt_id
        join public.questions qr on qr.id=t.question_id where qr.assignment_id=a.id
        and t.user_id=auth.uid() and r.status<>'reviewed') as pending
    from public.questions q where q.assignment_id=a.id
  ) s where app_private.can_read_assignment(a.id)),'[]'::jsonb);
end $$;

create or replace function app_private.management_content_activity(cid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.content_items where id=cid and app_private.same_workspace_subject(subject_id)) then raise exception 'access_denied'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'userId',p.id,'username',p.username,'firstName',p.first_name,'lastName',p.last_name,
    'firstOpen',la.opened_at,'lastOpen',la.last_opened_at,'openCount',coalesce(la.open_count,0),
    'activeSeconds',coalesce(la.active_seconds,0),
    'practiceAttempted',(select count(*) from public.practice_progress pp where pp.user_id=p.id and pp.content_id=cid),
    'practiceCompleted',(select count(*) from public.practice_progress pp where pp.user_id=p.id and pp.content_id=cid and pp.completed),
    'practiceAttempts',(select coalesce(sum(pp.attempts),0) from public.practice_progress pp where pp.user_id=p.id and pp.content_id=cid),
    'assignmentCount',(select count(*) from public.assignments ass where ass.content_id=cid),
    'assignmentAttempts',(select count(*) from public.attempts a join public.questions q on q.id=a.question_id
      join public.assignments ass on ass.id=q.assignment_id where a.user_id=p.id and ass.content_id=cid)
  ) order by p.username) from public.profiles p left join public.lesson_activity la on la.user_id=p.id and la.content_id=cid
    where app_private.user_can_read_content(p.id,cid) or la.content_id is not null),'[]'::jsonb);
end $$;

-- Protect an institution's last owner if a trusted operator disables global identity.
create function app_private.protect_account_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare membership record;
begin
 if not old.disabled and new.disabled then
 for membership in select workspace_id from public.workspace_memberships where user_id=old.id and role='owner' and not disabled order by workspace_id loop
 perform pg_advisory_xact_lock(hashtext(membership.workspace_id::text));
 if not exists(select 1 from public.workspace_memberships m join public.profiles p on p.id=m.user_id where m.workspace_id=membership.workspace_id and m.role='owner' and not m.disabled and not p.disabled and p.id<>old.id) then raise exception 'last_owner_required'; end if;
 end loop;
 end if;
 return new;
end $$;
create trigger protect_account_owner before update on public.profiles for each row execute function app_private.protect_account_owner();
