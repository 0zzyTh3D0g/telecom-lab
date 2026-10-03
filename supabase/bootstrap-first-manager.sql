-- Run once in the Supabase SQL Editor after creating the Auth user manually.
-- Edit only these four values. Never expose this file as a public RPC.
do $bootstrap$
declare
  auth_email text := 'admin@accounts.telecomlab.invalid';
  login_username text := 'admin';
  given_name text := 'Responsabile';
  family_name text := 'Piattaforma';
  auth_id uuid;
begin
  if exists(select 1 from public.workspace_memberships where role in ('owner','manager')) then
    raise exception 'A manager already exists; bootstrap refused';
  end if;
  select id into auth_id from auth.users where email=auth_email;
  if auth_id is null then raise exception 'Auth user % does not exist', auth_email; end if;
  if login_username !~ '^[a-z][a-z0-9]{2,39}$' then raise exception 'Invalid username'; end if;
  if auth_email <> login_username || '@accounts.telecomlab.invalid' then raise exception 'Auth email and username do not match'; end if;
  insert into public.profiles(id,username,first_name,last_name,must_change_password)
    values(auth_id,login_username,given_name,family_name,true);
  insert into public.workspace_memberships(workspace_id,user_id,role)
    values('10000000-0000-4000-8000-000000000001',auth_id,'owner');
  insert into public.audit_log(workspace_id,actor_id,action,target_id)
    values('10000000-0000-4000-8000-000000000001',auth_id,'first_manager_bootstrapped',auth_id::text);
end
$bootstrap$;
