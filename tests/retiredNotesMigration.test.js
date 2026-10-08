import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(new URL('../supabase/migrations/20261008090340_retire_quick_notes.sql', import.meta.url))
const migration = readFileSync(migrationPath, 'utf8')

describe('云端退役笔记迁移', () => {
  it('先把旧笔记并入归档键，再移除旧键并升级同步 schema', () => {
    expect(migration).toContain('public.merge_retired_quick_notes')
    expect(migration).toContain("'{sl_archived_quick_notes}'")
    expect(migration).toContain("coalesce(p_values->'sl_quick_notes', '[]'::jsonb)")
    expect(migration).toContain('greatest(v_schema_version, 6)')
    expect(migration).toContain('account_snapshot_no_retired_quick_notes')
  })
})
