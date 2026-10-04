// 类型债务棘轮：统计 `vue-tsc --checkJs` 的错误数，只允许变少，不允许变多。
//
// 【为什么不直接开 checkJs】实测数据（2026-10）：
//   checkJs 全开                5477条
//   关掉 noImplicitAny 后       2244 条   （-59%，但仍有 2244）
//   关掉 strictNullChecks 后    4218 条
// 剩余的 2244 条里，最大的一类是 TS2339「属性不存在于 never」——1488 条，
// 全部来自 `ref([])` 被推断成 `never[]` 这一条根因的级联（171 条是 `.id`、
// 80 条是 `.name`……）。要清掉它得给约 200 处数组补 JSDoc 标注，是一件需要
// 单独排期的工程，而不是顺手能做完的改动。
//
// 所以这里不追求"把checkJs 打开"，而是先保证**债务不再增长**：任何新增的类型
// 错误都会让这个脚本变红，而修掉旧错误会让它变绿并提示可以下调基线。
//
// 用法：
//   node scripts/typecheck-ratchet.mjs            # 与基线比较，变多则exit 1
//   node scripts/typecheck-ratchet.mjs --write    # 把当前值写成新基线（确认是主动改善后再用）
//   node scripts/typecheck-ratchet.mjs --report   # 只打印各错误码分布
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PROJECT_ROOT } from './source-signature.mjs'

const BASELINE_PATH = resolve(PROJECT_ROOT, 'scripts/typecheck-baseline.json')

// 「引用了不存在的名字」这一类必须是 0，且不参与棘轮比较 —— 它是硬红线。
//
// 理由：这类的绝大多数不是类型洁癖问题，而是**运行时会抛 ReferenceError 的真缺陷**。
// 本仓库已经因为同族问题出过两次事故（currencyField 从不存在的导出 import、
// ledgerNowHM 同样），而现有的 templateBindingIntegrity 守卫抓不到 ——
// 它只校验「具名导入在目标模块里确实存在」，管不到「这个标识符压根没被导入」。
// 本轮就是靠 checkJs 的 TS2304 抓到两个新的：
//   dataManagerPairing.js 调 revokeSyncDevice 但没导入 → 点「移除设备」必炸；
//   dataManagerSyncActions.js 引用 syncPreview 但没定义 → 点「关闭预览」必炸。
//
// 只收TS2304（Cannot find name），**不收** TS2551（Did you mean）：后者大量是
// 合法的厂商前缀探测，例如 FocusPanel 的 `window.AudioContext || window.webkitAudioContext`
// —— 那是有意的兼容写法，把它算成缺陷只会逼人把兼容代码删掉。
const MUST_BE_ZERO = new Set(['TS2304'])

// 固定这几个开关，保证每次统计口径一致 —— 换任何一个，数字都不可比。
const FLAGS = ['--noEmit', '--checkJs', '--noImplicitAny', 'false']

function runChecker() {
  // 不用 shell:true —— process.execPath 在 Windows 上是 "C:\Program Files\nodejs\node.exe"，
  // 交给 shell 会被按空格切开（'C:\Program' 不是可识别的命令）。
  const run = () => execFileSync(
    process.execPath,
    [resolve(PROJECT_ROOT, 'node_modules/vue-tsc/bin/vue-tsc.js'), ...FLAGS],
    { cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  try {
    return run()
  } catch (error) {
    // vue-tsc 发现类型错误时以非0 退出，诊断在 stdout 里；只有真正跑不起来才算失败。
    const output = [error?.stdout, error?.stderr].filter(Boolean).map(String).join('\n')
    if (output.trim()) return output
    throw error
  }
}

export function collectDiagnostics(output) {
  const byCode = {}
  const byFile = {}
  for (const line of String(output).split(/\r?\n/)) {
    const matched = /^(.+?)\(\d+,\d+\):\s+error\s+(TS\d+):/.exec(line.trim())
    if (!matched) continue
    const [, file, code] = matched
    byCode[code] = (byCode[code] || 0) + 1
    byFile[file] = (byFile[file] || 0) + 1
  }
  const total = Object.values(byCode).reduce((sum, n) => sum + n, 0)
  return { total, byCode, byFile }
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return null
  }
}

const args = new Set(process.argv.slice(2))
const output = runChecker()
const stats = collectDiagnostics(output)

if (args.has('--report')) {
  console.log(`类型错误总数：${stats.total}`)
  console.log('\n按错误码：')
  for (const [code, count] of Object.entries(stats.byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${code}`)
  }
  console.log('\n按文件（前 15）：')
  for (const [file, count] of Object.entries(stats.byFile).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(count).padStart(5)}  ${file}`)
  }
  process.exit(0)
}

const baseline = readBaseline()

// 硬红线优先于一切：哪怕总数比基线少，只要出现「引用不存在的名字」就必须失败。
const fatal = Object.entries(stats.byCode)
  .filter(([code, count]) => MUST_BE_ZERO.has(code) && count > 0)
if (fatal.length) {
  console.error('✗ 出现「引用了不存在的名字」，这类几乎都是运行时会抛 ReferenceError 的真缺陷：')
  for (const [code, count] of fatal) console.error(`  ${code}: ${count} 处`)
  console.error('\n明细：')
  for (const line of String(output).split(/\r?\n/)) {
    if (MUST_BE_ZERO.has(/TS\d+/.exec(line)?.[0] || '')) console.error(`  ${line.trim()}`)
  }
  process.exit(1)
}

if (args.has('--write')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ total: stats.total, flags: FLAGS, byCode: stats.byCode }, null, 2)}\n`)
  console.log(`✓ 基线已更新为 ${stats.total} 条`)
  process.exit(0)
}

if (!baseline) {
  console.log(`未找到基线文件。当前 ${stats.total} 条。`)
  console.log(`确认这是当前最好状态后，用 --write 写入基线：node scripts/typecheck-ratchet.mjs --write`)
  process.exit(0)
}

if (stats.total > baseline.total) {
  const delta = stats.total - baseline.total
  console.error(`类型债务比基线多了 ${delta} 条（基线 ${baseline.total} → 现在 ${stats.total}）。`)
  console.error('棘轮只允许变少。新增的类型错误要么修掉，要么在确实可接受时用 --write 主动上调基线。')
  const newCodes = Object.entries(stats.byCode)
    .filter(([code, count]) => count > (baseline.byCode?.[code] || 0))
    .sort((a, b) => (b[1] - (baseline.byCode?.[b[0]] || 0)) - (a[1] - (baseline.byCode?.[a[0]] || 0)))
  if (newCodes.length) {
    console.error('\n增长最多的错误码：')
    for (const [code, count] of newCodes.slice(0, 5)) {
      const before = baseline.byCode?.[code] || 0
      console.error(`  ${code}: ${before} → ${count}`)
    }
  }
  process.exit(1)
}

if (stats.total < baseline.total) {
  console.log(`✓ 类型错误比基线少了 ${baseline.total - stats.total} 条（${baseline.total} → ${stats.total}）。`)
  console.log('确认这个改善是主动为之后，可以下调基线：node scripts/typecheck-ratchet.mjs --write')
  process.exit(0)
}

console.log(`✓ 类型错误与基线持平：${stats.total} 条`)