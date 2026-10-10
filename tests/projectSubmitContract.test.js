import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import * as availability from '../supabase/functions/campus-social/availability.js'
import { normalizeTaskWorkCheckpoint } from '../src/composables/tasks/taskWorkProgress.js'

const actor = '00000001-0000-4000-8000-000000000001'
const source = readFileSync(new URL('../supabase/functions/campus-social/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function setup() {
  let handler
  const admin = { auth: { getUser: async () => ({ data: { user: { id: actor, email_confirmed_at: '2026-01-01' } } }) },
    rpc: vi.fn(async () => ({ data: { allowed: true }, error: null })) }
  vm.runInNewContext(compiled, {
    Deno: { env: { get: (name) => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-server-key' })[name] }, serve: (callback) => { handler = callback } },
    require: (name) => {
      if (name === 'npm:@supabase/supabase-js@2.117.2') return { createClient: () => admin }
      if (name === './availability.js') return availability
      if (name === '../../../src/composables/tasks/taskWorkProgress.js') return { normalizeTaskWorkCheckpoint }
      throw new Error('Unexpected dependency: ' + name)
    }, exports: {}, Date, Request, Response, Headers, TextEncoder, TextDecoder, console, crypto,
  })
  return { handler, admin }
}
const request = (revision) => new Request('https://example.invalid/functions/v1/campus-social', {
  method: 'POST', headers: { Authorization: 'Bearer fictional-token', 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'project_deliverable_submit', payload: { projectId: actor, deliverableId: actor,
    versionId: actor, submissionKey: actor, ...(revision === undefined ? {} : { expectedRevision: revision }) } }),
})
describe('real Edge deliverable submit contract', () => {
  it('forwards the expected revision to the database', async () => {
    const { handler, admin } = setup()
    expect((await handler(request(6))).status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('project_dispatch', expect.objectContaining({ p_action: 'deliverable_submit', p_payload: expect.objectContaining({ expectedRevision: 6 }) }))
  })
  it('rejects invalid revisions before dispatch and preserves legacy callers', async () => {
    const { handler, admin } = setup()
    expect((await handler(request(-1))).status).toBe(400)
    expect(admin.rpc.mock.calls.some(([name]) => name === 'project_dispatch')).toBe(false)
    expect((await handler(request(undefined))).status).toBe(200)
  })
})
