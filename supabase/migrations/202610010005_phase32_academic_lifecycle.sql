-- P3.2: incremental, no identity or historical document replacement.
-- Migration intentionally fails on ambiguous legacy cohorts / multiple active years.
-- Resolve those inconsistencies explicitly before retrying; never silently discard rows.
do $$ begin
 if exists(select 1 from public.academic_years where status='active' group by workspace_id having count(*)>1) then raise exception 'migration_multiple_active_years'; end if;
 if exists(select 1 from public.group_memberships m join public.groups g on g.id=m.group_id group by m.user_id,g.workspace_id,g.academic_year_id having count(*)>1) then raise exception 'migration_ambiguous_enrollments'; end if;
end $$;
create unique index one_active_year_per_workspace on public.academic_years(workspace_id) where status='active';
create table public.academic_levels (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 code text not null check(length(code) between 1 and 40),label text not null check(length(label) between 1 and 100),
 sort_order int not null default 0,archived_at timestamptz,created_at timestamptz not null default now(),unique(workspace_id,code)
);
create table public.track_levels(track_id uuid not null references public.tracks(id),level_id uuid not null references public.academic_levels(id),sort_order int not null,primary key(track_id,level_id),unique(track_id,sort_order));
insert into public.academic_levels(workspace_id,code,label,sort_order)
 select workspace_id,code,code,code::int from (
 select workspace_id,level::text code from public.groups where level is not null
 union select workspace_id,year::text from public.content_items
 union select s.workspace_id,m.year::text from public.module_access m join public.subjects s on s.id=m.subject_id) v;
alter table public.groups drop constraint groups_level_check;
alter table public.groups add column level_id uuid references public.academic_levels(id);
update public.groups g set level_id=l.id from public.academic_levels l where l.workspace_id=g.workspace_id and l.code=g.level::text;
insert into public.track_levels select distinct g.track_id,l.id,l.sort_order from public.groups g join public.academic_levels l on l.workspace_id=g.workspace_id;
alter table public.content_items drop constraint content_items_year_check;
alter table public.content_items alter column year drop not null;
alter table public.content_items add column level_code text;
update public.content_items set level_code=year::text;
alter table public.module_access drop constraint module_access_year_check;
alter table public.module_access alter column year drop not null;
alter table public.module_access add column level_code text not null default '';
update public.module_access set level_code=year::text;
create unique index module_level_group_unique on public.module_access(group_id,subject_id,level_code,module) where group_id is not null;
create unique index module_level_user_unique on public.module_access(user_id,subject_id,level_code,module) where user_id is not null;
alter table public.content_items drop constraint content_items_workspace_id_slug_key;
drop index public.content_identity_workspace_idx;
create unique index content_subject_slug on public.content_items(workspace_id,subject_id,slug);
create unique index content_subject_source on public.content_items(workspace_id,subject_id,source_id) where source_id is not null;

create table public.enrollments (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),academic_year_id uuid not null references public.academic_years(id),
 user_id uuid not null references public.profiles(id),group_id uuid not null references public.groups(id),
 started_at date not null,ended_at date,status text not null default 'active' check(status in ('active','completed','transferred','withdrawn')),
 outcome text check(outcome in ('promoted','repeat','completed_path','transferred_out','left','other')),
 provenance text not null default 'explicit',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(ended_at is null or ended_at>=started_at),check((status='active' and ended_at is null) or (status<>'active' and ended_at is not null))
);
create unique index one_primary_active_enrollment on public.enrollments(workspace_id,academic_year_id,user_id) where status='active';
create index enrollment_group_time on public.enrollments(group_id,user_id,started_at,ended_at);
create index enrollment_user_history on public.enrollments(workspace_id,user_id,academic_year_id);
insert into public.enrollments(workspace_id,academic_year_id,user_id,group_id,started_at,ended_at,status,provenance)
 select g.workspace_id,g.academic_year_id,m.user_id,g.id,y.start_date,case when y.status='archived' then y.end_date end,
 case when y.status='archived' then 'completed' else 'active' end,'P3.1 membership; exact joining date unknown' from public.group_memberships m join public.groups g on g.id=m.group_id join public.academic_years y on y.id=g.academic_year_id;
-- group_memberships remains as an immutable migration reference, never used for new authorization.
revoke insert,delete on public.group_memberships from authenticated;

create table public.subject_offerings (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),academic_year_id uuid not null references public.academic_years(id),
 track_id uuid not null references public.tracks(id),subject_id uuid not null references public.subjects(id),level_id uuid references public.academic_levels(id),
 status text not null default 'active' check(status in ('draft','active','archived')),created_at timestamptz not null default now()
);
create unique index offering_level_unique on public.subject_offerings(academic_year_id,track_id,subject_id,level_id) where level_id is not null;
create unique index offering_general_unique on public.subject_offerings(academic_year_id,track_id,subject_id) where level_id is null;
insert into public.subject_offerings(workspace_id,academic_year_id,track_id,subject_id,status)
 select distinct g.workspace_id,g.academic_year_id,g.track_id,s.id,case when y.status='archived' then 'archived' else 'active' end
 from public.groups g join public.academic_years y on y.id=g.academic_year_id join public.subjects s on s.workspace_id=g.workspace_id
 where exists(select 1 from public.track_subjects ts where ts.track_id=g.track_id and ts.subject_id=s.id)
 or exists(select 1 from public.content_access ca join public.content_items c on c.id=ca.content_id where ca.group_id=g.id and c.subject_id=s.id)
 or exists(select 1 from public.assignment_targets at join public.assignments a on a.id=at.assignment_id where at.group_id=g.id and a.subject_id=s.id);
create table public.teaching_assignments (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),staff_user_id uuid not null references public.profiles(id),
 academic_year_id uuid not null references public.academic_years(id),subject_id uuid not null references public.subjects(id),group_id uuid not null references public.groups(id),
 track_id uuid references public.tracks(id),created_at timestamptz not null default now(),unique(staff_user_id,subject_id,group_id)
);
-- Deliberately no automatic personal-data scopes inferred from authoring scopes.
create index teaching_staff_context on public.teaching_assignments(workspace_id,staff_user_id,academic_year_id,group_id,subject_id);
create table public.rollover_batches (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),source_year_id uuid not null references public.academic_years(id),
 destination_year_id uuid not null references public.academic_years(id),status text not null default 'draft' check(status in ('draft','ready','applied','cancelled')),
 revision int not null default 1,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),applied_at timestamptz,report jsonb,
 check(source_year_id<>destination_year_id)
);
create table public.rollover_entries (
 batch_id uuid not null references public.rollover_batches(id),enrollment_id uuid not null references public.enrollments(id),
 decision text not null default 'pending' check(decision in ('pending','advance','repeat','change_group','change_track','complete','exit')),
 destination_group_id uuid references public.groups(id),source_snapshot jsonb not null,primary key(batch_id,enrollment_id)
);
create table public.content_releases (
 id uuid primary key default gen_random_uuid(),content_id uuid not null references public.content_items(id),content_version int not null,
 workspace_id uuid not null references public.workspaces(id),academic_year_id uuid not null references public.academic_years(id),group_id uuid not null references public.groups(id),
 available_from timestamptz,available_until timestamptz,status text not null default 'published' check(status in ('published','superseded','archived')),
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),foreign key(content_id,content_version) references public.content_versions(content_id,version),
 check(available_until is null or available_from is null or available_until>available_from)
);
create unique index current_content_release on public.content_releases(content_id,group_id) where status='published';
create index release_context on public.content_releases(workspace_id,academic_year_id,group_id,status,content_id);
insert into public.content_releases(content_id,content_version,workspace_id,academic_year_id,group_id,available_from,available_until,status)
 select c.id,(select max(version) from public.content_versions where content_id=c.id),c.workspace_id,g.academic_year_id,g.id,c.available_from,c.available_until,
 case when y.status='archived' then 'archived' else 'published' end
 from public.content_items c join public.content_access ca on ca.content_id=c.id and ca.allowed join public.groups g on g.id=ca.group_id join public.academic_years y on y.id=g.academic_year_id
 where c.status='published' and exists(select 1 from public.content_versions where content_id=c.id);
create table public.lesson_release_activity (
 user_id uuid not null references public.profiles(id),release_id uuid not null references public.content_releases(id),
 first_opened_at timestamptz not null default now(),last_opened_at timestamptz not null default now(),last_active_at timestamptz not null default now(),open_count int not null default 1,active_seconds int not null default 0,
 primary key(user_id,release_id),check(active_seconds>=0 and open_count>0)
);
create table public.practice_release_progress (
 user_id uuid not null references public.profiles(id),release_id uuid not null references public.content_releases(id),exercise_id text not null,
 attempts int not null default 1,completed boolean not null default false,last_correct boolean,last_attempt_at timestamptz not null default now(),primary key(user_id,release_id,exercise_id),check(attempts>0)
);
create index release_activity_release on public.lesson_release_activity(release_id,user_id);
create index release_practice_release on public.practice_release_progress(release_id,user_id);
alter table public.attempts add column enrollment_id uuid references public.enrollments(id);
alter table public.audit_log add column details jsonb;

create function app_private.active_enrollment(uid uuid,gid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.enrollments e join public.groups g on g.id=e.group_id join public.academic_years y on y.id=e.academic_year_id join public.workspace_memberships m on m.workspace_id=e.workspace_id and m.user_id=e.user_id join public.profiles p on p.id=e.user_id
 where (uid=auth.uid() or app_private.is_manager()) and e.user_id=uid and e.group_id=gid and e.workspace_id=app_private.current_workspace() and e.status='active' and e.started_at<=current_date and e.ended_at is null
 and current_date between y.start_date and y.end_date and y.status='active' and g.archived_at is null and m.role='member' and not m.disabled and not p.disabled and not p.must_change_password) $$;
create function app_private.teaches_group(gid uuid,sid uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.teaching_assignments t where t.workspace_id=app_private.current_workspace() and t.staff_user_id=auth.uid() and app_private.current_role() in ('editor','reviewer') and t.group_id=gid and (sid is null or t.subject_id=sid)) $$;
create or replace function app_private.can_read_group(gid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.groups g where g.id=gid and g.workspace_id=app_private.current_workspace() and (app_private.is_manager() or app_private.teaches_group(gid) or app_private.active_enrollment(auth.uid(),gid))) $$;
create or replace function app_private.can_review_assignment(aid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.assignments a where a.id=aid and app_private.same_workspace_subject(a.subject_id) and (app_private.is_manager() or (app_private.current_role()='reviewer' and exists(select 1 from public.assignment_targets t where t.assignment_id=a.id and t.allowed and app_private.teaches_group(t.group_id,a.subject_id))))) $$;
create or replace function app_private.can_review_attempt(aid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attempts a join public.questions q on q.id=a.question_id join public.assignments ass on ass.id=q.assignment_id
 where a.id=aid and app_private.same_workspace_subject(ass.subject_id) and (app_private.is_manager() or (app_private.current_role()='reviewer' and q.kind in ('shortOpen','extendedOpen') and exists(
 select 1 from public.enrollments e where e.user_id=a.user_id and e.academic_year_id=ass.academic_year_id and a.enrollment_id=e.id
 and app_private.teaches_group(e.group_id,ass.subject_id) and exists(select 1 from public.assignment_targets t where t.assignment_id=ass.id and (t.group_id=e.group_id or t.user_id=a.user_id) and t.allowed))))) $$;

