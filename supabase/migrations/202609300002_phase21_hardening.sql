-- P2.1 is additive to Fase 2. Apply after 202609300001_phase2.sql.
-- app_private must NOT be added to the Supabase Data API exposed schemas.
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

-- A deny wins if an existing installation has conflicting duplicate grants.
update public.module_access a set allowed = false where a.allowed and exists
  (select 1 from public.module_access b where b.allowed = false and b.year=a.year and b.module=a.module
   and b.group_id is not distinct from a.group_id and b.user_id is not distinct from a.user_id);
update public.content_access a set allowed = false where a.allowed and exists
  (select 1 from public.content_access b where b.allowed = false and b.content_id=a.content_id
   and b.group_id is not distinct from a.group_id and b.user_id is not distinct from a.user_id);
update public.resource_access a set allowed = false where a.allowed and exists
  (select 1 from public.resource_access b where b.allowed = false and b.content_id=a.content_id and b.kind=a.kind
   and b.group_id is not distinct from a.group_id and b.user_id is not distinct from a.user_id);
update public.assignment_targets a set allowed = false where a.allowed and exists
  (select 1 from public.assignment_targets b where b.allowed = false and b.assignment_id=a.assignment_id
   and b.group_id is not distinct from a.group_id and b.user_id is not distinct from a.user_id);
delete from public.module_access a using public.module_access b where a.id>b.id and a.year=b.year and a.module=b.module
  and a.group_id is not distinct from b.group_id and a.user_id is not distinct from b.user_id;
delete from public.content_access a using public.content_access b where a.id>b.id and a.content_id=b.content_id
  and a.group_id is not distinct from b.group_id and a.user_id is not distinct from b.user_id;
delete from public.resource_access a using public.resource_access b where a.id>b.id and a.content_id=b.content_id and a.kind=b.kind
  and a.group_id is not distinct from b.group_id and a.user_id is not distinct from b.user_id;
-- assignment_targets has no id in Fase 2: retain one tuple per target.
delete from public.assignment_targets a where a.ctid in
  (select ctid from (select ctid,pg_catalog.row_number() over
    (partition by assignment_id,group_id,user_id order by ctid) as rn
    from public.assignment_targets) duplicates where rn>1);

create unique index module_access_group_unique on public.module_access(group_id,year,module) where group_id is not null;
create unique index module_access_user_unique on public.module_access(user_id,year,module) where user_id is not null;
create unique index content_access_group_unique on public.content_access(group_id,content_id) where group_id is not null;
create unique index content_access_user_unique on public.content_access(user_id,content_id) where user_id is not null;
create unique index resource_access_group_unique on public.resource_access(group_id,content_id,kind) where group_id is not null;
create unique index resource_access_user_unique on public.resource_access(user_id,content_id,kind) where user_id is not null;
create unique index assignment_targets_group_unique on public.assignment_targets(group_id,assignment_id) where group_id is not null;
create unique index assignment_targets_user_unique on public.assignment_targets(user_id,assignment_id) where user_id is not null;

alter table public.content_versions add column created_by uuid references public.profiles(id) on delete set null;
alter table public.content_items add column source_id text;
update public.content_items item set source_id=(select version.document->>'id' from public.content_versions version
  where version.content_id=item.id order by version.version desc limit 1);
create unique index content_items_source_id_unique on public.content_items(source_id) where source_id is not null;
alter table public.lesson_activity add column open_count int not null default 1 check(open_count >= 1);
alter table public.lesson_activity add column last_opened_at timestamptz;
update public.lesson_activity set last_opened_at=opened_at where last_opened_at is null;
alter table public.lesson_activity alter column last_opened_at set default now();
alter table public.lesson_activity alter column last_opened_at set not null;
create table public.practice_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  exercise_id text not null check(length(exercise_id) between 1 and 100),
  attempts int not null default 0 check(attempts >= 0),
  completed boolean not null default false,
  last_correct boolean,
  last_attempt_at timestamptz not null default now(),
  primary key(user_id,content_id,exercise_id)
);
create index practice_progress_content_idx on public.practice_progress(content_id,user_id);
alter table public.practice_progress enable row level security;

