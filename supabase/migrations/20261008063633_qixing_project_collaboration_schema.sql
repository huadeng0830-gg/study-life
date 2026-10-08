-- 齐行基础项目协作：项目、成员、受控邀请、任务和追加式操作记录。
-- 所有请求由 campus-social Edge Function 验证 Auth JWT 后以 service_role 调用；
-- 浏览器不能直接读取这些表，个人课表/待办快照也不存放团队数据。

create table public.team_projects (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  project_type text not null default 'blank'
    check (project_type in ('course', 'competition', 'research', 'software', 'event', 'blank')),
  starts_on date,
  target_end_on date,
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (target_end_on is null or starts_on is null or target_end_on >= starts_on),
  check ((status = 'deleted') = (deleted_at is not null))
);

create table public.team_project_milestones (
  id uuid primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  due_on date,
  status text not null default 'upcoming' check (status in ('upcoming', 'completed')),
  created_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);
create index team_project_milestones_project_idx on public.team_project_milestones(project_id, due_on nulls last, created_at);

create table public.team_project_members (
  project_id uuid not null references public.team_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'invited' check (status in ('invited', 'active', 'declined', 'left')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (project_id, user_id),
  check ((status = 'active') = (joined_at is not null)),
  check ((status = 'left') = (left_at is not null))
);

create unique index team_project_one_active_owner_idx
  on public.team_project_members(project_id) where role = 'owner' and status = 'active';
create index team_project_members_user_status_idx
  on public.team_project_members(user_id, status, project_id);

create table public.team_project_invite_links (
  id uuid primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses integer not null default 5 check (max_uses between 1 and 20),
  uses integer not null default 0 check (uses >= 0 and uses <= max_uses),
  revoked_at timestamptz
);
create index team_project_invite_links_project_idx
  on public.team_project_invite_links(project_id, created_at desc);

create table public.team_project_tasks (
  id uuid primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  milestone_id uuid references public.team_project_milestones(id) on delete set null,
  parent_task_id uuid references public.team_project_tasks(id) on delete set null,
  depends_on_task_id uuid references public.team_project_tasks(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 3000),
  created_by uuid references auth.users(id) on delete set null,
  assignee_id uuid references auth.users(id) on delete set null,
  assignment_status text not null default 'none'
    check (assignment_status in ('none', 'pending', 'accepted', 'declined')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'completed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_on date,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((assignee_id is null) = (assignment_status = 'none')),
  check ((status = 'completed') = (completed_at is not null)),
  check (parent_task_id is null or parent_task_id <> id),
  check (depends_on_task_id is null or depends_on_task_id <> id)
);
create index team_project_tasks_project_idx
  on public.team_project_tasks(project_id, parent_task_id, created_at);
create index team_project_tasks_assignee_idx
  on public.team_project_tasks(assignee_id, assignment_status, status)
  where assignee_id is not null;
create index team_project_tasks_dependency_idx
  on public.team_project_tasks(depends_on_task_id) where depends_on_task_id is not null;

create table public.team_project_task_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  task_id uuid not null references public.team_project_tasks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'created', 'assigned', 'assignment_accepted', 'assignment_declined',
    'updated', 'status_changed', 'member_left', 'member_removed',
    'adjustment_requested', 'adjustment_approved', 'adjustment_rejected', 'adjustment_cancelled', 'adjustment_stale',
    'result_submitted', 'review_approved', 'review_returned', 'milestone_completed'
  )),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index team_project_task_events_project_idx
  on public.team_project_task_events(project_id, created_at desc);
create index team_project_task_events_task_idx
  on public.team_project_task_events(task_id, created_at desc);

create table public.team_project_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'project_created', 'project_updated', 'project_archived', 'project_restored', 'project_deleted',
    'member_invited', 'invite_link_created', 'member_joined', 'member_declined',
    'member_left', 'member_removed', 'member_role_changed', 'owner_transferred', 'task_created', 'task_assigned',
    'adjustment_requested', 'adjustment_decided', 'deliverable_created', 'result_submitted', 'review_completed',
    'milestone_created', 'milestone_updated', 'meeting_created', 'meeting_status_changed', 'delivery_check_created', 'delivery_check_updated'
  )),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index team_project_activity_project_idx
  on public.team_project_activity(project_id, created_at desc);

