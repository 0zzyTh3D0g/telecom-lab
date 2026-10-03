-- P3: additive workspace, subject and staff capabilities. app_private stays unexposed.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 100),
  created_at timestamptz not null default now()
);
insert into public.workspaces(id,name) values('10000000-0000-4000-8000-000000000001','Telecom/lab');
create table public.subjects (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  slug text not null check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), name text not null check(length(name) between 2 and 100),
  description text not null default '', color text not null default 'mineral' check(color in ('mineral','blue','violet','amber','rose','slate')),
  archived_at timestamptz, sort_order int not null default 0, unique(workspace_id,slug)
);
insert into public.subjects(id,workspace_id,slug,name,description) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','telecomunicazioni','Telecomunicazioni','Segnali, circuiti e sistemi di comunicazione.');
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('owner','manager','editor','reviewer','member'));
alter table public.profiles add column workspace_id uuid not null default '10000000-0000-4000-8000-000000000001' references public.workspaces(id);
alter table public.groups add column workspace_id uuid not null default '10000000-0000-4000-8000-000000000001' references public.workspaces(id);
alter table public.content_items add column subject_id uuid not null default '20000000-0000-4000-8000-000000000001' references public.subjects(id);
alter table public.assignments add column subject_id uuid not null default '20000000-0000-4000-8000-000000000001' references public.subjects(id);
alter table public.module_access add column subject_id uuid not null default '20000000-0000-4000-8000-000000000001' references public.subjects(id);
alter table public.audit_log add column workspace_id uuid not null default '10000000-0000-4000-8000-000000000001' references public.workspaces(id);
create table public.staff_subjects (
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  primary key(user_id,subject_id)
);
-- Existing managers keep their access; the oldest one becomes the initial owner.
update public.profiles set role='owner' where id=(select id from public.profiles where role='manager' order by created_at,id limit 1);
drop index public.module_access_group_unique;
drop index public.module_access_user_unique;
create unique index module_access_group_unique on public.module_access(group_id,subject_id,year,module) where group_id is not null;
create unique index module_access_user_unique on public.module_access(user_id,subject_id,year,module) where user_id is not null;
create index content_subject_idx on public.content_items(subject_id,year,module,status);
create index assignments_subject_idx on public.assignments(subject_id,status);
create index profiles_workspace_idx on public.profiles(workspace_id,role);
create index subjects_workspace_idx on public.subjects(workspace_id);
alter table public.groups drop constraint groups_name_key;
alter table public.groups add constraint groups_workspace_name_key unique(workspace_id,name);

create function app_private.current_workspace() returns uuid language sql stable security definer set search_path='' as $$
 select workspace_id from public.profiles where id=auth.uid() and not disabled and not must_change_password $$;
create function app_private.is_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='owner' and not disabled and not must_change_password) $$;
create or replace function app_private.is_manager() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role in ('owner','manager') and not disabled and not must_change_password) $$;
create function app_private.can_edit_subject(sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subjects s join public.profiles p on p.workspace_id=s.workspace_id
 where s.id=sid and p.id=auth.uid() and not p.disabled and not p.must_change_password
 and (p.role in ('owner','manager') or (p.role='editor' and s.archived_at is null and exists
 (select 1 from public.staff_subjects ss where ss.subject_id=s.id and ss.user_id=p.id)))) $$;
create function app_private.can_review_assignment(aid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.assignments a join public.subjects s on s.id=a.subject_id
 join public.profiles p on p.workspace_id=s.workspace_id where a.id=aid and p.id=auth.uid()
 and not p.disabled and not p.must_change_password and (p.role in ('owner','manager') or
 (p.role='reviewer' and s.archived_at is null and exists(select 1 from public.staff_subjects ss where ss.user_id=p.id and ss.subject_id=s.id)))) $$;
create function app_private.can_review_attempt(aid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attempts a join public.questions q on q.id=a.question_id
 where a.id=aid and app_private.can_review_assignment(q.assignment_id)
 and (app_private.is_manager() or q.kind in ('shortOpen','extendedOpen'))) $$;
