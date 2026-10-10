import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtureRoot = path.join(root, '.vitest-tmp', 'frontend', 'pages-csp')
const fixtures = []
const fictionalScript = 'globalThis.fictionalPagesCspFixture = true'

function fixtureProject() {
  mkdirSync(fixtureRoot, { recursive: true })
  const directory = mkdtempSync(path.join(fixtureRoot, 'fixture-'))
  fixtures.push(directory)
  mkdirSync(path.join(directory, 'scripts'), { recursive: true })
  mkdirSync(path.join(directory, 'public', 'desktop-auth-return'), { recursive: true })
  for (const file of ['scripts/verify-pages-config.mjs', 'index.html', 'public/_headers', 'public/desktop-auth-return/index.html']) {
    copyFileSync(path.join(root, file), path.join(directory, file))
  }
  writeFileSync(path.join(directory, 'wrangler.jsonc'), JSON.stringify({ pages_build_output_dir: './dist' }))
  return directory
}

function verify(directory) {
  const result = spawnSync(process.execPath, [path.join(directory, 'scripts', 'verify-pages-config.mjs')], { cwd: directory, encoding: 'utf8' })
  expect(result.error).toBeUndefined()
  return result
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(fixtureRoot) + path.sep)) throw new Error('Fixture cleanup outside approved workspace')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Pages production CSP build gate', () => {
  it.each([
    { label: 'nested public classic script', file: 'public/desktop-auth-return/index.html', attributes: '' },
    { label: 'nested public inline module', file: 'public/desktop-auth-return/index.html', attributes: ' type="module"' },
    { label: 'root inline module', file: 'index.html', attributes: ' type="module"' },
  ])('rejects an unapproved $label', ({ file, attributes }) => {
    const directory = fixtureProject()
    const target = path.join(directory, file)
    writeFileSync(target, readFileSync(target, 'utf8') + `<script${attributes}>${fictionalScript}</script>`)
    const result = verify(directory)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain(file)
    expect(result.stderr).toContain('SHA-256')
  })

  it('rejects a hash approved only by style-src', () => {
    const directory = fixtureProject()
    const html = path.join(directory, 'index.html')
    writeFileSync(html, readFileSync(html, 'utf8') + `<script>${fictionalScript}</script>`)
    const headers = path.join(directory, 'public', '_headers')
    const styleHash = createHash('sha256').update(fictionalScript).digest('base64')
    writeFileSync(headers, readFileSync(headers, 'utf8').replace("style-src 'self'", `style-src 'self' 'sha256-${styleHash}'`))
    const result = verify(directory)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('index.html')
    expect(result.stderr).toContain('SHA-256')
  })

  it('accepts every current first-party HTML script under the production policy', () => {
    const result = verify(root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Cloudflare Pages')
  })
})
