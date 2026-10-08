-- Keep auth user deletion and actor lookups efficient as the social tables grow.
create index social_invitations_created_by_idx on public.social_invitations (created_by);
create index social_notifications_actor_id_idx on public.social_notifications (actor_id)
  where actor_id is not null;