create function app_private.same_workspace_subject(sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subjects where id=sid and workspace_id=app_private.current_workspace()) $$;
create function app_private.can_read_profile(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select uid=auth.uid() or exists(select 1 from public.profiles p where p.id=uid and p.workspace_id=app_private.current_workspace()
 and (app_private.is_owner() or (app_private.is_manager() and p.role='member') or exists
 (select 1 from public.attempts a where a.user_id=uid and app_private.can_review_attempt(a.id)))) $$;

-- Workspace boundaries are also enforced on privileged writes, so RPCs and
-- service-side account operations cannot accidentally join unrelated tenants.
create function app_private.guard_workspace_relations() returns trigger language plpgsql security definer set search_path='' as $$
declare subject_workspace uuid; target_workspace uuid;
begin
 if tg_table_name='group_memberships' then
  if (select workspace_id from public.groups where id=new.group_id) is distinct from
     (select workspace_id from public.profiles where id=new.user_id) then raise exception 'workspace_mismatch'; end if;
 elsif tg_table_name='staff_subjects' then
  if (select workspace_id from public.subjects where id=new.subject_id) is distinct from
     (select workspace_id from public.profiles where id=new.user_id) then raise exception 'workspace_mismatch'; end if;
 elsif tg_table_name='assignments' then
  if new.content_id is not null then
   select subject_id into new.subject_id from public.content_items where id=new.content_id;
  end if;
  if tg_op='UPDATE' and new.subject_id is distinct from old.subject_id then raise exception 'subject_move_requires_migration'; end if;
 elsif tg_table_name='content_items' then
  if tg_op='UPDATE' and new.subject_id is distinct from old.subject_id then raise exception 'subject_move_requires_migration'; end if;
 elsif tg_table_name in ('module_access','content_access','resource_access','assignment_targets') then
  if tg_table_name='module_access' then select workspace_id into subject_workspace from public.subjects where id=new.subject_id;
  elsif tg_table_name='assignment_targets' then select s.workspace_id into subject_workspace from public.assignments a join public.subjects s on s.id=a.subject_id where a.id=new.assignment_id;
  else select s.workspace_id into subject_workspace from public.content_items c join public.subjects s on s.id=c.subject_id where c.id=new.content_id; end if;
  if new.group_id is not null then select workspace_id into target_workspace from public.groups where id=new.group_id;
  else select workspace_id into target_workspace from public.profiles where id=new.user_id; end if;
  if subject_workspace is distinct from target_workspace then raise exception 'workspace_mismatch'; end if;
 elsif tg_table_name='audit_log' then
  new.workspace_id:=coalesce((select workspace_id from public.profiles where id=new.actor_id),new.workspace_id);
 end if;
 return new;
end $$;
do $$ declare tab text; begin foreach tab in array array['group_memberships','staff_subjects','assignments','content_items','module_access','content_access','resource_access','assignment_targets','audit_log'] loop
 execute pg_catalog.format('create trigger p3_workspace_guard before insert or update on public.%I for each row execute function app_private.guard_workspace_relations()',tab);
end loop; end $$;

create function app_private.protect_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.workspace_id is distinct from old.workspace_id then raise exception 'workspace_move_requires_migration'; end if;
 if old.role='owner' and not old.disabled and (tg_op='DELETE' or new.role<>'owner' or new.disabled) then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(old.workspace_id::text));
  if not exists(select 1 from public.profiles where workspace_id=old.workspace_id and role='owner' and not disabled and id<>old.id)
  then raise exception 'last_owner_required'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger protect_workspace_owner before update or delete on public.profiles for each row execute function app_private.protect_owner();

create function app_private.set_staff_role(uid uuid,new_role text,subject_ids uuid[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare wid uuid:=app_private.current_workspace();
begin
 if not app_private.is_owner() then raise exception 'access_denied'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(wid::text));
 if new_role not in ('owner','manager','editor','reviewer','member') or not exists
 (select 1 from public.profiles where id=uid and workspace_id=wid) then raise exception 'invalid_staff_target'; end if;
 if new_role in ('editor','reviewer') and coalesce(pg_catalog.cardinality(subject_ids),0)=0 then raise exception 'subject_scope_required'; end if;
 if exists(select 1 from pg_catalog.unnest(subject_ids) sid where not exists
 (select 1 from public.subjects s where s.id=sid and s.workspace_id=wid and s.archived_at is null)) then raise exception 'invalid_subject_scope'; end if;
 update public.profiles set role=new_role where id=uid;
 delete from public.staff_subjects where user_id=uid;
 if new_role in ('editor','reviewer') then insert into public.staff_subjects(user_id,subject_id) select uid,sid from (select distinct pg_catalog.unnest(subject_ids) sid) scopes; end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'staff_role_changed',uid::text||':'||new_role);