create function app_private.validate_academic_relation() returns trigger language plpgsql security definer set search_path='' as $$
declare g public.groups%rowtype; wid uuid; y public.academic_years%rowtype;
begin
 if tg_table_name='track_levels' then
 if (select workspace_id from public.tracks where id=new.track_id) is distinct from (select workspace_id from public.academic_levels where id=new.level_id) then raise exception 'workspace_mismatch'; end if;
 elsif tg_table_name='groups' then
 select * into y from public.academic_years where id=new.academic_year_id for share;
 if y.status='archived' then raise exception 'academic_year_archived';end if;
 if new.level_id is null and new.level is not null then select id into new.level_id from public.academic_levels where workspace_id=new.workspace_id and code=new.level::text; end if;
 if new.level_id is not null and not exists(select 1 from public.track_levels t join public.academic_levels l on l.id=t.level_id where t.track_id=new.track_id and l.id=new.level_id and l.workspace_id=new.workspace_id and l.archived_at is null) then raise exception 'invalid_track_level'; end if;
 if tg_op='UPDATE' and new.level_id is distinct from old.level_id and exists(select 1 from public.enrollments where group_id=old.id) then raise exception 'historical_group_level_immutable'; end if;
 elsif tg_table_name='enrollments' then
 perform pg_advisory_xact_lock(hashtext(new.workspace_id::text||':rollover'));
 select * into g from public.groups where id=new.group_id;select * into y from public.academic_years where id=new.academic_year_id for share;
 if g.workspace_id is distinct from new.workspace_id or g.academic_year_id is distinct from new.academic_year_id or not exists(select 1 from public.workspace_memberships where workspace_id=new.workspace_id and user_id=new.user_id and role='member') then raise exception 'workspace_mismatch'; end if;
 if y.status='archived' then raise exception 'academic_year_archived'; end if;
 if new.started_at<y.start_date or new.started_at>y.end_date or (new.ended_at is not null and new.ended_at>y.end_date) then raise exception 'enrollment_outside_year'; end if;
 if new.status='active' and g.archived_at is not null then raise exception 'invalid_group'; end if;
 if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.user_id<>old.user_id or new.academic_year_id<>old.academic_year_id or new.group_id<>old.group_id or new.started_at<>old.started_at) then raise exception 'enrollment_identity_immutable'; end if;
 if tg_op='UPDATE' and old.status<>'active' and current_setting('app.rollover_rollback',true) is distinct from 'on' then raise exception 'closed_enrollment_immutable'; end if;
 new.updated_at:=clock_timestamp();
 elsif tg_table_name in ('subject_offerings','teaching_assignments','content_releases') then
 select * into y from public.academic_years where id=new.academic_year_id for share;
 if y.workspace_id is distinct from new.workspace_id then raise exception 'workspace_mismatch'; end if;
 if y.status='archived' then raise exception 'academic_year_archived'; end if;
 if tg_table_name='content_releases' then
 select * into g from public.groups where id=new.group_id;
 if g.workspace_id is distinct from new.workspace_id or g.academic_year_id is distinct from new.academic_year_id or (select workspace_id from public.content_items where id=new.content_id) is distinct from new.workspace_id then raise exception 'workspace_mismatch'; end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then raise exception 'release_immutable'; end if;
 else
 if (select workspace_id from public.subjects where id=new.subject_id) is distinct from new.workspace_id then raise exception 'workspace_mismatch'; end if;
 if new.track_id is not null and (select workspace_id from public.tracks where id=new.track_id) is distinct from new.workspace_id then raise exception 'workspace_mismatch'; end if;
 if tg_table_name='subject_offerings' then
 if new.level_id is not null and not exists(select 1 from public.track_levels where track_id=new.track_id and level_id=new.level_id) then raise exception 'invalid_track_level'; end if;
 else
 select * into g from public.groups where id=new.group_id;
 if g.workspace_id is distinct from new.workspace_id or g.academic_year_id is distinct from new.academic_year_id or (new.track_id is not null and new.track_id<>g.track_id) or not exists(select 1 from public.workspace_memberships where workspace_id=new.workspace_id and user_id=new.staff_user_id and role in ('editor','reviewer') and not disabled) then raise exception 'invalid_teaching_assignment'; end if;
 end if;
 end if;
 end if;return new;
end $$;
do $$ declare t text;begin foreach t in array array['track_levels','groups','enrollments','subject_offerings','teaching_assignments','content_releases'] loop execute format('create trigger zz_academic_relation before insert or update on public.%I for each row execute function app_private.validate_academic_relation()',t);end loop;end $$;

create function app_private.change_enrollment(uid uuid,gid uuid,effective_on date,end_outcome text default 'other') returns uuid language plpgsql security definer set search_path='' as $$
declare g public.groups%rowtype;e public.enrollments%rowtype;result uuid;yid uuid;
begin
 if not app_private.is_manager() or not exists(select 1 from public.workspace_memberships where workspace_id=app_private.current_workspace() and user_id=uid and role='member' and not disabled) then raise exception 'access_denied'; end if;
 if gid is not null then select * into g from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null;if not found then raise exception 'invalid_group'; end if;yid:=g.academic_year_id;
 else select id into yid from public.academic_years where workspace_id=app_private.current_workspace() and status='active';end if;
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':'||uid::text));
 select * into e from public.enrollments where workspace_id=app_private.current_workspace() and academic_year_id=yid and user_id=uid and status='active' for update;
 if effective_on>current_date and e.id is not null and not (effective_on=e.started_at and exists(select 1 from public.academic_years where id=e.academic_year_id and status='upcoming')) then raise exception 'future_transfer_use_rollover';end if;
 if found and e.group_id=gid then return e.id;end if;
 if e.id is not null then update public.enrollments set status=case when gid is null then 'withdrawn' else 'transferred' end,ended_at=effective_on,outcome=end_outcome where id=e.id;end if;
 if gid is not null then insert into public.enrollments(workspace_id,academic_year_id,user_id,group_id,started_at) values(g.workspace_id,g.academic_year_id,uid,gid,effective_on) returning id into result;end if;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'enrollment_changed',uid::text,jsonb_build_object('previous',e.id,'new',result,'effectiveOn',effective_on,'outcome',end_outcome));return result;
end $$;
create function public.change_enrollment(uid uuid,gid uuid,effective_on date,end_outcome text default 'other') returns uuid language sql security invoker set search_path='' as $$ select app_private.change_enrollment(uid,gid,effective_on,end_outcome) $$;
create or replace function app_private.set_member_group(uid uuid,gid uuid) returns void language plpgsql security definer set search_path='' as $$ begin perform app_private.change_enrollment(uid,gid,coalesce((select greatest(current_date,y.start_date) from public.groups g join public.academic_years y on y.id=g.academic_year_id where g.id=gid),current_date),'other');end $$;
create function app_private.enrollment_history(uid uuid default null,gid uuid default null,page_number int default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if page_number<0 or page_number>1000 or (uid is null and gid is null) then raise exception 'invalid_page';end if;
 if not app_private.is_manager() and (uid is distinct from auth.uid()) and not app_private.teaches_group(gid) then raise exception 'access_denied';end if;
 return coalesce((select jsonb_agg(to_jsonb(v)) from (select e.*,p.username,p.first_name,p.last_name,g.name group_name,y.label year_label,t.name track_name,l.label level_label
 from public.enrollments e join public.profiles p on p.id=e.user_id join public.groups g on g.id=e.group_id join public.academic_years y on y.id=e.academic_year_id join public.tracks t on t.id=g.track_id left join public.academic_levels l on l.id=g.level_id
 where e.workspace_id=app_private.current_workspace() and (uid is null or e.user_id=uid) and (gid is null or e.group_id=gid) and (app_private.is_manager() or e.user_id=auth.uid() or app_private.teaches_group(e.group_id)) order by y.start_date desc,e.started_at desc,e.id limit 50 offset page_number*50) v),'[]');end $$;
create function public.enrollment_history(uid uuid default null,gid uuid default null,page_number int default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.enrollment_history(uid,gid,page_number) $$;

create function app_private.save_level(level_id uuid,code_value text,label_value text,order_value int) returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid;begin
 if not app_private.is_manager() then raise exception 'access_denied';end if;
 if level_id is null then insert into public.academic_levels(workspace_id,code,label,sort_order) values(app_private.current_workspace(),code_value,label_value,order_value) returning id into result;
 else update public.academic_levels set label=label_value,sort_order=order_value where id=level_id and workspace_id=app_private.current_workspace() and code=code_value returning id into result;end if;
 if result is null then raise exception 'level_code_immutable';end if;return result;end $$;
create function public.save_level(level_id uuid,code_value text,label_value text,order_value int) returns uuid language sql security invoker set search_path='' as $$ select app_private.save_level(level_id,code_value,label_value,order_value) $$;
create function app_private.set_track_levels(tid uuid,level_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$ begin
 if not app_private.is_manager() or not exists(select 1 from public.tracks where id=tid and workspace_id=app_private.current_workspace()) or exists(select 1 from unnest(level_ids) x where not exists(select 1 from public.academic_levels where id=x and workspace_id=app_private.current_workspace() and archived_at is null)) or cardinality(level_ids)<> (select count(distinct x) from unnest(level_ids) x) then raise exception 'invalid_track_level';end if;
 if exists(select 1 from public.groups where track_id=tid and level_id is not null and not(level_id=any(level_ids))) then raise exception 'historical_level_required';end if;
 delete from public.track_levels where track_id=tid;insert into public.track_levels select tid,x,n::int from unnest(level_ids) with ordinality v(x,n);
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'track_levels_changed',tid::text);end $$;
create function public.set_track_levels(tid uuid,level_ids uuid[]) returns void language sql security invoker set search_path='' as $$ select app_private.set_track_levels(tid,level_ids) $$;
create function app_private.activate_academic_year(yid uuid,archive_previous boolean default false) returns void language plpgsql security definer set search_path='' as $$ declare previous uuid;begin
 if not app_private.is_manager() then raise exception 'access_denied';end if;perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':years'));
 if not exists(select 1 from public.academic_years where id=yid and workspace_id=app_private.current_workspace() and status='upcoming') then raise exception 'invalid_academic_year';end if;
 select id into previous from public.academic_years where workspace_id=app_private.current_workspace() and status='active' for update;
 if previous is not null and not archive_previous then raise exception 'archive_previous_confirmation_required';end if;
 if previous is not null then update public.academic_years set status='archived' where id=previous;end if;
 update public.academic_years set status='active' where id=yid;insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'academic_year_activated',yid::text,jsonb_build_object('archived',previous));end $$;
create function public.activate_academic_year(yid uuid,archive_previous boolean default false) returns void language sql security invoker set search_path='' as $$ select app_private.activate_academic_year(yid,archive_previous) $$;
create or replace function app_private.save_academic_year(year_id uuid,year_label text,start_on date,end_on date,year_status text) returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid;begin
 if not app_private.is_manager() then raise exception 'access_denied';end if;
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':years'));
 if exists(select 1 from public.academic_years where id=year_id and workspace_id=app_private.current_workspace() and status='archived') then raise exception 'academic_year_archived';end if;
 if exists(select 1 from public.academic_years where workspace_id=app_private.current_workspace() and id is distinct from year_id and daterange(start_date,end_date,'[]') && daterange(start_on,end_on,'[]')) then raise exception 'academic_year_overlap';end if;
 if year_status='active' and exists(select 1 from public.academic_years where workspace_id=app_private.current_workspace() and status='active' and id is distinct from year_id) then raise exception 'archive_previous_confirmation_required';end if;
 if year_id is null then insert into public.academic_years(workspace_id,label,start_date,end_date,status) values(app_private.current_workspace(),year_label,start_on,end_on,year_status) returning id into result;
 else
 if exists(select 1 from public.enrollments where academic_year_id=year_id and (started_at<start_on or started_at>end_on or ended_at>end_on)) then raise exception 'enrollment_outside_year';end if;
 update public.academic_years set label=year_label,start_date=start_on,end_date=end_on,status=year_status where id=year_id and workspace_id=app_private.current_workspace() returning id into result;end if;
 if result is null then raise exception 'access_denied';end if;insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'academic_year_saved',result::text);return result;end $$;

