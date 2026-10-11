import { describe, expect, it } from 'vitest'
import { isExpectedDesktopUpdateSource } from '../scripts/desktop-update-source.mjs'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { FileMatcher } = require('app-builder-lib/out/fileMatcher.js')
const yaml = require('js-yaml')

describe('packaged desktop update source', () => {
  it('实际 Electron 打包过滤器保留主进程引用的全部本地模块', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const appRoot = path.join(root, 'desktop-app')
    const config = yaml.load(readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'))
    const included = new FileMatcher(appRoot, path.join(root, 'release-desktop'), (value) => value, config.files).createFilter()
    const main = readFileSync(path.join(appRoot, 'main.cjs'), 'utf8')
    const modules = ['main.cjs', 'preload.cjs', ...[...main.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)].map((match) => match[1])]
    expect(modules).toContain('verifiedNsisUpdater.cjs')
    for (const module of modules) {
      const full = path.join(appRoot, module)
      expect(included(full, statSync(full)), `${module} 被生产打包过滤器排除`).toBe(true)
    }
  })
  it('accepts only the canonical public repository', () => {
    expect(isExpectedDesktopUpdateSource(`
owner: huadeng0830-gg
repo: study-life
provider: github
releaseType: release
`)).toBe(true)
  })

  it('rejects the legacy feed embedded in installed v1.0.3', () => {
    expect(isExpectedDesktopUpdateSource(`
owner: huadeng0830-gg
repo: study-life-desktop-releases
provider: github
`)).toBe(false)
  })

  it('rejects the right repository with the wrong owner or provider', () => {
    expect(isExpectedDesktopUpdateSource('owner: someone-else\nrepo: study-life\nprovider: github')).toBe(false)
    expect(isExpectedDesktopUpdateSource('owner: huadeng0830-gg\nrepo: study-life\nprovider: generic')).toBe(false)
  })
})