-- Move every privileged function out of the Data API schema. Existing policy
-- dependencies follow the function OID when ALTER FUNCTION changes its schema.
alter function public.is_manager() set schema app_private;
alter function public.account_ready() set schema app_private;
alter function public.can_read_content(uuid) set schema app_private;
alter function public.can_read_resource(uuid,text) set schema app_private;
alter function public.can_read_assignment(uuid) set schema app_private;
alter function public.record_lesson_activity(uuid,int) set schema app_private;
alter function public.submit_assignment_answer(uuid,jsonb,int) set schema app_private;
alter function public.get_assignment_solution(uuid) set schema app_private;
alter function public.unit_scale(text) set schema app_private;
alter function public.unit_family(text) set schema app_private;

create or replace function app_private.is_manager() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='manager' and not disabled and not must_change_password)
$$;
create or replace function app_private.account_ready() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and not disabled and not must_change_password)
$$;
create or replace function app_private.can_read_content(cid uuid) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare c public.content_items%rowtype; module_allowed boolean; lesson_allowed boolean;
begin
  if app_private.is_manager() then return true; end if;
  if not app_private.account_ready() then return false; end if;
  select * into c from public.content_items where id=cid;
  if not found or c.status<>'published' or (c.available_from is not null and c.available_from>now())
    or (c.available_until is not null and c.available_until<=now()) then return false; end if;
  select allowed into module_allowed from public.module_access
    where user_id=auth.uid() and year=c.year and module=c.module;
  if not found then
    select coalesce(bool_or(ma.allowed),false) into module_allowed from public.module_access ma
      join public.groups g on g.id=ma.group_id and g.archived_at is null
      join public.group_memberships gm on gm.group_id=g.id
      where gm.user_id=auth.uid() and ma.year=c.year and ma.module=c.module;
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
  if app_private.is_manager() then return true; end if;
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
  if app_private.is_manager() then return true; end if;
  if not app_private.account_ready() then return false; end if;
  select * into a from public.assignments where id=aid;
  if not found or a.status<>'published' or (a.available_from is not null and a.available_from>now()) then return false; end if;
  select allowed into direct_allowed from public.assignment_targets where assignment_id=aid and user_id=auth.uid();
  if found then return direct_allowed; end if;
  return exists(select 1 from public.assignment_targets t
    join public.groups g on g.id=t.group_id and g.archived_at is null
    join public.group_memberships gm on gm.group_id=g.id
    where t.assignment_id=aid and t.allowed and gm.user_id=auth.uid());
end $$;
create or replace function app_private.unit_scale(u text) returns numeric language sql immutable set search_path = '' as $$
  select case when u in ('dB','rad/s') then 1
    when u ~ '^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$' then
      case (pg_catalog.regexp_match(u,'^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$'))[1]
      when 'p' then 0.000000000001 when 'n' then 0.000000001 when 'u' then 0.000001 when 'µ' then 0.000001
      when 'm' then 0.001 when 'k' then 1000 when 'M' then 1000000 when 'G' then 1000000000 else 1 end
    else null end
$$;
create or replace function app_private.unit_family(u text) returns text language sql immutable set search_path = '' as $$
  select case when u='dB' then 'dB' when u='rad/s' then 'rad/s'
    else (pg_catalog.regexp_match(u,'^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$'))[2] end
$$;

-- Existing policies reference moved function OIDs; explicit re-creation keeps
-- the SQL readable and avoids stale source text in schema dumps.
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id=auth.uid() or app_private.is_manager());
drop policy manager_groups on public.groups;
create policy manager_groups on public.groups for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy member_groups on public.groups;
create policy member_groups on public.groups for select to authenticated using(app_private.account_ready() and exists
  (select 1 from public.group_memberships gm where gm.group_id=id and gm.user_id=auth.uid()));