create function app_private.prepare_rollover(source_year uuid,destination_year uuid) returns uuid language plpgsql security definer set search_path='' as $$ declare bid uuid;begin
 if not app_private.is_manager() or not exists(select 1 from public.academic_years s join public.academic_years d on d.workspace_id=s.workspace_id where s.id=source_year and d.id=destination_year and s.workspace_id=app_private.current_workspace() and s.status<>'archived' and d.status='upcoming' and d.start_date>s.end_date) then raise exception 'invalid_rollover_years';end if;
 insert into public.rollover_batches(workspace_id,source_year_id,destination_year_id,created_by) values(app_private.current_workspace(),source_year,destination_year,auth.uid()) returning id into bid;
 insert into public.rollover_entries(batch_id,enrollment_id,decision,destination_group_id,source_snapshot)
 select bid,e.id,case when next_level.id is null then 'complete' when (select count(*) from public.groups where academic_year_id=destination_year and track_id=g.track_id and level_id=next_level.id and archived_at is null)=1 then 'advance' else 'pending' end,
 case when (select count(*) from public.groups where academic_year_id=destination_year and track_id=g.track_id and level_id=next_level.id and archived_at is null)=1 then (select id from public.groups where academic_year_id=destination_year and track_id=g.track_id and level_id=next_level.id and archived_at is null limit 1) end,to_jsonb(e)
 from public.enrollments e join public.groups g on g.id=e.group_id join public.track_levels current_level on current_level.track_id=g.track_id and current_level.level_id=g.level_id
 left join lateral (select t.level_id id from public.track_levels t join public.academic_levels l on l.id=t.level_id where t.track_id=g.track_id and t.sort_order>current_level.sort_order and l.archived_at is null order by t.sort_order limit 1) next_level on true
 where e.workspace_id=app_private.current_workspace() and e.academic_year_id=source_year and e.status='active';
 -- Groups without a configured level remain pending, never silently dropped.
 insert into public.rollover_entries(batch_id,enrollment_id,source_snapshot) select bid,e.id,to_jsonb(e) from public.enrollments e where e.workspace_id=app_private.current_workspace() and e.academic_year_id=source_year and e.status='active' and not exists(select 1 from public.rollover_entries where batch_id=bid and enrollment_id=e.id);
 return bid;end $$;
create function public.prepare_rollover(source_year uuid,destination_year uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.prepare_rollover(source_year,destination_year) $$;
create function app_private.save_rollover_entry(bid uuid,eid uuid,decision_value text,destination_group uuid,expected_revision int) returns int language plpgsql security definer set search_path='' as $$ declare b public.rollover_batches%rowtype;begin
 select * into b from public.rollover_batches where id=bid and workspace_id=app_private.current_workspace() for update;
 if not found or not app_private.is_manager() or b.status not in ('draft','ready') then raise exception 'access_denied';end if;
 if b.revision<>expected_revision then raise exception 'rollover_revision_conflict';end if;
 update public.rollover_entries set decision=decision_value,destination_group_id=case when decision_value in ('complete','exit','pending') then null else destination_group end where batch_id=bid and enrollment_id=eid;
 if not found then raise exception 'invalid_rollover_entry';end if;
 update public.rollover_batches set revision=revision+1,status='draft' where id=bid;return b.revision+1;end $$;
create function public.save_rollover_entry(bid uuid,eid uuid,decision_value text,destination_group uuid,expected_revision int) returns int language sql security invoker set search_path='' as $$ select app_private.save_rollover_entry(bid,eid,decision_value,destination_group,expected_revision) $$;
create function app_private.rollover_preview(bid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare b public.rollover_batches%rowtype;errors jsonb:='[]';rows jsonb;begin
 select * into b from public.rollover_batches where id=bid and workspace_id=app_private.current_workspace();if not found or not app_private.is_manager() then raise exception 'access_denied';end if;
 if b.status in ('draft','ready') then
 if not exists(select 1 from public.academic_years where id=b.source_year_id and status<>'archived') or not exists(select 1 from public.academic_years where id=b.destination_year_id and status='upcoming') then errors:=errors||'"Anni non operativi o destinazione già attiva"'::jsonb;end if;
 if exists(select 1 from public.enrollments e where e.academic_year_id=b.source_year_id and e.status='active' and not exists(select 1 from public.rollover_entries r where r.batch_id=bid and r.enrollment_id=e.id)) then errors:=errors||'"Nuove iscrizioni nella sorgente: rigenerare la bozza"'::jsonb;end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('enrollmentId',e.id,'userId',e.user_id,'username',p.username,'name',p.first_name||' '||p.last_name,'sourceGroup',g.name,'sourceTrack',g.track_id,'sourceLevel',g.level_id,'decision',r.decision,'destinationGroupId',r.destination_group_id,'error',
 case when b.status='applied' then null when r.decision='pending' then 'Esito in sospeso'
 when e.status<>'active' or to_jsonb(e) is distinct from r.source_snapshot then 'Iscrizione sorgente modificata'
 when not exists(select 1 from public.workspace_memberships where workspace_id=b.workspace_id and user_id=e.user_id and role='member' and not disabled) then 'Membership non disponibile'
 when r.decision not in ('complete','exit') and (dg.id is null or dg.academic_year_id<>b.destination_year_id or dg.workspace_id<>b.workspace_id or dg.archived_at is not null) then 'Gruppo destinazione non valido'
 when r.decision='advance' and (dg.track_id<>g.track_id or dg.level_id is distinct from (select tl.level_id from public.track_levels tl where tl.track_id=g.track_id and tl.sort_order>(select sort_order from public.track_levels where track_id=g.track_id and level_id=g.level_id) order by tl.sort_order limit 1)) then 'Avanzamento non coerente con ordine livelli'
 when r.decision='repeat' and (dg.track_id<>g.track_id or dg.level_id is distinct from g.level_id) then 'Ripetizione non coerente con livello'
 when r.decision='change_track' and dg.track_id=g.track_id then 'Seleziona un indirizzo differente'
 when r.decision not in ('complete','exit') and exists(select 1 from public.enrollments where academic_year_id=b.destination_year_id and user_id=e.user_id and status='active') then 'Iscrizione futura già presente'
 else null end) order by p.username),'[]') into rows
 from public.rollover_entries r join public.enrollments e on e.id=r.enrollment_id join public.profiles p on p.id=e.user_id join public.groups g on g.id=e.group_id left join public.groups dg on dg.id=r.destination_group_id where r.batch_id=bid;
 return jsonb_build_object('id',bid,'status',b.status,'revision',b.revision,'rows',rows,'total',jsonb_array_length(rows),'counts',(select coalesce(jsonb_object_agg(decision,n),'{}') from (select decision,count(*) n from public.rollover_entries where batch_id=bid group by decision)v),'errors',errors||coalesce((select jsonb_agg(v->'error') from jsonb_array_elements(rows)v where v->>'error' is not null),'[]'),'report',b.report);end $$;
create function public.rollover_preview(bid uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.rollover_preview(bid) $$;
create function app_private.apply_rollover(bid uuid,expected_revision int) returns jsonb language plpgsql security definer set search_path='' as $$ declare b public.rollover_batches%rowtype;r record;preview jsonb;dest_start date;source_end date;result jsonb;begin
 if not app_private.is_manager() then raise exception 'access_denied';end if;
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));
 select * into b from public.rollover_batches where id=bid and workspace_id=app_private.current_workspace() for update;if not found then raise exception 'access_denied';end if;
 if b.status='applied' then return b.report;end if;
 if b.status not in ('draft','ready') or b.revision<>expected_revision then raise exception 'rollover_revision_conflict';end if;
 perform 1 from public.academic_years where id in (b.source_year_id,b.destination_year_id) order by id for update;
 perform 1 from public.enrollments where academic_year_id in (b.source_year_id,b.destination_year_id) order by user_id,id for update;
 perform 1 from public.groups where academic_year_id=b.destination_year_id order by id for update;
 preview:=app_private.rollover_preview(bid);if jsonb_array_length(preview->'errors')>0 then raise exception 'rollover_preview_has_errors';end if;
 select start_date into dest_start from public.academic_years where id=b.destination_year_id;select end_date into source_end from public.academic_years where id=b.source_year_id;
 for r in select re.*,e.user_id from public.rollover_entries re join public.enrollments e on e.id=re.enrollment_id where re.batch_id=bid order by e.user_id loop
 perform pg_advisory_xact_lock(hashtext(b.workspace_id::text||':'||r.user_id::text));
 update public.enrollments set status=case when r.decision='exit' then 'withdrawn' else 'completed' end,ended_at=source_end,outcome=case r.decision when 'advance' then 'promoted' when 'repeat' then 'repeat' when 'complete' then 'completed_path' when 'exit' then 'transferred_out' else 'other' end where id=r.enrollment_id;
 if r.decision not in ('complete','exit') then insert into public.enrollments(workspace_id,academic_year_id,user_id,group_id,started_at,provenance) values(b.workspace_id,b.destination_year_id,r.user_id,r.destination_group_id,dest_start,'rollover:'||bid::text);end if;
 end loop;
 result:=jsonb_build_object('batchId',bid,'sourceYear',b.source_year_id,'destinationYear',b.destination_year_id,'total',preview->'total','counts',preview->'counts','actor',auth.uid(),'appliedAt',clock_timestamp());
 update public.rollover_batches set status='applied',applied_at=clock_timestamp(),report=result where id=bid;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'rollover_applied',bid::text,result);return result;end $$;
create function public.apply_rollover(bid uuid,expected_revision int) returns jsonb language sql security invoker set search_path='' as $$ select app_private.apply_rollover(bid,expected_revision) $$;
create function app_private.cancel_rollover(bid uuid) returns void language plpgsql security definer set search_path='' as $$ declare b public.rollover_batches%rowtype;begin
 if not app_private.is_manager() then raise exception 'access_denied';end if;perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));
 select * into b from public.rollover_batches where id=bid and workspace_id=app_private.current_workspace() for update;if not found or b.status='cancelled' then raise exception 'access_denied';end if;
 perform 1 from public.academic_years where id in (b.source_year_id,b.destination_year_id) for update;
 if b.status='applied' then
 if exists(select 1 from public.rollover_entries re join public.enrollments source on source.id=re.enrollment_id
 where re.batch_id=bid and re.decision not in ('complete','exit') and not exists(select 1 from public.enrollments destination where destination.user_id=source.user_id and destination.academic_year_id=b.destination_year_id and destination.group_id=re.destination_group_id and destination.status='active' and destination.provenance='rollover:'||bid::text)) then raise exception 'rollover_requires_manual_correction';end if;
 if exists(select 1 from public.academic_years where id in(b.source_year_id,b.destination_year_id) and status='archived')
 or exists(select 1 from public.attempts a join public.questions q on q.id=a.question_id join public.assignments ass on ass.id=q.assignment_id where ass.academic_year_id=b.destination_year_id)
 or exists(select 1 from public.lesson_release_activity a join public.content_releases r on r.id=a.release_id where r.academic_year_id=b.destination_year_id)
 or exists(select 1 from public.practice_release_progress p join public.content_releases r on r.id=p.release_id where r.academic_year_id=b.destination_year_id)
 or exists(select 1 from public.assignments where academic_year_id=b.destination_year_id and status in ('published','archived'))
 or exists(select 1 from public.content_releases where academic_year_id=b.destination_year_id) then raise exception 'rollover_requires_manual_correction';end if;
 perform set_config('app.rollover_rollback','on',true);
 update public.enrollments set status='withdrawn',ended_at=started_at,outcome='other',provenance=provenance||':cancelled' where provenance='rollover:'||bid::text and status='active';
 update public.enrollments e set status='active',ended_at=null,outcome=null from public.rollover_entries r where r.batch_id=bid and e.id=r.enrollment_id;
 end if;
 update public.rollover_batches set status='cancelled',revision=revision+1 where id=bid;insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'rollover_cancelled',bid::text);end $$;
