// 发布物料更新脚本：
//   node scripts/bump-release.mjs                # 只把 RELEASE_SOURCE_SIGNATURE 同步为当前源码签名
//   node scripts/bump-release.mjs --notes "说明1|说明2"   # 同时新增一条版本说明并更新签名
//
// 说明必须概括本次源码改动；脚本会用“写入后的 release.config.js”计算签名，
// 保证 vite.config.js 的 production 校验（说明与源码必须一起更新）直接通过。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { computeSourceSignature, PROJECT_ROOT } from './source-signature.mjs'
import { buildReleaseEntry, nextVersion } from './version-utils.mjs'

const RELEASE_PATH = fileURLToPath(new URL('../release.config.js', import.meta.url))

function parseArgs(argv) {
  const notesIndex = argv.indexOf('--notes')
  const notes = notesIndex !== -1 && argv[notesIndex + 1]
    ? String(argv[notesIndex + 1]).split('|').map((note) => note.trim()).filter(Boolean)
    : []
  return { notes }
}

function firstVersionOf(content) {
  const match = /version: '([^']+)'/.exec(content)
  return match ? match[1] : null
}

const { notes } = parseArgs(process.argv.slice(2))
const original = readFileSync(RELEASE_PATH, 'utf8')

// 1. 有说明时，在 RELEASE_UPDATES 顶部插入新条目（signature 占位，稍后统一填写）。
let candidate = original
if (notes.length) {
  const version = nextVersion([{ version: firstVersionOf(original) }])
  candidate = original.replace(
    /export const RELEASE_UPDATES = Object\.freeze\(\[\n/,
    `export const RELEASE_UPDATES = Object.freeze([\n${buildReleaseEntry(version, notes)}`
  )
}

// 2. 用“候选内容”计算签名：候选里的签名字段会被归一化，因此计算结果
//    与最终落盘文件的签名一致（新条目的 notes 已经参与哈希）。
const signature = computeSourceSignature({ releaseConfigContent: candidate })

// 3. 把签名写入候选内容：同步 RELEASE_SOURCE_SIGNATURE，并把新条目占位填上。
let finalized = candidate
  .replace(/RELEASE_SOURCE_SIGNATURE = '[^']*'/, `RELEASE_SOURCE_SIGNATURE = '${signature}'`)
if (notes.length) {
  finalized = finalized.replace(/signature: ''/, `signature: '${signature}'`)
}

writeFileSync(RELEASE_PATH, finalized)

const newVersion = firstVersionOf(finalized)
console.log(`✓ RELEASE_SOURCE_SIGNATURE 已更新为 ${signature}`)
console.log(notes.length
  ? `✓ 已新增版本条目：${newVersion}`
  : `✓ 未新增版本条目（可运行 node scripts/bump-release.mjs --notes "..." 补一条说明）`)
console.log(`当前版本：${newVersion}`)