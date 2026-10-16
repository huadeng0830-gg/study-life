-- 每类待处理队列都应有匹配其固定状态的局部排序索引。
begin;
do $$
declare
  missing text[];
begin
  select array_agg(expected.index_name order by expected.index_name)
    into missing
    from (values
      ('campus_teachers_pending_queue', 'review_status = ''pending_review'''),
      ('campus_courses_pending_queue', 'review_status = ''pending_review'''),
      ('campus_assignments_pending_queue', 'review_status = ''pending_review'''),
      ('campus_course_reviews_pending_queue', 'review_status = ''pending_review'''),
      ('campus_market_listings_pending_queue', 'status = ''pending_review'''),
      ('campus_help_tasks_pending_queue', 'status = ''pending_review'''),
      ('campus_shuttle_routes_pending_queue', 'status = ''pending_review'''),
      ('campus_shuttle_exceptions_pending_queue', 'status = ''pending_review'''),
      ('campus_lost_found_pending_queue', 'status = ''pending_review'''),
      ('campus_events_pending_queue', 'review_status = ''pending_review'''),
      ('campus_guides_pending_queue', 'review_status = ''pending_review'''),
      ('campus_matter_clarifications_pending_queue', 'deleted_at IS NULL')
    ) expected(index_name, predicate_fragment)
   where not exists (
     select 1
       from pg_catalog.pg_class index_relation
       join pg_catalog.pg_namespace index_schema on index_schema.oid = index_relation.relnamespace
       join pg_catalog.pg_index index_metadata on index_metadata.indexrelid = index_relation.oid
      where index_schema.nspname = 'public'
        and index_relation.relname = expected.index_name
        and index_metadata.indpred is not null
        and position(expected.predicate_fragment in pg_catalog.pg_get_expr(index_metadata.indpred, index_metadata.indrelid)) > 0
   );

  if missing is not null then
    raise exception 'missing partial campus queue indexes: %', missing;
  end if;
end;
$$;
rollback;
