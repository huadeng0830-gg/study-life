-- 每个治理队列分支都按固定待处理状态读取，并以 created_at / id 稳定排序。
-- 只把待处理行放进索引，避免把所有已审核校园记录也复制到队列索引里。
create index if not exists campus_teachers_pending_queue
  on public.campus_teachers (created_at, id) where review_status = 'pending_review';
create index if not exists campus_courses_pending_queue
  on public.campus_courses (created_at, id) where review_status = 'pending_review';
create index if not exists campus_assignments_pending_queue
  on public.campus_teaching_assignments (created_at, id) where review_status = 'pending_review';
create index if not exists campus_course_reviews_pending_queue
  on public.campus_course_reviews (created_at, id) where review_status = 'pending_review';
create index if not exists campus_market_listings_pending_queue
  on public.campus_market_listings (created_at, id) where status = 'pending_review';
create index if not exists campus_help_tasks_pending_queue
  on public.campus_help_tasks (created_at, id) where status = 'pending_review';
create index if not exists campus_shuttle_routes_pending_queue
  on public.campus_shuttle_routes (created_at, id) where status = 'pending_review';
create index if not exists campus_shuttle_exceptions_pending_queue
  on public.campus_shuttle_exceptions (created_at, id) where status = 'pending_review';
create index if not exists campus_lost_found_pending_queue
  on public.campus_lost_found_items (created_at, id) where status = 'pending_review';
create index if not exists campus_events_pending_queue
  on public.campus_events (created_at, id) where review_status = 'pending_review';
create index if not exists campus_guides_pending_queue
  on public.campus_guides (created_at, id) where review_status = 'pending_review';
create index if not exists campus_matter_clarifications_pending_queue
  on public.campus_matter_clarifications (created_at, id)
  where review_status = 'pending_review' and deleted_at is null;
