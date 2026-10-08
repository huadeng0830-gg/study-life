-- Keep project deliverables replaceable/removable only by an active project member
-- uploading under their own user directory while the project is still active.
create policy qixing_deliverables_replace on storage.objects
  for update to authenticated
  using (bucket_id = 'qixing-deliverables' and qixing_private.object_access(name, true))
  with check (bucket_id = 'qixing-deliverables' and qixing_private.object_access(name, true));

create policy qixing_deliverables_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'qixing-deliverables' and qixing_private.object_access(name, true));

-- The listInvitations dispatcher joins participants by invitation_id. The existing
-- user-first index does not cover that lookup or invitation cascade paths.
create index social_invitation_participants_invitation_id_idx
  on public.social_invitation_participants (invitation_id);