create table public.team_project_adjustment_requests (
  id uuid primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  task_id uuid not null references public.team_project_tasks(id) on delete cascade,
  requester_id uuid references auth.users(id) on delete set null,
  approver_id uuid references auth.users(id) on delete set null,
  request_type text not null check (request_type in ('deadline_extension', 'help', 'scope_change', 'split', 'handover', 'unable_to_continue')),
  reason text not null check (char_length(btrim(reason)) between 1 and 1500),
  request_data jsonb not null default '{}'::jsonb check (jsonb_typeof(request_data) = 'object'),
  task_revision integer not null check (task_revision > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'stale')),
  decision_by uuid references auth.users(id) on delete set null,
  decision_note text not null default '' check (char_length(decision_note) <= 1500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index team_project_adjustments_project_idx on public.team_project_adjustment_requests(project_id, created_at desc);
create index team_project_adjustments_inbox_idx on public.team_project_adjustment_requests(approver_id, status, created_at desc);
create unique index team_project_adjustments_one_pending_task_idx
  on public.team_project_adjustment_requests(task_id, requester_id, request_type) where status = 'pending';

create table public.team_project_deliverables (
  id uuid primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  task_id uuid references public.team_project_tasks(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  instructions text not null default '' check (char_length(instructions) <= 3000),
  required boolean not null default true,
  review_required boolean not null default true,
  reviewer_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index team_project_deliverables_project_idx on public.team_project_deliverables(project_id, created_at);
create unique index team_project_deliverables_one_per_task_idx
  on public.team_project_deliverables(task_id) where task_id is not null;

create table public.team_project_deliverable_drafts (
  deliverable_id uuid not null references public.team_project_deliverables(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (deliverable_id, user_id)
);

create table public.team_project_result_versions (
  id uuid primary key,
  deliverable_id uuid not null references public.team_project_deliverables(id) on delete cascade,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  submission_key uuid not null unique,
  submitted_by uuid references auth.users(id) on delete set null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  change_note text not null default '' check (char_length(change_note) <= 1500),
  review_status text not null check (review_status in ('pending', 'approved', 'returned', 'not_required')),
  created_at timestamptz not null default now(),
  unique (deliverable_id, version_number)
);
create index team_project_result_versions_deliverable_idx on public.team_project_result_versions(deliverable_id, version_number desc);

create table public.team_project_reviews (
  version_id uuid primary key references public.team_project_result_versions(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  result text not null check (result in ('approved', 'returned')),
  feedback text not null check (char_length(btrim(feedback)) between 1 and 3000),
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  created_at timestamptz not null default now()
);
create index team_project_reviews_reviewer_idx on public.team_project_reviews(reviewer_id, created_at desc);

create table public.team_project_delivery_checks (
  id uuid primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  required boolean not null default true,
  checked boolean not null default false,
  evidence text not null default '' check (char_length(evidence) <= 1500),
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (checked = (checked_at is not null))
);
create index team_project_delivery_checks_project_idx on public.team_project_delivery_checks(project_id, created_at);

create table public.team_project_meetings (
  id uuid primary key,
  project_id uuid not null references public.team_projects(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  note text not null default '' check (char_length(note) <= 1500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'cancelled')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '8 hours')
);
create index team_project_meetings_project_idx on public.team_project_meetings(project_id, starts_at);

create table public.team_project_meeting_participants (
  meeting_id uuid not null references public.team_project_meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'proposed')),
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  responded_at timestamptz,
  primary key (meeting_id, user_id),
  check ((status = 'proposed') = (proposed_starts_at is not null and proposed_ends_at is not null)),
  check (proposed_ends_at is null or proposed_ends_at > proposed_starts_at)
);
create index team_project_meeting_participants_user_idx on public.team_project_meeting_participants(user_id, status, meeting_id);

alter table public.team_projects enable row level security;
alter table public.team_project_milestones enable row level security;
alter table public.team_project_members enable row level security;
alter table public.team_project_invite_links enable row level security;
alter table public.team_project_tasks enable row level security;
alter table public.team_project_task_events enable row level security;
alter table public.team_project_activity enable row level security;
alter table public.team_project_adjustment_requests enable row level security;
alter table public.team_project_deliverables enable row level security;
alter table public.team_project_deliverable_drafts enable row level security;
alter table public.team_project_result_versions enable row level security;
alter table public.team_project_reviews enable row level security;
alter table public.team_project_delivery_checks enable row level security;
alter table public.team_project_meetings enable row level security;
alter table public.team_project_meeting_participants enable row level security;

-- Data API access is opt-in. Even authenticated members must go through the
-- JWT-verified Edge Function, so no member can widen access with a client query.
revoke all on table public.team_projects, public.team_project_members,
  public.team_project_invite_links, public.team_project_tasks,
  public.team_project_task_events, public.team_project_activity,
  public.team_project_adjustment_requests, public.team_project_deliverables,
  public.team_project_deliverable_drafts, public.team_project_result_versions,
  public.team_project_reviews, public.team_project_milestones,
  public.team_project_delivery_checks, public.team_project_meetings,
  public.team_project_meeting_participants
  from public, anon, authenticated;
grant all on table public.team_projects, public.team_project_members,
  public.team_project_invite_links, public.team_project_tasks,
  public.team_project_task_events, public.team_project_activity,
  public.team_project_adjustment_requests, public.team_project_deliverables,
  public.team_project_deliverable_drafts, public.team_project_result_versions,
  public.team_project_reviews, public.team_project_milestones,
  public.team_project_delivery_checks, public.team_project_meetings,
  public.team_project_meeting_participants to service_role;
revoke all on sequence public.team_project_task_events_id_seq, public.team_project_activity_id_seq from public, anon, authenticated;
grant usage, select on sequence public.team_project_task_events_id_seq, public.team_project_activity_id_seq to service_role;

insert into storage.buckets(id, name, public, file_size_limit)
  values ('qixing-deliverables', 'qixing-deliverables', false, 20971520)
  on conflict (id) do nothing;

-- Keep the SECURITY DEFINER helper outside the Data API exposed public schema.
create schema if not exists qixing_private;
revoke all on schema qixing_private from public, anon, authenticated;
grant usage on schema qixing_private to authenticated, service_role;

create or replace function qixing_private.object_access(p_name text, p_for_write boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project text := pg_catalog.split_part(coalesce(p_name, ''), '/', 1);
  v_deliverable text := pg_catalog.split_part(coalesce(p_name, ''), '/', 2);
  v_user text := pg_catalog.split_part(coalesce(p_name, ''), '/', 3);
begin
  if auth.uid() is null
    or coalesce(p_name, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]{1,200}$'
    or v_project !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_deliverable !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_user !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.team_project_members member
    join public.team_projects project on project.id = member.project_id
    join public.team_project_deliverables deliverable on deliverable.project_id = project.id
    where project.id = v_project::uuid and deliverable.id = v_deliverable::uuid
      and member.user_id = auth.uid() and member.status = 'active'
      and project.status <> 'deleted'
      and (not p_for_write or (project.status = 'active' and v_user::uuid = auth.uid()))
  );
end;
$$;
revoke all on function qixing_private.object_access(text, boolean) from public, anon;
grant execute on function qixing_private.object_access(text, boolean) to authenticated, service_role;

create policy qixing_deliverables_read on storage.objects
  for select to authenticated
  using (bucket_id = 'qixing-deliverables' and qixing_private.object_access(name, false));
create policy qixing_deliverables_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'qixing-deliverables' and qixing_private.object_access(name, true));
