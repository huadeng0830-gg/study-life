import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { verifySupabaseBundle } from '../scripts/supabase-build-checks.mjs'

const directories = []
function bundle() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'study-life-bundle-'))
  directories.push(directory)
  writeFileSync(path.join(directory, 'app.js'), 'const config = { url: "https://example.supabase.co", key: "sb_publishable_public-demo" }')
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Supabase 发布产物检查', () => {
  it('验证 JS 中有公开配置，并扫描 HTML、CSS、source map 等文本文件', () => {
    const directory = bundle()
    mkdirSync(path.join(directory, 'assets'))
    writeFileSync(path.join(directory, 'index.html'), '<html>safe</html>')
    writeFileSync(path.join(directory, 'assets', 'style.css'), 'body { color: black }')
    writeFileSync(path.join(directory, 'assets', 'app.js.map'), '{"sources":[]}')
    expect(verifySupabaseBundle(directory, {
      url: 'https://example.supabase.co', key: 'sb_publishable_public-demo',
    })).toBe(1)
  })

  it.each([
    ['HTML', 'index.html', '<script>window.key="sb_secret_0123456789abcdef0123"</script>'],
    ['CSS', 'assets.css', '/* postgres://admin:password@db.example.com/private */'],
    ['source map', 'app.js.map', JSON.stringify({ sourcesContent: ['-----BEGIN PRIVATE KEY-----'] })],
  ])('在 %s 中发现秘密时阻止通过', (_label, file, contents) => {
    const directory = bundle()
    writeFileSync(path.join(directory, file), contents)
    expect(() => verifySupabaseBundle(directory, {
      url: 'https://example.supabase.co', key: 'sb_publishable_public-demo',
    })).toThrow(/构建产物检测到/)
  })

  it('解码 JWT 并拒绝 service_role 权限', () => {
    const directory = bundle()
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = `${encode({ alg: 'HS256' })}.${encode({ role: 'service_role' })}.signaturepadding123`
    writeFileSync(path.join(directory, 'version.txt'), token)
    expect(() => verifySupabaseBundle(directory, {
      url: 'https://example.supabase.co', key: 'sb_publishable_public-demo',
    })).toThrow(/service-role JWT/)
  })
})