end $$;
create function public.set_staff_role(uid uuid,new_role text,subject_ids uuid[] default '{}') returns void language sql security invoker set search_path='' as $$
 select app_private.set_staff_role(uid,new_role,subject_ids) $$;

create function app_private.save_subject(sid uuid,subject_slug text,subject_name text,subject_description text,subject_color text,archived boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not app_private.is_manager() then raise exception 'access_denied'; end if;
 if sid is null then
  insert into public.subjects(workspace_id,slug,name,description,color) values(app_private.current_workspace(),subject_slug,subject_name,subject_description,subject_color) returning id into result_id;
 else
  update public.subjects set name=subject_name,description=subject_description,color=subject_color,
   archived_at=case when archived then coalesce(archived_at,pg_catalog.clock_timestamp()) else null end
   where id=sid and workspace_id=app_private.current_workspace() returning id into result_id;
  if result_id is null then raise exception 'access_denied'; end if;
 end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'subject_saved',result_id::text);
 return result_id;
end $$;
create function public.save_subject(sid uuid,subject_slug text,subject_name text,subject_description text,subject_color text,archived boolean default false) returns uuid
language sql security invoker set search_path='' as $$ select app_private.save_subject(sid,subject_slug,subject_name,subject_description,subject_color,archived) $$;