create function public.cancel_rollover(bid uuid) returns void language sql security invoker set search_path='' as $$ select app_private.cancel_rollover(bid) $$;

create function app_private.save_subject_offering(yid uuid,tid uuid,sid uuid,lid uuid,offering_status text default 'active') returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid;begin
 if not app_private.is_manager() then raise exception 'access_denied';end if;perform pg_advisory_xact_lock(hashtext(yid::text||tid::text||sid::text||coalesce(lid::text,'')));
 select id into result from public.subject_offerings where workspace_id=app_private.current_workspace() and academic_year_id=yid and track_id=tid and subject_id=sid and level_id is not distinct from lid;
 if result is null then insert into public.subject_offerings(workspace_id,academic_year_id,track_id,subject_id,level_id,status) values(app_private.current_workspace(),yid,tid,sid,lid,offering_status) returning id into result;
 else update public.subject_offerings set status=offering_status where id=result;end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'subject_offering_saved',result::text);return result;end $$;
create function public.save_subject_offering(yid uuid,tid uuid,sid uuid,lid uuid,offering_status text default 'active') returns uuid language sql security invoker set search_path='' as $$ select app_private.save_subject_offering(yid,tid,sid,lid,offering_status) $$;
create function app_private.set_teaching_assignment(uid uuid,sid uuid,gid uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$ declare g public.groups%rowtype;begin
 if not app_private.is_owner() then raise exception 'access_denied';end if;select * into g from public.groups where id=gid and workspace_id=app_private.current_workspace();if not found then raise exception 'access_denied';end if;
 if exists(select 1 from public.academic_years where id=g.academic_year_id and status='archived') then raise exception 'academic_year_archived';end if;
 if enabled then insert into public.teaching_assignments(workspace_id,staff_user_id,academic_year_id,subject_id,group_id,track_id) values(g.workspace_id,uid,g.academic_year_id,sid,gid,g.track_id) on conflict(staff_user_id,subject_id,group_id) do nothing;
 else delete from public.teaching_assignments where workspace_id=g.workspace_id and staff_user_id=uid and subject_id=sid and group_id=gid;end if;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'teaching_scope_changed',uid::text,jsonb_build_object('group',gid,'subject',sid,'enabled',enabled));end $$;
create function public.set_teaching_assignment(uid uuid,sid uuid,gid uuid,enabled boolean) returns void language sql security invoker set search_path='' as $$ select app_private.set_teaching_assignment(uid,sid,gid,enabled) $$;

create function app_private.release_eligible(uid uuid,rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.content_releases r join public.content_items c on c.id=r.content_id join public.content_versions v on v.content_id=c.id and v.version=r.content_version join public.subjects s on s.id=c.subject_id join public.groups g on g.id=r.group_id
 where r.id=rid and r.workspace_id=app_private.current_workspace() and r.status='published' and s.archived_at is null and c.status<>'archived'
 and (r.available_from is null or r.available_from<=now()) and (r.available_until is null or r.available_until>now()) and app_private.active_enrollment(uid,g.id)
 and exists(select 1 from public.subject_offerings o where o.academic_year_id=r.academic_year_id and o.track_id=g.track_id and o.subject_id=c.subject_id and (o.level_id is null or o.level_id=g.level_id) and o.status='active')
 and coalesce((select allowed from public.content_access where user_id=uid and content_id=c.id),(select allowed from public.content_access where group_id=g.id and content_id=c.id),false)
 and coalesce((select allowed from public.module_access where user_id=uid and subject_id=c.subject_id and level_code=coalesce(v.document->>'levelCode',v.document->>'year','') and module=v.document->>'module'),(select allowed from public.module_access where group_id=g.id and subject_id=c.subject_id and level_code=coalesce(v.document->>'levelCode',v.document->>'year','') and module=v.document->>'module'),false)) $$;
create function app_private.release_resource_allowed(uid uuid,rid uuid,kind_name text) returns boolean language sql stable security definer set search_path='' as $$
 select app_private.release_eligible(uid,rid) and exists(select 1 from public.content_releases r where r.id=rid and coalesce((select allowed from public.resource_access where content_id=r.content_id and user_id=uid and kind=kind_name),(select allowed from public.resource_access where content_id=r.content_id and group_id=r.group_id and kind=kind_name),false)) $$;
create or replace function app_private.user_can_read_content(uid uuid,cid uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.content_releases where content_id=cid and app_private.release_eligible(uid,id)) $$;
create or replace function app_private.can_read_content(cid uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.content_items c where c.id=cid and app_private.same_workspace_subject(c.subject_id) and (app_private.can_edit_subject(c.subject_id) or app_private.user_can_read_content(auth.uid(),cid))) $$;
create or replace function app_private.can_read_resource(cid uuid,rkind text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.content_items c where c.id=cid and app_private.can_edit_subject(c.subject_id)) or exists(select 1 from public.content_releases r where r.content_id=cid and app_private.release_resource_allowed(auth.uid(),r.id,rkind)) $$;
-- Members never receive current draft metadata/resources through a direct table query.
drop policy items_read on public.content_items;
drop policy resources_read on public.content_resources;
create policy draft_items_author on public.content_items for select to authenticated using(app_private.can_edit_subject(subject_id));
create policy draft_resources_author on public.content_resources for select to authenticated using(exists(select 1 from public.content_items c where c.id=content_id and app_private.can_edit_subject(c.subject_id)));

create function app_private.publish_content_release(cid uuid,gid uuid,version_number int,from_at timestamptz default null,until_at timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$ declare c public.content_items%rowtype;g public.groups%rowtype;result uuid;begin
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));
 select * into c from public.content_items where id=cid;select * into g from public.groups where id=gid;
 if not app_private.can_edit_subject(c.subject_id) or (not app_private.is_manager() and not app_private.teaches_group(gid,c.subject_id)) or c.workspace_id is distinct from g.workspace_id or g.workspace_id is distinct from app_private.current_workspace() or g.archived_at is not null or c.status='archived' then raise exception 'access_denied';end if;
 perform pg_advisory_xact_lock(hashtext(cid::text||':'||gid::text));
 if not exists(select 1 from public.content_versions where content_id=cid and version=version_number) then raise exception 'invalid_content_version';end if;
 if not exists(select 1 from public.subject_offerings where academic_year_id=g.academic_year_id and track_id=g.track_id and subject_id=c.subject_id and status='active' and (level_id is null or level_id=g.level_id)) then raise exception 'subject_offering_required';end if;
 select id into result from public.content_releases where content_id=cid and group_id=gid and status='published' and content_version=version_number and available_from is not distinct from from_at and available_until is not distinct from until_at;
 if result is not null then return result;end if;
 update public.content_releases set status='superseded' where content_id=cid and group_id=gid and status='published';
 insert into public.content_releases(content_id,content_version,workspace_id,academic_year_id,group_id,available_from,available_until,created_by) values(cid,version_number,c.workspace_id,g.academic_year_id,gid,from_at,until_at,auth.uid()) returning id into result;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'content_release_published',result::text,jsonb_build_object('content',cid,'version',version_number,'group',gid));return result;end $$;
create function public.publish_content_release(cid uuid,gid uuid,version_number int,from_at timestamptz default null,until_at timestamptz default null) returns uuid language sql security invoker set search_path='' as $$ select app_private.publish_content_release(cid,gid,version_number,from_at,until_at) $$;
create function app_private.archive_content_release(rid uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.content_releases r join public.content_items c on c.id=r.content_id where r.id=rid and app_private.can_edit_subject(c.subject_id) and (app_private.is_manager() or app_private.teaches_group(r.group_id,c.subject_id))) then raise exception 'access_denied';end if;
 update public.content_releases set status='archived' where id=rid;insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'content_release_archived',rid::text);end $$;
create function public.archive_content_release(rid uuid) returns void language sql security invoker set search_path='' as $$ select app_private.archive_content_release(rid) $$;
create function app_private.catalog_page(page_number int default 0,subject_id_filter uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if page_number<0 or page_number>1000 then raise exception 'invalid_page';end if;
 return coalesce((select jsonb_agg(to_jsonb(result)) from (
 select c.id,c.subject_id,c.slug,c.title,c.summary,c.level_code,c.module,c.topic,c.tags,c.status,c.sort_order,c.available_from,c.available_until,null::uuid release_id,null::int content_version from public.content_items c where c.workspace_id=app_private.current_workspace() and app_private.can_edit_subject(c.subject_id) and (subject_id_filter is null or c.subject_id=subject_id_filter)
 union all
 select c.id,c.subject_id,v.document->>'slug',v.document->>'title',v.document->>'summary',coalesce(v.document->>'levelCode',v.document->>'year'),v.document->>'module',v.document->>'topic',array(select jsonb_array_elements_text(coalesce(v.document->'tags','[]'))),'published',(v.document->>'order')::int,r.available_from,r.available_until,r.id,r.content_version
 from public.content_releases r join public.content_items c on c.id=r.content_id join public.content_versions v on v.content_id=c.id and v.version=r.content_version where app_private.release_eligible(auth.uid(),r.id) and not app_private.can_edit_subject(c.subject_id) and (subject_id_filter is null or c.subject_id=subject_id_filter)
 order by level_code,sort_order,id limit 100 offset page_number*100) result),'[]');end $$;
create function public.catalog_page(page_number int default 0,subject_id_filter uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.catalog_page(page_number,subject_id_filter) $$;
create function app_private.lesson_resources(cid uuid,rid uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare doc jsonb;kind_name text;result jsonb:='[]';entries jsonb;begin
 if rid is null then
 if not exists(select 1 from public.content_items where id=cid and app_private.can_edit_subject(subject_id)) then raise exception 'access_denied';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from public.content_resources r where content_id=cid),'[]');end if;
 if not exists(select 1 from public.content_releases where id=rid and content_id=cid and app_private.release_eligible(auth.uid(),rid)) then raise exception 'access_denied';end if;
 select document into doc from public.content_versions v join public.content_releases r on r.content_id=v.content_id and r.content_version=v.version where r.id=rid;
 foreach kind_name in array array['theory','simulation','exercise'] loop
 if app_private.release_resource_allowed(auth.uid(),rid,kind_name) then
 select coalesce(jsonb_agg(jsonb_build_object('block',b,'position',n-1) order by n),'[]') into entries from jsonb_array_elements(doc->'blocks') with ordinality a(b,n) where case when b->>'type'='simulation' or right(b->>'type',4)='Plot' then 'simulation' when b->>'type' in ('exercise','guidedExercise','parametricExercise','practiceQuestion','exerciseGroup','exerciseStep','hint','solution') then 'exercise' else 'theory' end=kind_name;
 result:=result||jsonb_build_array(jsonb_build_object('kind',kind_name,'blocks',entries));end if;end loop;return result;end $$;
create function public.lesson_resources(cid uuid,rid uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.lesson_resources(cid,rid) $$;
create function app_private.search_releases(query_text text) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if length(query_text)<2 or length(query_text)>200 then return '[]';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('content_id',id)) from (select distinct c.id from public.content_releases r join public.content_items c on c.id=r.content_id join public.content_versions v on v.content_id=c.id and v.version=r.content_version where app_private.release_eligible(auth.uid(),r.id) and exists(select 1 from jsonb_array_elements(v.document->'blocks') b where app_private.release_resource_allowed(auth.uid(),r.id,case when b->>'type'='simulation' or right(b->>'type',4)='Plot' then 'simulation' when b->>'type' in ('exercise','guidedExercise','parametricExercise','practiceQuestion','exerciseGroup','exerciseStep','hint','solution') then 'exercise' else 'theory' end) and strpos(lower(b::text),lower(query_text))>0)
 union select c.id from public.content_items c join public.content_resources cr on cr.content_id=c.id where app_private.can_edit_subject(c.subject_id) and strpos(lower(cr.search_text),lower(query_text))>0 limit 100) v),'[]');end $$;
