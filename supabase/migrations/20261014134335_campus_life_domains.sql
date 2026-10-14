-- Additive campus-life domains. User supplied content remains private/pending until
-- a platform administrator reviews it; no seed/demo records are inserted here.

alter table public.social_profiles
  add column if not exists campus text not null default ''
    check (char_length(campus) <= 100);

-- Preserve existing place rate-limit buckets while adding the new campus actions.
alter table private.social_rate_buckets drop constraint if exists social_rate_buckets_action_check;
alter table private.social_rate_buckets add constraint social_rate_buckets_action_check
  check (action in ('email_search', 'availability_query', 'friend_request', 'invitation',
    'campus_place_publish', 'campus_place_rating', 'campus_place_report', 'campus_place_invite',
    'campus_publish', 'campus_contact', 'campus_review', 'campus_report', 'campus_favorite'));

create or replace function private.social_take_rate_limit(
  p_user_id uuid, p_action text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 600), 3600));
  v_bucket timestamptz;
  v_hits integer;
begin
  if p_user_id is null or p_action not in ('email_search', 'availability_query', 'friend_request', 'invitation',
      'campus_place_publish', 'campus_place_rating', 'campus_place_report', 'campus_place_invite',
      'campus_publish', 'campus_contact', 'campus_review', 'campus_report', 'campus_favorite') then
    return false;
  end if;
  v_bucket := pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) / v_window) * v_window);
  insert into private.social_rate_buckets (user_id, action, bucket_start, hits)
  values (p_user_id, p_action, v_bucket, 1)
  on conflict (user_id, action, bucket_start)
  do update set hits = private.social_rate_buckets.hits + 1
  returning hits into v_hits;
  delete from private.social_rate_buckets where user_id = p_user_id
    and bucket_start < pg_catalog.clock_timestamp() - interval '1 day';
  return v_hits <= greatest(1, coalesce(p_limit, 1));
end;
$$;

create or replace function public.campus_life_take_rate_limit(
  p_user_id uuid, p_action text, p_limit integer, p_window_seconds integer
) returns boolean
language sql security definer set search_path = ''
as $$ select private.social_take_rate_limit(p_user_id, p_action, p_limit, p_window_seconds) $$;
revoke all on function public.campus_life_take_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.campus_life_take_rate_limit(uuid, text, integer, integer) to service_role;

create table public.campus_teachers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  department text not null default '' check (char_length(department) <= 120),
  research_directions text not null default '' check (char_length(research_directions) <= 1000),
  official_intro text not null default '' check (char_length(official_intro) <= 3000),
  source_url text not null check (char_length(source_url) between 1 and 500),
  review_status text not null default 'pending_review' check (review_status in ('pending_review', 'approved', 'rejected')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campus_teachers_public on public.campus_teachers (school, campus, name)
  where review_status = 'approved';
create index campus_teachers_owner on public.campus_teachers (owner_id, updated_at desc);

create table public.campus_courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  department text not null default '' check (char_length(department) <= 120),
  description text not null default '' check (char_length(description) <= 3000),
  source_url text not null default '' check (char_length(source_url) <= 500),
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'rejected')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campus_courses_public on public.campus_courses (school, campus, updated_at desc)
  where review_status = 'approved';
create index campus_courses_owner on public.campus_courses (owner_id, updated_at desc);

create table public.campus_teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.campus_courses(id) on delete cascade,
  teacher_id uuid not null references public.campus_teachers(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  term text not null check (char_length(btrim(term)) between 1 and 40),
  source_url text not null default '' check (char_length(source_url) <= 500),
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'rejected')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, teacher_id, term)
);
create index campus_teaching_assignments_public on public.campus_teaching_assignments (school, campus, term)
  where review_status = 'approved';
create index campus_teaching_assignments_owner on public.campus_teaching_assignments (owner_id, updated_at desc);

create table public.campus_course_reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campus_teaching_assignments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  clarity smallint check (clarity between 1 and 5),
  organization smallint check (organization between 1 and 5),
  learning smallint check (learning between 1 and 5),
  workload smallint check (workload between 1 and 5),
  assessment smallint check (assessment between 1 and 5),
  note text not null default '' check (char_length(note) <= 1500),
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'rejected')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, user_id),
  check (clarity is not null or organization is not null or learning is not null
    or workload is not null or assessment is not null or char_length(note) > 0)
);
create index campus_course_reviews_public on public.campus_course_reviews (assignment_id, created_at desc)
  where review_status = 'approved';

create table public.campus_market_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  listing_type text not null check (listing_type in ('sale', 'wanted', 'free')),
  category text not null check (category in ('textbook', 'electronics', 'living', 'sports', 'dorm', 'clothing', 'instrument', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 3000),
  condition text not null default '' check (char_length(condition) <= 80),
  price_cents integer check (price_cents between 0 and 100000000),
  meetup_area text not null default '' check (char_length(meetup_area) <= 120),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'active', 'reserved', 'sold', 'withdrawn', 'rejected')),
  reserved_by uuid references auth.users(id) on delete set null,
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((listing_type = 'free' and (price_cents is null or price_cents = 0))
    or listing_type <> 'free')
);
create index campus_market_public on public.campus_market_listings (school, campus, updated_at desc)
  where status in ('active', 'reserved');
create index campus_market_owner on public.campus_market_listings (owner_id, updated_at desc);

create table public.campus_market_interests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.campus_market_listings(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, buyer_id)
);
create index campus_market_interests_listing on public.campus_market_interests (listing_id, created_at);
create index campus_market_interests_buyer on public.campus_market_interests (buyer_id, created_at desc);

create table public.campus_help_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  assignee_id uuid references auth.users(id) on delete set null,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  task_type text not null check (task_type in ('parcel', 'delivery', 'errand', 'temporary_help', 'moving', 'daily_task', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 2000),
  pickup_area text not null default '' check (char_length(pickup_area) <= 100),
  delivery_area text not null default '' check (char_length(delivery_area) <= 100),
  deadline timestamptz,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'open', 'assigned', 'in_progress', 'awaiting_confirmation', 'completed', 'cancelled', 'disputed', 'rejected', 'expired')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_id <> assignee_id)
);
create index campus_help_public on public.campus_help_tasks (school, campus, created_at desc)
  where status = 'open';