-- Updated P2.1 operations retain their transaction boundaries.
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
      join public.groups g on g.id=ma.group_id and g.archived_at is null
      join public.group_memberships gm on gm.group_id=g.id
      where gm.user_id=auth.uid() and ma.subject_id=c.subject_id and ma.year=c.year and ma.module=c.module;
  end if;
  if not coalesce(module_allowed,false) then return false; end if;
  select allowed into lesson_allowed from public.content_access where content_id=cid and user_id=auth.uid();
  if found then return lesson_allowed; end if;
  return exists(select 1 from public.content_access ca
    join public.groups g on g.id=ca.group_id and g.archived_at is null
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
    join public.groups g on g.id=ra.group_id and g.archived_at is null
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
  if a.status<>'published' or (a.available_from is not null and a.available_from>now()) then return false; end if;
  select allowed into direct_allowed from public.assignment_targets where assignment_id=aid and user_id=auth.uid();
  if found then return direct_allowed; end if;
  return exists(select 1 from public.assignment_targets t
    join public.groups g on g.id=t.group_id and g.archived_at is null
    join public.group_memberships gm on gm.group_id=g.id
    where t.assignment_id=aid and t.allowed and gm.user_id=auth.uid());
end $$;

create or replace function app_private.user_can_read_content(uid uuid,cid uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare item public.content_items%rowtype; module_allowed boolean; lesson_allowed boolean;
begin
  if not exists(select 1 from public.profiles p where p.id=uid and p.role='member'
    and not p.disabled and not p.must_change_password) then return false; end if;
  select * into item from public.content_items where id=cid;
  if not found or not exists(select 1 from public.subjects s join public.profiles p on p.workspace_id=s.workspace_id where s.id=item.subject_id and p.id=uid and s.archived_at is null) then return false; end if;
  if item.status<>'published' or (item.available_from is not null and item.available_from>now())
    or (item.available_until is not null and item.available_until<=now()) then return false; end if;
  select allowed into module_allowed from public.module_access where user_id=uid and subject_id=item.subject_id and year=item.year and module=item.module;
  if not found then select coalesce(bool_or(ma.allowed),false) into module_allowed from public.module_access ma
    join public.groups g on g.id=ma.group_id and g.archived_at is null
    join public.group_memberships gm on gm.group_id=g.id
    where gm.user_id=uid and ma.subject_id=item.subject_id and ma.year=item.year and ma.module=item.module; end if;
  if not coalesce(module_allowed,false) then return false; end if;
  select allowed into lesson_allowed from public.content_access where content_id=cid and user_id=uid;
  if found then return lesson_allowed; end if;
  return exists(select 1 from public.content_access ca
    join public.groups g on g.id=ca.group_id and g.archived_at is null
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
  if doc->>'schemaVersion'<>'2' or pg_catalog.jsonb_typeof(doc->'blocks')<>'array'
    or pg_catalog.jsonb_array_length(doc->'blocks')<1 or doc->>'slug' is null
    or doc->>'title' is null or doc->>'module' is null then raise exception 'invalid_content_document'; end if;
  if doc->>'id' is null then raise exception 'missing_content_id'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('id:'||(doc->>'id')));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('slug:'||(doc->>'slug')));
  if (select count(*) from public.content_items where slug=doc->>'slug' or source_id=doc->>'id')>1
    then raise exception 'content_identity_conflict'; end if;
  select id into cid from public.content_items where slug=doc->>'slug' or source_id=doc->>'id' for update;
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

create or replace function app_private.restore_content_version(cid uuid, source_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare source_doc jsonb; result jsonb;
begin
  if not exists(select 1 from public.content_items where id=cid and app_private.can_edit_subject(subject_id)) then raise exception 'access_denied'; end if;
  select document into source_doc from public.content_versions where content_id=cid and version=source_version;
  if not found then raise exception 'version_not_found'; end if;
  result:=app_private.save_content_document(source_doc,cid);
  insert into public.audit_log(actor_id,action,target_id)
    values(auth.uid(),'content_version_restored',cid::text||':'||source_version::text);
  return result;
end $$;

create or replace function app_private.save_group_access(cid uuid,gid uuid,module_allowed boolean,lesson_allowed boolean,
  theory_allowed boolean,simulation_allowed boolean,exercise_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.content_items%rowtype;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  select * into item from public.content_items where id=cid;
  if not found or not app_private.same_workspace_subject(item.subject_id) or not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null) then raise exception 'invalid_access_target'; end if;
  insert into public.module_access(group_id,subject_id,year,module,allowed) values(gid,item.subject_id,item.year,item.module,module_allowed)
    on conflict(group_id,subject_id,year,module) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.content_access(group_id,content_id,allowed) values(gid,cid,lesson_allowed)
    on conflict(group_id,content_id) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.resource_access(group_id,content_id,kind,allowed) values
    (gid,cid,'theory',theory_allowed),(gid,cid,'simulation',simulation_allowed),(gid,cid,'exercise',exercise_allowed)
    on conflict(group_id,content_id,kind) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'group_access_changed',gid::text||':'||cid::text);
end $$;

drop function public.set_module_bundle(uuid,int,text,boolean);
drop function app_private.set_module_bundle(uuid,int,text,boolean);

create or replace function app_private.set_module_bundle(gid uuid,academic_year int,module_name text,allowed_value boolean,sid uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  sid:=coalesce(sid,(select id from public.subjects where workspace_id=app_private.current_workspace() and slug='telecomunicazioni'));
  if not app_private.same_workspace_subject(sid) then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null) then raise exception 'invalid_access_target'; end if;
  if academic_year not in (3,4) or module_name is null then raise exception 'invalid_module'; end if;
  insert into public.module_access(group_id,subject_id,year,module,allowed) values(gid,sid,academic_year,module_name,allowed_value)
    on conflict(group_id,subject_id,year,module) where group_id is not null do update set allowed=excluded.allowed;
  for cid in select id from public.content_items where subject_id=sid and year=academic_year and module=module_name loop
    insert into public.content_access(group_id,content_id,allowed) values(gid,cid,allowed_value)
      on conflict(group_id,content_id) where group_id is not null do update set allowed=excluded.allowed;
    insert into public.resource_access(group_id,content_id,kind,allowed) values
      (gid,cid,'theory',allowed_value),(gid,cid,'simulation',allowed_value),(gid,cid,'exercise',allowed_value)
      on conflict(group_id,content_id,kind) where group_id is not null do update set allowed=excluded.allowed;
  end loop;
  insert into public.audit_log(actor_id,action,target_id)
    values(auth.uid(),'module_access_changed',gid::text||':'||academic_year::text||':'||module_name);
end $$;

create function public.set_module_bundle(gid uuid,academic_year int,module_name text,allowed_value boolean,sid uuid default null) returns void language sql security invoker set search_path='' as $$ select app_private.set_module_bundle(gid,academic_year,module_name,allowed_value,sid) $$;

create or replace function app_private.create_assignment_bundle(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare draft jsonb; q jsonb; keyrow jsonb; aid uuid; qid uuid; gid uuid; content_id uuid; position int:=0;
begin
  if not exists(select 1 from public.content_items where id=(payload->>'contentId')::uuid and app_private.can_edit_subject(subject_id)) then raise exception 'access_denied'; end if;
  draft:=payload->'draft'; gid:=(payload->>'groupId')::uuid; content_id:=(payload->>'contentId')::uuid;
  if pg_catalog.jsonb_typeof(draft->'questions')<>'array' or pg_catalog.jsonb_array_length(draft->'questions')<1
    or (payload->>'maxAttempts')::int not between 1 and 20
    or not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null)
    or not exists(select 1 from public.content_items where id=content_id) then raise exception 'invalid_assignment_bundle'; end if;
  insert into public.assignments(content_id,title,description,status,due_at,max_attempts,hints_allowed,solution_release)
    values(content_id,draft->>'title',coalesce(draft->>'description',''),'draft',
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

create or replace function app_private.submit_assignment_answer(qid uuid, response jsonb, used_hints int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.questions%rowtype; a public.assignments%rowtype; keyrow public.private_answer_keys%rowtype;
 n int; result boolean; aid uuid; normalized_response numeric; normalized_key numeric;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='member') then raise exception 'member_required'; end if;
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
    where app_private.user_can_read_content(p.id,cid)),'[]'::jsonb);
