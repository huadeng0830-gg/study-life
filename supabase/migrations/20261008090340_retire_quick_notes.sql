-- Move retired standalone notes into a syncable archive before removing their
-- active collection. Preserve older clients' notes as well as prior archives.
create or replace function public.merge_retired_quick_notes(p_existing jsonb, p_incoming jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with candidates as (
    select
      coalesce(nullif(note.value->>'id', ''), note.value::text) as note_key,
      note.value as item,
      0 as source_order,
      note.ordinal
    from jsonb_array_elements(case when jsonb_typeof(p_existing) = 'array' then p_existing else '[]'::jsonb end)
      with ordinality as note(value, ordinal)
    union all
    select
      coalesce(nullif(note.value->>'id', ''), note.value::text) as note_key,
      note.value as item,
      1 as source_order,
      note.ordinal
    from jsonb_array_elements(case when jsonb_typeof(p_incoming) = 'array' then p_incoming else '[]'::jsonb end)
      with ordinality as note(value, ordinal)
  ), deduplicated as (
    select distinct on (note_key) note_key, item, source_order, ordinal
    from candidates
    order by note_key, source_order desc, ordinal desc
  )
  select coalesce(jsonb_agg(item order by source_order, ordinal), '[]'::jsonb)
  from deduplicated;
$function$;

create or replace function public.retire_quick_note_values(p_values jsonb, p_previous_values jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_values jsonb;
  v_notes jsonb;
  v_collection jsonb;
  v_key text;
begin
  v_values := coalesce(p_values, '{}'::jsonb) - 'sl_quick_notes';
  if p_values ? 'sl_archived_quick_notes' then
    -- A current client owns the archive value and may intentionally clear it.
    v_notes := coalesce(p_values->'sl_archived_quick_notes', '[]'::jsonb);
  else
    -- Older clients do not know the archive key; keep the server's copy.
    v_notes := coalesce(p_previous_values->'sl_archived_quick_notes', '[]'::jsonb);
  end if;
  v_notes := public.merge_retired_quick_notes(v_notes, coalesce(p_values->'sl_quick_notes', '[]'::jsonb));
  v_values := jsonb_set(v_values, '{sl_archived_quick_notes}', v_notes, true);

  foreach v_key in array array['sl_tasks', 'sl_events'] loop
    if jsonb_typeof(v_values->v_key) = 'array' then
      select coalesce(jsonb_agg(
        case when item.value->>'sourceType' = 'note'
          then item.value || jsonb_build_object(
            'sourceType', '', 'sourceId', '', 'relationId', '', 'updatedAt', now()::text
          )
          else item.value
        end
        order by item.ordinal
      ), '[]'::jsonb)
      into v_collection
      from jsonb_array_elements(v_values->v_key)
        with ordinality as item(value, ordinal);
      v_values := jsonb_set(v_values, array[v_key], v_collection, true);
    end if;
  end loop;
  return v_values;
end;
$function$;

create or replace function public.retire_quick_note_manifest(p_manifest jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_manifest jsonb := coalesce(p_manifest, '{}'::jsonb);
  v_collection jsonb;
  v_key text;
  v_schema_version integer := 1;
begin
  if coalesce(v_manifest->>'schemaVersion', '') ~ '^\d+$' then
    v_schema_version := (v_manifest->>'schemaVersion')::integer;
  end if;
  v_manifest := jsonb_set(v_manifest, '{schemaVersion}', to_jsonb(greatest(v_schema_version, 6)), true);
  v_manifest := jsonb_set(
    v_manifest,
    '{entities}',
    coalesce(v_manifest->'entities', '{}'::jsonb) - 'sl_quick_notes',
    true
  );
  foreach v_key in array array['tombstones', 'restoreMarkers'] loop
    if jsonb_typeof(v_manifest->v_key) = 'array' then
      select coalesce(jsonb_agg(item.value order by item.ordinal), '[]'::jsonb)
      into v_collection
      from jsonb_array_elements(v_manifest->v_key)
        with ordinality as item(value, ordinal)
      where coalesce(item.value->>'entityType', '') <> 'Note';
      v_manifest := jsonb_set(v_manifest, array[v_key], v_collection, true);
    end if;
  end loop;
  return v_manifest;
end;
$function$;

-- These helpers only normalize caller-owned JSON. The trigger below uses them
-- for authenticated account snapshot writes.
revoke all on function public.merge_retired_quick_notes(jsonb, jsonb) from public, anon;
revoke all on function public.retire_quick_note_values(jsonb, jsonb) from public, anon;
revoke all on function public.retire_quick_note_manifest(jsonb) from public, anon;
grant execute on function public.merge_retired_quick_notes(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.retire_quick_note_values(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.retire_quick_note_manifest(jsonb) to authenticated, service_role;

create or replace function public.strip_retired_quick_notes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_previous_values jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' then
    v_previous_values := coalesce(old.payload->'values', '{}'::jsonb);
  end if;
  new.payload := jsonb_set(
    new.payload,
    '{values}',
    public.retire_quick_note_values(coalesce(new.payload->'values', '{}'::jsonb), v_previous_values),
    true
  );
  new.payload := jsonb_set(
    new.payload,
    '{manifest}',
    public.retire_quick_note_manifest(coalesce(new.payload->'manifest', '{}'::jsonb)),
    true
  );
  return new;
end;
$function$;

revoke all on function public.strip_retired_quick_notes() from public, anon, authenticated;
create trigger account_snapshot_strip_retired_quick_notes
  before insert or update on public.account_sync_snapshots
  for each row execute function public.strip_retired_quick_notes();

-- Archive every existing remote note before clearing its retired sync key and
-- relation metadata. Bump revisions so all active clients re-read the payload.
update public.account_sync_snapshots as snapshot
set payload = jsonb_set(
      jsonb_set(
        snapshot.payload,
        '{values}',
        public.retire_quick_note_values(coalesce(snapshot.payload->'values', '{}'::jsonb), '{}'::jsonb),
        true
      ),
      '{manifest}',
      public.retire_quick_note_manifest(coalesce(snapshot.payload->'manifest', '{}'::jsonb)),
      true
    ),
    revision = revision + 1,
    updated_at = now()
where (coalesce(snapshot.payload->'values', '{}'::jsonb) ? 'sl_quick_notes')
   or (coalesce(snapshot.payload #> '{manifest,entities}', '{}'::jsonb) ? 'sl_quick_notes')
   or exists (
     select 1
     from jsonb_array_elements(case
       when jsonb_typeof(snapshot.payload #> '{values,sl_tasks}') = 'array'
         then snapshot.payload #> '{values,sl_tasks}'
       else '[]'::jsonb
     end) as item(value)
     where item.value->>'sourceType' = 'note'
   )
   or exists (
     select 1
     from jsonb_array_elements(case
       when jsonb_typeof(snapshot.payload #> '{values,sl_events}') = 'array'
         then snapshot.payload #> '{values,sl_events}'
       else '[]'::jsonb
     end) as item(value)
     where item.value->>'sourceType' = 'note'
   )
   or exists (
     select 1
     from jsonb_array_elements(case
       when jsonb_typeof(snapshot.payload #> '{manifest,tombstones}') = 'array'
         then snapshot.payload #> '{manifest,tombstones}'
       else '[]'::jsonb
     end) as item(value)
     where item.value->>'entityType' = 'Note'
   )
   or exists (
     select 1
     from jsonb_array_elements(case
       when jsonb_typeof(snapshot.payload #> '{manifest,restoreMarkers}') = 'array'
         then snapshot.payload #> '{manifest,restoreMarkers}'
       else '[]'::jsonb
     end) as item(value)
     where item.value->>'entityType' = 'Note'
   );

-- Retired clients cannot reintroduce the active collection. Their note bodies
-- are merged into the archive, and the schema marker prevents newer clients
-- from overwriting the migrated payload with an older data shape.
alter table public.account_sync_snapshots
  add constraint account_snapshot_no_retired_quick_notes check (
    not (coalesce(payload #> '{values}', '{}'::jsonb) ? 'sl_quick_notes')
    and not (coalesce(payload #> '{manifest,entities}', '{}'::jsonb) ? 'sl_quick_notes')
  );