drop policy manager_memberships on public.group_memberships;
create policy manager_memberships on public.group_memberships for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy own_memberships on public.group_memberships;
create policy own_memberships on public.group_memberships for select to authenticated using(app_private.account_ready() and user_id=auth.uid());
drop policy manager_items on public.content_items;
create policy manager_items on public.content_items for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy readable_items on public.content_items;
create policy readable_items on public.content_items for select to authenticated using(app_private.can_read_content(id));
drop policy manager_versions on public.content_versions;
create policy manager_versions on public.content_versions for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy manager_resources on public.content_resources;
create policy manager_resources on public.content_resources for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy readable_resources on public.content_resources;
create policy readable_resources on public.content_resources for select to authenticated using(app_private.can_read_resource(content_id,kind));
drop policy manager_module_access on public.module_access;
create policy manager_module_access on public.module_access for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy manager_content_access on public.content_access;
create policy manager_content_access on public.content_access for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy manager_resource_access on public.resource_access;
create policy manager_resource_access on public.resource_access for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy manager_assignments on public.assignments;
create policy manager_assignments on public.assignments for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy readable_assignments on public.assignments;
create policy readable_assignments on public.assignments for select to authenticated using(app_private.can_read_assignment(id));
drop policy manager_targets on public.assignment_targets;
create policy manager_targets on public.assignment_targets for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy manager_questions on public.questions;
create policy manager_questions on public.questions for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy readable_questions on public.questions;
create policy readable_questions on public.questions for select to authenticated using(app_private.can_read_assignment(assignment_id));
drop policy manager_keys on public.private_answer_keys;
create policy manager_keys on public.private_answer_keys for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy manager_attempts on public.attempts;
create policy manager_attempts on public.attempts for select to authenticated using(app_private.is_manager());
drop policy own_attempts on public.attempts;
create policy own_attempts on public.attempts for select to authenticated using(app_private.account_ready() and user_id=auth.uid());
drop policy manager_reviews on public.reviews;
create policy manager_reviews on public.reviews for all to authenticated using(app_private.is_manager()) with check(app_private.is_manager());
drop policy own_reviews on public.reviews;
create policy own_reviews on public.reviews for select to authenticated using(app_private.account_ready() and exists
  (select 1 from public.attempts a where a.id=attempt_id and a.user_id=auth.uid()));
drop policy manager_activity on public.lesson_activity;
create policy manager_activity on public.lesson_activity for select to authenticated using(app_private.is_manager());
drop policy own_activity on public.lesson_activity;
create policy own_activity on public.lesson_activity for select to authenticated using(app_private.account_ready() and user_id=auth.uid());
create policy manager_practice on public.practice_progress for select to authenticated using(app_private.is_manager());
create policy own_practice on public.practice_progress for select to authenticated using(app_private.account_ready() and user_id=auth.uid());
drop policy manager_audit on public.audit_log;
create policy manager_audit on public.audit_log for select to authenticated using(app_private.is_manager());

create or replace function app_private.record_lesson_activity(cid uuid, seconds_delta int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_read_content(cid) then raise exception 'access_denied'; end if;
  if seconds_delta is null or seconds_delta<1 or seconds_delta>120 then raise exception 'invalid_activity'; end if;
  update public.lesson_activity set active_seconds=active_seconds+seconds_delta,last_active_at=pg_catalog.clock_timestamp()
    where user_id=auth.uid() and content_id=cid
      and seconds_delta <= pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()-last_active_at))::int;
  if not found then raise exception 'invalid_activity_or_open_required'; end if;
end $$;
create function app_private.record_lesson_open(cid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_read_content(cid) then raise exception 'access_denied'; end if;
  insert into public.lesson_activity(user_id,content_id,open_count,opened_at,last_opened_at,last_active_at)
    values(auth.uid(),cid,1,pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp())
  on conflict(user_id,content_id) do update set
    open_count=public.lesson_activity.open_count +
      case when pg_catalog.clock_timestamp()-public.lesson_activity.last_opened_at >= interval '5 minutes' then 1 else 0 end,
    last_opened_at=case when pg_catalog.clock_timestamp()-public.lesson_activity.last_opened_at >= interval '5 minutes'
      then pg_catalog.clock_timestamp() else public.lesson_activity.last_opened_at end;
end $$;
create function app_private.record_practice_progress(cid uuid, eid text, was_correct boolean, is_completed boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_read_resource(cid,'exercise') then raise exception 'access_denied'; end if;
  if eid is null or length(eid)<1 or length(eid)>100 then raise exception 'invalid_exercise'; end if;
  if not exists(select 1 from public.content_resources cr
    cross join lateral pg_catalog.jsonb_array_elements(cr.blocks) as entry(value)
    where cr.content_id=cid and cr.kind='exercise' and
      (entry.value->'block'->>'id'=eid or 'legacy-'||(entry.value->>'position')=eid or
       exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(entry.value->'block'->'questions','[]'::jsonb)) as child(value)
         where child.value->>'id'=eid))) then raise exception 'invalid_exercise'; end if;
  insert into public.practice_progress(user_id,content_id,exercise_id,attempts,completed,last_correct)
    values(auth.uid(),cid,eid,1,coalesce(is_completed,false),was_correct)
  on conflict(user_id,content_id,exercise_id) do update set
    attempts=public.practice_progress.attempts+1,
    completed=public.practice_progress.completed or excluded.completed,
    last_correct=excluded.last_correct,last_attempt_at=pg_catalog.clock_timestamp();
