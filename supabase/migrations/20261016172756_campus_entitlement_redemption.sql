-- 三两豆的「支出」侧：权益目录 + 兑换闭环。
--
-- 【为什么需要这个迁移】
-- `campus_bean_ledger.entry_type` 早就允许 `'redemption'`（以及 `'purchase'`、
-- `'manual_adjustment'`），`campus_bean_wallet` 也预留了 `entitlementRedemptionEnabled`
-- 字段，但全仓**没有任何写入方** —— 贡献豆只涨不减，用户拿到豆之后没有任何用处。
-- 这就是「三两豆没有闭环、只有一个界面」的技术原因：账本、债务、幂等键都已就绪，
-- 缺的是「权益目录 + 扣豆入账 + 归属记录」这一段。
--
-- 【本迁移做什么】只补「贡献豆兑换数字权益」（徽章/称号一类零成本权益）：
--   1. `campus_entitlements`            权益目录（价格、库存、有效期、上下架、排序）
--   2. `campus_entitlement_redemptions` 兑换归属与使用记录
--   3. `campus_bean_redeem(...)`         兑换：锁钱包 + 校验余额 + 幂等 + 写流水
--   4. `campus_bean_entitlements(...)`   目录与「我的权益」，一次请求取全
--   5. 重建 `campus_bean_wallet(...)`：兑换开关改为由目录驱动，不再写死 false
--
-- 【不做什么】不涉及支付与充值（`purchase` 仍无写入方，`rechargeEnabled` 仍为 false）、
-- 不提现、不转赠；权益不设有效期的用 null 表示长期有效。
--
-- 【安全边界】与既有校园表一致：RLS 开启且不给 anon/authenticated 任何策略，
-- 只授 service_role；所有读写都经 Edge Function，客户端拿不到这两张表。

create table public.campus_entitlements (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{2,39}$'),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  bean_type text not null default 'contribution' check (bean_type in ('purchased','contribution')),
  price integer not null check (price between 1 and 100000),
  enabled boolean not null default false,
  sort_order integer not null default 100 check (sort_order between 0 and 100000),
  -- null 表示长期有效；有值表示兑换后这么多天过期。
  duration_days integer check (duration_days between 1 and 3650),
  -- null 表示不限量。
  stock integer check (stock is null or stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 目录是「上架 + 排序」两次读取，走部分索引，未上架的行不进索引。
create index campus_entitlements_catalog on public.campus_entitlements(sort_order,code) where enabled;

create table public.campus_entitlement_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_code text not null references public.campus_entitlements(code) on delete restrict,
  bean_type text not null check (bean_type in ('purchased','contribution')),
  -- 把成交价抄一份：目录以后改价，历史归属仍反映当时的价格。
  price integer not null check (price between 1 and 100000),
  ledger_id uuid not null references public.campus_bean_ledger(id) on delete restrict,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index campus_entitlement_redemptions_user on public.campus_entitlement_redemptions(user_id,created_at desc,id desc);
create index campus_entitlement_redemptions_active on public.campus_entitlement_redemptions(user_id,entitlement_code) where consumed_at is null;

alter table public.campus_entitlements enable row level security;
alter table public.campus_entitlement_redemptions enable row level security;
revoke all on public.campus_entitlements from public,anon,authenticated;
revoke all on public.campus_entitlement_redemptions from public,anon,authenticated;

-- 兑换开关由目录驱动：有上架权益时才让界面显示入口，而不是写死 false。
create or replace function public.campus_bean_wallet(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_wallet public.campus_bean_wallets; v_enabled boolean;
begin
  if not exists(select 1 from auth.users where id=p_actor and (banned_until is null or banned_until<=now())) then raise exception 'CAMPUS_FORBIDDEN'; end if;
  insert into public.campus_bean_wallets(user_id) values(p_actor) on conflict(user_id) do nothing;
  select * into v_wallet from public.campus_bean_wallets where user_id=p_actor;
  select exists(select 1 from public.campus_entitlements where enabled) into v_enabled;
  return jsonb_build_object('purchased',v_wallet.purchased_balance,'contribution',v_wallet.contribution_balance,
    'contributionDebt',v_wallet.contribution_debt,'rechargeEnabled',false,'entitlementRedemptionEnabled',v_enabled);
end;
$$;
revoke all on function public.campus_bean_wallet(uuid) from public,anon,authenticated;
grant execute on function public.campus_bean_wallet(uuid) to service_role;

/**
 * 目录 + 我的权益。一次请求取全，避免页面为两块内容各发一次请求。
 * 只返回上架权益；已过期或已使用的归属不进「我的权益」。
 */
create function public.campus_bean_entitlements(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_catalog jsonb; v_owned jsonb;
begin
  if p_actor is null then raise exception 'CAMPUS_BEAN_ACTOR_REQUIRED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'code',e.code,'title',e.title,'description',e.description,'beanType',e.bean_type,
      'price',e.price,'stock',e.stock,'durationDays',e.duration_days) order by e.sort_order,e.code),'[]'::jsonb)
    into v_catalog
    from public.campus_entitlements e where e.enabled;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'code',r.entitlement_code,'title',e.title,'beanType',r.bean_type,'price',r.price,
      'expiresAt',r.expires_at,'createdAt',r.created_at) order by r.created_at desc),'[]'::jsonb)
    into v_owned
    from public.campus_entitlement_redemptions r
    join public.campus_entitlements e on e.code = r.entitlement_code
    where r.user_id = p_actor and r.consumed_at is null
      and (r.expires_at is null or r.expires_at > now());
  return jsonb_build_object('catalog',v_catalog,'owned',v_owned);
