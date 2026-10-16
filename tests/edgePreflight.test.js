import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

function preflightHandler(name) {
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const client = { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() }
  let handler
  vm.runInNewContext(compiled, {
    Deno: { env: { get: () => '' }, serve: callback => { handler = callback } },
    require: dependency => dependency.startsWith('npm:@supabase/') ? { createClient: () => client } : {},
    exports: {}, URL, Request, Response, Headers, TextEncoder, TextDecoder, console, crypto,
  }, { filename: `${name}/index.ts` })
  return { handler, client }
}

describe('browser preflight round trips', () => {
  it.each(['campus-social', 'campus-life', 'campus-community'])('%s reuses allowed preflights without touching the database', async name => {
    const { handler, client } = preflightHandler(name)
    const response = await handler(new Request('https://fictional.supabase.co/functions/v1/' + name, {
      method: 'OPTIONS', headers: { Origin: 'https://study-life.pages.dev', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-supabase-api-version' },
    }))
    expect(response.status).toBe(200)
    expect(Number(response.headers.get('Access-Control-Max-Age'))).toBeGreaterThanOrEqual(3600)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://study-life.pages.dev')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-supabase-api-version')
    expect(response.headers.get('Vary')).toContain('Origin')
    expect(client.auth.getUser).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
    const denied = await handler(new Request('https://fictional.supabase.co/functions/v1/' + name, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example.invalid' } }))
    expect(denied.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })
})