end $$;

create or replace function app_private.submit_assignment_answer(qid uuid, response jsonb, used_hints int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.questions%rowtype; a public.assignments%rowtype; keyrow public.private_answer_keys%rowtype;
 n int; result boolean; aid uuid; normalized_response numeric; normalized_key numeric;
begin
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
create or replace function app_private.get_assignment_solution(qid uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare a public.assignments%rowtype;
begin
  select x.* into a from public.assignments x join public.questions q on q.assignment_id=x.id where q.id=qid;
  if not found or not app_private.can_read_assignment(a.id) then raise exception 'access_denied'; end if;
  if not app_private.is_manager() and not
    ((a.solution_release='manual' and a.solutions_released)
      or (a.solution_release='after_deadline' and a.due_at is not null and pg_catalog.clock_timestamp()>a.due_at)
      or (a.solution_release='after_submission' and exists
        (select 1 from public.attempts where question_id=qid and user_id=auth.uid())))
    then raise exception 'solution_unavailable'; end if;
  return (select solution from public.private_answer_keys where question_id=qid);
end $$;

-- All browser RPCs are invoker wrappers. The privileged implementations are
-- in a schema not exposed via PostgREST and re-check the authenticated actor.
create function public.record_lesson_open(cid uuid) returns void language sql security invoker set search_path = '' as $$
  select app_private.record_lesson_open(cid) $$;
create function public.record_lesson_activity(cid uuid, seconds_delta int) returns void language sql security invoker set search_path = '' as $$
  select app_private.record_lesson_activity(cid,seconds_delta) $$;
create function public.record_practice_progress(cid uuid,eid text,was_correct boolean,is_completed boolean) returns void
language sql security invoker set search_path = '' as $$
  select app_private.record_practice_progress(cid,eid,was_correct,is_completed) $$;
create function public.submit_assignment_answer(qid uuid,response jsonb,used_hints int default 0) returns jsonb
language sql security invoker set search_path = '' as $$
  select app_private.submit_assignment_answer(qid,response,used_hints) $$;
create function public.get_assignment_solution(qid uuid) returns text language sql stable security invoker set search_path = '' as $$
  select app_private.get_assignment_solution(qid) $$;

create function app_private.save_content_document(doc jsonb, expected_content_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cid uuid; next_version int; old_slug text; kind_name text; resource_blocks jsonb; searchable text;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if doc->>'schemaVersion'<>'2' or pg_catalog.jsonb_typeof(doc->'blocks')<>'array'
    or pg_catalog.jsonb_array_length(doc->'blocks')<1 or doc->>'slug' is null
    or doc->>'title' is null or doc->>'module' is null then raise exception 'invalid_content_document'; end if;
  if doc->>'id' is null then raise exception 'missing_content_id'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('id:'||(doc->>'id')));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('slug:'||(doc->>'slug')));
  if (select count(*) from public.content_items where slug=doc->>'slug' or source_id=doc->>'id')>1
    then raise exception 'content_identity_conflict'; end if;
  select id into cid from public.content_items where slug=doc->>'slug' or source_id=doc->>'id' for update;
  if expected_content_id is not null and cid is distinct from expected_content_id then raise exception 'content_identity_mismatch'; end if;
  if cid is not null and expected_content_id is null then raise exception 'content_already_exists'; end if;
  if cid is null then
    insert into public.content_items(source_id,slug,title,summary,year,module,topic,tags,sort_order,status)
      values(doc->>'id',doc->>'slug',doc->>'title',doc->>'summary',(doc->>'year')::int,doc->>'module',doc->>'topic',
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
create function public.save_content_document(doc jsonb, expected_content_id uuid default null) returns jsonb
language sql security invoker set search_path = '' as $$ select app_private.save_content_document(doc,expected_content_id) $$;

create function app_private.restore_content_version(cid uuid, source_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare source_doc jsonb; result jsonb;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  select document into source_doc from public.content_versions where content_id=cid and version=source_version;
  if not found then raise exception 'version_not_found'; end if;
  result:=app_private.save_content_document(source_doc,cid);
  insert into public.audit_log(actor_id,action,target_id)
    values(auth.uid(),'content_version_restored',cid::text||':'||source_version::text);
  return result;
end $$;
create function public.restore_content_version(cid uuid, source_version int) returns jsonb
language sql security invoker set search_path = '' as $$ select app_private.restore_content_version(cid,source_version) $$;

create function app_private.save_group_access(cid uuid,gid uuid,module_allowed boolean,lesson_allowed boolean,
  theory_allowed boolean,simulation_allowed boolean,exercise_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.content_items%rowtype;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  select * into item from public.content_items where id=cid;
  if not found or not exists(select 1 from public.groups where id=gid and archived_at is null) then raise exception 'invalid_access_target'; end if;
  insert into public.module_access(group_id,year,module,allowed) values(gid,item.year,item.module,module_allowed)
    on conflict(group_id,year,module) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.content_access(group_id,content_id,allowed) values(gid,cid,lesson_allowed)
    on conflict(group_id,content_id) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.resource_access(group_id,content_id,kind,allowed) values
    (gid,cid,'theory',theory_allowed),(gid,cid,'simulation',simulation_allowed),(gid,cid,'exercise',exercise_allowed)
    on conflict(group_id,content_id,kind) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'group_access_changed',gid::text||':'||cid::text);
end $$;
create function public.save_group_access(cid uuid,gid uuid,module_allowed boolean,lesson_allowed boolean,
  theory_allowed boolean,simulation_allowed boolean,exercise_allowed boolean) returns void
language sql security invoker set search_path = '' as $$
  select app_private.save_group_access(cid,gid,module_allowed,lesson_allowed,theory_allowed,simulation_allowed,exercise_allowed) $$;
create function app_private.set_module_bundle(gid uuid,academic_year int,module_name text,allowed_value boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.groups where id=gid and archived_at is null) then raise exception 'invalid_access_target'; end if;
  if academic_year not in (3,4) or module_name is null then raise exception 'invalid_module'; end if;
  insert into public.module_access(group_id,year,module,allowed) values(gid,academic_year,module_name,allowed_value)
    on conflict(group_id,year,module) where group_id is not null do update set allowed=excluded.allowed;
  for cid in select id from public.content_items where year=academic_year and module=module_name loop
    insert into public.content_access(group_id,content_id,allowed) values(gid,cid,allowed_value)
      on conflict(group_id,content_id) where group_id is not null do update set allowed=excluded.allowed;
    insert into public.resource_access(group_id,content_id,kind,allowed) values
      (gid,cid,'theory',allowed_value),(gid,cid,'simulation',allowed_value),(gid,cid,'exercise',allowed_value)
      on conflict(group_id,content_id,kind) where group_id is not null do update set allowed=excluded.allowed;
  end loop;
  insert into public.audit_log(actor_id,action,target_id)
    values(auth.uid(),'module_access_changed',gid::text||':'||academic_year::text||':'||module_name);
end $$;
create function public.set_module_bundle(gid uuid,academic_year int,module_name text,allowed_value boolean) returns void
language sql security invoker set search_path = '' as $$
  select app_private.set_module_bundle(gid,academic_year,module_name,allowed_value) $$;

create function app_private.create_assignment_bundle(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare draft jsonb; q jsonb; keyrow jsonb; aid uuid; qid uuid; gid uuid; content_id uuid; position int:=0;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  draft:=payload->'draft'; gid:=(payload->>'groupId')::uuid; content_id:=(payload->>'contentId')::uuid;
  if pg_catalog.jsonb_typeof(draft->'questions')<>'array' or pg_catalog.jsonb_array_length(draft->'questions')<1
    or (payload->>'maxAttempts')::int not between 1 and 20
    or not exists(select 1 from public.groups where id=gid and archived_at is null)
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
create function public.create_assignment_bundle(payload jsonb) returns uuid
language sql security invoker set search_path = '' as $$ select app_private.create_assignment_bundle(payload) $$;

create function app_private.user_can_read_content(uid uuid,cid uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare item public.content_items%rowtype; module_allowed boolean; lesson_allowed boolean;
begin
  if not exists(select 1 from public.profiles p where p.id=uid and p.role='member'
    and not p.disabled and not p.must_change_password) then return false; end if;
  select * into item from public.content_items where id=cid;
  if not found or item.status<>'published' or (item.available_from is not null and item.available_from>now())
    or (item.available_until is not null and item.available_until<=now()) then return false; end if;
  select allowed into module_allowed from public.module_access where user_id=uid and year=item.year and module=item.module;
  if not found then select coalesce(bool_or(ma.allowed),false) into module_allowed from public.module_access ma
    join public.groups g on g.id=ma.group_id and g.archived_at is null
    join public.group_memberships gm on gm.group_id=g.id
    where gm.user_id=uid and ma.year=item.year and ma.module=item.module; end if;
  if not coalesce(module_allowed,false) then return false; end if;
  select allowed into lesson_allowed from public.content_access where content_id=cid and user_id=uid;
  if found then return lesson_allowed; end if;
  return exists(select 1 from public.content_access ca
    join public.groups g on g.id=ca.group_id and g.archived_at is null
    join public.group_memberships gm on gm.group_id=g.id
    where gm.user_id=uid and ca.content_id=cid and ca.allowed);
end $$;
create function app_private.management_content_activity(cid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
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
create function public.management_content_activity(cid uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select app_private.management_content_activity(cid) $$;
create function app_private.management_account_activity(uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'contentId',c.id,'title',c.title,'firstOpen',la.opened_at,'lastOpen',la.last_opened_at,
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
create function public.management_account_activity(uid uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select app_private.management_account_activity(uid) $$;
create function app_private.my_assignment_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.account_ready() then raise exception 'access_denied'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',a.id,'title',a.title,'due_at',a.due_at,
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
create function public.my_assignment_overview() returns jsonb
language sql stable security invoker set search_path = '' as $$ select app_private.my_assignment_overview() $$;
create function app_private.management_group_activity(gid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare eligible int; opened int; attempted int; completed int; tries int; pending int; member_count int; assignment_tries int;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.groups where id=gid) then raise exception 'group_not_found'; end if;
  select count(*) into eligible from public.group_memberships gm join public.content_items c
    on app_private.user_can_read_content(gm.user_id,c.id) where gm.group_id=gid;
  select count(*) into opened from public.group_memberships gm join public.lesson_activity la on la.user_id=gm.user_id
    join public.content_items c on c.id=la.content_id and app_private.user_can_read_content(gm.user_id,c.id)
    where gm.group_id=gid;
  select count(*),count(*) filter(where pp.completed),coalesce(sum(pp.attempts),0)
    into attempted,completed,tries from public.practice_progress pp
    join public.group_memberships gm on gm.user_id=pp.user_id
    where gm.group_id=gid and app_private.user_can_read_content(pp.user_id,pp.content_id);
  select count(*) into pending from public.reviews r join public.attempts a on a.id=r.attempt_id
    join public.group_memberships gm on gm.user_id=a.user_id where gm.group_id=gid and r.status<>'reviewed';
  select count(*) into member_count from public.group_memberships gm join public.profiles p on p.id=gm.user_id
    where gm.group_id=gid and p.role='member' and not p.disabled;
  select count(*) into assignment_tries from public.attempts a join public.group_memberships gm on gm.user_id=a.user_id
    where gm.group_id=gid;
  return pg_catalog.jsonb_build_object('eligible',eligible,'opened',opened,'practiceAttempted',attempted,
    'practiceCompleted',completed,'practiceAttempts',tries,'pendingReviews',pending,
    'averageAssignmentAttempts',case when member_count>0 then pg_catalog.round(assignment_tries::numeric/member_count,1) else 0 end,
    'topErrors',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('question',err.prompt,'errors',err.n))
      from (select q.prompt,count(*) as n from public.attempts a join public.questions q on q.id=a.question_id
        join public.group_memberships gm on gm.user_id=a.user_id where gm.group_id=gid and a.correct=false
        group by q.id,q.prompt order by n desc limit 5) err),'[]'::jsonb));
end $$;
create function public.management_group_activity(gid uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select app_private.management_group_activity(gid) $$;
create function app_private.management_reviews(filter_status text, filter_group uuid, filter_assignment uuid,
  filter_user uuid, page_number int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
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
    where (filter_status is null or r.status=filter_status)
      and (filter_user is null or a.user_id=filter_user)
      and (filter_assignment is null or q.assignment_id=filter_assignment)
      and (filter_group is null or exists(select 1 from public.group_memberships gm
        where gm.user_id=a.user_id and gm.group_id=filter_group))
    order by case r.status when 'pending' then 0 when 'in_review' then 1 else 2 end,r.updated_at desc
    limit 25 offset page_number*25) v),'[]'::jsonb));
end $$;
create function public.management_reviews(filter_status text default null,filter_group uuid default null,
  filter_assignment uuid default null,filter_user uuid default null,page_number int default 0) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select app_private.management_reviews(filter_status,filter_group,filter_assignment,filter_user,page_number) $$;
create function app_private.delete_member_activity(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.profiles where id=uid and role='member') then raise exception 'member_target_required'; end if;
  delete from public.lesson_activity where user_id=uid;
  delete from public.practice_progress where user_id=uid;
  delete from public.attempts where user_id=uid;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'activity_deleted',uid::text);
end $$;
create function public.delete_member_activity(uid uuid) returns void
language sql security invoker set search_path = '' as $$ select app_private.delete_member_activity(uid) $$;
create function app_private.restore_configuration_backup(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare section text;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if payload->>'format'<>'telecomlab-backup-v3' or payload->>'schemaVersion'<>'3' then raise exception 'incompatible_backup'; end if;
  foreach section in array array['groups','content_items','content_versions','content_resources',
    'module_access','content_access','resource_access'] loop
    if pg_catalog.jsonb_typeof(payload->section)<>'array' then raise exception 'invalid_backup_section: %',section; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_populate_recordset(null::public.groups,payload->'groups') g
      join public.groups existing on existing.id=g.id or existing.name=g.name)
    or exists(select 1 from pg_catalog.jsonb_populate_recordset(null::public.content_items,payload->'content_items') c
      join public.content_items existing on existing.id=c.id or existing.slug=c.slug)
    then raise exception 'backup_conflict_existing_data'; end if;
  insert into public.groups(id,name,level,archived_at)
    select id,name,level,archived_at from pg_catalog.jsonb_populate_recordset(null::public.groups,payload->'groups');
  insert into public.content_items(id,source_id,slug,title,summary,year,module,topic,tags,status,available_from,available_until,
    sort_order,created_at,updated_at)
    select c.id,coalesce(c.source_id,(select v.document->>'id' from
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
  insert into public.module_access(id,group_id,year,module,allowed)
    select id,group_id,year,module,allowed
    from pg_catalog.jsonb_populate_recordset(null::public.module_access,payload->'module_access') where group_id is not null;
  insert into public.content_access(id,content_id,group_id,allowed)
    select id,content_id,group_id,allowed
    from pg_catalog.jsonb_populate_recordset(null::public.content_access,payload->'content_access') where group_id is not null;
  insert into public.resource_access(id,content_id,kind,group_id,allowed)
    select id,content_id,kind,group_id,allowed
    from pg_catalog.jsonb_populate_recordset(null::public.resource_access,payload->'resource_access') where group_id is not null;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'backup_configuration_restored',null);
end $$;
create function public.restore_configuration_backup(payload jsonb) returns void
language sql security invoker set search_path = '' as $$ select app_private.restore_configuration_backup(payload) $$;

create function app_private.audit_sensitive_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare action_name text; object_id text;
begin
  if tg_table_name='content_items' and tg_op='UPDATE' then
    new.updated_at:=pg_catalog.clock_timestamp();
    if new.status='published' and old.status is distinct from new.status and
      (not exists(select 1 from public.content_versions where content_id=new.id)
       or not exists(select 1 from public.content_resources where content_id=new.id))
      then raise exception 'content_incomplete'; end if;
    if (new.status,new.available_from,new.available_until) is distinct from
      (old.status,old.available_from,old.available_until) then
      action_name:='content_publication_changed'; object_id:=new.id::text;
    end if;
  elsif tg_table_name='assignments' and tg_op='UPDATE' then
    if new.status='published' and old.status is distinct from new.status and
      (not exists(select 1 from public.assignment_targets where assignment_id=new.id and allowed)
       or not exists(select 1 from public.questions where assignment_id=new.id)
       or exists(select 1 from public.questions q left join public.private_answer_keys k on k.question_id=q.id
         where q.assignment_id=new.id and k.question_id is null))
      then raise exception 'assignment_incomplete'; end if;
    if (new.status,new.available_from,new.due_at,new.solutions_released) is distinct from
      (old.status,old.available_from,old.due_at,old.solutions_released) then
      action_name:='assignment_publication_changed'; object_id:=new.id::text;
    end if;
  elsif tg_table_name='reviews' and tg_op='UPDATE' then
    new.reviewer_id:=auth.uid(); new.updated_at:=pg_catalog.clock_timestamp();
    action_name:='review_saved'; object_id:=new.attempt_id::text;
  else return new; end if;
  if action_name is not null then insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),action_name,object_id); end if;
  return new;
end $$;
create trigger content_status_audit before update on public.content_items
  for each row execute function app_private.audit_sensitive_change();
create trigger assignment_status_audit before update on public.assignments
  for each row execute function app_private.audit_sensitive_change();
create trigger review_audit before update on public.reviews
  for each row execute function app_private.audit_sensitive_change();
create function app_private.audit_membership_or_group() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='groups' then
    insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),
      case when tg_op='INSERT' then 'group_created' else 'group_changed' end,new.id::text);
    return new;
  end if;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),
    case when tg_op='INSERT' then 'membership_added' else 'membership_removed' end,
    case when tg_op='DELETE' then old.user_id::text||':'||old.group_id::text
      else new.user_id::text||':'||new.group_id::text end);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger group_audit after insert or update on public.groups
  for each row execute function app_private.audit_membership_or_group();
