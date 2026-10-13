-- Platform administration is intentionally separate from each user's personal data.
-- These tables are accessible only to the trusted Edge Function service role.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null default 'owner' check (role = 'owner'),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index platform_admins_single_owner
  on public.platform_admins (role)
  where role = 'owner';

alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_admins to service_role;

create table public.platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('user.suspend', 'user.restore')),
  outcome text not null default 'started' check (outcome in ('started', 'succeeded', 'failed')),
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index platform_admin_audit_created_at_idx
  on public.platform_admin_audit (created_at desc);

alter table public.platform_admin_audit enable row level security;
revoke all on table public.platform_admin_audit from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_admin_audit to service_role;
