-- Synthetic query-plan experiment on a TEMP table only. No production rows or
-- indexes change; counts/times from this fixture are not production timings.
begin;
set local statement_timeout = '15s';
create temporary table capacity_marks (like public.campus_matter_marks including defaults including constraints including indexes) on commit drop;
insert into capacity_marks(matter_id,user_id,mark_type)
select md5('fictional-matter-'||n)::uuid,md5('fictional-user-'||(n%1000))::uuid,'understand'
from generate_series(1,30000) n;
analyze capacity_marks;
create temporary table capacity_plans(phase text,plan jsonb) on commit drop;
do $$
declare before_plan jsonb; after_plan jsonb;
begin
  execute $q$explain (analyze,buffers,format json) select matter_id,mark_type from capacity_marks where user_id=md5('fictional-user-42')::uuid$q$ into before_plan;
  create index capacity_marks_user_matter on capacity_marks(user_id,matter_id);
  execute $q$explain (analyze,buffers,format json) select matter_id,mark_type from capacity_marks where user_id=md5('fictional-user-42')::uuid$q$ into after_plan;
  insert into capacity_plans values('before',before_plan),('after',after_plan);
end;
$$;
select phase,plan->0->'Plan'->>'Node Type' node_type,
  plan->0->>'Execution Time' execution_ms,
  plan->0->'Plan'->>'Actual Rows' returned_rows,
  plan->0->'Plan'->>'Rows Removed by Filter' rows_removed,
  plan->0->'Plan'->>'Local Hit Blocks' local_hit_blocks
from capacity_plans order by phase;
rollback;