create trigger membership_audit after insert or delete on public.group_memberships
  for each row execute function app_private.audit_membership_or_group();

-- Existing projects may auto-grant new objects in public. Explicitly reset
-- the API surface after every object above has been created.
create function app_private.set_member_group(uid uuid, gid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.profiles where id=uid and role='member') then raise exception 'invalid_member'; end if;
  if gid is not null and not exists(select 1 from public.groups where id=gid and archived_at is null) then raise exception 'invalid_group'; end if;
  delete from public.group_memberships where user_id=uid;
  if gid is not null then insert into public.group_memberships(user_id,group_id) values(uid,gid); end if;
end $$;
create function public.set_member_group(uid uuid, gid uuid) returns void
language sql security invoker set search_path = '' as $$ select app_private.set_member_group(uid,gid) $$;

revoke all on all tables in schema public from public,anon,authenticated;
revoke all on all sequences in schema public from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
revoke execute on all functions in schema app_private from public,anon,authenticated;
grant select on public.profiles,public.groups,public.group_memberships,public.content_items,
  public.content_versions,public.content_resources,public.module_access,public.content_access,
  public.resource_access,public.assignments,public.assignment_targets,public.questions,
  public.private_answer_keys,public.attempts,public.reviews,public.lesson_activity,
  public.practice_progress,public.audit_log to authenticated;
