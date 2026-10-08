// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { MOTION } from '../src/composables/motion.js'

/*
 * 动效令牌的一致性守卫。
 *
 * 背景：src/style.css 顶部写着「此前各组件硬编码 0.13s~0.3s 与各不相同的缓动，
 * 手感不一致」，并定义了 --dur-* / --ease-* 令牌。但迁移只做了一半 ——
 * 12 个组件里仍有 46 处裸时长与裸 ease，hover 手感在不同页面分别是
 * 130/140/150/180ms，令牌形同虚设。这个测试把「交互声明必须走令牌」变成可执行的规则。
 *
 * 三条断言：
 *  1. 交互声明里不能再出现 90–400ms 的裸时长
 *  2. CSS 令牌的值必须与 motion.js 的 JS 常量一致
 *  3. DESIGN_TOKENS.md 里写到的每个 token 都必须真实存在
 */

// happy-dom 下 import.meta.url 会变成 http:// 形式，fileURLToPath 会失败；
// 用 import.meta.dirname（仍是文件系统路径）与仓库既有的 courierAbsence 测试保持一致。
const projectRoot = resolve(import.meta.dirname, '..')
const srcDir = resolve(projectRoot, 'src')
const styleCss = readFileSync(resolve(srcDir, 'style.css'), 'utf8')
const tokensDoc = readFileSync(resolve(projectRoot, 'DESIGN_TOKENS.md'), 'utf8')

function collectFiles(dir, extension, out = []) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) collectFiles(full, extension, out)
    else if (name.endsWith(extension)) out.push(full)
  }
  return out
}

function styleBlocks(file) {
  return [...readFileSync(file, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1])
}

function declarations(css) {
  return [...css.matchAll(/(^|[\s;{])((?:transition|animation)(?!-duration)(?:-[a-z]+)?)\s*:\s*([^;{}]+)/g)]
    .map((match) => ({ property: match[2], value: match[3].trim() }))
}

const files = [...collectFiles(srcDir, '.vue'), resolve(srcDir, 'style.css')]

describe('动效令牌一致性', () => {
  it('交互声明里没有裸时长', () => {
    const offenders = []
    for (const file of files) {
      const blocks = file.endsWith('.css') ? [readFileSync(file, 'utf8')] : styleBlocks(file)
      for (const block of blocks) {
        for (const { property, value } of declarations(block)) {
          // 降级规则必须保持 0.01ms!important，循环动画的周期也不属于交互刻度。
          if (/!important/i.test(value)) continue
          if (/infinite/i.test(value)) continue
          for (const raw of value.split(',')) {
            const part = raw.trim()
            if (!part || /var\(--dur-/.test(part)) continue
            for (const token of part.split(/\s+/)) {
              const seconds = /^([0-9]*\.?[0-9]+)s$/i.exec(token)
              const millis = /^([0-9]+)ms$/i.exec(token)
              const ms = seconds ? Number.parseFloat(seconds[1]) * 1000 : millis ? Number(millis[1]) : null
              if (ms === null) continue
              // 只对交互刻度（90–400ms）报错：循环与注意力脉冲各有各的周期。
              if (ms < 90 || ms > 400) continue
              offenders.push(`${file.replace(srcDir, '')} → ${property}: ${value}`)
            }
          }
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('CSS 令牌的值与 motion.js 的 JS 常量一致', () => {
    const cssValue = (name) => {
      const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(styleCss)
      return match ? match[1].trim() : null
    }
    for (const key of ['instant', 'fast', 'base', 'slow', 'reveal']) {
      expect(cssValue(`dur-${key}`), `--dur-${key} 缺失`).toBe(`${MOTION[key]}ms`)
    }
    const easings = { standard: MOTION.easeStandard, out: MOTION.easeOut, spring: MOTION.easeSpring }
    for (const [suffix, expected] of Object.entries(easings)) {
      const value = cssValue(`ease-${suffix}`)
      expect(value, `--ease-${suffix} 缺失`).not.toBeNull()
      // 统一去空格后比较，避免 .2 与 0.2 这种等价写法被判成不一致。
      const normalize = (text) => text.replace(/\s+/g, '').replace(/cubic-bezier\(0?\./g, 'cubic-bezier(.')
      expect(normalize(value)).toBe(normalize(expected))
    }
  })

  it('DESIGN_TOKENS.md 里提到的 token 都真实存在', () => {
    const mentioned = new Set()
    for (const match of tokensDoc.matchAll(/`--((?:dur|ease|focus|tap|on)-[a-z-]+)`/g)) mentioned.add(match[1])
    // 只校验动效令牌；颜色与焦点令牌由 tests/contrastAudit.test.js 覆盖。
    const motionTokens = [...mentioned].filter((name) => name.startsWith('dur-') || name.startsWith('ease-'))
    expect(motionTokens.length).toBeGreaterThan(0)
    const missing = motionTokens.filter((name) => !new RegExp(`--${name}\\s*:`).test(styleCss))
    expect(missing, `文档里写了但 style.css 中不存在的令牌：${missing.join(', ')}`).toEqual([])
  })

  it('style.css 自身也不再硬编码 0.13s~0.3s 的过渡', () => {
    // 令牌定义块之外的裸时长同样不允许（focus-target-pulse 的 2.4s 属于脉冲周期，被 90–400ms 区间排除）。
    const offenders = declarations(styleCss)
      .filter(({ value }) => !/!important/i.test(value) && !/infinite/i.test(value) && !/var\(--dur-/.test(value))
      .filter(({ value }) => /(^|\s)(0?\.[0-9]{1,2}s|[0-9]{2,3}ms)(\s|,|$)/.test(value))
      .map(({ property, value }) => `${property}: ${value}`)
    expect(offenders).toEqual([])
  })
})