end $$;

create or replace function app_private.management_account_activity(uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.profiles where id=uid and workspace_id=app_private.current_workspace()) then raise exception 'access_denied'; end if;
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
    where app_private.user_can_read_content(uid,c.id)),'[]'::jsonb);
end $$;

drop function public.management_group_activity(uuid);
drop function app_private.management_group_activity(uuid);
create function app_private.management_group_activity(gid uuid,sid uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not app_private.is_manager() or not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace())
 or (sid is not null and not app_private.same_workspace_subject(sid)) then raise exception 'access_denied'; end if;
 with members as (select p.id from public.profiles p join public.group_memberships gm on gm.user_id=p.id
   where gm.group_id=gid and p.role='member' and not p.disabled and not p.must_change_password),
 eligible as (select m.id uid,c.id cid from members m join public.content_items c on app_private.user_can_read_content(m.id,c.id)
   where sid is null or c.subject_id=sid),
 practice as (select pp.* from public.practice_progress pp join eligible e on e.uid=pp.user_id and e.cid=pp.content_id),
 attempt_data as (select a.id,a.correct,q.id qid,q.prompt from public.attempts a join members m on m.id=a.user_id
   join public.questions q on q.id=a.question_id join public.assignments ass on ass.id=q.assignment_id where sid is null or ass.subject_id=sid)
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
create function public.management_group_activity(gid uuid,sid uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select app_private.management_group_activity(gid,sid) $$;

create or replace function app_private.delete_member_activity(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.profiles where id=uid and workspace_id=app_private.current_workspace()) then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.profiles where id=uid and role='member') then raise exception 'member_target_required'; end if;
  delete from public.lesson_activity where user_id=uid;
  delete from public.practice_progress where user_id=uid;
  delete from public.attempts where user_id=uid;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'activity_deleted',uid::text);
end $$;

create or replace function app_private.my_assignment_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.account_ready() then raise exception 'access_denied'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',a.id,'title',a.title,'subject_id',a.subject_id,'due_at',a.due_at,
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

