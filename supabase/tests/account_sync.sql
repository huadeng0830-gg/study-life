begin;
select set_config('study_life_test.user_a', gen_random_uuid()::text, true);
select set_config('study_life_test.user_b', gen_random_uuid()::text, true);
insert into auth.users(id) values
  (current_setting('study_life_test.user_a')::uuid),
  (current_setting('study_life_test.user_b')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('study_life_test.user_a'), true);
do $$
declare
  payload jsonb := '{"format":"study-life-sync","version":3,"values":{},"manifest":{}}';
  result jsonb;
  denied boolean := false;
  affected bigint;
begin
  result := public.write_account_sync_snapshot(null, payload, 'Fictional device A');
  if result->>'ok' <> 'true' or result->>'revision' <> '1' then raise exception 'Initial CAS failed'; end if;
  result := public.write_account_sync_snapshot(null, payload, 'Fictional duplicate');
  if result->>'conflict' <> 'true' or result->>'revision' <> '1' then raise exception 'Duplicate insert was not rejected'; end if;
  result := public.write_account_sync_snapshot(2, payload, 'Fictional stale device');
  if result->>'conflict' <> 'true' then raise exception 'Stale revision was not rejected'; end if;
  result := public.write_account_sync_snapshot(1, payload, 'Fictional device A');
  if result->>'ok' <> 'true' or result->>'revision' <> '2' then raise exception 'Valid CAS update failed'; end if;

  perform set_config('request.jwt.claim.sub', current_setting('study_life_test.user_b'), true);
  if (select count(*) from public.account_sync_snapshots) <> 0 then raise exception 'Cross-account read leak'; end if;
  begin
    insert into public.account_sync_snapshots(user_id, payload) values(current_setting('study_life_test.user_a')::uuid, payload);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Cross-account insert allowed'; end if;
  update public.account_sync_snapshots set device_name = 'Forbidden'
    where user_id = current_setting('study_life_test.user_a')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-account update allowed'; end if;
  result := public.write_account_sync_snapshot(null, payload, 'Fictional device B');
  if result->>'ok' <> 'true' then raise exception 'Own account insert denied'; end if;

  denied := false;
  begin
    update public.account_sync_snapshots set user_id = current_setting('study_life_test.user_a')::uuid
      where user_id = current_setting('study_life_test.user_b')::uuid;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Owner reassignment allowed'; end if;
  denied := false;
  begin
    perform public.write_account_sync_snapshot(1, '{}'::jsonb, 'Fictional invalid payload');
  exception when check_violation then denied := true;
  end;
  if not denied then raise exception 'Missing fields accepted'; end if;
end $$;
reset role;
set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform count(*) from public.account_sync_snapshots;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous table access allowed'; end if;
  denied := false;
  begin perform public.write_account_sync_snapshot(null, '{}'::jsonb, 'Fictional anon');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous RPC allowed'; end if;
end $$;
reset role;
rollback;
select 'passed' as account_rls_and_cas_checks,
  (select count(*) from auth.users) as remaining_accounts,
  (select count(*) from public.account_sync_snapshots) as remaining_snapshots;
