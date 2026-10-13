begin;
select set_config('study_life_test.owner_a', gen_random_uuid()::text, true);
select set_config('study_life_test.owner_b', gen_random_uuid()::text, true);
insert into auth.users(id) values
  (current_setting('study_life_test.owner_a')::uuid),
  (current_setting('study_life_test.owner_b')::uuid);

set local role service_role;
insert into public.platform_admins(user_id)
  values (current_setting('study_life_test.owner_a')::uuid);

do $$
declare
  denied boolean := false;
begin
  begin
    insert into public.platform_admins(user_id)
      values (current_setting('study_life_test.owner_b')::uuid);
  exception when unique_violation then denied := true;
  end;
  if not denied then raise exception 'A second platform owner was accepted'; end if;
end $$;

insert into public.platform_admin_audit(actor_user_id, target_user_id, action, outcome, reason)
  values (current_setting('study_life_test.owner_a')::uuid,
    current_setting('study_life_test.owner_b')::uuid, 'user.suspend', 'started', 'Fictional test reason');

reset role;
set local role authenticated;
do $$
declare denied boolean := false;
begin
  begin perform count(*) from public.platform_admins;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Authenticated users can read the admin registry'; end if;
  denied := false;
  begin perform count(*) from public.platform_admin_audit;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Authenticated users can read admin audit events'; end if;
end $$;

reset role;
set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform count(*) from public.platform_admins;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous users can read the admin registry'; end if;
end $$;

rollback;
select 'passed' as platform_admin_access_checks,
  (select count(*) from public.platform_admins) as remaining_admins,
  (select count(*) from public.platform_admin_audit) as remaining_events;