create function public.search_releases(query_text text) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.search_releases(query_text) $$;

create function app_private.record_release_open(rid uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));
 if not app_private.release_eligible(auth.uid(),rid) then raise exception 'access_denied';end if;
 insert into public.lesson_release_activity(user_id,release_id) values(auth.uid(),rid) on conflict(user_id,release_id) do update set open_count=public.lesson_release_activity.open_count+case when clock_timestamp()-public.lesson_release_activity.last_opened_at>=interval '5 minutes' then 1 else 0 end,last_opened_at=case when clock_timestamp()-public.lesson_release_activity.last_opened_at>=interval '5 minutes' then clock_timestamp() else public.lesson_release_activity.last_opened_at end;end $$;
create function public.record_release_open(rid uuid) returns void language sql security invoker set search_path='' as $$ select app_private.record_release_open(rid) $$;
create function app_private.record_release_activity(rid uuid,seconds_delta int) returns void language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));
 if not app_private.release_eligible(auth.uid(),rid) then raise exception 'access_denied';end if;
 if seconds_delta is null or seconds_delta<1 or seconds_delta>120 then raise exception 'invalid_activity';end if;
 update public.lesson_release_activity set active_seconds=active_seconds+seconds_delta,last_active_at=clock_timestamp() where user_id=auth.uid() and release_id=rid and seconds_delta<=floor(extract(epoch from clock_timestamp()-last_active_at));if not found then raise exception 'invalid_activity_or_open_required';end if;end $$;
create function public.record_release_activity(rid uuid,seconds_delta int) returns void language sql security invoker set search_path='' as $$ select app_private.record_release_activity(rid,seconds_delta) $$;
create function app_private.record_release_practice(rid uuid,eid text,was_correct boolean,is_completed boolean) returns void language plpgsql security definer set search_path='' as $$ declare resources jsonb;begin
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));
 if not app_private.release_resource_allowed(auth.uid(),rid,'exercise') then raise exception 'access_denied';end if;
 resources:=app_private.lesson_resources((select content_id from public.content_releases where id=rid),rid);
 if eid is null or length(eid)>100 or not exists(select 1 from jsonb_array_elements(resources) r cross join lateral jsonb_array_elements(r->'blocks') b where r->>'kind'='exercise' and (b->'block'->>'id'=eid or 'legacy-'||(b->>'position')=eid or exists(select 1 from jsonb_array_elements(coalesce(b->'block'->'questions','[]')) q where q->>'id'=eid))) then raise exception 'invalid_exercise';end if;
 insert into public.practice_release_progress(user_id,release_id,exercise_id,completed,last_correct) values(auth.uid(),rid,eid,coalesce(is_completed,false),was_correct)
 on conflict(user_id,release_id,exercise_id) do update set attempts=public.practice_release_progress.attempts+1,completed=public.practice_release_progress.completed or excluded.completed,last_correct=excluded.last_correct,last_attempt_at=clock_timestamp();end $$;
create function public.record_release_practice(rid uuid,eid text,was_correct boolean,is_completed boolean) returns void language sql security invoker set search_path='' as $$ select app_private.record_release_practice(rid,eid,was_correct,is_completed) $$;
-- Old tracking endpoints are retained as compatibility entry points, always resolve a release.
create or replace function app_private.record_lesson_open(cid uuid) returns void language plpgsql security definer set search_path='' as $$ declare rid uuid;begin select id into rid from public.content_releases where content_id=cid and app_private.release_eligible(auth.uid(),id);perform app_private.record_release_open(rid);end $$;
create or replace function app_private.record_lesson_activity(cid uuid,seconds_delta int) returns void language plpgsql security definer set search_path='' as $$ declare rid uuid;begin select id into rid from public.content_releases where content_id=cid and app_private.release_eligible(auth.uid(),id);perform app_private.record_release_activity(rid,seconds_delta);end $$;
create or replace function app_private.record_practice_progress(cid uuid,eid text,was_correct boolean,is_completed boolean) returns void language plpgsql security definer set search_path='' as $$ declare rid uuid;begin select id into rid from public.content_releases where content_id=cid and app_private.release_eligible(auth.uid(),id);perform app_private.record_release_practice(rid,eid,was_correct,is_completed);end $$;

create function app_private.freeze_assignment_snapshot() returns trigger language plpgsql security definer set search_path='' as $$ declare aid uuid;yid uuid;st text;row_data jsonb;begin
 if tg_op='DELETE' and current_setting('app.privacy_delete',true)='on' then return old;end if;
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='private_answer_keys' then select assignment_id into aid from public.questions where id=(row_data->>'question_id')::uuid;
 elsif tg_table_name='attempts' then select assignment_id into aid from public.questions where id=(row_data->>'question_id')::uuid;
 elsif tg_table_name='reviews' then select q.assignment_id into aid from public.attempts a join public.questions q on q.id=a.question_id where a.id=(row_data->>'attempt_id')::uuid;
 elsif tg_table_name='assignments' then aid:=(row_data->>'id')::uuid;
 else aid:=(row_data->>'assignment_id')::uuid;end if;
 select academic_year_id,status into yid,st from public.assignments where id=aid;
 if tg_table_name='assignments' and tg_op='INSERT' then yid:=new.academic_year_id;end if;
 perform 1 from public.academic_years where id=yid for share;
 if exists(select 1 from public.academic_years where id=yid and status='archived') then raise exception 'academic_year_archived';end if;
 if tg_op='DELETE' and tg_table_name='assignments' and (st in ('published','archived') or exists(select 1 from public.attempts a join public.questions q on q.id=a.question_id where q.assignment_id=aid)) then raise exception 'published_assignment_snapshot_immutable';end if;
 if tg_table_name in ('questions','private_answer_keys') and (st in ('published','archived') or exists(select 1 from public.attempts a join public.questions q on q.id=a.question_id where q.assignment_id=aid)) then raise exception 'published_assignment_snapshot_immutable';end if;
 if tg_table_name='assignments' and tg_op='UPDATE' and ((to_jsonb(old)->>'status') in ('published','archived') or exists(select 1 from public.attempts a join public.questions q on q.id=a.question_id where q.assignment_id=(to_jsonb(old)->>'id')::uuid)) and (to_jsonb(new)-array['status','solutions_released']) is distinct from (to_jsonb(old)-array['status','solutions_released']) then raise exception 'published_assignment_snapshot_immutable';end if;
 if tg_table_name='assignments' and tg_op='UPDATE' and (to_jsonb(old)->>'status')='published' and (to_jsonb(new)->>'status') not in ('published','archived') then raise exception 'published_assignment_snapshot_immutable';end if;
 if tg_table_name='attempts' and tg_op='INSERT' then
 if new.enrollment_id is null then select e.id into new.enrollment_id from public.enrollments e where e.academic_year_id=yid and e.user_id=new.user_id and app_private.active_enrollment(e.user_id,e.group_id);end if;end if;
 if tg_op='DELETE' then return old;end if;return new;end $$;
do $$ declare t text;begin foreach t in array array['questions','private_answer_keys','assignments','attempts','reviews'] loop execute format('create trigger zz_assignment_snapshot before insert or update or delete on public.%I for each row execute function app_private.freeze_assignment_snapshot()',t);end loop;end $$;

-- Adapted P3.1 RPCs (full definitions, no runtime mutation).
-- Authorization is derived from the stored scopes, never the supplied recent labels.
create function app_private.resolve_recent_contexts(contexts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;wid uuid;yid uuid;tid uuid;sid uuid;gid uuid;previous text;result jsonb:='[]';wname text;yname text;tname text;sname text;gname text;begin
 if not app_private.account_ready() or jsonb_typeof(contexts) is distinct from 'array' or jsonb_array_length(contexts)>8 then raise exception 'invalid_contexts';end if;
 previous:=current_setting('request.headers',true);
 for item in select * from jsonb_array_elements(contexts) loop
 begin
 wid:=(item->>'workspaceId')::uuid;yid:=nullif(item->>'yearId','')::uuid;tid:=nullif(item->>'trackId','')::uuid;sid:=nullif(item->>'subjectId','')::uuid;gid:=nullif(item->>'groupId','')::uuid;
 perform set_config('request.headers',jsonb_build_object('x-workspace-id',wid)::text,true);
 if app_private.current_workspace() is distinct from wid then continue;end if;
 if gid is not null and not app_private.can_read_group(gid) then continue;end if;
 if gid is not null and not exists(select 1 from public.groups where id=gid and workspace_id=wid and (yid is null or academic_year_id=yid) and (tid is null or track_id=tid)) then continue;end if;
 if sid is not null and not app_private.can_read_subject(sid) then continue;end if;
 if yid is not null and not exists(select 1 from public.academic_years where id=yid and workspace_id=wid and (app_private.current_role()<>'member' or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.academic_year_id=yid))) then continue;end if;
 if tid is not null and not exists(select 1 from public.tracks where id=tid and workspace_id=wid and (app_private.is_manager() or exists(select 1 from public.groups where track_id=tid and app_private.can_read_group(id)))) then continue;end if;
 select name into wname from public.workspaces where id=wid;select label into yname from public.academic_years where id=yid;select name into tname from public.tracks where id=tid;select name into sname from public.subjects where id=sid;select name into gname from public.groups where id=gid;
 result:=result||jsonb_build_array(item||jsonb_build_object('label',concat_ws(' · ',wname,yname,tname,sname,gname)));
 exception when invalid_text_representation then continue;end;
 end loop;
 perform set_config('request.headers',coalesce(previous,''),true);return result;end $$;
create function public.resolve_recent_contexts(contexts jsonb) returns jsonb language sql security invoker set search_path='' as $$ select app_private.resolve_recent_contexts(contexts) $$;

create function app_private.leave_workspace_account(uid uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not app_private.is_manager() or not exists(select 1 from public.workspace_memberships where workspace_id=app_private.current_workspace() and user_id=uid and role='member') then raise exception 'access_denied';end if;
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':rollover'));
 perform pg_advisory_xact_lock(hashtext(app_private.current_workspace()::text||':'||uid::text));
 update public.enrollments e set status='withdrawn',outcome='left',ended_at=greatest(e.started_at,least(current_date,y.end_date)) from public.academic_years y where e.academic_year_id=y.id and e.user_id=uid and e.workspace_id=app_private.current_workspace() and e.status='active' and y.status<>'archived';
 update public.workspace_memberships set disabled=true where workspace_id=app_private.current_workspace() and user_id=uid;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'workspace_member_departed',uid::text);end $$;
create function public.leave_workspace_account(uid uuid) returns void language sql security invoker set search_path='' as $$ select app_private.leave_workspace_account(uid) $$;

