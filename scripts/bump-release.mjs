// 发布物料更新脚本：
//   node scripts/bump-release.mjs                # 只把 RELEASE_SOURCE_SIGNATURE 同步为当前源码签名
//   node scripts/bump-release.mjs --notes "说明1|说明2"        # 新增一条版本说明并更新签名
//   node scripts/bump-release.mjs --amend-notes "说明1|说明2"  # 只修正**当前版本**的说明，不新增版本
//
// 说明必须概括本次源码改动；脚本会用“写入后的 release.config.js”计算签名，
// 保证 vite.config.js 的 production 校验（说明与源码必须一起更新）直接通过。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { computeSourceSignature, PROJECT_ROOT } from './source-signature.mjs'
import { buildReleaseEntry, nextVersion, replaceCurrentNotes, validateReleaseNotes } from './version-utils.mjs'

const RELEASE_PATH = fileURLToPath(new URL('../release.config.js', import.meta.url))

function parseArgs(argv) {
  const notesIndex = argv.indexOf('--notes')
  const amendIndex = argv.indexOf('--amend-notes')
  const raw = notesIndex !== -1 && argv[notesIndex + 1]
    ? String(argv[notesIndex + 1])
    : amendIndex !== -1 && argv[amendIndex + 1] ? String(argv[amendIndex + 1]) : ''
  const notes = raw.split('|').map((note) => note.trim()).filter(Boolean)
  return { notes, amend: amendIndex !== -1 }
}

function firstVersionOf(content) {
  const match = /version: '([^']+)'/.exec(content)
  return match ? match[1] : null
}

const { notes, amend } = parseArgs(process.argv.slice(2))
const original = readFileSync(RELEASE_PATH, 'utf8')

// 0. 写入前先校验说明。说明是手写并经 shell 传参的，引号很容易被吃掉：
//    实测 `--notes "\"/\" 打开全局搜索…"` 传到脚本里只剩一个反斜杠，
//    脚本照写不误，直到 tests/releaseNotes.test.js 才报红。宁可在这里拒绝。
if (notes.length || amend) {
  const problems = validateReleaseNotes(notes)
  if (problems.length) {
    console.error('✗ 版本说明校验不通过，未写入任何内容：')
    problems.forEach((problem) => console.error(`  - ${problem}`))
    process.exit(1)
  }
}

// 1. 有说明时：默认在 RELEASE_UPDATES 顶部插入新条目（signature 占位，稍后统一填写）；
//    `--amend-notes` 则只替换当前版本那条的说明，不新增版本。
let candidate = original
if (notes.length && amend) {
  const replaced = replaceCurrentNotes(original, notes)
  if (!replaced || replaced === original) {
    console.error('✗ 没能在 release.config.js 里定位当前版本的说明块，未写入任何内容')
    process.exit(1)
  }
  candidate = replaced
} else if (notes.length) {
  const version = nextVersion([{ version: firstVersionOf(original) }])
  candidate = original.replace(
    /export const RELEASE_UPDATES = Object\.freeze\(\[\n/,
    `export const RELEASE_UPDATES = Object.freeze([\n${buildReleaseEntry(version, notes)}`
  )
}

// 2. 用“候选内容”计算签名：候选里的签名字段会被归一化，因此计算结果
//    与最终落盘文件的签名一致（新条目 / 新说明的 notes 已经参与哈希）。
const signature = computeSourceSignature({ releaseConfigContent: candidate })

// 3. 把签名写入候选内容：同步 RELEASE_SOURCE_SIGNATURE，并把新条目占位填上。
let finalized = candidate
  .replace(/RELEASE_SOURCE_SIGNATURE = '[^']*'/, `RELEASE_SOURCE_SIGNATURE = '${signature}'`)
if (notes.length && amend) {
  // 说明变了，当前版本条目的 signature 字段也要跟着更新——否则条目里会留一个
  // 属于旧说明的签名。只改 RELEASE_UPDATES 的第一条，历史条目原样不动。
  const before = finalized
  finalized = finalized.replace(
    /(RELEASE_UPDATES = Object\.freeze\(\[\n  \{\n    version: '[^']*',\n    signature: ')[^']*(')/,
    `$1${signature}$2`
  )
  if (finalized === before) {
    console.error('✗ 没能更新当前版本条目的 signature，未写入任何内容')
    process.exit(1)
  }
} else if (notes.length) {
  finalized = finalized.replace(/signature: ''/, `signature: '${signature}'`)
}

writeFileSync(RELEASE_PATH, finalized)

const newVersion = firstVersionOf(finalized)
console.log(`✓ RELEASE_SOURCE_SIGNATURE 已更新为 ${signature}`)
console.log(notes.length && amend
  ? `✓ 已修正版本条目 ${newVersion} 的说明（未新增版本）`
  : notes.length
    ? `✓ 已新增版本条目：${newVersion}`
    : '✓ 未新增版本条目（可运行 node scripts/bump-release.mjs --notes "..." 补一条说明）')
console.log(`当前版本：${newVersion}`)