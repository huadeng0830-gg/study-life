-- Administrative bucket configuration only; never alter object rows or files.
-- Existing files keep their read permissions. Only new uploads are capped.
update storage.buckets
  set file_size_limit = 5242880
  where id = 'qixing-deliverables' and public = false
  returning id, public, file_size_limit;
