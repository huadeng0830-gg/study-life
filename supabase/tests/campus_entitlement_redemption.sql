-- 三两豆兑换闭环。全部夹具为虚构数据，整个事务结束回滚。
begin;
select set_config('bean_test.actor', gen_random_uuid()::text, true);
select set_config('bean_test.other', gen_random_uuid()::text, true);
insert into auth.users(id,email,email_confirmed_at)
  select current_setting('bean_test.'||k)::uuid, 'fictional-beans-'||current_setting('bean_test.'||k)||'@example.invalid', now()
  from unnest(array['actor','other']) k;

set local role service_role;
do $$
declare
  actor uuid := current_setting('bean_test.actor')::uuid;
  other uuid := current_setting('bean_test.other')::uuid;
  result jsonb;
  balance integer;
  ledger_count integer;
  owned_count integer;
  denied boolean := false;
begin
  -- 目录必须来自迁移里的播种：没有上架权益时兑换入口根本不该出现。
  if not exists(select 1 from public.campus_entitlements where enabled) then
    raise exception 'no enabled entitlement was seeded';
  end if;

  -- 余额不足必须被拒绝，且不能留下任何流水或归属。
  insert into public.campus_bean_wallets(user_id,contribution_balance) values(actor,5)
    on conflict(user_id) do update set contribution_balance = 5;
  begin
    perform public.campus_bean_redeem(actor,'badge_contributor','insufficient-key-0001');
    raise exception 'redeeming with an insufficient balance was accepted';
  exception when others then
    if position('CAMPUS_BEAN_INSUFFICIENT' in sqlerrm) = 0 then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'insufficient balance did not raise'; end if;
  if exists(select 1 from public.campus_bean_ledger l where l.user_id = actor and l.entry_type = 'redemption') then
    raise exception 'a rejected redemption still wrote a ledger row';
  end if;

  -- 正常兑换：扣豆、写流水、写归属，三者必须一致。
  update public.campus_bean_wallets set contribution_balance = 100 where user_id = actor;
  result := public.campus_bean_redeem(actor,'badge_contributor','redeem-key-0001');
  if (result->>'duplicate')::boolean then raise exception 'first redemption was reported as duplicate'; end if;
  select contribution_balance into balance from public.campus_bean_wallets where user_id = actor;
  if balance <> 70 then raise exception 'wallet balance after redemption should be 70, got %', balance; end if;
  if (result->>'contribution')::integer <> 70 then raise exception 'rpc returned the wrong balance: %', result; end if;
  select count(*) into ledger_count from public.campus_bean_ledger
    where user_id = actor and entry_type = 'redemption';
  if ledger_count <> 1 then raise exception 'expected exactly one redemption ledger row, got %', ledger_count; end if;
  if not exists(
    select 1 from public.campus_bean_ledger l
    join public.campus_entitlement_redemptions r on r.ledger_id = l.id
    where l.user_id = actor and l.balance_after = 70 and r.price = 30
  ) then raise exception 'ledger balance_after and redemption price disagree'; end if;

  -- 幂等：同一个键重放不能重复扣豆。
  result := public.campus_bean_redeem(actor,'badge_contributor','redeem-key-0001');
  if not (result->>'duplicate')::boolean then raise exception 'replayed redemption was not reported as duplicate'; end if;
  select contribution_balance into balance from public.campus_bean_wallets where user_id = actor;
  if balance <> 70 then raise exception 'replaying a redemption charged twice: %', balance; end if;
  select count(*) into ledger_count from public.campus_bean_ledger
    where user_id = actor and entry_type = 'redemption';
  if ledger_count <> 1 then raise exception 'replay wrote a second ledger row'; end if;

  -- 同一个幂等键不能把别人的兑换或本账号另一种权益误报成成功。
  denied := false;
  begin
    perform public.campus_bean_redeem(other,'badge_contributor','redeem-key-0001');
    raise exception 'another account reused an existing redemption key';
  exception when others then
    if position('CAMPUS_BEAN_IDEMPOTENCY_CONFLICT' in sqlerrm) = 0 then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'cross-account idempotency reuse did not raise'; end if;
  denied := false;
  begin
    perform public.campus_bean_redeem(actor,'badge_review_helper','redeem-key-0001');
    raise exception 'a different entitlement reused an existing redemption key';
  exception when others then
    if position('CAMPUS_BEAN_IDEMPOTENCY_CONFLICT' in sqlerrm) = 0 then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'cross-entitlement idempotency reuse did not raise'; end if;

  -- 另一条权益仍然可以兑换：幂等键只锁住它自己那一笔。
  result := public.campus_bean_redeem(actor,'badge_review_helper','redeem-key-0002');
  select contribution_balance into balance from public.campus_bean_wallets where user_id = actor;
  if balance <> 10 then raise exception 'second redemption left the wrong balance: %', balance; end if;

  -- 「我的权益」只包含未过期、未使用的归属；别人看不到我的。
  result := public.campus_bean_entitlements(actor);
  owned_count := jsonb_array_length(result->'owned');
  if owned_count <> 2 then raise exception 'expected 2 owned entitlements, got %', owned_count; end if;
  if jsonb_array_length(result->'catalog') < 2 then raise exception 'catalog lost its seeded rows'; end if;
  result := public.campus_bean_entitlements(other);
  if jsonb_array_length(result->'owned') <> 0 then raise exception 'another account saw these entitlements'; end if;

  -- 下架之后不能再兑换，但已经换到手的归属不受影响。
  update public.campus_entitlements set enabled = false where code = 'badge_contributor';
  denied := false;
  begin
    perform public.campus_bean_redeem(other,'badge_contributor','redeem-key-0003');
  exception when others then
    if position('CAMPUS_BEAN_DISABLED' in sqlerrm) = 0 then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'a disabled entitlement was still redeemable'; end if;
  update public.campus_entitlements set enabled = true where code = 'badge_contributor';
  if not exists(select 1 from public.campus_entitlement_redemptions where user_id = actor and entitlement_code = 'badge_contributor') then
    raise exception 'disabling the catalog erased an existing entitlement';
  end if;

  -- 库存为 0 时拒绝兑换。
  insert into public.campus_entitlements(code,title,bean_type,price,enabled,sort_order,stock)
    values('test_out_of_stock','虚构限量权益','contribution',5,true,900,0);
  denied := false;
  begin
    perform public.campus_bean_redeem(other,'test_out_of_stock','redeem-key-0004');
  exception when others then
    if position('CAMPUS_BEAN_OUT_OF_STOCK' in sqlerrm) = 0 then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'an out-of-stock entitlement was redeemable'; end if;

  -- 幂等键必须够长：太短的键会让重试保护形同虚设。
  denied := false;
  begin
    perform public.campus_bean_redeem(other,'badge_contributor','short');
  exception when others then
    if position('CAMPUS_BEAN_IDEMPOTENCY_INVALID' in sqlerrm) = 0 then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'a short idempotency key was accepted'; end if;
end $$;

-- 客户端不能直读这两张表。
reset role;
set local role authenticated;
do $$
declare denied boolean := false;
begin
  begin perform count(*) from public.campus_entitlements;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'authenticated users can read the entitlement catalog'; end if;
  denied := false;
  begin perform count(*) from public.campus_entitlement_redemptions;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'authenticated users can read entitlement ownership'; end if;
end $$;

reset role;
set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform count(*) from public.campus_entitlements;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'anonymous users can read the entitlement catalog'; end if;
end $$;

rollback;
select 'passed' as campus_entitlement_checks,
  (select count(*) from public.campus_entitlements) as remaining_entitlements,
  (select count(*) from public.campus_entitlement_redemptions) as remaining_redemptions;
