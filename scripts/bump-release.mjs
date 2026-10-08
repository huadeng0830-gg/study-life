// 发布物料更新脚本：
//   node scripts/bump-release.mjs                # 只把 RELEASE_SOURCE_SIGNATURE 同步为当前源码签名
//   node scripts/bump-release.mjs --notes "说明1|说明2"        # 新增一条版本说明并更新签名
//   node scripts/bump-release.mjs --amend-notes "说明1|说明2"  # 只修正**当前版本**的说明，不新增版本
//
// 新版本说明会同时递增桌面 SemVer 并刷新 README 发布区块；脚本对候选文件计算签名后再写入。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RELEASE_NOTES } from '../release.config.js'
import { computeSourceSignature } from './source-signature.mjs'
import { buildReleaseEntry, MAX_RELEASE_ENTRIES, nextVersion, replaceCurrentNotes, trimReleaseUpdates, validateReleaseNotes } from './version-utils.mjs'
import { syncReleaseStatus } from './release-readme.mjs'

const RELEASE_PATH = fileURLToPath(new URL('../release.config.js', import.meta.url))
const DESKTOP_PACKAGE_PATH = fileURLToPath(new URL('../desktop-app/package.json', import.meta.url))
const DESKTOP_LOCK_PATH = fileURLToPath(new URL('../desktop-app/package-lock.json', import.meta.url))
const README_PATH = fileURLToPath(new URL('../README.md', import.meta.url))

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

function incrementPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ''))
  if (!match) throw new Error(`桌面版版本号必须是纯 SemVer x.y.z，目前为 ${JSON.stringify(version)}`)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

const { notes, amend } = parseArgs(process.argv.slice(2))
const original = readFileSync(RELEASE_PATH, 'utf8')
const desktopPackage = JSON.parse(readFileSync(DESKTOP_PACKAGE_PATH, 'utf8'))
const desktopLock = JSON.parse(readFileSync(DESKTOP_LOCK_PATH, 'utf8'))
const originalReadme = readFileSync(README_PATH, 'utf8')

if (desktopPackage.version !== desktopLock.version || desktopPackage.version !== desktopLock.packages?.['']?.version) {
  console.error('✗ desktop-app/package.json 与 package-lock.json 的桌面版本号不一致，未写入任何内容')
  process.exit(1)
}

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
  const releaseHeader = /export const RELEASE_UPDATES = Object\.freeze\(\[\r?\n/
  const headerMatch = releaseHeader.exec(original)
  if (!headerMatch) {
    console.error('✗ 没能在 release.config.js 里定位版本列表，未写入任何内容')
    process.exit(1)
  }
  const eol = headerMatch[0].endsWith('\r\n') ? '\r\n' : '\n'
  const insertAt = headerMatch.index + headerMatch[0].length
  const entry = buildReleaseEntry(version, notes).replace(/\n/g, eol)
  candidate = `${original.slice(0, insertAt)}${entry}${original.slice(insertAt)}`
}

// 1b. 无论新增还是只改说明，历史都裁到最多 MAX_RELEASE_ENTRIES 条：
//     release.config.js 会被首屏静态打包，超长历史等于白背体积。
candidate = trimReleaseUpdates(candidate, MAX_RELEASE_ENTRIES)

// 新增一条正式发布说明时同步递增桌面 SemVer；electron-updater 按此版本判断是否需要更新。
// 修订当前说明不会制造一个新安装包版本。
let nextDesktopVersion = desktopPackage.version
let desktopPackageCandidate = null
let desktopLockCandidate = null
if (notes.length && !amend) {
  try {
    nextDesktopVersion = incrementPatchVersion(desktopPackage.version)
  } catch (error) {
    console.error(`✗ ${error.message}，未写入任何内容`)
    process.exit(1)
  }
  desktopPackageCandidate = { ...desktopPackage, version: nextDesktopVersion }
  desktopLockCandidate = {
    ...desktopLock,
    version: nextDesktopVersion,
    packages: {
      ...desktopLock.packages,
      '': { ...desktopLock.packages[''], version: nextDesktopVersion },
    },
  }
}

// 2. 用“候选内容”计算签名：候选里的签名字段会被归一化，因此计算结果
//    与最终落盘文件的签名一致（新条目 / 新说明的 notes 已经参与哈希）。
const sourceFileContents = desktopPackageCandidate
  ? {
      'desktop-app/package.json': serializeJson(desktopPackageCandidate),
      'desktop-app/package-lock.json': serializeJson(desktopLockCandidate),
    }
  : {}
const signature = computeSourceSignature({ releaseConfigContent: candidate, sourceFileContents })

// 3. 把签名写入候选内容：同步 RELEASE_SOURCE_SIGNATURE，并把新条目占位填上。
let finalized = candidate
  .replace(/RELEASE_SOURCE_SIGNATURE = '[^']*'/, `RELEASE_SOURCE_SIGNATURE = '${signature}'`)
if (notes.length && amend) {
  // 说明变了，当前版本条目的 signature 字段也要跟着更新——否则条目里会留一个
  // 属于旧说明的签名。只改 RELEASE_UPDATES 的第一条，历史条目原样不动。
  const before = finalized
  const currentSignaturePattern = /(RELEASE_UPDATES = Object\.freeze\(\[\r?\n  \{\r?\n    version: '[^']*',\r?\n    signature: ')[^']*(')/
  finalized = finalized.replace(
    currentSignaturePattern,
    `$1${signature}$2`
  )
  if (finalized === before) {
    console.error('✗ 没能更新当前版本条目的 signature，未写入任何内容')
    process.exit(1)
  }
} else if (notes.length) {
  finalized = finalized.replace(/signature: ''/, `signature: '${signature}'`)
}

const newVersion = firstVersionOf(finalized)
let readmeCandidate
try {
  readmeCandidate = syncReleaseStatus(originalReadme, {
    webVersion: newVersion,
    desktopVersion: nextDesktopVersion,
    notes: notes.length ? notes : RELEASE_NOTES,
  })
} catch (error) {
  console.error(`✗ ${error.message}，未写入任何内容`)
  process.exit(1)
}

writeFileSync(RELEASE_PATH, finalized)
if (desktopPackageCandidate) {
  writeFileSync(DESKTOP_PACKAGE_PATH, serializeJson(desktopPackageCandidate))
  writeFileSync(DESKTOP_LOCK_PATH, serializeJson(desktopLockCandidate))
}
writeFileSync(README_PATH, readmeCandidate)

console.log(`✓ RELEASE_SOURCE_SIGNATURE 已更新为 ${signature}`)
console.log(notes.length && amend
  ? `✓ 已修正版本条目 ${newVersion} 的说明（未新增版本）`
  : notes.length
    ? `✓ 已新增版本条目：${newVersion}`
    : '✓ 未新增版本条目（可运行 node scripts/bump-release.mjs --notes "..." 补一条说明）')
console.log(`当前版本：${newVersion}`)
console.log(`Windows 桌面版：${nextDesktopVersion}${desktopPackageCandidate ? '（已递增 patch）' : ''}`)
console.log('✓ README.md 的版本号与最近更新摘要已同步')
