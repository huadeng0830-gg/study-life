// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { globSync } from 'glob'
import { splitCssRules, stripCssComments, maskStrings } from '../scripts/css-rules.mjs'

/**
 * 顺序敏感度穷举检查（§4.24 / §1.65 候选）。
 *
 * 找出同一上下文、共享类名、同特异性、声明冲突、相对顺序翻转的规则对。
 * 这类规则的相对顺序决定了谁赢（后来者居上），顺序一变就换样式——是脆弱点。
 *
 * 注意：天然会有大量合法命中（如 `.tt-cell:hover` 与 `.tt-cell.isToday` 刻意共存），
 * 本检查只做**标记与报告**，不作为失败判据（除非显式开启严格模式）。
 */

function parseSelector(selector) {
  // 简易特异性计算：(id, class, element)
  const parts = selector.split(/\s*,\s*/)
  let maxSpecificity = [0, 0, 0]
  for (const part of parts) {
    const ids = (part.match(/#[\w-]+/g) || []).length
    const classes = (part.match(/\.[\w-]+/g) || []).length
    const elements = (part.match(/^\w+|[ >+~]\s*\w+/g) || []).filter(
      t => !t.startsWith('.') && !t.startsWith('#') && !t.startsWith(':') && !t.startsWith('[')
    ).length
    if (ids > maxSpecificity[0] ||
        (ids === maxSpecificity[0] && classes > maxSpecificity[1]) ||
        (ids === maxSpecificity[0] && classes === maxSpecificity[1] && elements > maxSpecificity[2])) {
      maxSpecificity = [ids, classes, elements]
    }
  }
  return maxSpecificity
}

function extractClassNames(selector) {
  return selector.match(/\.[\w-]+/g) || []
}

function extractDeclarations(body) {
  const decls = {}
  const masked = maskStrings(stripCssComments(body))
  // 简易解析：分号分割，忽略花括号内的分号
  let depth = 0
  let current = ''
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (ch === ';' && depth === 0) {
      const [prop, ...rest] = current.split(':')
      if (prop && prop.trim()) {
        decls[prop.trim()] = rest.join(':').trim()
      }
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) {
    const [prop, ...rest] = current.split(':')
    if (prop && prop.trim()) {
      decls[prop.trim()] = rest.join(':').trim()
    }
  }
  return decls
}

function hasSharedClassNames(a, b) {
  const classesA = new Set(extractClassNames(a))
  const classesB = new Set(extractClassNames(b))
  for (const c of classesA) {
    if (classesB.has(c)) return true
  }
  return false
}

function sameSpecificity(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function hasConflictingDeclarations(bodyA, bodyB) {
  const declsA = extractDeclarations(bodyA)
  const declsB = extractDeclarations(bodyB)
  for (const prop of Object.keys(declsA)) {
    if (declsB[prop] !== undefined && declsA[prop] !== declsB[prop]) {
      return { property: prop, valueA: declsA[prop], valueB: declsB[prop] }
    }
  }
  return null
}

function analyzeCssFile(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const { ok, rules } = splitCssRules(content)
  if (!ok) {
    return { ok: false, reason: 'CSS braces not balanced', rules: [] }
  }

  const pairs = []
  // 只查 rule 类型（不查 at-rule），且只在同一上下文内比较
  const ruleRules = rules.filter(r => r.kind === 'rule')

  for (let i = 0; i < ruleRules.length; i++) {
    for (let j = i + 1; j < ruleRules.length; j++) {
      const a = ruleRules[i]
      const b = ruleRules[j]

      // 必须同一上下文
      if (a.context !== b.context) continue

      // 共享类名（能匹配同一个元素）
      if (!hasSharedClassNames(a.selector, b.selector)) continue

      // 同特异性
      const specA = parseSelector(a.selector)
      const specB = parseSelector(b.selector)
      if (!sameSpecificity(specA, specB)) continue

      // 声明冲突
      const conflict = hasConflictingDeclarations(a.body, b.body)
      if (!conflict) continue

      pairs.push({
        file: filePath,
        context: a.context || '(root)',
        selectorA: a.selector,
        selectorB: b.selector,
        specificity: specA,
        conflict,
        order: i < j ? 'A before B' : 'B before A',
        lineA: content.slice(0, a.start).split('\n').length,
        lineB: content.slice(0, b.start).split('\n').length,
      })
    }
  }

  return { ok: true, rules: ruleRules.length, pairs }
}

describe('CSS 顺序敏感度穷举检查（§4.24 候选）', () => {
  const files = globSync('src/**/*.{vue,css}', { absolute: true })
  const allPairs = []

  for (const file of files) {
    const result = analyzeCssFile(file)
    if (!result.ok) {
      console.warn(`[SKIP] ${file}: ${result.reason}`)
      continue
    }
    if (result.pairs.length > 0) {
      allPairs.push(...result.pairs)
    }
  }

  // 汇总报告（不作为失败判据，只打印）
  it('汇总：顺序敏感规则对', () => {
    console.log('\n=== CSS 顺序敏感规则对汇总 ===')
    console.log(`扫描文件: ${files.length}`)
    console.log(`发现脆弱对: ${allPairs.length}`)

    // 按文件分组打印
    const byFile = new Map()
    for (const p of allPairs) {
      if (!byFile.has(p.file)) byFile.set(p.file, [])
      byFile.get(p.file).push(p)
    }

    for (const [file, pairs] of byFile) {
      console.log(`\n--- ${file} (${pairs.length} 对) ---`)
      for (const p of pairs.slice(0, 5)) { // 每文件最多打印 5 对
        console.log(
          `  L${p.lineA}: ${p.selectorA}` +
          `  vs  L${p.lineB}: ${p.selectorB}` +
          `  [特异性 ${p.specificity.join(',')}]` +
          `  冲突: ${p.conflict.property} = ${p.conflict.valueA} | ${p.conflict.valueB}` +
          `  顺序: ${p.order}`
        )
      }
      if (pairs.length > 5) {
        console.log(`  ... 另有 ${pairs.length - 5} 对`)
      }
    }

    // 预期：.skin-notebook .tt-cell 与 .tt-cell:hover,.tt-cell.isToday 这对必在
    const knownPair = allPairs.find(p =>
      p.selectorA.includes('.skin-notebook .tt-cell') ||
      p.selectorB.includes('.skin-notebook .tt-cell')
    )
    expect(knownPair).toBeTruthy()
    console.log('\n✅ 已知脆弱对（§1.65 的极性错误对）已被检出')

    // 不做硬性失败：大量合法命中（如 :hover 与 .isToday）
    // 若后续想严格，可在此加 `expect(allPairs.length).toBeLessThan(N)`
  }, 60000)
})