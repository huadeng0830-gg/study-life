-- service_role has no SELECT on auth.users. Keep the narrowly privileged lookup
-- in an unexposed schema; a service-only invoker RPC is the PostgREST boundary.
-- Verify the Edge-verified actor again, cap the batch, return only id/email.
create schema if not exists private;
grant usage on schema private to service_role;
create or replace function private.platform_admin_user_emails(p_actor uuid, p_user_ids uuid[])
returns table(user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.platform_admins a where a.user_id = p_actor and a.role = 'owner'
  ) or ((select auth.uid()) is not null and (select auth.uid()) <> p_actor) then
    raise exception 'PLATFORM_FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_user_ids), 0) > 500 then
    raise exception 'PLATFORM_INVALID_INPUT' using errcode = '22023';
  end if;
  return query
    select u.id, coalesce(u.email::text, '')
    from auth.users as u
    where u.id = any(p_user_ids);
end;
$$;
revoke all on function private.platform_admin_user_emails(uuid, uuid[]) from public, anon, authenticated;
grant execute on function private.platform_admin_user_emails(uuid, uuid[]) to service_role;

create or replace function public.platform_admin_user_emails(p_actor uuid, p_user_ids uuid[])
returns table(user_id uuid, email text)
language sql stable security invoker set search_path = ''
as $$
  select labels.user_id, labels.email from private.platform_admin_user_emails(p_actor, p_user_ids) labels;
$$;
revoke all on function public.platform_admin_user_emails(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.platform_admin_user_emails(uuid, uuid[]) to service_role;

-- user_id equality is used by matter list/detail interaction lookups; these
-- also cover auth.users FK deletion checks (the existing PK leads with matter).
create index if not exists campus_matter_marks_user_matter
  on public.campus_matter_marks(user_id, matter_id);
create index if not exists campus_matter_response_feedback_user_response
  on public.campus_matter_response_feedback(user_id, response_id);
-- Cover the author FK on the outcome table. Keep the matter/time index used
-- by outcome histories; this is not a redundant replacement for it.
create index if not exists campus_matter_outcomes_author
  on public.campus_matter_outcomes(author_id);