-- Full v6 backups never create/update auth.users, profiles or membership roles.
-- Restore requires known identities already linked locally; dry run reports prerequisites.
create function app_private.restore_lifecycle_backup(payload jsonb,dry_run boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare section text;row_data jsonb;restore_table text;cols text;select_cols text;existing jsonb;wid uuid;source_wid uuid;counts jsonb:='{}';st text;
begin
 if not app_private.is_owner() then raise exception 'access_denied';end if;wid:=app_private.current_workspace();
 if payload->>'format' is distinct from 'telecomlab-backup-v6' or payload->>'schemaVersion' is distinct from '6' then raise exception 'incompatible_backup';end if;
 source_wid:=(payload->>'workspaceId')::uuid;
 if source_wid is distinct from wid then raise exception 'backup_requires_original_workspace_identity';end if;
 if exists(select 1 from jsonb_object_keys(payload) key where not (key=any(array['format','schemaVersion','workspaceId','exportedAt','workspaces','workspace_memberships','academic_levels','track_levels','academic_years','tracks','track_subjects','staff_subjects','subjects','subject_offerings','groups','group_memberships','enrollments','rollover_batches','rollover_entries','teaching_assignments','content_items','content_versions','content_resources','content_releases','module_access','content_access','resource_access','assignments','assignment_targets','questions','private_answer_keys','attempts','reviews','lesson_activity','practice_progress','lesson_release_activity','practice_release_progress','curriculum_sources','curriculum_plans','curriculum_plan_versions','personal_library_items','audit_log']))) then raise exception 'backup_unknown_section';end if;
 if octet_length(payload::text)>50000000 then raise exception 'backup_size_limit';end if;
 foreach section in array array['academic_levels','track_levels','academic_years','tracks','track_subjects','staff_subjects','subjects','subject_offerings','groups','group_memberships','enrollments','rollover_batches','rollover_entries','teaching_assignments','content_items','content_versions','content_resources','content_releases','module_access','content_access','resource_access','assignments','assignment_targets','questions','private_answer_keys','attempts','reviews','lesson_activity','practice_progress','lesson_release_activity','practice_release_progress','curriculum_sources','curriculum_plans','curriculum_plan_versions','personal_library_items','audit_log'] loop
 if jsonb_typeof(payload->section) is distinct from 'array' or jsonb_array_length(payload->section)>5500 then raise exception 'invalid_backup_section: %',section;end if;counts:=counts||jsonb_build_object(section,jsonb_array_length(payload->section));end loop;
 if exists(select 1 from jsonb_array_elements(payload->'enrollments') e where not exists(select 1 from public.workspace_memberships where workspace_id=wid and user_id=(e->>'user_id')::uuid and role='member'))
 or exists(select 1 from jsonb_array_elements(payload->'teaching_assignments') t where not exists(select 1 from public.workspace_memberships where workspace_id=wid and user_id=(t->>'staff_user_id')::uuid and role in('editor','reviewer')))
 or exists(select 1 from jsonb_array_elements(payload->'personal_library_items') l where (l->>'owner_id')::uuid<>auth.uid()) then raise exception 'backup_identity_prerequisites';end if;
 -- Validate every source tenant discriminator before interpreting records.
 foreach section in array array['academic_levels','academic_years','tracks','subjects','subject_offerings','groups','enrollments','rollover_batches','teaching_assignments','content_items','content_releases','audit_log'] loop
 if exists(select 1 from jsonb_array_elements(payload->section) r where (r->>'workspace_id')::uuid is distinct from source_wid) then raise exception 'backup_workspace_mismatch: %',section;end if;end loop;
 foreach section in array array['curriculum_sources','curriculum_plans'] loop
 if exists(select 1 from jsonb_array_elements(payload->section) r where (r->>'workspace_id')::uuid is not null and (r->>'workspace_id')::uuid<>wid or (r->>'workspace_id') is null and (r->>'owner_id')::uuid<>auth.uid()) then raise exception 'backup_curriculum_scope';end if;end loop;
 -- The subtransaction below runs the real import even for a dry run, then rolls it back.
 begin
 perform pg_advisory_xact_lock(hashtext(wid::text||':restore'));
 perform pg_advisory_xact_lock(hashtext(wid::text||':rollover'));
 perform pg_advisory_xact_lock(hashtext(wid::text||':years'));
 -- Recovery into the same institution identity only. Bootstrap configuration is
 -- removed inside this subtransaction; configured/operational destinations fail.
 if exists(select 1 from public.groups where workspace_id=wid)
 or exists(select 1 from public.content_items where workspace_id=wid)
 or exists(select 1 from public.curriculum_plans where workspace_id=wid)
 or exists(select 1 from public.curriculum_sources where workspace_id=wid)
 or exists(select 1 from public.academic_levels where workspace_id=wid)
 or exists(select 1 from public.rollover_batches where workspace_id=wid)
 or exists(select 1 from public.subject_offerings where workspace_id=wid)
 or exists(select 1 from public.subjects where workspace_id=wid and (slug<>'telecomunicazioni' or name<>'Telecomunicazioni'))
 or exists(select 1 from public.tracks where workspace_id=wid and name<>'Da configurare')
 or exists(select 1 from public.academic_years where workspace_id=wid and (label<>'2026/2027' or start_date<>'2026-09-01'::date or end_date<>'2027-08-31'::date))
 then raise exception 'backup_destination_not_empty';end if;
 delete from public.staff_subjects where subject_id in(select id from public.subjects where workspace_id=wid);
 delete from public.track_subjects where track_id in(select id from public.tracks where workspace_id=wid);
 delete from public.tracks where workspace_id=wid;
 delete from public.academic_years where workspace_id=wid;
 delete from public.subjects where workspace_id=wid;
 foreach restore_table in array array['subjects','academic_levels','academic_years','tracks','track_levels','track_subjects','staff_subjects','groups','subject_offerings','personal_library_items','content_items','content_versions','content_resources','module_access','content_access','resource_access','enrollments','group_memberships','teaching_assignments','rollover_batches','rollover_entries','content_releases','assignments','assignment_targets','questions','private_answer_keys','attempts','reviews','lesson_activity','practice_progress','lesson_release_activity','practice_release_progress','curriculum_sources','curriculum_plans','curriculum_plan_versions','audit_log'] loop
 select string_agg(quote_ident(column_name),',' order by ordinal_position),string_agg(case when data_type='jsonb' and is_nullable='NO' then 'coalesce(r.'||quote_ident(column_name)||',''null''::jsonb)' else 'r.'||quote_ident(column_name) end,',' order by ordinal_position) into cols,select_cols from information_schema.columns where table_schema='public' and information_schema.columns.table_name=restore_table and is_generated='NEVER' and (restore_table<>'audit_log' or column_name<>'id');
 for row_data in select * from jsonb_array_elements(payload->restore_table) loop
 if exists(select 1 from jsonb_object_keys(row_data) key where not exists(select 1 from information_schema.columns col where col.table_schema='public' and col.table_name=restore_table and col.column_name=key)) then raise exception 'backup_unknown_column: %',restore_table;end if;
 if row_data ? 'workspace_id' and row_data->>'workspace_id' is not null then row_data:=row_data||jsonb_build_object('workspace_id',wid);end if;
 if restore_table='audit_log' then row_data:=row_data||jsonb_build_object('details',coalesce(row_data->'details','{}')||jsonb_build_object('restoredSourceAuditId',row_data->'id'));end if;
 if restore_table='academic_years' then row_data:=row_data||jsonb_build_object('status','upcoming');end if;
 if restore_table='assignments' then row_data:=row_data||jsonb_build_object('status','draft');end if;
 -- Duplicate immutable IDs fail, rather than overwriting histories. No ON CONFLICT UPDATE.
 execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',restore_table,cols,select_cols,restore_table) using row_data;
 end loop;end loop;
 for row_data in select * from jsonb_array_elements(payload->'assignments') loop update public.assignments set status=row_data->>'status' where id=(row_data->>'id')::uuid;end loop;
 for row_data in select * from jsonb_array_elements(payload->'academic_years') loop update public.academic_years set status=row_data->>'status' where id=(row_data->>'id')::uuid;end loop;
 if dry_run then raise sqlstate 'P0032';end if;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'lifecycle_backup_restored',wid::text,counts);return jsonb_build_object('dryRun',false,'counts',counts);
 exception when sqlstate 'P0032' then return jsonb_build_object('dryRun',true,'counts',counts,'message','Ripristino completo convalidato e annullato: nessuna modifica persistente.');end;end $$;
create function public.restore_lifecycle_backup(payload jsonb,dry_run boolean default true) returns jsonb language sql security invoker set search_path='' as $$ select app_private.restore_lifecycle_backup(payload,dry_run) $$;
create or replace function app_private.save_content_document(doc jsonb, expected_content_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare legacy_year int; sid uuid; cid uuid; next_version int; old_slug text; kind_name text; resource_blocks jsonb; searchable text;
begin
  select id into sid from public.subjects where workspace_id=app_private.current_workspace() and slug=coalesce(doc->>'subject','telecomunicazioni') and archived_at is null;
  if sid is null or not app_private.can_edit_subject(sid) then raise exception 'subject_access_denied'; end if;
  if doc->>'schemaVersion' in ('1','2') then legacy_year:=(doc->>'year')::int;doc:=(doc-'year')||jsonb_build_object('schemaVersion',3,'levelCode',legacy_year::text);end if;
  if doc->>'levelCode' is not null and not exists(select 1 from public.academic_levels where workspace_id=app_private.current_workspace() and code=doc->>'levelCode' and archived_at is null) then raise exception 'unknown_level_code';end if;
  doc:=doc||pg_catalog.jsonb_build_object('subject',(select slug from public.subjects where id=sid));
  if doc->>'schemaVersion' is distinct from '3' or pg_catalog.jsonb_typeof(doc->'blocks') is distinct from 'array'
    or pg_catalog.jsonb_array_length(doc->'blocks')<1 or doc->>'slug' is null
    or doc->>'title' is null or doc->>'module' is null then raise exception 'invalid_content_document'; end if;
  if octet_length(doc::text)>1000000 or jsonb_array_length(doc->'blocks')>500 or exists(select 1 from jsonb_array_elements(doc->'blocks') b where b ? 'id' group by b->>'id' having count(*)>1) then raise exception 'invalid_content_size_or_ids';end if;
  if doc->>'id' is null then raise exception 'missing_content_id'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(app_private.current_workspace()::text||':'||sid::text||':id:'||(doc->>'id')));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(app_private.current_workspace()::text||':'||sid::text||':slug:'||(doc->>'slug')));
  if (select count(*) from public.content_items where workspace_id=app_private.current_workspace() and subject_id=sid and (slug=doc->>'slug' or source_id=doc->>'id'))>1
    then raise exception 'content_identity_conflict'; end if;
  select id into cid from public.content_items where workspace_id=app_private.current_workspace() and subject_id=sid and (slug=doc->>'slug' or source_id=doc->>'id') for update;
  if cid is not null and not exists(select 1 from public.content_items where id=cid and subject_id=sid) then raise exception 'content_identity_conflict'; end if;
  if expected_content_id is not null and cid is distinct from expected_content_id then raise exception 'content_identity_mismatch'; end if;
  if cid is not null and expected_content_id is null then raise exception 'content_already_exists'; end if;
  if cid is null then
    insert into public.content_items(subject_id,source_id,slug,title,summary,year,level_code,module,topic,tags,sort_order,status)
      values(sid,doc->>'id',doc->>'slug',doc->>'title',doc->>'summary',legacy_year,doc->>'levelCode',doc->>'module',doc->>'topic',
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
    update public.content_items set source_id=doc->>'id',slug=doc->>'slug',title=doc->>'title',summary=doc->>'summary',year=legacy_year,level_code=doc->>'levelCode',
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

create or replace function app_private.save_group_access(cid uuid,gid uuid,module_allowed boolean,lesson_allowed boolean,
  theory_allowed boolean,simulation_allowed boolean,exercise_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.content_items%rowtype;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  select * into item from public.content_items where id=cid;
  if not found or not app_private.same_workspace_subject(item.subject_id) or not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null) then raise exception 'invalid_access_target'; end if;
  insert into public.module_access(group_id,subject_id,year,level_code,module,allowed) values(gid,item.subject_id,item.year,coalesce(item.level_code,''),item.module,module_allowed)
    on conflict(group_id,subject_id,level_code,module) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.content_access(group_id,content_id,allowed) values(gid,cid,lesson_allowed)
    on conflict(group_id,content_id) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.resource_access(group_id,content_id,kind,allowed) values
    (gid,cid,'theory',theory_allowed),(gid,cid,'simulation',simulation_allowed),(gid,cid,'exercise',exercise_allowed)
    on conflict(group_id,content_id,kind) where group_id is not null do update set allowed=excluded.allowed;
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'group_access_changed',gid::text||':'||cid::text);
end $$;

