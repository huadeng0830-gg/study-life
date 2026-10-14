-- Cover foreign-key lookups used by deletes, joins, moderation, and ownership queries.
create index if not exists campus_course_reviews_user_id_idx
  on public.campus_course_reviews (user_id);
create index if not exists campus_help_disputes_opened_by_idx
  on public.campus_help_disputes (opened_by);
create index if not exists campus_help_disputes_task_id_idx
  on public.campus_help_disputes (task_id);
create index if not exists campus_market_listings_reserved_by_idx
  on public.campus_market_listings (reserved_by);
create index if not exists campus_moderation_events_actor_id_idx
  on public.campus_moderation_events (actor_id);
create index if not exists campus_place_review_events_actor_id_idx
  on public.campus_place_review_events (actor_id);
create index if not exists campus_private_messages_sender_id_idx
  on public.campus_private_messages (sender_id);
create index if not exists campus_shuttle_corrections_owner_id_idx
  on public.campus_shuttle_corrections (owner_id);
create index if not exists campus_shuttle_corrections_route_id_idx
  on public.campus_shuttle_corrections (route_id);
create index if not exists campus_shuttle_exceptions_owner_id_idx
  on public.campus_shuttle_exceptions (owner_id);
create index if not exists campus_shuttle_routes_owner_id_idx
  on public.campus_shuttle_routes (owner_id);
create index if not exists campus_teaching_assignments_teacher_id_idx
  on public.campus_teaching_assignments (teacher_id);
create index if not exists platform_admin_audit_actor_user_id_idx
  on public.platform_admin_audit (actor_user_id);
create index if not exists platform_admin_audit_target_user_id_idx
  on public.platform_admin_audit (target_user_id);
create index if not exists platform_admins_granted_by_idx
  on public.platform_admins (granted_by);