grant insert,update on public.groups to authenticated;
grant insert,delete on public.group_memberships to authenticated;
grant update on public.content_items,public.assignments,public.reviews to authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_manager(),app_private.account_ready(),
  app_private.can_read_content(uuid),app_private.can_read_resource(uuid,text),
  app_private.can_read_assignment(uuid),app_private.record_lesson_open(uuid),
  app_private.record_lesson_activity(uuid,int),app_private.record_practice_progress(uuid,text,boolean,boolean),
  app_private.submit_assignment_answer(uuid,jsonb,int),app_private.get_assignment_solution(uuid),
  app_private.save_content_document(jsonb,uuid),app_private.restore_content_version(uuid,int),
  app_private.save_group_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean),
  app_private.set_module_bundle(uuid,int,text,boolean),app_private.create_assignment_bundle(jsonb),
  app_private.management_content_activity(uuid),app_private.management_account_activity(uuid),
  app_private.management_group_activity(uuid),app_private.management_reviews(text,uuid,uuid,uuid,int),
  app_private.my_assignment_overview(),app_private.delete_member_activity(uuid),
  app_private.set_member_group(uuid,uuid),
  app_private.restore_configuration_backup(jsonb) to authenticated;
grant execute on function public.record_lesson_open(uuid),public.record_lesson_activity(uuid,int),
  public.record_practice_progress(uuid,text,boolean,boolean),
  public.submit_assignment_answer(uuid,jsonb,int),public.get_assignment_solution(uuid),
  public.save_content_document(jsonb,uuid),public.restore_content_version(uuid,int),
  public.save_group_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean),
  public.set_module_bundle(uuid,int,text,boolean),
  public.create_assignment_bundle(jsonb),public.management_content_activity(uuid),public.my_assignment_overview(),
  public.management_account_activity(uuid),public.management_group_activity(uuid),
  public.management_reviews(text,uuid,uuid,uuid,int),public.delete_member_activity(uuid),
  public.set_member_group(uuid,uuid),
  public.restore_configuration_backup(jsonb) to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- No future object is automatically reachable over the Data API.
alter default privileges in schema public revoke all on tables from anon,authenticated,service_role;
alter default privileges in schema public revoke all on sequences from anon,authenticated,service_role;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role;
