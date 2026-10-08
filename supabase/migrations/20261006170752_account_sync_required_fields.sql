alter table public.account_sync_snapshots
  add constraint account_snapshot_required_fields check (
    payload ?& array['format', 'version', 'values', 'manifest']
    and payload->'version' = '3'::jsonb
    and payload->'values' <> 'null'::jsonb
    and payload->'manifest' <> 'null'::jsonb
  );
