// 一键把「源码里唯一的正式版本」（release.config.js 的 APP_VERSION）
// 同步到 root 与 desktop-app 的 package.json / package-lock.json。
//
// 为什么需要：bump-release.mjs 要求这六处版本号完全一致，否则拒绝写入任何文件；
// 只发 Web/PWA 时（AGENTS.md 的默认发布范围）手工对齐两个 lock 文件既繁琐又易错。
// 这个脚本只对齐版本号，不生成发布说明、不改 release-history.json。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { APP_VERSION } from '../release.config.js'

const TARGETS = [
  ['package.json', false],
  ['package-lock.json', true],
  ['desktop-app/package.json', false],
  ['desktop-app/package-lock.json', true],
]

const dryRun = process.argv.includes('--dry-run')
let changed = 0

for (const [relativePath, isLock] of TARGETS) {
  const path = fileURLToPath(new URL(`../${relativePath}`, import.meta.url))
  if (!existsSync(path)) {
    console.error(`✗ ${relativePath} 不存在；桌面端 lock 也必须保留，发版校验依赖它。`)
    process.exit(1)
  }
  const raw = readFileSync(path, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error(`✗ ${relativePath} 不是有效 JSON：${error.message}`)
    process.exit(1)
  }
  const before = parsed.version
  if (before === APP_VERSION) {
    console.log(`= ${relativePath} 已经是 ${APP_VERSION}`)
    continue
  }
  parsed.version = APP_VERSION
  if (isLock && parsed.packages?.['']) parsed.packages[''].version = APP_VERSION
  if (dryRun) {
    console.log(`~ ${relativePath} 将从 ${before ?? '(缺失)'} 改为 ${APP_VERSION}`)
    changed += 1
    continue
  }
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  console.log(`✓ ${relativePath} ${before ?? '(缺失)'} → ${APP_VERSION}`)
  changed += 1
}

console.log(changed
  ? dryRun ? `（--dry-run）共 ${changed} 个文件待更新。` : `共更新 ${changed} 个文件。接下来运行 npm run check:release 校验发布一致性。`
  : '全部文件已与 release.config.js 的版本一致。')