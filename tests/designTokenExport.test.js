// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripPrintStyles, themePalettes, tokensIn } from '../scripts/audit-contrast.mjs'
import { stripCssComments, styleBlocksOf, stripHtmlComments } from '../scripts/css-rules.mjs'

/**
 * 设计令牌导出（`node scripts/audit-contrast.mjs --tokens`）的守卫。
 *
 * 【为什么需要】这个导出是交给设计侧对齐 Figma 的**交付物**：它输出的每个键值都会被
 * 当成真实令牌抄进设计文件。第五十三轮实测它曾经是错的 ——
 * `src/style.css` 里有一段注释记录 `--radius-m: 12px` 为什么被删掉，而
 * `tokensIn()` 的正则**不认注释**，于是：
 *   1. 已删除的 `--radius-m` 被**复活**，值是一整段中文注释（含换行）；
 *   2. 那个"值"一路吞到下一个 `;`，把紧随其后的**真声明 `--focus-ring` 吸收掉**，
 *      于是导出里**根本没有 `--focus-ring`**。
 * 这是本仓记录过的"凡是要 parse 的先剥注释"第 8 次，前 7 次都在测试/构建侧，这次在交付物里。
 *
 * 【判据取向】不去硬编码"应该有 40 个令牌"这种数字，而是守住三条不变量：
 *   ① 注释正文绝不参与令牌身份（夹具直接证明，并保留一条"不剥注释就会错"的对照）；
 *   ② 每个令牌的值必须能在 `src/style.css` 里**逐字找到**（复活/吞并/拼接都会违反它）；
 *   ③ 规模自证，防止解析器打偏后"零令牌"也算通过。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptSource = readFileSync(resolve(root, 'scripts/audit-contrast.mjs'), 'utf8')
const styleSource = readFileSync(resolve(root, 'src/style.css'), 'utf8')
const palettes = themePalettes()

function walkVue(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkVue(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

/* ---------- ① 注释不得参与令牌身份（夹具 + 对照） ---------- */

describe('tokensIn 的判别力（注释不造令牌）', () => {
  it('剥掉注释后，注释里写的令牌不会出现', () => {
    const css = ':root{/* 这里原本有 --ghost: #ffffff; 已删除 */--real: #123456;}'
    const tokens = tokensIn(stripCssComments(css))
    expect(tokens['--real']).toBe('#123456')
    expect(tokens['--ghost']).toBeUndefined()
  })

  it('对照甲：注释里的声明带分号时，幽灵令牌被复活成**看起来完全合法**的颜色', () => {
    const css = ':root{/* 这里原本有 --ghost: #ffffff; 已删除 */--real: #123456;}'
    const tokens = tokensIn(css)
    // 这一种最难发现：值本身是合法色值，肉眼审不出来。
    expect(tokens['--ghost']).toBe('#ffffff')
  })

  it('对照乙：注释里的声明没有分号时，正文被当成值并吞掉紧随其后的真声明', () => {
    const css = ':root{/* 原本有 --radius-m: 12px。说明文字 */\n  --focus-ring: rgba(1, 2, 3, 0.5);}'
    const tokens = tokensIn(css)
    // 真实仓库里就是这一种：--radius-m 拿到中文注释正文，--focus-ring 直接消失。
    expect(tokens['--focus-ring']).toBeUndefined()
    expect(tokens['--radius-m']).toContain('说明文字')
  })

  it('注释不得吞掉紧随其后的真声明（--focus-ring 就是这么丢的）', () => {
    const css = ':root{/* --radius-m: 12px。多行注释\n     第二行 */\n  --focus-ring: rgba(1, 2, 3, 0.5);\n  --next: 7px;}'
    const tokens = tokensIn(stripCssComments(css))
    expect(tokens['--focus-ring']).toBe('rgba(1, 2, 3, 0.5)')
    expect(tokens['--next']).toBe('7px')
    expect(tokens['--radius-m']).toBeUndefined()
  })
})

/* ---------- ② 真实导出：每个值都能在源码里逐字找到 ---------- */