create function app_private.set_level_module_bundle(gid uuid,level_code_value text,module_name text,allowed_value boolean,sid uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  sid:=coalesce(sid,(select id from public.subjects where workspace_id=app_private.current_workspace() and slug='telecomunicazioni'));
  if not app_private.same_workspace_subject(sid) then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace() and archived_at is null) then raise exception 'invalid_access_target'; end if;
  if module_name is null or (level_code_value<>'' and not exists(select 1 from public.academic_levels where code=level_code_value and workspace_id=app_private.current_workspace())) then raise exception 'invalid_module'; end if;
  insert into public.module_access(group_id,subject_id,level_code,module,allowed) values(gid,sid,level_code_value,module_name,allowed_value)
    on conflict(group_id,subject_id,level_code,module) where group_id is not null do update set allowed=excluded.allowed;
  for cid in select id from public.content_items where subject_id=sid and level_code=level_code_value and module=module_name loop
    insert into public.content_access(group_id,content_id,allowed) values(gid,cid,allowed_value)
      on conflict(group_id,content_id) where group_id is not null do update set allowed=excluded.allowed;
    insert into public.resource_access(group_id,content_id,kind,allowed) values
      (gid,cid,'theory',allowed_value),(gid,cid,'simulation',allowed_value),(gid,cid,'exercise',allowed_value)
      on conflict(group_id,content_id,kind) where group_id is not null do update set allowed=excluded.allowed;
  end loop;
  insert into public.audit_log(actor_id,action,target_id)
    values(auth.uid(),'module_access_changed',gid::text||':'||level_code_value||':'||module_name);
end $$;

create function public.set_level_module_bundle(gid uuid,level_code_value text,module_name text,allowed_value boolean,sid uuid default null) returns void language sql security invoker set search_path='' as $$ select app_private.set_level_module_bundle(gid,level_code_value,module_name,allowed_value,sid) $$;

create or replace function app_private.set_module_bundle(gid uuid,academic_year int,module_name text,allowed_value boolean,sid uuid default null) returns void language plpgsql security definer set search_path='' as $$ begin perform app_private.set_level_module_bundle(gid,academic_year::text,module_name,allowed_value,sid);end $$;

create or replace function app_private.can_read_assignment(aid uuid) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare a public.assignments%rowtype; direct_allowed boolean;
begin
  if not app_private.account_ready() then return false; end if;
  select * into a from public.assignments where id=aid;
  if not found or not app_private.same_workspace_subject(a.subject_id) then return false; end if;
  if (app_private.is_manager() or (app_private.can_edit_subject(a.subject_id) and a.status in ('draft','ready'))) or app_private.can_review_assignment(a.id) or (app_private.current_role()='editor' and exists(select 1 from public.assignment_targets t where t.assignment_id=a.id and t.allowed and app_private.teaches_group(t.group_id,a.subject_id))) then return true; end if;
  if exists(select 1 from public.subjects where id=a.subject_id and archived_at is not null) then return false; end if;
  if not exists(select 1 from public.academic_years y where y.id=a.academic_year_id and y.status='active') then return false; end if;
  if a.status<>'published' or (a.available_from is not null and a.available_from>now()) then return false; end if;
  select allowed into direct_allowed from public.assignment_targets where assignment_id=aid and user_id=auth.uid();
  if found then return direct_allowed and exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.academic_year_id=a.academic_year_id and app_private.active_enrollment(auth.uid(),e.group_id)); end if;
  return exists(select 1 from public.assignment_targets t
    join public.groups g on g.id=t.group_id and g.archived_at is null and exists(select 1 from public.academic_years y where y.id=g.academic_year_id and y.status='active')
    join public.enrollments gm on gm.group_id=g.id and app_private.active_enrollment(auth.uid(),g.id)
    where t.assignment_id=aid and t.allowed and gm.user_id=auth.uid());
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
      and (filter_group is null or exists(select 1 from public.enrollments gm
        where gm.user_id=a.user_id and gm.group_id=filter_group and gm.academic_year_id=ass.academic_year_id and (a.enrollment_id=gm.id or (a.enrollment_id is null and a.submitted_at::date>=gm.started_at and (gm.ended_at is null or a.submitted_at::date<=gm.ended_at)))))
    order by case r.status when 'pending' then 0 when 'in_review' then 1 else 2 end,r.updated_at desc
    limit 25 offset page_number*25) v),'[]'::jsonb));
end $$;

create or replace function app_private.management_group_activity(gid uuid,sid uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not app_private.is_manager() or not exists(select 1 from public.groups where id=gid and workspace_id=app_private.current_workspace())
 or (sid is not null and not app_private.same_workspace_subject(sid)) then raise exception 'access_denied'; end if;
 with members as (select p.id from public.profiles p join public.enrollments gm on gm.user_id=p.id
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

-- New API tables: select only. Every write is behind an authorized transaction.
do $$ declare t text;begin foreach t in array array['academic_levels','track_levels','enrollments','subject_offerings','teaching_assignments','rollover_batches','rollover_entries','content_releases','lesson_release_activity','practice_release_progress'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);end loop;end $$;
create policy levels_read on public.academic_levels for select to authenticated using(workspace_id=app_private.current_workspace());
create policy track_levels_read on public.track_levels for select to authenticated using(exists(select 1 from public.tracks t where t.id=track_id and t.workspace_id=app_private.current_workspace()));
create policy enrollments_read on public.enrollments for select to authenticated using(workspace_id=app_private.current_workspace() and (app_private.is_manager() or user_id=auth.uid() or app_private.teaches_group(group_id)));
create policy offerings_read on public.subject_offerings for select to authenticated using(workspace_id=app_private.current_workspace() and (app_private.is_manager() or app_private.can_read_curriculum_subject(subject_id) or exists(select 1 from public.groups g where g.academic_year_id=subject_offerings.academic_year_id and g.track_id=subject_offerings.track_id and app_private.can_read_group(g.id))));
create policy teaching_read on public.teaching_assignments for select to authenticated using(workspace_id=app_private.current_workspace() and (app_private.is_owner() or (staff_user_id=auth.uid() and app_private.current_role() in ('editor','reviewer'))));
create policy rollover_read on public.rollover_batches for select to authenticated using(workspace_id=app_private.current_workspace() and app_private.is_manager());
create policy rollover_entries_read on public.rollover_entries for select to authenticated using(exists(select 1 from public.rollover_batches b where b.id=batch_id and b.workspace_id=app_private.current_workspace() and app_private.is_manager()));
create policy releases_read on public.content_releases for select to authenticated using(workspace_id=app_private.current_workspace() and (exists(select 1 from public.content_items c where c.id=content_id and app_private.can_edit_subject(c.subject_id)) or app_private.release_eligible(auth.uid(),id)));
-- Historical activity policies use a private helper so members don't lose their own history
-- when a release is superseded, while staff remain limited to the recorded group.
create function app_private.can_read_release_history(uid uuid,rid uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.content_releases r join public.content_items c on c.id=r.content_id where r.id=rid and r.workspace_id=app_private.current_workspace() and (uid=auth.uid() or app_private.is_manager() or app_private.teaches_group(r.group_id,c.subject_id))) $$;
create policy release_activity_read on public.lesson_release_activity for select to authenticated using(app_private.can_read_release_history(user_id,release_id));
create policy release_practice_read on public.practice_release_progress for select to authenticated using(app_private.can_read_release_history(user_id,release_id));

create function app_private.save_rollover_choices(bid uuid,choices jsonb,expected_revision int) returns int language plpgsql security definer set search_path='' as $$ declare b public.rollover_batches%rowtype;c jsonb;begin
 select * into b from public.rollover_batches where id=bid and workspace_id=app_private.current_workspace() for update;
 if not found or not app_private.is_manager() or b.status not in('draft','ready') or b.revision<>expected_revision or jsonb_typeof(choices) is distinct from 'array' or jsonb_array_length(choices)>5000 then raise exception 'rollover_revision_conflict';end if;
 for c in select * from jsonb_array_elements(choices) loop
 update public.rollover_entries set decision=c->>'decision',destination_group_id=case when c->>'decision' in ('complete','exit','pending') then null else nullif(c->>'destinationGroupId','')::uuid end where batch_id=bid and enrollment_id=(c->>'enrollmentId')::uuid;
 if not found then raise exception 'invalid_rollover_entry';end if;end loop;
 update public.rollover_batches set revision=revision+1,status='draft' where id=bid;return b.revision+1;end $$;
create function public.save_rollover_choices(bid uuid,choices jsonb,expected_revision int) returns int language sql security invoker set search_path='' as $$ select app_private.save_rollover_choices(bid,choices,expected_revision) $$;
create function app_private.my_recent_activity() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(v)),'[]') from (select content_id,max(last_active_at) last_active_at from (
 select a.content_id,a.last_active_at from public.lesson_activity a join public.content_items c on c.id=a.content_id where a.user_id=auth.uid() and c.workspace_id=app_private.current_workspace()
 union all select r.content_id,a.last_active_at from public.lesson_release_activity a join public.content_releases r on r.id=a.release_id where a.user_id=auth.uid() and r.workspace_id=app_private.current_workspace()) data group by content_id order by last_active_at desc limit 100) v $$;
create function public.my_recent_activity() returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.my_recent_activity() $$;

create function app_private.register_created_accounts(actor uuid,wid uuid,accounts jsonb) returns void language plpgsql security definer set search_path='' as $$ declare a jsonb;g public.groups%rowtype;y public.academic_years%rowtype;begin
 if not exists(select 1 from public.workspace_memberships m join public.profiles p on p.id=m.user_id join public.workspaces w on w.id=m.workspace_id where m.user_id=actor and m.workspace_id=wid and m.role in('owner','manager') and not m.disabled and not p.disabled and not p.must_change_password and w.archived_at is null) or jsonb_typeof(accounts) is distinct from 'array' or jsonb_array_length(accounts) not between 1 and 100 then raise exception 'access_denied';end if;
 perform pg_advisory_xact_lock(hashtext(wid::text||':rollover'));
 for a in select * from jsonb_array_elements(accounts) loop
 insert into public.profiles(id,username,first_name,last_name,must_change_password) values((a->>'id')::uuid,a->>'username',a->>'firstName',a->>'lastName',true);
 insert into public.workspace_memberships(workspace_id,user_id,role) values(wid,(a->>'id')::uuid,'member');
 if nullif(a->>'groupId','') is not null then
 select * into g from public.groups where id=(a->>'groupId')::uuid and workspace_id=wid and archived_at is null;select * into y from public.academic_years where id=g.academic_year_id;
 if g.id is null or y.status='archived' or y.end_date<current_date then raise exception 'invalid_group';end if;
 insert into public.enrollments(workspace_id,academic_year_id,user_id,group_id,started_at) values(wid,g.academic_year_id,(a->>'id')::uuid,g.id,greatest(y.start_date,current_date));end if;
 insert into public.audit_log(workspace_id,actor_id,action,target_id) values(wid,actor,'account_created',a->>'id');end loop;end $$;
