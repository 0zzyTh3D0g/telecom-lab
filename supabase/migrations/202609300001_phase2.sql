create extension if not exists pgcrypto;

create table public.groups (id uuid primary key default gen_random_uuid(), name text not null unique, level int check(level in (3,4)), archived_at timestamptz);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, username text not null unique check(username ~ '^[a-z][a-z0-9]{2,39}$'), first_name text not null, last_name text not null, role text not null default 'member' check(role in ('manager','member')), disabled boolean not null default false, must_change_password boolean not null default true, created_at timestamptz not null default now());
create table public.group_memberships (user_id uuid references public.profiles(id) on delete cascade, group_id uuid references public.groups(id) on delete cascade, primary key(user_id,group_id));
create table public.content_items (id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null, summary text not null, year int not null check(year in (3,4)), module text not null, topic text not null, tags text[] not null default '{}', status text not null default 'draft' check(status in ('draft','ready','published','archived')), available_from timestamptz, available_until timestamptz, sort_order int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(available_until is null or available_from is null or available_until > available_from));
create table public.content_versions (id uuid primary key default gen_random_uuid(), content_id uuid not null references public.content_items(id) on delete cascade, version int not null, document jsonb not null, created_at timestamptz not null default now(), unique(content_id,version));
create table public.content_resources (content_id uuid not null references public.content_items(id) on delete cascade, kind text not null check(kind in ('theory','simulation','exercise')), blocks jsonb not null default '[]', search_text text not null default '', primary key(content_id,kind));
create table public.module_access (id uuid primary key default gen_random_uuid(), group_id uuid references public.groups(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, year int not null check(year in (3,4)), module text not null, allowed boolean not null, check((group_id is null) <> (user_id is null)));
create table public.content_access (id uuid primary key default gen_random_uuid(), content_id uuid not null references public.content_items(id) on delete cascade, group_id uuid references public.groups(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, allowed boolean not null, check((group_id is null) <> (user_id is null)));
create table public.resource_access (id uuid primary key default gen_random_uuid(), content_id uuid not null references public.content_items(id) on delete cascade, kind text not null check(kind in ('theory','simulation','exercise')), group_id uuid references public.groups(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, allowed boolean not null, check((group_id is null) <> (user_id is null)));
create table public.assignments (id uuid primary key default gen_random_uuid(), content_id uuid references public.content_items(id) on delete set null, title text not null, description text not null default '', status text not null default 'draft' check(status in ('draft','ready','published','archived')), available_from timestamptz, due_at timestamptz, max_attempts int not null default 1 check(max_attempts between 1 and 20), hints_allowed boolean not null default false, solution_release text not null default 'manual' check(solution_release in ('after_submission','after_deadline','manual')), solutions_released boolean not null default false, created_at timestamptz not null default now());
create table public.assignment_targets (assignment_id uuid references public.assignments(id) on delete cascade, group_id uuid references public.groups(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, allowed boolean not null default true, check((group_id is null) <> (user_id is null)));
create table public.questions (id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments(id) on delete cascade, kind text not null check(kind in ('numeric','singleChoice','multipleChoice','trueFalse','matching','shortOpen','extendedOpen')), prompt text not null, difficulty text not null, options jsonb, pairs jsonb, hints text[] not null default '{}', points numeric not null default 1, sort_order int not null default 0);
create table public.private_answer_keys (question_id uuid primary key references public.questions(id) on delete cascade, answer jsonb not null, tolerance numeric, unit text, solution text, rubric text);
create table public.attempts (id uuid primary key default gen_random_uuid(), question_id uuid not null references public.questions(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, attempt_number int not null, answer jsonb not null, correct boolean, hints_used int not null default 0, submitted_at timestamptz not null default now(), unique(question_id,user_id,attempt_number));
create table public.reviews (attempt_id uuid primary key references public.attempts(id) on delete cascade, status text not null default 'pending' check(status in ('pending','in_review','reviewed')), judgment text, feedback text, score numeric, reviewer_id uuid references public.profiles(id), updated_at timestamptz not null default now());
create table public.lesson_activity (user_id uuid not null references public.profiles(id) on delete cascade, content_id uuid not null references public.content_items(id) on delete cascade, opened_at timestamptz not null default now(), last_active_at timestamptz not null default now(), active_seconds int not null default 0 check(active_seconds >= 0), primary key(user_id,content_id));
create table public.audit_log (id bigint generated always as identity primary key, actor_id uuid references public.profiles(id) on delete set null, action text not null, target_id text, created_at timestamptz not null default now());
create index on public.group_memberships(group_id,user_id);
create index on public.content_items(year,module,status,available_from);
create index on public.content_access(content_id,group_id);
create index on public.resource_access(content_id,kind,group_id);
create index on public.assignment_targets(assignment_id,group_id);
create index on public.questions(assignment_id,sort_order);
create index on public.attempts(user_id,question_id);

create function public.is_manager() returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='manager' and not disabled and not must_change_password) $$;
create function public.account_ready() returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.profiles where id=auth.uid() and not disabled and not must_change_password) $$;
create function public.can_read_content(cid uuid) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.content_items%rowtype;
begin
 if public.is_manager() then return true; end if;
 if not public.account_ready() then return false; end if;
 select * into c from public.content_items where id=cid;
 if not found or c.status<>'published' or (c.available_from is not null and c.available_from>now()) or (c.available_until is not null and c.available_until<=now()) then return false; end if;
 if exists(select 1 from public.content_access a where a.content_id=cid and a.user_id=auth.uid()) then return exists(select 1 from public.content_access a where a.content_id=cid and a.user_id=auth.uid() and a.allowed); end if;
 return exists(select 1 from public.group_memberships gm join public.groups g on g.id=gm.group_id join public.module_access ma on ma.group_id=g.id and ma.year=c.year and ma.module=c.module and ma.allowed join public.content_access ca on ca.group_id=g.id and ca.content_id=cid and ca.allowed where gm.user_id=auth.uid() and g.archived_at is null);
end $$;
create function public.can_read_resource(cid uuid, rkind text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if public.is_manager() then return true; end if;
 if not public.can_read_content(cid) then return false; end if;
 if exists(select 1 from public.resource_access where content_id=cid and kind=rkind and user_id=auth.uid()) then return exists(select 1 from public.resource_access where content_id=cid and kind=rkind and user_id=auth.uid() and allowed); end if;
 return exists(select 1 from public.resource_access ra join public.group_memberships gm on gm.group_id=ra.group_id where ra.content_id=cid and ra.kind=rkind and ra.allowed and gm.user_id=auth.uid());
end $$;
create function public.can_read_assignment(aid uuid) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.assignments%rowtype;
begin
 if public.is_manager() then return true; end if;
 if not public.account_ready() then return false; end if;
 select * into a from public.assignments where id=aid;
 if not found or a.status<>'published' or (a.available_from is not null and a.available_from>now()) then return false; end if;
 if exists(select 1 from public.assignment_targets where assignment_id=aid and user_id=auth.uid()) then return exists(select 1 from public.assignment_targets where assignment_id=aid and user_id=auth.uid() and allowed); end if;
 return exists(select 1 from public.assignment_targets t join public.group_memberships gm on gm.group_id=t.group_id join public.groups g on g.id=gm.group_id where t.assignment_id=aid and t.allowed and gm.user_id=auth.uid() and g.archived_at is null);
end $$;

do $$ declare t text; begin foreach t in array array['groups','profiles','group_memberships','content_items','content_versions','content_resources','module_access','content_access','resource_access','assignments','assignment_targets','questions','private_answer_keys','attempts','reviews','lesson_activity','audit_log'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy profiles_read on public.profiles for select to authenticated using (id=auth.uid() or public.is_manager());
create policy manager_groups on public.groups for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy member_groups on public.groups for select to authenticated using(public.account_ready() and exists(select 1 from public.group_memberships gm where gm.group_id=id and gm.user_id=auth.uid()));
create policy manager_memberships on public.group_memberships for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy own_memberships on public.group_memberships for select to authenticated using(public.account_ready() and user_id=auth.uid());
create policy manager_items on public.content_items for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy readable_items on public.content_items for select to authenticated using(public.can_read_content(id));
create policy manager_versions on public.content_versions for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy manager_resources on public.content_resources for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy readable_resources on public.content_resources for select to authenticated using(public.can_read_resource(content_id,kind));
create policy manager_module_access on public.module_access for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy manager_content_access on public.content_access for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy manager_resource_access on public.resource_access for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy manager_assignments on public.assignments for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy readable_assignments on public.assignments for select to authenticated using(public.can_read_assignment(id));
create policy manager_targets on public.assignment_targets for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy manager_questions on public.questions for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy readable_questions on public.questions for select to authenticated using(public.can_read_assignment(assignment_id));
create policy manager_keys on public.private_answer_keys for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy manager_attempts on public.attempts for select to authenticated using(public.is_manager());
create policy own_attempts on public.attempts for select to authenticated using(public.account_ready() and user_id=auth.uid());
create policy manager_reviews on public.reviews for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy own_reviews on public.reviews for select to authenticated using(public.account_ready() and exists(select 1 from public.attempts a where a.id=attempt_id and a.user_id=auth.uid()));
create policy manager_activity on public.lesson_activity for select to authenticated using(public.is_manager());
create policy own_activity on public.lesson_activity for select to authenticated using(public.account_ready() and user_id=auth.uid());
create policy manager_audit on public.audit_log for select to authenticated using(public.is_manager());

-- Direct member writes to attempts and activity are deliberately absent. RPCs below enforce access and limits.
create function public.record_lesson_activity(cid uuid, seconds_delta int) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.can_read_content(cid) then raise exception 'access_denied'; end if;
 if seconds_delta < 0 or seconds_delta > 120 then raise exception 'invalid_activity'; end if;
 insert into public.lesson_activity(user_id,content_id,active_seconds) values(auth.uid(),cid,seconds_delta)
 on conflict(user_id,content_id) do update set active_seconds=public.lesson_activity.active_seconds+excluded.active_seconds,last_active_at=now();
end $$;
create function public.unit_scale(u text) returns numeric language sql immutable as $$
 select case when u in ('dB','rad/s') then 1
 when u ~ '^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$' then
   case (regexp_match(u,'^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$'))[1]
   when 'p' then 0.000000000001 when 'n' then 0.000000001 when 'u' then 0.000001 when 'µ' then 0.000001 when 'm' then 0.001 when 'k' then 1000 when 'M' then 1000000 when 'G' then 1000000000 else 1 end
 else null end $$;
create function public.unit_family(u text) returns text language sql immutable as $$
 select case when u='dB' then 'dB' when u='rad/s' then 'rad/s' else (regexp_match(u,'^(p|n|u|µ|m|k|M|G)?(Hz|s|V|A|Ω|W)$'))[2] end $$;
create function public.submit_assignment_answer(qid uuid, response jsonb, used_hints int default 0) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.questions%rowtype; a public.assignments%rowtype; keyrow public.private_answer_keys%rowtype; n int; result boolean; aid uuid; normalized_response numeric; normalized_key numeric;
begin
 if not public.account_ready() then raise exception 'access_denied'; end if;
 select * into q from public.questions where id=qid; if not found then raise exception 'question_not_found'; end if;
 select * into a from public.assignments where id=q.assignment_id;
 if not public.can_read_assignment(a.id) or (a.due_at is not null and now()>a.due_at) then raise exception 'assignment_unavailable'; end if;
 if used_hints<0 or (used_hints>0 and not a.hints_allowed) then raise exception 'hints_not_allowed'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text || qid::text));
 select count(*) into n from public.attempts where question_id=qid and user_id=auth.uid();
 if n>=a.max_attempts then raise exception 'attempt_limit'; end if;
 select * into keyrow from public.private_answer_keys where question_id=qid;
 if not found then raise exception 'answer_key_missing'; end if;
 if q.kind='numeric' then
   if public.unit_family(response->>'unit') is distinct from public.unit_family(keyrow.unit) or public.unit_scale(response->>'unit') is null then result:=false;
   else
     normalized_response:=(response->>'value')::numeric * public.unit_scale(response->>'unit');
     normalized_key:=(keyrow.answer->>'value')::numeric * public.unit_scale(keyrow.unit);
     result:=abs(normalized_response-normalized_key)<=coalesce(keyrow.tolerance,0)*public.unit_scale(keyrow.unit);
   end if;
 elsif q.kind='singleChoice' or q.kind='trueFalse' then result:=(response=keyrow.answer);
 elsif q.kind='multipleChoice' then result:=(select array_agg(v order by v) from jsonb_array_elements_text(response) v)=(select array_agg(v order by v) from jsonb_array_elements_text(keyrow.answer) v);
 elsif q.kind='matching' then result:=(response=keyrow.answer);
 else result:=null;
 end if;
 insert into public.attempts(question_id,user_id,attempt_number,answer,correct,hints_used) values(qid,auth.uid(),n+1,response,result,used_hints) returning id into aid;
 if q.kind in ('shortOpen','extendedOpen') then insert into public.reviews(attempt_id) values(aid); end if;
 return jsonb_build_object('attemptId',aid,'attemptNumber',n+1,'correct',result,'reviewStatus',case when result is null then 'pending' else null end);
end $$;
revoke all on function public.unit_scale(text), public.unit_family(text) from public,anon;
grant execute on function public.record_lesson_activity(uuid,int),public.submit_assignment_answer(uuid,jsonb,int) to authenticated;
create function public.get_assignment_solution(qid uuid) returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare assignment_row public.assignments%rowtype;
begin
 select a.* into assignment_row from public.assignments a join public.questions q on q.assignment_id=a.id where q.id=qid;
 if not found or not public.can_read_assignment(assignment_row.id) then raise exception 'access_denied'; end if;
 if not public.is_manager() and not (
   (assignment_row.solution_release='manual' and assignment_row.solutions_released)
   or (assignment_row.solution_release='after_deadline' and assignment_row.due_at is not null and now()>assignment_row.due_at)
   or (assignment_row.solution_release='after_submission' and exists(select 1 from public.attempts where question_id=qid and user_id=auth.uid()))
 ) then raise exception 'solution_unavailable'; end if;
 return (select solution from public.private_answer_keys where question_id=qid);
end $$;
grant execute on function public.get_assignment_solution(uuid) to authenticated;
