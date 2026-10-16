-- Execute after the candidate migration inside a BEGIN ... ROLLBACK transaction.
-- All identities are fictional; these rows must never be committed.
do $$
declare
  actor uuid;
  other_user uuid := gen_random_uuid();
  total integer;
begin
  select a.user_id into actor from public.platform_admins a where a.role = 'owner';
  if actor is null then
    actor := gen_random_uuid();
    insert into auth.users(id,email,email_confirmed_at) values(actor,'capacity-owner-' || actor || '@example.invalid',now());
    insert into public.platform_admins(user_id,role) values(actor,'owner');
  end if;
  insert into auth.users(id,email,email_confirmed_at) values(other_user,'capacity-other-' || other_user || '@example.invalid',now());
  if has_function_privilege('anon','public.platform_admin_user_emails(uuid,uuid[])','execute')
    or has_function_privilege('authenticated','public.platform_admin_user_emails(uuid,uuid[])','execute')
    or has_function_privilege('anon','private.platform_admin_user_emails(uuid,uuid[])','execute')
    or has_function_privilege('authenticated','private.platform_admin_user_emails(uuid,uuid[])','execute') then
    raise exception 'browser can call privileged email lookup';
  end if;
  if not has_function_privilege('service_role','public.platform_admin_user_emails(uuid,uuid[])','execute') then
    raise exception 'service cannot call batch lookup';
  end if;
  select count(*) into total from public.platform_admin_user_emails(actor,array[other_user,other_user]);
  if total <> 1 then raise exception 'batch dedupe/missing results: %',total; end if;
  select count(*) into total from public.platform_admin_user_emails(actor,'{}'::uuid[]);
  if total <> 0 then raise exception 'empty batch returns data'; end if;
  begin
    perform public.platform_admin_user_emails(other_user,array[actor]);
    raise exception 'non-owner accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_user_emails(actor,array_fill(other_user,array[501]));
    raise exception 'oversized batch accepted';
  exception when invalid_parameter_value then null;
  end;
  -- Verify under the actual API database role (which cannot SELECT auth.users).
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  select count(*) into total from public.platform_admin_user_emails(actor,array[other_user]);
  if total <> 1 then raise exception 'service role cannot read batch'; end if;
  execute 'reset role';
end;
$$;
