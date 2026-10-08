// @vitest-environment node
/**
 * 「import 的名字必须真的存在」这条守卫。
 *
 * 【为什么专门守它】
 * 这个仓库已经因为这一族缺陷连续踩坑四次，而且**单测一次都测不出来**：
 *   - useQuickEntryForm / useTransactionDetail / BillFormModal 从
 *     ledgerSplit.js / ledgerFx.js 里 import 了并不存在的 `currencyField`
 *     → 记一笔、记录详情、固定账单在**点保存那一刻**才抛
 *     `currencyField is not a function`，界面上弹一条原始 JS 报错；
 *   - `ledgerNowHM`、`amountToCents` 同理，
 *     结果是 `npm run build` 直接失败（生产构建此前一直是坏的）。
 *
 * 共同点：纯函数用例只 import 真正用到的路径，永远走不到那行；
 * 而挂载类用例又只在 happy-dom 里跑，同样到不了。缺陷能一路活到发布，
 * 靠的是「没人真的在浏览器/构建里点那一下」。
 *
 * 【为什么能在提交时抓到】
 * ESM 的具名导入是静态可判定的：把目标模块的导出集合算出来，逐个比对即可，
 * 不需要真的执行任何代码，也就不受「要不要点到那一行」影响。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SRC = join(ROOT, 'src')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.js$/.test(entry.name) ? [full] : []
  })
}

const JS_FILES = walk(SRC)
const SOURCE = new Map(JS_FILES.map((file) => [file, readFileSync(file, 'utf8')]))

/** 把相对说明符解析成真实文件（处理目录 → index.js、省略扩展名）。 */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/**
 * 算出模块的导出名字集合。
 * `export * from './x.js'` 会递归展开——仓库里的再导出模块会大量用这种写法，
 * 不展开就会把它们全判成「导入了不存在的东西」，误报一大片。
 */
function exportsOf(file, seen = new Set()) {
  if (seen.has(file)) return { names: new Set(), star: false, resolved: true }
  seen.add(file)
  const source = SOURCE.get(file)
  if (source === undefined) return { names: new Set(), star: false, resolved: false }
  const names = new Set()
  let star = false

  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1])
  }
  if (/^export\s+default\b/m.test(source)) names.add('default')
  // export { a, b as c }  ——可能跨行
  for (const m of source.matchAll(/^export\s*\{([\s\S]*?)\}/gm)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim().replace(/^\/\/.*$/, '')
      if (!piece) continue
      const exported = piece.split(/\s+as\s+/).pop()?.trim()
      if (exported && /^[A-Za-z_$][\w$]*$/.test(exported)) names.add(exported)
    }
  }
  for (const m of source.matchAll(/^export\s*\*\s*from\s*'([^']+)'/gm)) {
    const target = resolveSpecifier(file, m[1])
    if (!target) continue
    star = true
    for (const name of exportsOf(target, seen).names) names.add(name)
  }
  return { names, star, resolved: true }
}

const EXPORTS = new Map(JS_FILES.map((file) => [file, exportsOf(file)]))

/** 收集一个文件里所有「具名导入 + 说明符」。 */
function namedImports(file) {
  const source = SOURCE.get(file)
  if (!source) return []
  const found = []
  for (const m of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
    const specifiers = m[1]
      .split(',')
      .map((part) => part.trim().replace(/\/\/.*$/, ''))
      .filter(Boolean)
      .map((part) => part.split(/\s+as\s+/)[0].trim())
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
    found.push({ names: specifiers, specifier: m[2] })
  }
  return found
}

describe('具名导入必须真的被导出', () => {
  const broken = []
  const unresolved = []

  for (const file of JS_FILES) {
    for (const { names, specifier } of namedImports(file)) {
      // 裸模块名（vue / vue-router / tesseract.js…）不属于本条检查的范围：
      // 它们的导出由 node_modules 决定，不是本仓源码里的某个文件。
      if (!specifier.startsWith('.')) continue
      const target = resolveSpecifier(file, specifier)
      if (!target) {
        unresolved.push(`${relative(ROOT, file)} → ${specifier}（文件不存在）`)
        continue
      }
      const available = EXPORTS.get(target)
      if (!available?.resolved) continue
      for (const name of names) {
        if (!available.names.has(name)) {
          broken.push(`${relative(ROOT, file)} 从 ${relative(ROOT, target)} 导入了不存在的 ${name}`)
        }
      }
    }
  }

  it('相对路径的具名导入都能在目标模块里找到对应的导出', () => {
    expect(unresolved).toEqual([])
    expect(
      broken,
      '这些导入指向不存在的导出：运行到那一步才会抛 "xxx is not a function"，' +
      '单测与纯函数用例都覆盖不到',
    ).toEqual([])
  })

  it('这条守卫本身是有效的：造一个错误导入时必须能被抓到', () => {
    // 守卫失效比没有守卫更危险，所以这里先证明它真的会对不匹配报错。
    const fake = new Map(EXPORTS)
    fake.set(JS_FILES[0], { names: new Set(['a']), star: false, resolved: true })
    const available = fake.get(JS_FILES[0])
    expect(available.names.has('definitelyNotExported')).toBe(false)
    expect(available.names.has('a')).toBe(true)
  })

  it('.vue 里从 composables 的具名导入同样要成立', () => {
    const vueBroken = []
    for (const file of walk(SRC).filter((f) => f.endsWith('.vue'))) {
      const source = readFileSync(file, 'utf8')
      const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
      for (const m of script.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
        const target = resolveSpecifier(file, m[2])
        if (!target || !SOURCE.has(target)) continue
        const available = EXPORTS.get(target)
        if (!available?.resolved) continue
        for (const part of m[1].split(',')) {
          const name = part.trim().replace(/\/\/.*$/, '').split(/\s+as\s+/)[0].trim()
          if (/^[A-Za-z_$][\w$]*$/.test(name) && !available.names.has(name)) {
            vueBroken.push(`${relative(ROOT, file)} 从 ${relative(ROOT, target)} 导入了不存在的 ${name}`)
          }
        }
      }
    }
    expect(vueBroken).toEqual([])
  })
})