drop function public.management_reviews(text,uuid,uuid,uuid,int);
drop function app_private.management_reviews(text,uuid,uuid,uuid,int);
create or replace function app_private.management_reviews(filter_status text, filter_group uuid, filter_assignment uuid,
  filter_user uuid, page_number int, filter_subject uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.account_ready() or not exists(select 1 from public.profiles where id=auth.uid() and role in ('owner','manager','reviewer')) then raise exception 'access_denied'; end if;
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

create function public.management_reviews(filter_status text default null,filter_group uuid default null,filter_assignment uuid default null,
 filter_user uuid default null,page_number int default 0,filter_subject uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select app_private.management_reviews(filter_status,filter_group,filter_assignment,filter_user,page_number,filter_subject) $$;

create or replace function app_private.set_member_group(uid uuid, gid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.profiles where id=uid and role='member' and workspace_id=app_private.current_workspace()) then raise exception 'invalid_member'; end if;
  if gid is not null and not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null) then raise exception 'invalid_group'; end if;
  delete from public.group_memberships where user_id=uid;
  if gid is not null then insert into public.group_memberships(user_id,group_id) values(uid,gid); end if;
end $$;

create or replace function app_private.restore_configuration_backup(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare section text;
begin
  if not app_private.is_owner() then raise exception 'access_denied'; end if;
  if ((payload->>'format'='telecomlab-backup-v3' and payload->>'schemaVersion'='3') or (payload->>'format'='telecomlab-backup-v4' and payload->>'schemaVersion'='4')) is not true then raise exception 'incompatible_backup'; end if;
  foreach section in array array['groups','content_items','content_versions','content_resources',
    'module_access','content_access','resource_access'] loop
    if pg_catalog.jsonb_typeof(payload->section) is distinct from 'array' then raise exception 'invalid_backup_section: %',section; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_populate_recordset(null::public.groups,payload->'groups') g
      join public.groups existing on existing.id=g.id or existing.name=g.name)
    or exists(select 1 from pg_catalog.jsonb_populate_recordset(null::public.content_items,payload->'content_items') c
      join public.content_items existing on existing.id=c.id or existing.slug=c.slug)
    then raise exception 'backup_conflict_existing_data'; end if;
  if payload->>'schemaVersion'='4' then
    if pg_catalog.jsonb_typeof(payload->'subjects') is distinct from 'array' then raise exception 'missing_subjects'; end if;
    insert into public.subjects(workspace_id,slug,name,description,color)
      select app_private.current_workspace(),s.slug,s.name,s.description,s.color
      from pg_catalog.jsonb_populate_recordset(null::public.subjects,payload->'subjects') s
      on conflict(workspace_id,slug) do nothing;
  end if;
  insert into public.groups(id,name,level,archived_at,workspace_id)
    select id,name,level,archived_at,app_private.current_workspace() from pg_catalog.jsonb_populate_recordset(null::public.groups,payload->'groups');
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

create function app_private.can_edit_content(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.content_items where id=cid and app_private.can_edit_subject(subject_id)) $$;
create function app_private.can_edit_assignment(aid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.assignments where id=aid and app_private.can_edit_subject(subject_id)) $$;
create function app_private.can_read_subject(sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subjects s where s.id=sid and s.workspace_id=app_private.current_workspace()
 and (app_private.is_manager() or (s.archived_at is null and (exists(select 1 from public.staff_subjects where subject_id=s.id and user_id=auth.uid())
 or exists(select 1 from public.content_items c where c.subject_id=s.id and app_private.can_read_content(c.id))
 or exists(select 1 from public.assignments a where a.subject_id=s.id and app_private.can_read_assignment(a.id)))))) $$;
create function app_private.can_read_group(gid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.groups g where g.id=gid and g.workspace_id=app_private.current_workspace()
 and (app_private.is_manager() or exists(select 1 from public.profiles where id=auth.uid() and role='editor')
 or exists(select 1 from public.group_memberships where group_id=g.id and user_id=auth.uid())
 or exists(select 1 from public.assignment_targets where group_id=g.id and app_private.can_review_assignment(assignment_id)))) $$;

-- Replace old permissive manager policies instead of layering OR policies.
do $$ declare p record; begin for p in select schemaname,tablename,policyname from pg_catalog.pg_policies where schemaname='public'
 loop execute pg_catalog.format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop; end $$;
alter table public.workspaces enable row level security;
alter table public.subjects enable row level security;
alter table public.staff_subjects enable row level security;

create policy workspace_read on public.workspaces for select to authenticated using(id=app_private.current_workspace());
create policy workspace_owner on public.workspaces for update to authenticated using(id=app_private.current_workspace() and app_private.is_owner()) with check(id=app_private.current_workspace() and app_private.is_owner());
create policy subjects_read on public.subjects for select to authenticated using(app_private.can_read_subject(id));
create policy staff_scopes_read on public.staff_subjects for select to authenticated using((app_private.account_ready() and user_id=auth.uid()) or (app_private.is_owner() and app_private.same_workspace_subject(subject_id)));
create policy profiles_read on public.profiles for select to authenticated using(app_private.can_read_profile(id));
create policy groups_read on public.groups for select to authenticated using(app_private.can_read_group(id));
create policy groups_insert on public.groups for insert to authenticated with check(app_private.is_manager() and workspace_id=app_private.current_workspace());
create policy groups_update on public.groups for update to authenticated using(app_private.is_manager() and workspace_id=app_private.current_workspace()) with check(app_private.is_manager() and workspace_id=app_private.current_workspace());
create policy memberships_read on public.group_memberships for select to authenticated using(user_id=auth.uid() or (app_private.is_manager() and app_private.can_read_group(group_id)));
create policy items_read on public.content_items for select to authenticated using(app_private.can_read_content(id));
create policy items_update on public.content_items for update to authenticated using(app_private.can_edit_subject(subject_id) and (app_private.is_manager() or status in ('draft','ready'))) with check(app_private.can_edit_subject(subject_id) and (app_private.is_manager() or status in ('draft','ready')));
create policy versions_read on public.content_versions for select to authenticated using(app_private.can_edit_content(content_id));
create policy resources_read on public.content_resources for select to authenticated using(app_private.can_read_resource(content_id,kind));
create policy module_grants_read on public.module_access for select to authenticated using(app_private.is_manager() and app_private.same_workspace_subject(subject_id));
create policy content_grants_read on public.content_access for select to authenticated using(app_private.is_manager() and app_private.can_edit_content(content_id));
create policy resource_grants_read on public.resource_access for select to authenticated using(app_private.is_manager() and app_private.can_edit_content(content_id));
create policy assignments_read on public.assignments for select to authenticated using(app_private.can_read_assignment(id));
create policy assignments_update on public.assignments for update to authenticated using(app_private.can_edit_subject(subject_id) and (app_private.is_manager() or status in ('draft','ready'))) with check(app_private.can_edit_subject(subject_id) and (app_private.is_manager() or (status in ('draft','ready') and not solutions_released)));
create policy targets_read on public.assignment_targets for select to authenticated using(app_private.can_edit_assignment(assignment_id));
create policy questions_read on public.questions for select to authenticated using(app_private.can_read_assignment(assignment_id));
create policy keys_read on public.private_answer_keys for select to authenticated using(exists(select 1 from public.questions q where q.id=question_id and app_private.can_edit_assignment(q.assignment_id)));
create policy attempts_read on public.attempts for select to authenticated using((app_private.account_ready() and user_id=auth.uid()) or app_private.can_review_attempt(id));
create policy reviews_read on public.reviews for select to authenticated using(app_private.can_review_attempt(attempt_id) or (app_private.account_ready() and exists(select 1 from public.attempts a where a.id=attempt_id and a.user_id=auth.uid())));
create policy reviews_update on public.reviews for update to authenticated using(app_private.can_review_attempt(attempt_id)) with check(app_private.can_review_attempt(attempt_id));
create policy activity_read on public.lesson_activity for select to authenticated using((app_private.account_ready() and user_id=auth.uid()) or (app_private.is_manager() and app_private.can_edit_content(content_id)));
create policy practice_read on public.practice_progress for select to authenticated using((app_private.account_ready() and user_id=auth.uid()) or (app_private.is_manager() and app_private.can_edit_content(content_id)));
create policy audit_read on public.audit_log for select to authenticated using(app_private.is_manager() and workspace_id=app_private.current_workspace());

revoke all on public.workspaces,public.subjects,public.staff_subjects from public,anon,authenticated;
grant select on public.workspaces,public.subjects,public.staff_subjects to authenticated;
grant update(name) on public.workspaces to authenticated;
grant all on public.workspaces,public.subjects,public.staff_subjects to service_role;
revoke insert,delete on public.group_memberships from authenticated;
revoke update on public.reviews,public.content_items,public.assignments,public.groups from authenticated;
grant update(status,judgment,feedback,score) on public.reviews to authenticated;
grant update(status,available_from,available_until) on public.content_items to authenticated;
grant update(status,available_from,due_at,solutions_released) on public.assignments to authenticated;
grant update(name,level,archived_at) on public.groups to authenticated;
revoke execute on all functions in schema app_private from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function app_private.current_workspace(),app_private.is_owner(),app_private.is_manager(),app_private.account_ready(),
 app_private.can_edit_subject(uuid),app_private.can_review_assignment(uuid),app_private.can_review_attempt(uuid),
 app_private.same_workspace_subject(uuid),app_private.can_read_profile(uuid),app_private.can_edit_content(uuid),
 app_private.can_edit_assignment(uuid),app_private.can_read_subject(uuid),app_private.can_read_group(uuid),
 app_private.can_read_content(uuid),app_private.can_read_resource(uuid,text),app_private.can_read_assignment(uuid),
 app_private.record_lesson_open(uuid),app_private.record_lesson_activity(uuid,int),app_private.record_practice_progress(uuid,text,boolean,boolean),
 app_private.submit_assignment_answer(uuid,jsonb,int),app_private.get_assignment_solution(uuid),
 app_private.save_content_document(jsonb,uuid),app_private.restore_content_version(uuid,int),
 app_private.save_group_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean),app_private.set_module_bundle(uuid,int,text,boolean,uuid),
 app_private.create_assignment_bundle(jsonb),app_private.management_content_activity(uuid),app_private.management_account_activity(uuid),
 app_private.management_group_activity(uuid,uuid),app_private.management_reviews(text,uuid,uuid,uuid,int,uuid),app_private.my_assignment_overview(),
 app_private.delete_member_activity(uuid),app_private.restore_configuration_backup(jsonb),app_private.set_member_group(uuid,uuid),
 app_private.set_staff_role(uuid,text,uuid[]),app_private.save_subject(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.record_lesson_open(uuid),public.record_lesson_activity(uuid,int),public.record_practice_progress(uuid,text,boolean,boolean),
 public.submit_assignment_answer(uuid,jsonb,int),public.get_assignment_solution(uuid),public.save_content_document(jsonb,uuid),public.restore_content_version(uuid,int),
 public.save_group_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean),public.set_module_bundle(uuid,int,text,boolean,uuid),public.create_assignment_bundle(jsonb),
 public.management_content_activity(uuid),public.management_account_activity(uuid),public.management_group_activity(uuid,uuid),public.management_reviews(text,uuid,uuid,uuid,int,uuid),
 public.my_assignment_overview(),public.delete_member_activity(uuid),public.restore_configuration_backup(jsonb),public.set_member_group(uuid,uuid),
 public.set_staff_role(uuid,text,uuid[]),public.save_subject(uuid,text,text,text,text,boolean) to authenticated;
