-- Extend the school-visible directory while keeping the existing six rating
-- templates and defaulting historical rows to a sensible detailed type.
alter table public.campus_places
  add column place_type text,
  add column description text not null default '',
  add column opening_hours text not null default '',
  add column service_info text not null default '',
  add column public_contact text not null default '',
  add column source_info text not null default '',
  add column review_status text not null default 'approved',
  add column review_reason text not null default '',
  add column review_revision uuid not null default gen_random_uuid();

update public.campus_places
set place_type = case category
  when 'food' then 'restaurant'
  when 'study' then 'study-room'
  when 'transport' then 'shuttle-stop'
  when 'trade' then 'campus-shop'
  when 'social' then 'recreation'
  else 'other'
end
where place_type is null;

-- Preserve old rows as approved while making every future insert enter review.
alter table public.campus_places alter column review_status set default 'pending';

alter table public.campus_places
  alter column place_type set default 'other',
  alter column place_type set not null,
  add constraint campus_places_place_type_check check (place_type in (
    'teaching-building', 'library', 'study-room', 'laboratory',
    'cafeteria', 'restaurant', 'tea-shop', 'coffee-shop',
    'supermarket', 'convenience-store', 'campus-shop',
    'printing', 'parcel-station', 'sports', 'recreation',
    'dorm-facility', 'medical', 'administration', 'shuttle-stop',
    'scenic', 'campus-edge-shop', 'other'
  )),
  add constraint campus_places_description_length check (char_length(description) <= 500),
  add constraint campus_places_opening_hours_length check (char_length(opening_hours) <= 120),
  add constraint campus_places_service_info_length check (char_length(service_info) <= 500),
  add constraint campus_places_public_contact_length check (char_length(public_contact) <= 100),
  add constraint campus_places_source_info_length check (char_length(source_info) <= 160);

alter table public.campus_places
  add constraint campus_places_review_status_check
    check (review_status in ('pending', 'approved', 'rejected')),
  add constraint campus_places_review_reason_length check (char_length(review_reason) <= 500);

create index campus_places_school_type_name
  on public.campus_places (school, place_type, name, id)
  where archived_at is null;

create index campus_places_review_queue
  on public.campus_places (updated_at, id)
  where review_status = 'pending' and archived_at is null;

create table public.campus_place_review_events (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.campus_places(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected')),
  outcome text not null default 'started' check (outcome in ('started', 'succeeded', 'failed')),
  reason text not null default '' check (char_length(reason) <= 500),
  content_revision uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index campus_place_review_events_recent
  on public.campus_place_review_events (created_at desc, id desc);
create index campus_place_review_events_place
  on public.campus_place_review_events (place_id, created_at desc);

alter table public.campus_place_review_events enable row level security;
revoke all on public.campus_place_review_events from public, anon, authenticated;
grant select, insert, update on public.campus_place_review_events to service_role;
create policy campus_place_review_events_service_role
  on public.campus_place_review_events for all to service_role using (true) with check (true);

alter table public.social_notifications drop constraint if exists social_notifications_kind_check;
alter table public.social_notifications add constraint social_notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'friend_removed', 'invitation', 'invitation_updated',
    'invitation_cancelled', 'invitation_expired', 'place_preset', 'campus_place_reviewed'));