create function public.register_created_accounts(actor uuid,wid uuid,accounts jsonb) returns void language sql security invoker set search_path='' as $$ select app_private.register_created_accounts(actor,wid,accounts) $$;
revoke execute on function app_private.register_created_accounts(uuid,uuid,jsonb),public.register_created_accounts(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app_private.register_created_accounts(uuid,uuid,jsonb),public.register_created_accounts(uuid,uuid,jsonb) to service_role;
-- Review update policy already calls can_review_attempt; the immutable-year trigger
-- additionally prevents managers from writing to archived years.
revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function app_private.active_enrollment(uuid,uuid) to authenticated;
grant execute on function app_private.teaches_group(uuid,uuid) to authenticated;
grant execute on function app_private.can_read_group(uuid) to authenticated;
grant execute on function app_private.can_review_assignment(uuid) to authenticated;
grant execute on function app_private.can_review_attempt(uuid) to authenticated;
grant execute on function app_private.change_enrollment(uuid,uuid,date,text) to authenticated;
grant execute on function public.change_enrollment(uuid,uuid,date,text) to authenticated;
grant execute on function app_private.set_member_group(uuid,uuid) to authenticated;
grant execute on function app_private.enrollment_history(uuid,uuid,int) to authenticated;
grant execute on function public.enrollment_history(uuid,uuid,int) to authenticated;
grant execute on function app_private.save_level(uuid,text,text,int) to authenticated;
grant execute on function public.save_level(uuid,text,text,int) to authenticated;
grant execute on function app_private.set_track_levels(uuid,uuid[]) to authenticated;
grant execute on function public.set_track_levels(uuid,uuid[]) to authenticated;
grant execute on function app_private.activate_academic_year(uuid,boolean) to authenticated;
grant execute on function public.activate_academic_year(uuid,boolean) to authenticated;
grant execute on function app_private.save_academic_year(uuid,text,date,date,text) to authenticated;
grant execute on function app_private.prepare_rollover(uuid,uuid) to authenticated;
grant execute on function public.prepare_rollover(uuid,uuid) to authenticated;
grant execute on function app_private.save_rollover_entry(uuid,uuid,text,uuid,int) to authenticated;
grant execute on function public.save_rollover_entry(uuid,uuid,text,uuid,int) to authenticated;
grant execute on function app_private.rollover_preview(uuid) to authenticated;
grant execute on function public.rollover_preview(uuid) to authenticated;
grant execute on function app_private.apply_rollover(uuid,int) to authenticated;
grant execute on function public.apply_rollover(uuid,int) to authenticated;
grant execute on function app_private.cancel_rollover(uuid) to authenticated;
grant execute on function public.cancel_rollover(uuid) to authenticated;
grant execute on function app_private.save_subject_offering(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.save_subject_offering(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function app_private.set_teaching_assignment(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.set_teaching_assignment(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function app_private.release_eligible(uuid,uuid) to authenticated;
grant execute on function app_private.release_resource_allowed(uuid,uuid,text) to authenticated;
grant execute on function app_private.user_can_read_content(uuid,uuid) to authenticated;
grant execute on function app_private.can_read_content(uuid) to authenticated;
grant execute on function app_private.can_read_resource(uuid,text) to authenticated;
grant execute on function app_private.publish_content_release(uuid,uuid,int,timestamptz,timestamptz) to authenticated;
grant execute on function public.publish_content_release(uuid,uuid,int,timestamptz,timestamptz) to authenticated;
grant execute on function app_private.archive_content_release(uuid) to authenticated;
grant execute on function public.archive_content_release(uuid) to authenticated;
grant execute on function app_private.catalog_page(int,uuid) to authenticated;
grant execute on function public.catalog_page(int,uuid) to authenticated;
grant execute on function app_private.lesson_resources(uuid,uuid) to authenticated;
grant execute on function public.lesson_resources(uuid,uuid) to authenticated;
grant execute on function app_private.search_releases(text) to authenticated;
grant execute on function public.search_releases(text) to authenticated;
grant execute on function app_private.record_release_open(uuid) to authenticated;
grant execute on function public.record_release_open(uuid) to authenticated;
grant execute on function app_private.record_release_activity(uuid,int) to authenticated;
grant execute on function public.record_release_activity(uuid,int) to authenticated;
grant execute on function app_private.record_release_practice(uuid,text,boolean,boolean) to authenticated;
grant execute on function public.record_release_practice(uuid,text,boolean,boolean) to authenticated;
grant execute on function app_private.record_lesson_open(uuid) to authenticated;
grant execute on function app_private.record_lesson_activity(uuid,int) to authenticated;
grant execute on function app_private.record_practice_progress(uuid,text,boolean,boolean) to authenticated;
grant execute on function app_private.resolve_recent_contexts(jsonb) to authenticated;
grant execute on function public.resolve_recent_contexts(jsonb) to authenticated;
grant execute on function app_private.leave_workspace_account(uuid) to authenticated;
grant execute on function public.leave_workspace_account(uuid) to authenticated;
grant execute on function app_private.restore_lifecycle_backup(jsonb,boolean) to authenticated;
grant execute on function public.restore_lifecycle_backup(jsonb,boolean) to authenticated;
grant execute on function app_private.save_content_document(jsonb,uuid) to authenticated;
grant execute on function app_private.save_group_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function app_private.set_level_module_bundle(uuid,text,text,boolean,uuid) to authenticated;
grant execute on function public.set_level_module_bundle(uuid,text,text,boolean,uuid) to authenticated;
grant execute on function app_private.set_module_bundle(uuid,int,text,boolean,uuid) to authenticated;
grant execute on function app_private.can_read_assignment(uuid) to authenticated;
grant execute on function app_private.management_reviews(text,uuid,uuid,uuid,int,uuid) to authenticated;
grant execute on function app_private.management_group_activity(uuid,uuid) to authenticated;
grant execute on function app_private.can_read_release_history(uuid,uuid) to authenticated;

create or replace function app_private.delete_member_activity(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_manager() then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.workspace_memberships where user_id=uid and workspace_id=app_private.current_workspace()) then raise exception 'access_denied'; end if;
  if not exists(select 1 from public.workspace_memberships where user_id=uid and workspace_id=app_private.current_workspace() and role='member') then raise exception 'member_target_required'; end if;
  delete from public.lesson_activity where user_id=uid and content_id in (select id from public.content_items where workspace_id=app_private.current_workspace());
  delete from public.practice_progress where user_id=uid and content_id in (select id from public.content_items where workspace_id=app_private.current_workspace());
  perform set_config('app.privacy_delete','on',true);
  delete from public.lesson_release_activity a using public.content_releases r where r.id=a.release_id and r.workspace_id=app_private.current_workspace() and a.user_id=uid;
  delete from public.practice_release_progress p using public.content_releases r where r.id=p.release_id and r.workspace_id=app_private.current_workspace() and p.user_id=uid;
  delete from public.attempts where user_id=uid and question_id in (select q.id from public.questions q join public.assignments a on a.id=q.assignment_id where app_private.same_workspace_subject(a.subject_id));
  insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'activity_deleted',uid::text);
end $$;

-- Final privilege reset after every P3.2 object.
revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function app_private.active_enrollment(uuid,uuid) to authenticated;
grant execute on function app_private.teaches_group(uuid,uuid) to authenticated;
grant execute on function app_private.can_read_group(uuid) to authenticated;
grant execute on function app_private.can_review_assignment(uuid) to authenticated;
grant execute on function app_private.can_review_attempt(uuid) to authenticated;
grant execute on function app_private.change_enrollment(uuid,uuid,date,text) to authenticated;
grant execute on function public.change_enrollment(uuid,uuid,date,text) to authenticated;
grant execute on function app_private.set_member_group(uuid,uuid) to authenticated;
grant execute on function app_private.enrollment_history(uuid,uuid,int) to authenticated;
grant execute on function public.enrollment_history(uuid,uuid,int) to authenticated;
grant execute on function app_private.save_level(uuid,text,text,int) to authenticated;
grant execute on function public.save_level(uuid,text,text,int) to authenticated;
grant execute on function app_private.set_track_levels(uuid,uuid[]) to authenticated;
grant execute on function public.set_track_levels(uuid,uuid[]) to authenticated;
grant execute on function app_private.activate_academic_year(uuid,boolean) to authenticated;
grant execute on function public.activate_academic_year(uuid,boolean) to authenticated;
grant execute on function app_private.save_academic_year(uuid,text,date,date,text) to authenticated;
grant execute on function app_private.prepare_rollover(uuid,uuid) to authenticated;
grant execute on function public.prepare_rollover(uuid,uuid) to authenticated;
grant execute on function app_private.save_rollover_entry(uuid,uuid,text,uuid,int) to authenticated;
grant execute on function public.save_rollover_entry(uuid,uuid,text,uuid,int) to authenticated;
grant execute on function app_private.rollover_preview(uuid) to authenticated;
grant execute on function public.rollover_preview(uuid) to authenticated;
grant execute on function app_private.apply_rollover(uuid,int) to authenticated;
grant execute on function public.apply_rollover(uuid,int) to authenticated;
grant execute on function app_private.cancel_rollover(uuid) to authenticated;
grant execute on function public.cancel_rollover(uuid) to authenticated;
grant execute on function app_private.save_subject_offering(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.save_subject_offering(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function app_private.set_teaching_assignment(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.set_teaching_assignment(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function app_private.release_eligible(uuid,uuid) to authenticated;
grant execute on function app_private.release_resource_allowed(uuid,uuid,text) to authenticated;
grant execute on function app_private.user_can_read_content(uuid,uuid) to authenticated;
grant execute on function app_private.can_read_content(uuid) to authenticated;
grant execute on function app_private.can_read_resource(uuid,text) to authenticated;
grant execute on function app_private.publish_content_release(uuid,uuid,int,timestamptz,timestamptz) to authenticated;
grant execute on function public.publish_content_release(uuid,uuid,int,timestamptz,timestamptz) to authenticated;
grant execute on function app_private.archive_content_release(uuid) to authenticated;
grant execute on function public.archive_content_release(uuid) to authenticated;
grant execute on function app_private.catalog_page(int,uuid) to authenticated;
grant execute on function public.catalog_page(int,uuid) to authenticated;
grant execute on function app_private.lesson_resources(uuid,uuid) to authenticated;
grant execute on function public.lesson_resources(uuid,uuid) to authenticated;
grant execute on function app_private.search_releases(text) to authenticated;
grant execute on function public.search_releases(text) to authenticated;
grant execute on function app_private.record_release_open(uuid) to authenticated;
grant execute on function public.record_release_open(uuid) to authenticated;
grant execute on function app_private.record_release_activity(uuid,int) to authenticated;
grant execute on function public.record_release_activity(uuid,int) to authenticated;
grant execute on function app_private.record_release_practice(uuid,text,boolean,boolean) to authenticated;
grant execute on function public.record_release_practice(uuid,text,boolean,boolean) to authenticated;
grant execute on function app_private.record_lesson_open(uuid) to authenticated;
grant execute on function app_private.record_lesson_activity(uuid,int) to authenticated;
grant execute on function app_private.record_practice_progress(uuid,text,boolean,boolean) to authenticated;
grant execute on function app_private.resolve_recent_contexts(jsonb) to authenticated;
grant execute on function public.resolve_recent_contexts(jsonb) to authenticated;
grant execute on function app_private.leave_workspace_account(uuid) to authenticated;
grant execute on function public.leave_workspace_account(uuid) to authenticated;
grant execute on function app_private.restore_lifecycle_backup(jsonb,boolean) to authenticated;
grant execute on function public.restore_lifecycle_backup(jsonb,boolean) to authenticated;
grant execute on function app_private.save_content_document(jsonb,uuid) to authenticated;
grant execute on function app_private.save_group_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function app_private.set_level_module_bundle(uuid,text,text,boolean,uuid) to authenticated;
grant execute on function public.set_level_module_bundle(uuid,text,text,boolean,uuid) to authenticated;
grant execute on function app_private.set_module_bundle(uuid,int,text,boolean,uuid) to authenticated;
grant execute on function app_private.can_read_assignment(uuid) to authenticated;
grant execute on function app_private.management_reviews(text,uuid,uuid,uuid,int,uuid) to authenticated;
grant execute on function app_private.management_group_activity(uuid,uuid) to authenticated;
grant execute on function app_private.can_read_release_history(uuid,uuid) to authenticated;
grant execute on function app_private.save_rollover_choices(uuid,jsonb,int) to authenticated;
grant execute on function public.save_rollover_choices(uuid,jsonb,int) to authenticated;
grant execute on function app_private.my_recent_activity() to authenticated;
grant execute on function public.my_recent_activity() to authenticated;
grant execute on function app_private.delete_member_activity(uuid) to authenticated;

grant usage on schema app_private to service_role;
