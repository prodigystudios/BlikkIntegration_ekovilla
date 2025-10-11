-- Add tags array to profiles and helper to set tags (admin-only)
-- Safe to run multiple times

-- 1) Column + index
alter table if exists public.profiles
  add column if not exists tags text[] not null default '{}'::text[];

create index if not exists profiles_tags_gin on public.profiles using gin (tags);

comment on column public.profiles.tags is 'Free-form tags (e.g., crew) for filtering and assignment UI';

-- 2) Admin function to set tags
create or replace function public.set_user_tags(target uuid, new_tags text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- This function is intended to be called only with the service role via server-side API.
  -- Keep logic simple and rely on GRANTs to restrict usage.
  update public.profiles
     set tags = coalesce(new_tags, '{}'::text[])
   where id = target;
  if not found then
    raise exception 'target user not found';
  end if;
end;
$$;

-- Allow only service_role to execute; block others
revoke all on function public.set_user_tags(uuid, text[]) from public;
revoke all on function public.set_user_tags(uuid, text[]) from authenticated;
grant execute on function public.set_user_tags(uuid, text[]) to service_role;
