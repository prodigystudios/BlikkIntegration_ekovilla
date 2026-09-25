-- Admin self-lockout guard for the permission setters (CREATE OR REPLACE over the functions
-- from 20260608_permissions_model.sql). Without this, an admin could — via a direct API call,
-- bypassing the UI which already blocks it — strip their own admin access two ways:
--   1) remove crm.admin from the admin ROLE bundle (all admins lose it), or
--   2) revoke crm.admin on an admin USER (revoke wins → that admin loses it).
-- Both now raise an exception. Recovery from an existing lockout is still a manual SQL delete
-- of the offending role_permissions / user_permissions row.
--
-- Run AFTER 20260608_permissions_model.sql. Idempotent (replaces the functions).

create or replace function public.set_role_permission(p_role public.user_role, p_key text, p_present boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.permissions where key = p_key) then
    raise exception 'unknown permission %', p_key;
  end if;
  -- Lockout guard: the admin role must always keep crm.admin.
  if p_role = 'admin' and p_key = 'crm.admin' and p_present = false then
    raise exception 'cannot remove crm.admin from the admin role';
  end if;
  if p_present then
    insert into public.role_permissions(role, permission_key) values (p_role, p_key)
    on conflict do nothing;
  else
    delete from public.role_permissions where role = p_role and permission_key = p_key;
  end if;
end;$$;
revoke all on function public.set_role_permission(public.user_role, text, boolean) from public;
grant execute on function public.set_role_permission(public.user_role, text, boolean) to authenticated;

-- p_effect: 'grant' | 'revoke' to set an override, NULL to clear it (fall back to the role).
create or replace function public.set_user_permission(p_user uuid, p_key text, p_effect text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.permissions where key = p_key) then
    raise exception 'unknown permission %', p_key;
  end if;
  -- Lockout guard: never revoke crm.admin from a user who is an admin.
  if p_key = 'crm.admin' and p_effect = 'revoke'
     and exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'cannot revoke crm.admin from an admin';
  end if;
  if p_effect is null then
    delete from public.user_permissions where user_id = p_user and permission_key = p_key;
  elsif p_effect in ('grant', 'revoke') then
    insert into public.user_permissions(user_id, permission_key, effect, created_by)
    values (p_user, p_key, p_effect, auth.uid())
    on conflict (user_id, permission_key) do update
      set effect = excluded.effect, created_by = excluded.created_by;
  else
    raise exception 'invalid effect %', p_effect;
  end if;
end;$$;
revoke all on function public.set_user_permission(uuid, text, text) from public;
grant execute on function public.set_user_permission(uuid, text, text) to authenticated;