create index campus_help_owner on public.campus_help_tasks (owner_id, updated_at desc);
create index campus_help_assignee on public.campus_help_tasks (assignee_id, updated_at desc)
  where assignee_id is not null;

create table public.campus_help_applications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.campus_help_tasks(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, applicant_id)
);
create index campus_help_applications_task on public.campus_help_applications (task_id, created_at);
create index campus_help_applications_applicant on public.campus_help_applications (applicant_id, created_at desc);

create table public.campus_help_disputes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.campus_help_tasks(id) on delete cascade,
  opened_by uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 1500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution text not null default '' check (char_length(resolution) <= 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campus_help_disputes_queue on public.campus_help_disputes (created_at)
  where status = 'open';

create table public.campus_shuttle_routes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  source_url text not null default '' check (char_length(source_url) <= 500),
  effective_from date,
  effective_to date,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'retired')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index campus_shuttle_public on public.campus_shuttle_routes (school, campus, updated_at desc)
  where status = 'approved';

create table public.campus_shuttle_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.campus_shuttle_routes(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  position smallint not null check (position between 1 and 60),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  unique (route_id, direction, position)
);
create index campus_shuttle_stops_route on public.campus_shuttle_stops (route_id, direction, position);

create table public.campus_shuttle_departures (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.campus_shuttle_routes(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  service_day text not null check (service_day in ('weekday', 'weekend', 'holiday')),
  departure_time time not null,
  stop_name text not null default '' check (char_length(stop_name) <= 100),
  unique (route_id, direction, service_day, departure_time, stop_name)
);
create index campus_shuttle_departures_route on public.campus_shuttle_departures (route_id, direction, service_day, departure_time);

create table public.campus_shuttle_exceptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  route_id uuid not null references public.campus_shuttle_routes(id) on delete cascade,
  service_date date not null,
  exception_type text not null check (exception_type in ('suspended', 'additional', 'changed')),
  departure_time time,
  direction text not null check (direction in ('outbound', 'inbound')),
  note text not null default '' check (char_length(note) <= 300),
  source_url text not null default '' check (char_length(source_url) <= 500),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index campus_shuttle_exceptions_route on public.campus_shuttle_exceptions (route_id, service_date);

create table public.campus_shuttle_corrections (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.campus_shuttle_routes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  detail text not null check (char_length(btrim(detail)) between 1 and 1500),
  source_url text not null default '' check (char_length(source_url) <= 500),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index campus_shuttle_corrections_queue on public.campus_shuttle_corrections (created_at)
  where status = 'pending_review';

create table public.campus_lost_found_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  mode text not null check (mode in ('lost', 'found')),
  category text not null check (category in ('electronics', 'card', 'keys', 'documents', 'clothing', 'bag', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1500),
  approximate_location text not null default '' check (char_length(approximate_location) <= 120),
  occurred_at date,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'open', 'claim_pending', 'returned', 'closed', 'rejected')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campus_lost_found_public on public.campus_lost_found_items (school, campus, created_at desc)
  where status in ('open', 'claim_pending');
create index campus_lost_found_owner on public.campus_lost_found_items (owner_id, updated_at desc);

create table public.campus_lost_found_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.campus_lost_found_items(id) on delete cascade,
  claimant_id uuid not null references auth.users(id) on delete cascade,
  private_evidence text not null check (char_length(btrim(private_evidence)) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, claimant_id)
);
create index campus_lost_found_claims_item on public.campus_lost_found_claims (item_id, created_at);
create index campus_lost_found_claims_user on public.campus_lost_found_claims (claimant_id, created_at desc);

create table public.campus_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '' check (char_length(location) <= 160),
  organizer text not null default '' check (char_length(organizer) <= 120),
  signup_url text not null default '' check (char_length(signup_url) <= 500),
  capacity integer check (capacity between 1 and 100000),
  source_url text not null default '' check (char_length(source_url) <= 500),
  review_status text not null default 'pending_review' check (review_status in ('pending_review', 'approved', 'rejected')),
  status text not null default 'published' check (status in ('published', 'cancelled', 'ended')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index campus_events_public on public.campus_events (school, campus, starts_at)
  where review_status = 'approved' and status = 'published';
create index campus_events_owner on public.campus_events (owner_id, updated_at desc);

create table public.campus_event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.campus_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index campus_event_registrations_event on public.campus_event_registrations (event_id, status);
create index campus_event_registrations_user on public.campus_event_registrations (user_id, created_at desc);

create table public.campus_guides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  category text not null check (category in ('new_student', 'administration', 'dormitory', 'food', 'printing', 'transport', 'facilities', 'exam', 'graduation', 'safety', 'other')),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  source_type text not null check (source_type in ('official_public', 'student_experience', 'merchant_submission')),
  source_url text not null default '' check (char_length(source_url) <= 500),
  expires_on date,
  review_status text not null default 'pending_review' check (review_status in ('pending_review', 'approved', 'rejected', 'needs_review')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campus_guides_public on public.campus_guides (school, campus, category, updated_at desc)
  where review_status = 'approved';
create index campus_guides_owner on public.campus_guides (owner_id, updated_at desc);

create table public.campus_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  target_type text not null check (target_type in ('place', 'teacher', 'course', 'market_listing', 'help_task', 'shuttle_route', 'lost_found', 'event', 'guide')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index campus_favorites_school_recent on public.campus_favorites (school, created_at desc);

create table public.campus_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  target_type text not null check (target_type in ('place', 'teacher', 'course', 'course_review', 'market_listing', 'help_task', 'shuttle_route', 'lost_found', 'event', 'guide')),
  target_id uuid not null,
  reason text not null check (reason in ('inaccurate', 'privacy', 'abuse', 'prohibited', 'other')),
  detail text not null default '' check (char_length(detail) <= 1000),
  status text not null default 'pending_review' check (status in ('pending_review', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index campus_content_reports_queue on public.campus_content_reports (created_at)
  where status = 'pending_review';

create table public.campus_moderation_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  school text not null default '' check (char_length(school) <= 100),
  target_type text not null,
  target_id uuid not null,
  from_status text not null,
  to_status text not null,
  reason text not null default '' check (char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index campus_moderation_events_target on public.campus_moderation_events (target_type, target_id, created_at desc);

create table public.campus_private_messages (
  id uuid primary key default gen_random_uuid(),
  school text not null check (char_length(btrim(school)) between 1 and 100),
  target_type text not null check (target_type in ('market_listing', 'help_task', 'lost_found')),
  target_id uuid not null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index campus_private_messages_thread on public.campus_private_messages
  (school, target_type, target_id, created_at);
create index campus_private_messages_recipient on public.campus_private_messages
  (recipient_id, created_at desc) where read_at is null;

alter table public.campus_shuttle_exceptions
  add column if not exists revision integer not null default 1 check (revision > 0),
  add column if not exists review_reason text not null default '' check (char_length(review_reason) <= 500);
alter table public.campus_shuttle_corrections
  add column if not exists revision integer not null default 1 check (revision > 0),
  add column if not exists review_reason text not null default '' check (char_length(review_reason) <= 500);
alter table public.campus_events add column if not exists revision integer not null default 1 check (revision > 0);
alter table public.campus_guides add column if not exists revision integer not null default 1 check (revision > 0);
alter table public.campus_lost_found_items add column if not exists revision integer not null default 1 check (revision > 0);
alter table public.social_notifications add column if not exists dedupe_key text;
create unique index if not exists social_notifications_dedupe_key on public.social_notifications (dedupe_key);

create or replace function public.campus_life_resubmit_content(
  p_actor_id uuid, p_target_type text, p_target_id uuid, p_expected_revision integer, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_revision integer;
  v_school text;
  v_campus text;
  v_route public.campus_shuttle_routes%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 1 or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'CAMPUS_RESUBMIT_INVALID';
  end if;
  case p_target_type
    when 'teacher' then
      update public.campus_teachers set name = p_payload->>'name', department = coalesce(p_payload->>'department', ''),
        research_directions = coalesce(p_payload->>'research_directions', ''), official_intro = coalesce(p_payload->>'official_intro', ''),
        source_url = coalesce(p_payload->>'source_url', ''), review_status = 'pending_review', review_reason = '',
        revision = revision + 1, updated_at = now()
      where id = p_target_id and owner_id = p_actor_id and review_status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'course' then
      update public.campus_courses set name = p_payload->>'name', department = coalesce(p_payload->>'department', ''),
        description = coalesce(p_payload->>'description', ''), source_url = coalesce(p_payload->>'source_url', ''),
        review_status = 'pending_review', review_reason = '', revision = revision + 1, updated_at = now()
      where id = p_target_id and owner_id = p_actor_id and review_status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'assignment' then
      select school, campus into v_school, v_campus from public.campus_teaching_assignments
      where id = p_target_id and owner_id = p_actor_id and review_status = 'rejected' and revision = p_expected_revision for update;
      if not found then raise exception 'CAMPUS_RESUBMIT_CONFLICT'; end if;
      if not exists (
        select 1 from public.campus_courses c join public.campus_teachers t on t.id = (p_payload->>'teacher_id')::uuid
        where c.id = (p_payload->>'course_id')::uuid and c.school = v_school and c.campus = v_campus
          and t.school = v_school and t.campus = v_campus and c.review_status = 'approved' and t.review_status = 'approved'
      ) then raise exception 'CAMPUS_RESUBMIT_RELATION_INVALID'; end if;
      update public.campus_teaching_assignments set course_id = (p_payload->>'course_id')::uuid,
        teacher_id = (p_payload->>'teacher_id')::uuid, term = p_payload->>'term', source_url = coalesce(p_payload->>'source_url', ''),
        review_status = 'pending_review', review_reason = '', revision = revision + 1, updated_at = now()
      where id = p_target_id and owner_id = p_actor_id and review_status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'market_listing' then
      update public.campus_market_listings set listing_type = p_payload->>'listing_type', category = p_payload->>'category',
        title = p_payload->>'title', description = coalesce(p_payload->>'description', ''), condition = coalesce(p_payload->>'condition', ''),
        price_cents = nullif(p_payload->>'price_cents', '')::integer, meetup_area = coalesce(p_payload->>'meetup_area', ''),
        status = 'pending_review', review_reason = '', revision = revision + 1, updated_at = now()
      where id = p_target_id and owner_id = p_actor_id and status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'help_task' then
      update public.campus_help_tasks set task_type = p_payload->>'task_type', title = p_payload->>'title',
        description = coalesce(p_payload->>'description', ''), pickup_area = coalesce(p_payload->>'pickup_area', ''),
        delivery_area = coalesce(p_payload->>'delivery_area', ''), deadline = nullif(p_payload->>'deadline', '')::timestamptz,
        status = 'pending_review', review_reason = '', revision = revision + 1, updated_at = now()
      where id = p_target_id and owner_id = p_actor_id and status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'shuttle_route' then
      select * into v_route from public.campus_shuttle_routes
      where id = p_target_id and owner_id = p_actor_id and status = 'rejected' and revision = p_expected_revision for update;
      if not found then raise exception 'CAMPUS_RESUBMIT_CONFLICT'; end if;
      update public.campus_shuttle_routes set name = p_payload->>'name', source_url = coalesce(p_payload->>'source_url', ''),
        effective_from = nullif(p_payload->>'effective_from', '')::date, effective_to = nullif(p_payload->>'effective_to', '')::date,
        status = 'pending_review', review_reason = '', revision = revision + 1, updated_at = now()
      where id = p_target_id returning id, revision into v_id, v_revision;
      delete from public.campus_shuttle_stops where route_id = p_target_id;
      delete from public.campus_shuttle_departures where route_id = p_target_id;
      insert into public.campus_shuttle_stops(route_id, direction, position, name)
        select p_target_id, item.direction, item.position, item.name
        from jsonb_to_recordset(coalesce(p_payload->'stops', '[]'::jsonb)) as item(direction text, position smallint, name text);
      insert into public.campus_shuttle_departures(route_id, direction, service_day, departure_time, stop_name)
        select p_target_id, item.direction, item.service_day, item.departure_time, coalesce(item.stop_name, '')
        from jsonb_to_recordset(coalesce(p_payload->'departures', '[]'::jsonb)) as item(direction text, service_day text, departure_time time, stop_name text);
    when 'shuttle_correction' then
      update public.campus_shuttle_corrections set route_id = (p_payload->>'route_id')::uuid,
        detail = p_payload->>'detail', source_url = coalesce(p_payload->>'source_url', ''), status = 'pending_review',
        review_reason = '', revision = revision + 1
      where id = p_target_id and owner_id = p_actor_id and status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'shuttle_exception' then
      update public.campus_shuttle_exceptions set route_id = (p_payload->>'route_id')::uuid,
        service_date = (p_payload->>'service_date')::date, exception_type = p_payload->>'exception_type',
        departure_time = nullif(p_payload->>'departure_time', '')::time, direction = p_payload->>'direction',
        note = coalesce(p_payload->>'note', ''), source_url = coalesce(p_payload->>'source_url', ''), status = 'pending_review',
        review_reason = '', revision = revision + 1
      where id = p_target_id and owner_id = p_actor_id and status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'lost_found' then
      update public.campus_lost_found_items set mode = p_payload->>'mode', category = p_payload->>'category', title = p_payload->>'title',
        description = coalesce(p_payload->>'description', ''), approximate_location = coalesce(p_payload->>'approximate_location', ''),
        occurred_at = nullif(p_payload->>'occurred_at', '')::date, status = 'pending_review', review_reason = '',
        revision = revision + 1, updated_at = now()
      where id = p_target_id and owner_id = p_actor_id and status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'event' then
      update public.campus_events set title = p_payload->>'title', description = coalesce(p_payload->>'description', ''),
        starts_at = (p_payload->>'starts_at')::timestamptz, ends_at = (p_payload->>'ends_at')::timestamptz,
        location = coalesce(p_payload->>'location', ''), organizer = coalesce(p_payload->>'organizer', ''),
        signup_url = coalesce(p_payload->>'signup_url', ''), source_url = coalesce(p_payload->>'source_url', ''),
        capacity = nullif(p_payload->>'capacity', '')::integer, review_status = 'pending_review', review_reason = '',
        revision = revision + 1, updated_at = now()
      where id = p_target_id and owner_id = p_actor_id and review_status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    when 'guide' then
      update public.campus_guides set title = p_payload->>'title', category = p_payload->>'category',
        body = p_payload->>'body', source_type = p_payload->>'source_type', source_url = coalesce(p_payload->>'source_url', ''),
        expires_on = nullif(p_payload->>'expires_on', '')::date, review_status = 'pending_review', review_reason = '',
        revision = revision + 1, updated_at = now()
      where id = p_target_id and owner_id = p_actor_id and review_status = 'rejected' and revision = p_expected_revision
      returning id, revision into v_id, v_revision;
    else
      raise exception 'CAMPUS_RESUBMIT_INVALID';
  end case;
  if v_id is null then raise exception 'CAMPUS_RESUBMIT_CONFLICT'; end if;
  return jsonb_build_object('id', v_id, 'revision', v_revision, 'status', 'pending_review');
end;
$$;

-- Reserve a listing for exactly one accepted campus buyer; stale or competing
-- requests cannot move it after the first successful conditional update.
create or replace function public.campus_life_reserve_listing(
  p_actor_id uuid, p_listing_id uuid, p_interest_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_listing public.campus_market_listings%rowtype; v_interest public.campus_market_interests%rowtype;
begin
  select * into v_listing from public.campus_market_listings where id = p_listing_id for update;
  if not found or v_listing.owner_id <> p_actor_id or v_listing.status <> 'active' then
    raise exception 'CAMPUS_LISTING_STATE_CHANGED';
  end if;
  select * into v_interest from public.campus_market_interests
    where id = p_interest_id and listing_id = p_listing_id and status = 'pending' for update;
  if not found then raise exception 'CAMPUS_INTEREST_NOT_FOUND'; end if;
  update public.campus_market_listings set status = 'reserved', reserved_by = v_interest.buyer_id,
    revision = revision + 1, updated_at = now() where id = p_listing_id;
  update public.campus_market_interests set status = case when id = p_interest_id then 'accepted' else 'closed' end,
    updated_at = now() where listing_id = p_listing_id and status = 'pending';
  return jsonb_build_object('listingId', p_listing_id, 'buyerId', v_interest.buyer_id, 'status', 'reserved');
end;
$$;

-- Assign an open task after locking both the task and application rows.
create or replace function public.campus_life_accept_help_application(
  p_actor_id uuid, p_task_id uuid, p_application_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_task public.campus_help_tasks%rowtype; v_application public.campus_help_applications%rowtype;
begin
  select * into v_task from public.campus_help_tasks where id = p_task_id for update;
  if not found or v_task.owner_id <> p_actor_id or v_task.status <> 'open' then
    raise exception 'CAMPUS_HELP_STATE_CHANGED';
  end if;
  select * into v_application from public.campus_help_applications
    where id = p_application_id and task_id = p_task_id and status = 'pending' for update;
  if not found then raise exception 'CAMPUS_HELP_APPLICATION_NOT_FOUND'; end if;
  update public.campus_help_tasks set assignee_id = v_application.applicant_id,
    status = 'assigned', revision = revision + 1, updated_at = now() where id = p_task_id;
  update public.campus_help_applications set status = case when id = p_application_id then 'accepted' else 'closed' end,
    updated_at = now() where task_id = p_task_id and status = 'pending';
  return jsonb_build_object('taskId', p_task_id, 'assigneeId', v_application.applicant_id, 'status', 'assigned');
end;
$$;

-- Serialize new contact/applications with reserve/accept transitions by locking
-- the parent record before inserting or refreshing the related request.
create or replace function public.campus_life_create_market_interest(
  p_actor_id uuid, p_listing_id uuid, p_message text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_listing public.campus_market_listings%rowtype; v_interest public.campus_market_interests%rowtype;
begin
  select * into v_listing from public.campus_market_listings where id = p_listing_id for update;
  if not found or v_listing.status <> 'active' then raise exception 'CAMPUS_LISTING_STATE_CHANGED'; end if;
  if v_listing.owner_id = p_actor_id then raise exception 'CAMPUS_LISTING_SELF_CONTACT'; end if;
  insert into public.campus_market_interests(listing_id, buyer_id, message, status, updated_at)
    values (p_listing_id, p_actor_id, p_message, 'pending', now())
    on conflict (listing_id, buyer_id) do update
      set message = excluded.message, status = 'pending', updated_at = now()
    returning * into v_interest;
  return jsonb_build_object('id', v_interest.id, 'status', v_interest.status, 'ownerId', v_listing.owner_id);
end;
$$;

create or replace function public.campus_life_create_help_application(
  p_actor_id uuid, p_task_id uuid, p_message text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_task public.campus_help_tasks%rowtype; v_application public.campus_help_applications%rowtype;
begin
  select * into v_task from public.campus_help_tasks where id = p_task_id for update;
  if not found or v_task.status <> 'open' then raise exception 'CAMPUS_HELP_STATE_CHANGED'; end if;
  if v_task.owner_id = p_actor_id then raise exception 'CAMPUS_HELP_SELF_APPLICATION'; end if;
  insert into public.campus_help_applications(task_id, applicant_id, message, status, updated_at)
    values (p_task_id, p_actor_id, p_message, 'pending', now())
    on conflict (task_id, applicant_id) do update
      set message = excluded.message, status = 'pending', updated_at = now()
    returning * into v_application;
  return jsonb_build_object('id', v_application.id, 'status', v_application.status, 'ownerId', v_task.owner_id);
end;
$$;

create or replace function public.campus_life_create_lost_found_claim(
  p_actor_id uuid, p_item_id uuid, p_private_evidence text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_item public.campus_lost_found_items%rowtype; v_claim public.campus_lost_found_claims%rowtype;
begin
  select * into v_item from public.campus_lost_found_items where id = p_item_id for update;
  if not found or v_item.status not in ('open', 'claim_pending') then raise exception 'CAMPUS_CLAIM_STATE_CHANGED'; end if;
  if v_item.owner_id = p_actor_id then raise exception 'CAMPUS_CLAIM_SELF_APPLICATION'; end if;
  insert into public.campus_lost_found_claims(item_id, claimant_id, private_evidence, status, updated_at)
    values (p_item_id, p_actor_id, p_private_evidence, 'pending', now())
    on conflict (item_id, claimant_id) do update
      set private_evidence = excluded.private_evidence, status = 'pending', updated_at = now()
    returning * into v_claim;
  update public.campus_lost_found_items set status = 'claim_pending', updated_at = now() where id = p_item_id;
  return jsonb_build_object('id', v_claim.id, 'status', v_claim.status, 'ownerId', v_item.owner_id);
end;
$$;

-- A review edit creates a new revision so moderation can compare the exact
-- content version that was displayed in the queue.
create or replace function public.campus_life_submit_course_review(
  p_actor_id uuid, p_assignment_id uuid, p_school text,
  p_clarity smallint, p_organization smallint, p_learning smallint,
  p_workload smallint, p_assessment smallint, p_note text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_assignment public.campus_teaching_assignments%rowtype; v_review public.campus_course_reviews%rowtype;
begin
  select * into v_assignment from public.campus_teaching_assignments where id = p_assignment_id for share;
  if not found or v_assignment.school <> p_school or v_assignment.review_status <> 'approved' then
    raise exception 'CAMPUS_REVIEW_TARGET_UNAVAILABLE';
  end if;
  insert into public.campus_course_reviews(assignment_id, user_id, school, clarity, organization, learning, workload, assessment, note, review_status, review_reason, revision, updated_at)
    values (p_assignment_id, p_actor_id, p_school, p_clarity, p_organization, p_learning, p_workload, p_assessment, p_note, 'pending_review', '', 1, now())
    on conflict (assignment_id, user_id) do update set
      clarity = excluded.clarity, organization = excluded.organization, learning = excluded.learning,
      workload = excluded.workload, assessment = excluded.assessment, note = excluded.note,
      review_status = 'pending_review', review_reason = '', revision = campus_course_reviews.revision + 1, updated_at = now()
    returning * into v_review;
  return jsonb_build_object('id', v_review.id, 'review_status', v_review.review_status, 'updated_at', v_review.updated_at, 'revision', v_review.revision);
end;
$$;

-- Moderation state and its immutable audit event are committed together.
create or replace function public.campus_life_moderate_content(
  p_actor_id uuid, p_target_type text, p_target_id uuid, p_decision text,
  p_reason text, p_expected_revision integer default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_table text; v_status_field text := 'review_status'; v_pending text := 'pending_review';
  v_approved text := 'approved'; v_rejected text := 'rejected'; v_owner_field text;
  v_has_reason boolean := true; v_has_revision boolean := false; v_has_updated_at boolean := true;
  v_current jsonb; v_updated jsonb; v_from text; v_to text; v_school text; v_owner uuid;
  v_sql text;
begin
  if p_decision not in ('approve', 'reject', 'dismiss') then raise exception 'CAMPUS_MODERATION_INVALID'; end if;
  case p_target_type
    when 'teacher' then v_table := 'campus_teachers'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'course' then v_table := 'campus_courses'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'assignment' then v_table := 'campus_teaching_assignments'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'course_review' then v_table := 'campus_course_reviews'; v_owner_field := 'user_id'; v_has_revision := true;
    when 'market_listing' then v_table := 'campus_market_listings'; v_status_field := 'status'; v_approved := 'active'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'help_task' then v_table := 'campus_help_tasks'; v_status_field := 'status'; v_approved := 'open'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'shuttle_route' then v_table := 'campus_shuttle_routes'; v_status_field := 'status'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'shuttle_correction' then v_table := 'campus_shuttle_corrections'; v_status_field := 'status'; v_owner_field := 'owner_id'; v_has_revision := true; v_has_updated_at := false;
    when 'shuttle_exception' then v_table := 'campus_shuttle_exceptions'; v_status_field := 'status'; v_owner_field := 'owner_id'; v_has_revision := true; v_has_updated_at := false;
    when 'lost_found' then v_table := 'campus_lost_found_items'; v_status_field := 'status'; v_approved := 'open'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'event' then v_table := 'campus_events'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'guide' then v_table := 'campus_guides'; v_owner_field := 'owner_id'; v_has_revision := true;
    when 'report' then v_table := 'campus_content_reports'; v_status_field := 'status'; v_approved := 'resolved'; v_rejected := 'dismissed'; v_owner_field := null; v_has_reason := false; v_has_updated_at := false;
    else raise exception 'CAMPUS_MODERATION_INVALID';
  end case;
  if (p_target_type = 'report' and p_decision = 'reject') or (p_target_type <> 'report' and p_decision = 'dismiss') then
    raise exception 'CAMPUS_MODERATION_INVALID';
  end if;
  if p_decision = 'reject' and char_length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'CAMPUS_MODERATION_REASON_REQUIRED'; end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', v_table) into v_current using p_target_id;
  if v_current is null or v_current ->> v_status_field <> v_pending then raise exception 'CAMPUS_MODERATION_STATE_CHANGED'; end if;
  if v_has_revision and (p_expected_revision is null or (v_current ->> 'revision')::integer <> p_expected_revision) then
    raise exception 'CAMPUS_MODERATION_REVISION_CHANGED';
  end if;
  v_from := v_current ->> v_status_field;
  v_to := case when p_decision = 'approve' then v_approved else v_rejected end;
  v_school := coalesce(v_current ->> 'school', '');
  if v_school = '' and p_target_type = 'shuttle_exception' then
    select school into v_school from public.campus_shuttle_routes where id = (v_current ->> 'route_id')::uuid;
    v_school := coalesce(v_school, '');
  end if;
  if v_owner_field is not null then v_owner := (v_current ->> v_owner_field)::uuid; end if;
  v_sql := format('update public.%I set %I = $2', v_table, v_status_field);
  if v_has_reason then v_sql := v_sql || ', review_reason = $3'; end if;
  if v_has_revision then v_sql := v_sql || ', revision = revision + 1'; end if;
  if v_has_updated_at then v_sql := v_sql || ', updated_at = now()'; end if;
  v_sql := v_sql || ' where id = $1 returning to_jsonb(' || quote_ident(v_table) || ')';
  if v_has_reason then
    execute v_sql into v_updated using p_target_id, v_to, case when p_decision = 'approve' then '' else left(coalesce(p_reason, ''), 500) end;
  else
    execute v_sql into v_updated using p_target_id, v_to;
  end if;
  insert into public.campus_moderation_events(actor_id, school, target_type, target_id, from_status, to_status, reason)
    values (p_actor_id, v_school, p_target_type, p_target_id, v_from, v_to, left(coalesce(p_reason, ''), 1000));
  return jsonb_build_object('id', p_target_id, 'status', v_to, 'ownerId', v_owner, 'school', v_school);
end;
$$;

-- Merge every moderation category into one stable, globally ordered queue.
-- Fetch one extra row so the client can page without silently losing backlog.
create or replace function public.campus_life_moderation_queue(p_offset integer, p_limit integer)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_rows jsonb; v_items jsonb; v_has_more boolean;
begin
  if p_offset < 0 or p_offset > 100000 or p_limit < 1 or p_limit > 100 then raise exception 'CAMPUS_MODERATION_PAGE_INVALID'; end if;
  with pending as (
    select 'teacher'::text as target_type, to_jsonb(t) as item, t.created_at from public.campus_teachers t where t.review_status = 'pending_review'
    union all select 'course', to_jsonb(t), t.created_at from public.campus_courses t where t.review_status = 'pending_review'
    union all select 'assignment', to_jsonb(t), t.created_at from public.campus_teaching_assignments t where t.review_status = 'pending_review'
    union all select 'course_review', to_jsonb(t), t.created_at from public.campus_course_reviews t where t.review_status = 'pending_review'
    union all select 'market_listing', to_jsonb(t), t.created_at from public.campus_market_listings t where t.status = 'pending_review'
    union all select 'help_task', to_jsonb(t), t.created_at from public.campus_help_tasks t where t.status = 'pending_review'
    union all select 'help_dispute', to_jsonb(t), t.created_at from public.campus_help_disputes t where t.status = 'open'
    union all select 'shuttle_route', to_jsonb(t), t.created_at from public.campus_shuttle_routes t where t.status = 'pending_review'
    union all select 'shuttle_exception', jsonb_set(to_jsonb(t), '{school}', to_jsonb(r.school), true), t.created_at
      from public.campus_shuttle_exceptions t join public.campus_shuttle_routes r on r.id = t.route_id where t.status = 'pending_review'
    union all select 'shuttle_correction', to_jsonb(t), t.created_at from public.campus_shuttle_corrections t where t.status = 'pending_review'
    union all select 'lost_found', to_jsonb(t), t.created_at from public.campus_lost_found_items t where t.status = 'pending_review'
    union all select 'event', to_jsonb(t), t.created_at from public.campus_events t where t.review_status = 'pending_review'
    union all select 'guide', to_jsonb(t), t.created_at from public.campus_guides t where t.review_status = 'pending_review'
    union all select 'report', to_jsonb(t), t.created_at from public.campus_content_reports t where t.status = 'pending_review'
  )
  select coalesce(jsonb_agg(jsonb_build_object('type', page.target_type, 'item', page.item)
    order by page.created_at, page.target_type, page.item ->> 'id'), '[]'::jsonb)
    into v_rows
    from (select * from pending order by created_at, target_type, item ->> 'id' offset p_offset limit p_limit + 1) page;
  v_has_more := jsonb_array_length(v_rows) > p_limit;
  if v_has_more then
    select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into v_items
      from jsonb_array_elements(v_rows) with ordinality as rows(value, ordinal)
      where ordinal <= p_limit;
  else
    v_items := v_rows;
  end if;
  return jsonb_build_object('items', v_items, 'hasMore', v_has_more);
end;
$$;

-- Capacity validation and registration happen in one transaction under a row lock.
create or replace function public.campus_life_register_event(p_actor_id uuid, p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_event public.campus_events%rowtype; v_count integer; v_registration public.campus_event_registrations%rowtype;
begin
  select * into v_event from public.campus_events where id = p_event_id for update;
  if not found or v_event.review_status <> 'approved' or v_event.status <> 'published' then
    raise exception 'CAMPUS_EVENT_UNAVAILABLE';
  end if;
  if v_event.starts_at <= now() then raise exception 'CAMPUS_EVENT_CLOSED'; end if;
  select * into v_registration from public.campus_event_registrations where event_id = p_event_id and user_id = p_actor_id for update;
  if found and v_registration.status = 'registered' then
    return jsonb_build_object('eventId', p_event_id, 'status', 'registered', 'existing', true, 'registeredAt', v_registration.updated_at);
  end if;
  if v_event.capacity is not null then
    select count(*)::integer into v_count from public.campus_event_registrations
      where event_id = p_event_id and status = 'registered';
    if v_count >= v_event.capacity then raise exception 'CAMPUS_EVENT_FULL'; end if;
  end if;
  insert into public.campus_event_registrations(event_id, user_id, status)
    values (p_event_id, p_actor_id, 'registered')
    on conflict (event_id, user_id) do update set status = 'registered', updated_at = now()
    returning * into v_registration;
  return jsonb_build_object('eventId', p_event_id, 'status', 'registered', 'existing', false, 'registeredAt', v_registration.updated_at);
end;
$$;

create or replace function public.campus_life_event_counts(p_actor_id uuid, p_event_ids uuid[])
returns jsonb
language sql security definer set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_object_agg(aggregate.event_id::text,
    jsonb_build_object('count', aggregate.registered_count, 'is_registered', aggregate.is_registered)), '{}'::jsonb)
  from (
    select event.id as event_id,
      count(registration.id) filter (where registration.status = 'registered')::integer as registered_count,
      coalesce(bool_or(registration.user_id = p_actor_id and registration.status = 'registered'), false) as is_registered
    from public.campus_events event
    left join public.campus_event_registrations registration on registration.event_id = event.id
    where event.id = any(coalesce(p_event_ids, array[]::uuid[]))
    group by event.id
  ) aggregate;
$$;

create or replace function public.campus_life_decide_lost_found_claim(
  p_actor_id uuid, p_claim_id uuid, p_decision text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_claim public.campus_lost_found_claims%rowtype; v_item public.campus_lost_found_items%rowtype; v_next_item_status text;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'CAMPUS_CLAIM_DECISION_INVALID'; end if;
  select * into v_claim from public.campus_lost_found_claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'pending' then raise exception 'CAMPUS_CLAIM_STATE_CHANGED'; end if;
  select * into v_item from public.campus_lost_found_items where id = v_claim.item_id for update;
  if not found or v_item.owner_id <> p_actor_id or v_item.status not in ('open', 'claim_pending') then
    raise exception 'CAMPUS_CLAIM_FORBIDDEN';
  end if;
  if p_decision = 'approve' then
    update public.campus_lost_found_claims set status = 'approved', updated_at = now() where id = p_claim_id;
    update public.campus_lost_found_claims set status = 'rejected', updated_at = now()
      where item_id = v_item.id and id <> p_claim_id and status = 'pending';
    v_next_item_status := 'returned';
  else
    update public.campus_lost_found_claims set status = 'rejected', updated_at = now() where id = p_claim_id;
    v_next_item_status := case when exists (select 1 from public.campus_lost_found_claims where item_id = v_item.id and id <> p_claim_id and status = 'pending') then 'claim_pending' else 'open' end;
  end if;
  update public.campus_lost_found_items set status = v_next_item_status, updated_at = now() where id = v_item.id;
  return jsonb_build_object('claimId', p_claim_id, 'claimStatus', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'itemId', v_item.id, 'itemStatus', v_next_item_status);
end;
$$;

create or replace function public.campus_life_raise_help_dispute(
  p_actor_id uuid, p_task_id uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_task public.campus_help_tasks%rowtype; v_dispute_id uuid;
begin
  select * into v_task from public.campus_help_tasks where id = p_task_id for update;
  if not found or p_actor_id not in (v_task.owner_id, v_task.assignee_id)
      or v_task.status not in ('assigned', 'in_progress', 'awaiting_confirmation') then
    raise exception 'CAMPUS_HELP_STATE_CHANGED';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 1 or char_length(p_reason) > 1500 then raise exception 'CAMPUS_HELP_DISPUTE_INVALID'; end if;
  update public.campus_help_tasks set status = 'disputed', revision = revision + 1, updated_at = now() where id = p_task_id;
  insert into public.campus_help_disputes(task_id, opened_by, reason) values (p_task_id, p_actor_id, p_reason) returning id into v_dispute_id;
  return jsonb_build_object('taskId', p_task_id, 'status', 'disputed', 'disputeId', v_dispute_id);
end;
$$;

-- A dispute can only leave its locked state through an explicit platform ruling.
create or replace function public.campus_life_resolve_help_dispute(
  p_actor_id uuid, p_dispute_id uuid, p_task_status text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_dispute public.campus_help_disputes%rowtype; v_task public.campus_help_tasks%rowtype;
begin
  if p_task_status not in ('completed', 'cancelled') then raise exception 'CAMPUS_DISPUTE_OUTCOME_INVALID'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 1 or char_length(p_reason) > 1500 then raise exception 'CAMPUS_DISPUTE_REASON_INVALID'; end if;
  select * into v_dispute from public.campus_help_disputes where id = p_dispute_id for update;
  if not found or v_dispute.status <> 'open' then raise exception 'CAMPUS_DISPUTE_STATE_CHANGED'; end if;
  select * into v_task from public.campus_help_tasks where id = v_dispute.task_id for update;
  if not found or v_task.status <> 'disputed' then raise exception 'CAMPUS_DISPUTE_STATE_CHANGED'; end if;
  update public.campus_help_disputes set status = 'resolved', resolution = p_reason, updated_at = now() where id = p_dispute_id;
  update public.campus_help_tasks set status = p_task_status, revision = revision + 1, updated_at = now() where id = v_task.id;
  insert into public.campus_moderation_events(actor_id, school, target_type, target_id, from_status, to_status, reason)
    values (p_actor_id, v_task.school, 'help_dispute', p_dispute_id, 'open', 'resolved', p_task_status || ': ' || p_reason);
  return jsonb_build_object('disputeId', p_dispute_id, 'taskId', v_task.id, 'taskStatus', p_task_status,
    'ownerId', v_task.owner_id, 'assigneeId', v_task.assignee_id);
end;
$$;

alter table public.campus_courses enable row level security;
alter table public.campus_teachers enable row level security;
alter table public.campus_teaching_assignments enable row level security;
alter table public.campus_course_reviews enable row level security;
alter table public.campus_market_listings enable row level security;
alter table public.campus_market_interests enable row level security;
alter table public.campus_help_tasks enable row level security;
alter table public.campus_help_applications enable row level security;
alter table public.campus_help_disputes enable row level security;
alter table public.campus_shuttle_routes enable row level security;
alter table public.campus_shuttle_stops enable row level security;
alter table public.campus_shuttle_departures enable row level security;
alter table public.campus_shuttle_exceptions enable row level security;
alter table public.campus_shuttle_corrections enable row level security;
alter table public.campus_lost_found_items enable row level security;
alter table public.campus_lost_found_claims enable row level security;
alter table public.campus_events enable row level security;
alter table public.campus_event_registrations enable row level security;
alter table public.campus_guides enable row level security;
alter table public.campus_favorites enable row level security;
alter table public.campus_content_reports enable row level security;
alter table public.campus_moderation_events enable row level security;
alter table public.campus_private_messages enable row level security;

revoke all on public.campus_courses, public.campus_teachers, public.campus_teaching_assignments,
  public.campus_course_reviews, public.campus_market_listings,
  public.campus_market_interests, public.campus_help_tasks, public.campus_help_applications, public.campus_help_disputes,
  public.campus_shuttle_routes, public.campus_shuttle_stops, public.campus_shuttle_departures,
  public.campus_shuttle_exceptions, public.campus_shuttle_corrections,
  public.campus_lost_found_items, public.campus_lost_found_claims,
  public.campus_events, public.campus_event_registrations, public.campus_guides,
  public.campus_favorites, public.campus_content_reports, public.campus_moderation_events,
  public.campus_private_messages
  from public, anon, authenticated;
grant all on public.campus_courses, public.campus_teachers, public.campus_teaching_assignments,
  public.campus_course_reviews, public.campus_market_listings,
  public.campus_market_interests, public.campus_help_tasks, public.campus_help_applications, public.campus_help_disputes,
  public.campus_shuttle_routes, public.campus_shuttle_stops, public.campus_shuttle_departures,
  public.campus_shuttle_exceptions, public.campus_shuttle_corrections,
  public.campus_lost_found_items, public.campus_lost_found_claims,
  public.campus_events, public.campus_event_registrations, public.campus_guides,
  public.campus_favorites, public.campus_content_reports, public.campus_moderation_events,
  public.campus_private_messages
  to service_role;

do $campus_life_policies$
declare v_table text;
begin
  for v_table in select unnest(array[
    'campus_courses', 'campus_teachers', 'campus_teaching_assignments', 'campus_course_reviews',
    'campus_market_listings', 'campus_market_interests', 'campus_help_tasks', 'campus_help_applications',
    'campus_help_disputes', 'campus_shuttle_routes', 'campus_shuttle_stops', 'campus_shuttle_departures',
    'campus_shuttle_exceptions', 'campus_shuttle_corrections', 'campus_lost_found_items',
    'campus_lost_found_claims', 'campus_events', 'campus_event_registrations', 'campus_guides',
    'campus_favorites', 'campus_content_reports', 'campus_moderation_events', 'campus_private_messages'
  ]) loop
    execute format('create policy campus_life_service_role on public.%I for all to service_role using (true) with check (true)', v_table);
  end loop;
end
$campus_life_policies$;

revoke all on function public.campus_life_reserve_listing(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.campus_life_accept_help_application(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.campus_life_create_market_interest(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.campus_life_create_help_application(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.campus_life_create_lost_found_claim(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.campus_life_submit_course_review(uuid, uuid, text, smallint, smallint, smallint, smallint, smallint, text) from public, anon, authenticated;
revoke all on function public.campus_life_moderate_content(uuid, text, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.campus_life_moderation_queue(integer, integer) from public, anon, authenticated;
revoke all on function public.campus_life_register_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.campus_life_event_counts(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.campus_life_decide_lost_found_claim(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.campus_life_raise_help_dispute(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.campus_life_resolve_help_dispute(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.campus_life_resubmit_content(uuid, text, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.campus_life_reserve_listing(uuid, uuid, uuid) to service_role;
grant execute on function public.campus_life_accept_help_application(uuid, uuid, uuid) to service_role;
grant execute on function public.campus_life_create_market_interest(uuid, uuid, text) to service_role;
grant execute on function public.campus_life_create_help_application(uuid, uuid, text) to service_role;
grant execute on function public.campus_life_create_lost_found_claim(uuid, uuid, text) to service_role;
grant execute on function public.campus_life_submit_course_review(uuid, uuid, text, smallint, smallint, smallint, smallint, smallint, text) to service_role;
grant execute on function public.campus_life_moderate_content(uuid, text, uuid, text, text, integer) to service_role;
grant execute on function public.campus_life_moderation_queue(integer, integer) to service_role;
grant execute on function public.campus_life_register_event(uuid, uuid) to service_role;
grant execute on function public.campus_life_event_counts(uuid, uuid[]) to service_role;
grant execute on function public.campus_life_decide_lost_found_claim(uuid, uuid, text) to service_role;
grant execute on function public.campus_life_raise_help_dispute(uuid, uuid, text) to service_role;
grant execute on function public.campus_life_resolve_help_dispute(uuid, uuid, text, text) to service_role;
grant execute on function public.campus_life_resubmit_content(uuid, text, uuid, integer, jsonb) to service_role;

-- Extend the existing notification union without exposing payload text.
alter table public.social_notifications drop constraint if exists social_notifications_kind_check;
alter table public.social_notifications add constraint social_notifications_kind_check check (
  kind = any (array[
    'friend_request','friend_accepted','friend_removed','invitation','invitation_updated',
    'invitation_cancelled','invitation_expired','place_preset','campus_place_reviewed',
    'campus_content_reviewed','campus_market_interest','campus_help_application',
    'campus_lost_found_claim','campus_event_update','campus_private_message','campus_help_update'
  ]::text[])
);

comment on table public.campus_lost_found_claims is 'Private claim evidence; readable only through authenticated server-side ownership checks.';
comment on table public.campus_moderation_events is 'Append-only audit of campus content review decisions.';
comment on table public.campus_private_messages is 'Private in-app contact; participants are verified by the campus-life Edge Function.';
