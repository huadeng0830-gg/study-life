-- Counts are public; voter identities stay behind the authenticated API.
begin;
alter table public.campus_feedback_suggestions
  add column like_count integer not null default 0 check (like_count >= 0);
grant select (like_count) on public.campus_feedback_suggestions to anon, authenticated;

create table public.feedback_support_votes (
  feedback_id uuid not null references public.campus_feedback_suggestions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (feedback_id, user_id)
);
alter table public.feedback_support_votes enable row level security;
revoke all on public.feedback_support_votes from public, anon, authenticated;
grant select, insert, delete on public.feedback_support_votes to service_role;
create index feedback_support_user_idx on public.feedback_support_votes(user_id, feedback_id);
create index feedback_public_support_idx on public.campus_feedback_suggestions(visibility, like_count desc, created_at, id);
create index feedback_active_support_idx on public.campus_feedback_suggestions(like_count desc, created_at, id)
  where status in ('pending','needs_info','planned','processing');

-- Voting must not edit the content revision or manufacture a public progress event.
create function public.feedback_update_support_count() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.campus_feedback_suggestions set like_count = like_count + 1 where id = new.feedback_id;
    return new;
  end if;
  update public.campus_feedback_suggestions set like_count = like_count - 1 where id = old.feedback_id;
  return old;
end;
$$;
revoke all on function public.feedback_update_support_count() from public, anon, authenticated;
create trigger feedback_support_count after insert or delete on public.feedback_support_votes
  for each row execute function public.feedback_update_support_count();

-- Explicit desired state makes retries idempotent; the parent lock serializes votes.
create function public.feedback_set_support(p_actor uuid, p_feedback uuid, p_liked boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare item public.campus_feedback_suggestions;
begin
  if p_actor is null then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_liked is null then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  select * into item from public.campus_feedback_suggestions where id = p_feedback for update;
  if item.id is null or item.visibility <> 'public' then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if p_liked then
    insert into public.feedback_support_votes(feedback_id,user_id) values(p_feedback,p_actor) on conflict do nothing;
  else
    delete from public.feedback_support_votes where feedback_id = p_feedback and user_id = p_actor;
  end if;
  return jsonb_build_object('feedbackId',p_feedback,'liked',p_liked,'likeCount',
    (select like_count from public.campus_feedback_suggestions where id = p_feedback));
end;
$$;
revoke all on function public.feedback_set_support(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.feedback_set_support(uuid,uuid,boolean) to service_role;
commit;
