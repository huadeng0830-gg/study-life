-- Keep the internal rate-limit table unavailable to browser roles.
alter table private.social_rate_buckets enable row level security;

create policy social_rate_buckets_service_role_access
  on private.social_rate_buckets
  for all
  to service_role
  using (true)
  with check (true);
