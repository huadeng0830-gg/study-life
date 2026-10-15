-- Same public projection already exposed by campus-community/public_list.
-- Grant individual columns so anonymous callers cannot query author identities,
-- reviewer notes or private message threads even through the Data API directly.
grant select (id, category, title, body, status, visibility, public_reply,
  public_reason, reward_beans, reward_issued, created_at, updated_at)
  on public.campus_feedback_suggestions to anon;

create policy campus_feedback_published_read on public.campus_feedback_suggestions
  for select to anon using (visibility = 'public');

create index campus_feedback_public_updated_idx
  on public.campus_feedback_suggestions(updated_at desc, id)
  where visibility = 'public';
