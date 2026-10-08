// 发布源码签名：vite.config.js 与 scripts/bump-release.mjs 共用。
// 相同源码永远得到相同版本；任何发布源码修改后都会自动得到新签名。
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))

export const RELEASE_INPUTS = ['src', 'functions', 'public', 'desktop', 'desktop-app', 'index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'electron-builder.yml', 'release.config.js', 'wrangler.jsonc']

export function collectReleaseFiles(target) {
  if (!existsSync(target)) return []
  if (!statSync(target).isDirectory()) return [target]
  return readdirSync(target, { withFileTypes: true })
    // 安装后依赖不属于仓库源码；把它纳入签名会令本机和干净 CI 算出不同结果。
    .filter((entry) => !['node_modules', '.git'].includes(entry.name))
    .flatMap((entry) => collectReleaseFiles(resolve(target, entry.name)))
}

// 二进制判定沿用 git 的启发式：首块里出现 NUL 字节即视为二进制。
// 这一步必须有，否则 png / wasm / traineddata 会被 utf8 解码成大量 U+FFFD，
// 不同字节解码成同一个字符串 —— 换图标、换 OCR 模型都不会触发闸门。
const BINARY_SNIFF_BYTES = 8000

function normalizeEol(content) {
  return content.replace(/\r\n/g, '\n')
}

// release.config.js 同时保存说明与签名；对签名字段归一化，避免哈希自引用，
// 但说明正文仍参与签名，确保业务代码和更新说明必须一起更新。
export function normalizeReleaseConfig(content) {
  return content
    .replace(/signature: '[^']*'/g, "signature: '<source-signature>'")
    .replace(/RELEASE_SOURCE_SIGNATURE = '[^']*'/, "RELEASE_SOURCE_SIGNATURE = '<source-signature>'")
}

// sourceFileContents 允许发布脚本对尚未落盘的发布文件计算签名，
// 避免先写版本号、再补签名时留下部分更新的工作区。
export function computeSourceSignature({
  projectRoot = PROJECT_ROOT,
  releaseInputs = RELEASE_INPUTS,
  releaseConfigContent = null,
  sourceFileContents = {},
} = {}) {
  const hash = createHash('sha256')
  const files = releaseInputs
    .flatMap((input) => collectReleaseFiles(resolve(projectRoot, input)))
    .sort((a, b) => a.localeCompare(b))
  for (const file of files) {
    const relativePath = relative(projectRoot, file).replaceAll('\\', '/')
    hash.update(relativePath)
    const sourceOverride = sourceFileContents[relativePath]
    const buffer = sourceOverride === undefined ? readFileSync(file) : Buffer.from(sourceOverride, 'utf8')
    if (relativePath === 'release.config.js') {
      // 这个文件永远按文本处理，并且换行先归一化。
      let content = releaseConfigContent !== null ? releaseConfigContent : buffer.toString('utf8')
      content = normalizeReleaseConfig(content)
      hash.update(normalizeEol(content), 'utf8')
      continue
    }
    const isBinary = buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)
    if (isBinary) {
      // 二进制按原始字节入哈希：任何比特变化都必须被看见。
      hash.update(buffer)
    } else {
      // 文本统一 CRLF → LF。没有这一步，工作区是 LF 还是 CRLF 会算出两个签名，
      // 而 core.autocrlf 是每台机器各自的本地配置 —— 签名因此无法跨机器复现。
      hash.update(normalizeEol(buffer.toString('utf8')), 'utf8')
    }
  }
  return hash.digest('hex').slice(0, 10)
}