alter default privileges in schema app_private revoke execute on functions from public,anon,authenticated;


-- Preserve workspace attribution for membership operations performed by the service role.
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
  if wid is null then select workspace_id into wid from public.profiles where id=case when tg_op='DELETE' then old.user_id else new.user_id end; end if;
  if wid is null then return old; end if;
  insert into public.audit_log(workspace_id,actor_id,action,target_id) values(wid,auth.uid(),
    case when tg_op='INSERT' then 'membership_added' else 'membership_removed' end,
    case when tg_op='DELETE' then old.user_id::text||':'||old.group_id::text
      else new.user_id::text||':'||new.group_id::text end);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- Explicit dimensionless numeric answers for subjects such as Mathematics.
create or replace function app_private.unit_scale(u text) returns numeric language sql immutable set search_path = '' as $$
  select case when u in ('1','dB','rad/s') then 1
    when u ~ '^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$' then
      case (pg_catalog.regexp_match(u,'^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$'))[1]
      when 'p' then 0.000000000001 when 'n' then 0.000000001 when 'u' then 0.000001 when 'µ' then 0.000001
      when 'm' then 0.001 when 'k' then 1000 when 'M' then 1000000 when 'G' then 1000000000 else 1 end
    else null end
$$;
create or replace function app_private.unit_family(u text) returns text language sql immutable set search_path = '' as $$
  select case when u='1' then 'dimensionless' when u='dB' then 'dB' when u='rad/s' then 'rad/s'
    else (pg_catalog.regexp_match(u,'^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$'))[2] end
$$;

