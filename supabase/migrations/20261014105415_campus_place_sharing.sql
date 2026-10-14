-- Public school-visible place directory. Private places and visit-level data
-- remain on-device and never enter these tables.
create table public.campus_places (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  campus text not null default '' check (char_length(campus) <= 100),
  area text not null default '' check (char_length(area) <= 80),
  place_hint text not null default '' check (char_length(place_hint) <= 100),
  category text not null check (category in ('food', 'service', 'study', 'transport', 'trade', 'social')),
  rating_template_id text not null check (rating_template_id = category),
  visibility text not null default 'school' check (visibility = 'school'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campus_places_school_name on public.campus_places (school, name, id) where archived_at is null;
create index campus_places_owner_recent on public.campus_places (owner_id, updated_at desc);

create table public.campus_place_ratings (
  place_id uuid not null references public.campus_places(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
  note text not null default '' check (char_length(note) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (place_id, user_id)
);
create index campus_place_ratings_place on public.campus_place_ratings (place_id, created_at);

create table public.campus_place_reports (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.campus_places(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('inaccurate', 'sensitive', 'abuse', 'other')),
  detail text not null default '' check (char_length(detail) <= 50),
  created_at timestamptz not null default now(),
  unique (place_id, reporter_id)
);
create index campus_place_reports_recent on public.campus_place_reports (created_at desc);

-- A friend preset is an explicit, expiring copy of selected public-safe fields.
-- It never carries visit dates, prices, ledger links, offers, or private notes.
create table public.campus_place_invites (
  id uuid primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 30000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  constraint campus_place_invite_distinct_users check (sender_id <> recipient_id)
);
create unique index campus_place_invites_one_pending_pair
  on public.campus_place_invites (sender_id, recipient_id) where status = 'pending';
create index campus_place_invites_recipient_recent
  on public.campus_place_invites (recipient_id, created_at desc) where status = 'pending';
create index campus_place_invites_sender_recent
  on public.campus_place_invites (sender_id, created_at desc) where status = 'pending';

alter table public.campus_places enable row level security;
alter table public.campus_place_ratings enable row level security;
alter table public.campus_place_reports enable row level security;
alter table public.campus_place_invites enable row level security;

revoke all on public.campus_places, public.campus_place_ratings, public.campus_place_reports from public, anon, authenticated;
grant select, insert, update, delete on public.campus_places, public.campus_place_ratings, public.campus_place_reports to service_role;
revoke all on public.campus_place_invites from public, anon, authenticated;
grant select, insert, update, delete on public.campus_place_invites to service_role;

create policy campus_place_invites_service_role on public.campus_place_invites
  for all to service_role using (true) with check (true);

-- The push is visible in the existing social inbox; the payload is fetched only
-- by the named friend and is removed after acceptance, rejection, revocation,
-- or expiry.
alter table public.social_notifications drop constraint if exists social_notifications_kind_check;
alter table public.social_notifications add constraint social_notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'friend_removed', 'invitation', 'invitation_updated',
    'invitation_cancelled', 'invitation_expired', 'place_preset'));

alter table private.social_rate_buckets drop constraint if exists social_rate_buckets_action_check;
alter table private.social_rate_buckets add constraint social_rate_buckets_action_check
  check (action in ('email_search', 'availability_query', 'friend_request', 'invitation', 'campus_place_publish',
    'campus_place_rating', 'campus_place_report', 'campus_place_invite'));

create policy campus_places_service_role on public.campus_places
  for all to service_role using (true) with check (true);
create policy campus_place_ratings_service_role on public.campus_place_ratings
  for all to service_role using (true) with check (true);
create policy campus_place_reports_service_role on public.campus_place_reports
  for all to service_role using (true) with check (true);

-- Reuse the existing private per-user rate buckets through a service-role-only RPC.
create or replace function private.social_take_rate_limit(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 600), 3600));
  v_bucket timestamptz;
  v_hits integer;
begin
  if p_user_id is null or p_action not in ('email_search', 'availability_query', 'friend_request', 'invitation',
    'campus_place_publish', 'campus_place_rating', 'campus_place_report', 'campus_place_invite') then
    return false;
  end if;
  v_bucket := pg_catalog.to_timestamp(
    pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) / v_window) * v_window
  );
  insert into private.social_rate_buckets (user_id, action, bucket_start, hits)
  values (p_user_id, p_action, v_bucket, 1)
  on conflict (user_id, action, bucket_start)
  do update set hits = private.social_rate_buckets.hits + 1
  returning hits into v_hits;
  delete from private.social_rate_buckets
    where user_id = p_user_id and bucket_start < pg_catalog.clock_timestamp() - interval '1 day';
  return v_hits <= greatest(1, coalesce(p_limit, 1));
end;
$$;

create or replace function public.campus_place_rate_limit(p_actor_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or p_action not in ('publish', 'rating', 'report', 'invite') then
    raise exception using message = 'CAMPUS_PLACE_INVALID_ACTION', errcode = '22023';
  end if;
  return private.social_take_rate_limit(p_actor_id, 'campus_place_' || p_action, 30, 600);
end;
$$;
revoke all on function public.campus_place_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.campus_place_rate_limit(uuid, text) to service_role;
