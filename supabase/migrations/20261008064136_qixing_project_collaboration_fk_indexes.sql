-- Cover foreign keys that are not the leading column of an existing project index.
-- This keeps membership cleanup and referenced-row checks efficient as teams grow.
create index if not exists team_project_activity_actor_id_idx
  on public.team_project_activity(actor_id);
create index if not exists team_project_adjustments_decision_by_idx
  on public.team_project_adjustment_requests(decision_by);
create index if not exists team_project_adjustments_requester_idx
  on public.team_project_adjustment_requests(requester_id);
create index if not exists team_project_deliverable_drafts_user_idx
  on public.team_project_deliverable_drafts(user_id);
create index if not exists team_project_deliverables_created_by_idx
  on public.team_project_deliverables(created_by);
create index if not exists team_project_deliverables_reviewer_idx
  on public.team_project_deliverables(reviewer_id);
create index if not exists team_project_delivery_checks_checked_by_idx
  on public.team_project_delivery_checks(checked_by);
create index if not exists team_project_delivery_checks_created_by_idx
  on public.team_project_delivery_checks(created_by);
create index if not exists team_project_invite_links_created_by_idx
  on public.team_project_invite_links(created_by);
create index if not exists team_project_meetings_created_by_idx
  on public.team_project_meetings(created_by);
create index if not exists team_project_members_invited_by_idx
  on public.team_project_members(invited_by);
create index if not exists team_project_milestones_completed_by_idx
  on public.team_project_milestones(completed_by);
create index if not exists team_project_milestones_created_by_idx
  on public.team_project_milestones(created_by);
create index if not exists team_project_result_versions_project_id_idx
  on public.team_project_result_versions(project_id);
create index if not exists team_project_result_versions_submitted_by_idx
  on public.team_project_result_versions(submitted_by);
create index if not exists team_project_task_events_actor_id_idx
  on public.team_project_task_events(actor_id);
create index if not exists team_project_tasks_created_by_idx
  on public.team_project_tasks(created_by);
create index if not exists team_project_tasks_milestone_id_idx
  on public.team_project_tasks(milestone_id);
create index if not exists team_project_tasks_parent_task_id_idx
  on public.team_project_tasks(parent_task_id);
create index if not exists team_projects_owner_id_idx
  on public.team_projects(owner_id);
