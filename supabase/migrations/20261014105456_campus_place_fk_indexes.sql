-- 外键的首列索引支持按用户清理评分与举报记录，避免用户删除时扫描整张表。
create index campus_place_ratings_user on public.campus_place_ratings (user_id);
create index campus_place_reports_reporter on public.campus_place_reports (reporter_id);