describe('真实 --tokens 导出', () => {
  it('已删除的 --radius-m 不得出现在任何主题里', () => {
    for (const [theme, tokens] of Object.entries(palettes)) {
      expect(tokens['--radius-m'], `${theme} 里复活了已删除的令牌`).toBeUndefined()
    }
  })

  it('--focus-ring 必须在，且值等于源码里声明的那个', () => {
    expect(palettes['默认（蓝）']['--focus-ring']).toBe('rgba(61, 99, 216, 0.28)')
  })

  it('没有令牌的值含中文、`*/` 或换行（注释正文泄漏探测器）', () => {
    const polluted = []
    for (const [theme, tokens] of Object.entries(palettes)) {
      for (const [name, value] of Object.entries(tokens)) {
        if (/[\n\r]|\*\//.test(String(value)) || /[\u4e00-\u9fff]/.test(String(value))) {
          polluted.push(`${theme} ${name} = ${JSON.stringify(value).slice(0, 80)}`)
        }
      }
    }
    expect(polluted, '有令牌的值里混进了注释正文').toEqual([])
  })

  it('每个令牌的值都能在 src/style.css 里逐字找到（防复活/吞并/拼接）', () => {
    const plain = stripCssComments(styleSource)
    const missing = []
    for (const [name, value] of Object.entries(palettes['默认（蓝）'])) {
      if (!plain.includes(String(value))) missing.push(`${name} = ${JSON.stringify(value)}`)
    }
    expect(missing, '这些值在 style.css 里找不到原文——大概率是解析串味了').toEqual([])
  })

  it('规模自证：6 套主题、每套都有底色/卡片/正文与足够多的令牌', () => {
    const themes = Object.keys(palettes)
    expect(themes.length).toBeGreaterThanOrEqual(6)
    for (const theme of themes) {
      const tokens = palettes[theme]
      expect(Object.keys(tokens).length, `${theme} 令牌数异常`).toBeGreaterThanOrEqual(15)
      for (const required of ['--bg', '--card', '--text']) {
        expect(tokens[required], `${theme} 缺 ${required}`).toBeTruthy()
      }
    }
  })

  it('CLI 仍暴露 --tokens 且打印的就是 themePalettes()（防接口被改名/改道）', () => {
    expect(scriptSource).toContain("arguments_.includes('--tokens')")
    expect(scriptSource).toContain('JSON.stringify(themePalettes()')
  })
})

/* ---------- ③ .vue 样式块定位：HTML 注释里的字面量 <style> 不得骗到扫描器 ---------- */

describe('跨规则扫描的样式块定位', () => {
  it('每个 .vue 的样式块数量在三种取法下一致', () => {
    const mismatches = []
    for (const file of walkVue(resolve(root, 'src'))) {
      const text = readFileSync(file, 'utf8')
      const pattern = /<style[^>]*>([\s\S]*?)<\/style>/g
      const raw = [...text.matchAll(pattern)].length
      const htmlStripped = [...stripHtmlComments(text).matchAll(pattern)].length
      const trusted = styleBlocksOf(text).length
      if (raw !== trusted || htmlStripped !== trusted) {
        mismatches.push(`${file}: raw=${raw} htmlStripped=${htmlStripped} trusted=${trusted}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('夹具：注释里的字面量 <style> 会被 stripHtmlComments 挡掉', () => {
    const sfc = '<!-- 见 <style> 里的 .skip-to-content -->\n<template><div/></template>\n<style>.a{color:red}</style>'
    const pattern = /<style[^>]*>([\s\S]*?)<\/style>/g
    expect([...stripHtmlComments(sfc).matchAll(pattern)].length).toBe(1)
    expect(styleBlocksOf(sfc).length).toBe(1)
  })

  it('stripPrintStyles 仍能剥掉打印块（未被本次改动影响）', () => {
    const css = '.a{color:red}@media print{.a{color:black}}'
    expect(stripPrintStyles(css)).not.toContain('color:black')
  })
})