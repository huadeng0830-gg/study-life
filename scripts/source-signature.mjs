// 发布源码签名：vite.config.js 与 scripts/bump-release.mjs 共用。
// 相同源码永远得到相同版本；任何发布源码修改后都会自动得到新签名。
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))

export const RELEASE_INPUTS = ['src', 'functions', 'sync-coordinator', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'release.config.js', 'wrangler.jsonc']

export function collectReleaseFiles(target) {
  if (!existsSync(target)) return []
  if (!statSync(target).isDirectory()) return [target]
  return readdirSync(target, { withFileTypes: true })
    .flatMap((entry) => collectReleaseFiles(resolve(target, entry.name)))
}

// release.config.js 同时保存说明与签名；对签名字段归一化，避免哈希自引用，
// 但说明正文仍参与签名，确保业务代码和更新说明必须一起更新。
export function normalizeReleaseConfig(content) {
  return content
    .replace(/signature: '[^']*'/g, "signature: '<source-signature>'")
    .replace(/RELEASE_SOURCE_SIGNATURE = '[^']*'/, "RELEASE_SOURCE_SIGNATURE = '<source-signature>'")
}

// releaseConfigContent 允许传入“即将写入但尚未落盘”的 release.config.js 内容，
// 供 bump-release 在写入前计算与最终文件一致的签名。
export function computeSourceSignature({
  projectRoot = PROJECT_ROOT,
  releaseInputs = RELEASE_INPUTS,
  releaseConfigContent = null,
} = {}) {
  const hash = createHash('sha256')
  const files = releaseInputs
    .flatMap((input) => collectReleaseFiles(resolve(projectRoot, input)))
    .sort((a, b) => a.localeCompare(b))
  for (const file of files) {
    const relativePath = relative(projectRoot, file).replaceAll('\\', '/')
    hash.update(relativePath)
    let content = readFileSync(file, 'utf8')
    if (relativePath === 'release.config.js' && releaseConfigContent !== null) {
      content = releaseConfigContent
    }
    if (relativePath === 'release.config.js') {
      content = normalizeReleaseConfig(content)
    }
    hash.update(content)
  }
  return hash.digest('hex').slice(0, 10)
}