end;
$$;
revoke all on function public.campus_bean_entitlements(uuid) from public,anon,authenticated;
grant execute on function public.campus_bean_entitlements(uuid) to service_role;

/**
 * 兑换一条权益。
 *
 * 事务内顺序固定为：幂等短路 → 锁目录行 → 锁钱包行 → 校验余额 → 扣豆 → 写流水 → 写归属。
 * 锁的顺序（目录在前、钱包在后）对所有调用者一致，不会和别的写路径形成死锁。
 *
 * 幂等：`p_idempotency_key` 命中已有流水时直接返回原结果，**不重复扣豆**。
 * 这是唯一能防住「请求已入库但响应丢失后用户重试」的机制 —— 没有它，重试就是重复扣费。
 */
create function public.campus_bean_redeem(p_actor uuid, p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.campus_entitlements;
  v_wallet public.campus_bean_wallets;
  v_existing uuid;
  v_balance integer;
  v_ledger_id uuid;
  v_redemption_id uuid;
  v_expires timestamptz;
begin
  if p_actor is null then raise exception 'CAMPUS_BEAN_ACTOR_REQUIRED'; end if;
  if not exists(select 1 from auth.users where id=p_actor and (banned_until is null or banned_until<=now())) then
    raise exception 'CAMPUS_FORBIDDEN';
  end if;
  p_code := btrim(coalesce(p_code,''));
  p_idempotency_key := btrim(coalesce(p_idempotency_key,''));
  if p_code !~ '^[a-z][a-z0-9_]{2,39}$' then raise exception 'CAMPUS_BEAN_CODE_INVALID'; end if;
  if char_length(p_idempotency_key) < 8 or char_length(p_idempotency_key) > 220 then
    raise exception 'CAMPUS_BEAN_IDEMPOTENCY_INVALID';
  end if;

  select l.id into v_existing from public.campus_bean_ledger l
    where l.idempotency_key = p_idempotency_key for update;
  if v_existing is not null then
    if not exists(select 1 from public.campus_bean_ledger l where l.id = v_existing
      and l.user_id = p_actor and l.entry_type = 'redemption'
      and l.metadata->>'entitlement' = p_code) then
      raise exception 'CAMPUS_BEAN_IDEMPOTENCY_CONFLICT';
    end if;
    select r.id, r.expires_at into v_redemption_id, v_expires
      from public.campus_entitlement_redemptions r where r.ledger_id = v_existing;
    select * into v_wallet from public.campus_bean_wallets where user_id = p_actor;
    return jsonb_build_object('ok',true,'duplicate',true,'code',p_code,'redemptionId',v_redemption_id,
      'expiresAt',v_expires,'contribution',coalesce(v_wallet.contribution_balance,0),
      'purchased',coalesce(v_wallet.purchased_balance,0));
  end if;

  select * into v_item from public.campus_entitlements where code = p_code for update;
  if v_item.code is null then raise exception 'CAMPUS_BEAN_CODE_UNKNOWN'; end if;
  if not v_item.enabled then raise exception 'CAMPUS_BEAN_DISABLED'; end if;
  if v_item.stock is not null and v_item.stock <= 0 then raise exception 'CAMPUS_BEAN_OUT_OF_STOCK'; end if;

  insert into public.campus_bean_wallets(user_id) values(p_actor) on conflict(user_id) do nothing;
  select * into v_wallet from public.campus_bean_wallets where user_id = p_actor for update;

  v_balance := case when v_item.bean_type = 'contribution' then v_wallet.contribution_balance else v_wallet.purchased_balance end;
  if v_balance < v_item.price then raise exception 'CAMPUS_BEAN_INSUFFICIENT'; end if;

  if v_item.bean_type = 'contribution' then
    update public.campus_bean_wallets set contribution_balance = contribution_balance - v_item.price, updated_at = now()
      where user_id = p_actor returning contribution_balance into v_balance;
  else
    update public.campus_bean_wallets set purchased_balance = purchased_balance - v_item.price, updated_at = now()
      where user_id = p_actor returning purchased_balance into v_balance;
  end if;

  if v_item.duration_days is null then v_expires := null;
  else v_expires := now() + make_interval(days => v_item.duration_days);
  end if;

  insert into public.campus_bean_ledger(user_id,bean_type,amount,debt_delta,balance_after,debt_after,
    entry_type,reason,idempotency_key,metadata)
    values(p_actor,v_item.bean_type,-v_item.price,0,v_balance,v_wallet.contribution_debt,
      'redemption',left('兑换：' || v_item.title,500),p_idempotency_key,
      jsonb_build_object('entitlement',v_item.code))
    returning id into v_ledger_id;

  insert into public.campus_entitlement_redemptions(user_id,entitlement_code,bean_type,price,ledger_id,expires_at)
    values(p_actor,v_item.code,v_item.bean_type,v_item.price,v_ledger_id,v_expires)
    returning id into v_redemption_id;

  if v_item.stock is not null then
    update public.campus_entitlements set stock = stock - 1, updated_at = now() where code = v_item.code;
  end if;

  return jsonb_build_object('ok',true,'duplicate',false,'code',v_item.code,'title',v_item.title,
    'redemptionId',v_redemption_id,'expiresAt',v_expires,
    'contribution',case when v_item.bean_type = 'contribution' then v_balance else v_wallet.contribution_balance end,
    'purchased',case when v_item.bean_type = 'purchased' then v_balance else v_wallet.purchased_balance end);
end;
$$;
revoke all on function public.campus_bean_redeem(uuid,text,text) from public,anon,authenticated;
grant execute on function public.campus_bean_redeem(uuid,text,text) to service_role;

-- 首批权益刻意只放零成本、可撤销的荣誉类：不需要支付资质，也不会产生履约义务。
-- 价格参照既有产出（每条审核 3 豆、每日最多 20 条），30/60 豆对应约 2–3 天的正常参与。
insert into public.campus_entitlements(code,title,description,bean_type,price,enabled,sort_order,duration_days,stock) values
  ('badge_contributor','贡献者徽章','在三两豆页的「我的权益」中长期展示。','contribution',30,true,10,null,null),
  ('badge_review_helper','热心审核徽章','在三两豆页的「我的权益」中长期展示。','contribution',60,true,20,null,null)
on conflict (code) do nothing;
