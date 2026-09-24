// @vitest-environment happy-dom
/**
 * 样式注释的棘轮（第五十轮，对应 §4 第 22 条）。
 *
 * 【为什么值得守】第三十七轮我用一个正则删除器清理死类，规则区间偏移算错，把 6 个文件约
 * 259 条规则切碎。而**在那之前，注释已经被同一批正则吃掉了**——注释对 CSS 解析毫无影响，
 * 删掉注释后构建照样通过、测试照样全绿（既有守卫只检查行为），所以这种破坏**没有任何症状**。
 * 恢复只能用删除前的构建产物，而编译产物里没有注释：这 6 个样式块约 1000 条规则的**逐条解释
 * 整体消失了**，只剩一个"原注释在恢复中丢失"的说明。
 *
 * 所以这里给注释数上棘轮：**只准多、不准少**。想合法地减少（比如真删了规则、连同它的注释），
 * 就得来改这里的数字——那正是这个守卫想要的效果：让"注释没了"这件事必须被**意识到**，
 * 而不是静默发生。
 *
 * 数字都是**实测值**，不是拍脑袋定的。
 *
 * 【同一份文件里第四、五次踩的坑】写这个计数器时同样要先剥 HTML 注释：`App.vue` 的模板注释里
 * 有一句"见 `<style>` 里的 …"，不剥就会从注释里那个字面量 `<style>` 开始匹配，把整段模板
 * 当成样式去数。夹具里专门放了这个形状。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')

/** 剥 HTML 注释（等长替换，保留行号）。 */
export function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 掩掉 CSS 字符串：字符串里出现的注释起始符号不算真注释。 */
export function maskCssStrings(css) {
  return css.replace(/"[^"]*"|'[^']*'/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 取 SFC 的样式块（先剥 HTML 注释，避免注释里的字面量 <style>）。 */
export function styleBlocks(text) {
  const source = stripHtmlComments(text)
  const out = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let match
  while ((match = re.exec(source))) out.push(match[1])
  return out
}

/** CSS 注释条数（.css 文件整体算一块，SFC 只看样式块）。 */
export function countCssComments(text, isSfc = true) {
  const blocks = isSfc ? styleBlocks(text) : [text]
  return blocks.reduce((sum, block) => sum + (maskCssStrings(block).match(/\/\*[\s\S]*?\*\//g) ?? []).length, 0)
}

function walk(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|css)$/.test(name)) out.push(full)
  }
  return out
}

const relOf = (file) => file.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1)

/** 第三十七轮受损的 6 个文件（见 §4 第 22 条）与它们恢复后的注释下限（实测值）。 */
export const DAMAGED_FILES = {
  'App.vue': 4,
  'views/TodayView.vue': 4,
  'components/DataManager.vue': 2,
  'views/ScheduleView.vue': 2,
  'views/LedgerView.vue': 2,
  'components/AppearanceSettings.vue': 2,
}

/** 全仓 CSS 注释下限（实测 131）。 */
export const TOTAL_FLOOR = 131

describe('计数器本身的判别力', () => {
  it('只数样式块里的注释，注释里的字面量 <style> 不会骗到它', () => {
    const sfc = '<!-- 见 <style> 里的 .skip-to-content -->\n<template><div/></template>\n<style>/* 真注释 */ .a{color:red}</style>'
    expect(countCssComments(sfc)).toBe(1)
    expect(styleBlocks(sfc)).toHaveLength(1)
    // 不剥 HTML 注释就会从注释里那个 <style> 起匹配，把模板也当成样式
    expect(styleBlocks(sfc)[0]).toContain('真注释')
    expect(styleBlocks(sfc)[0], '样式块不该包含模板').not.toContain('template')
  })

  it('CSS 字符串里的 /* */ 不算注释', () => {
    expect(countCssComments('<style>.a{content:"/* 不是注释 */"}</style>')).toBe(0)
    expect(countCssComments('<style>.a{content:"/* x */"}/* 真注释 */</style>')).toBe(1)
  })

  it('.css 文件整体当一块数', () => {
    expect(countCssComments('/* a */ /* b */ .x{color:red}', false)).toBe(2)
  })
})

describe('样式注释棘轮（§4 第 22 条）', () => {
  const files = walk().map((file) => ({
    file: relOf(file),
    text: readFileSync(file, 'utf8'),
    isSfc: file.endsWith('.vue'),
  }))
  const countOf = (name) => {
    const entry = files.find((f) => f.file === name)
    expect(entry, `${name} 不存在了`).toBeTruthy()
    return countCssComments(entry.text, entry.isSfc)
  }

  it('第三十七轮受损的 6 个文件都还留着注释（只准多、不准少）', () => {
    const short = []
    for (const [name, floor] of Object.entries(DAMAGED_FILES)) {
      const n = countOf(name)
      if (n < floor) short.push(`${name}: ${n} < ${floor}`)
    }
    expect(
      short,
      '注释变少了。第三十七轮的事故就是这样发生的：正则吃掉注释，构建与测试全绿，没人发现。'
        + '如果确实是有意减少（比如删了规则连注释一起走），请把这个下限一起改掉并说明原因',
    ).toEqual([])
  })

  it('全仓 CSS 注释总数不低于实测值', () => {
    const total = files.reduce((sum, f) => sum + countCssComments(f.text, f.isSfc), 0)
    expect(total, `全仓注释 ${total} 条，低于下限 ${TOTAL_FLOOR}`).toBeGreaterThanOrEqual(TOTAL_FLOOR)
  })

  it('6 个重建过的样式块都保留着"原注释丢失"的说明', () => {
    const missing = []
    for (const name of Object.keys(DAMAGED_FILES)) {
      const entry = files.find((f) => f.file === name)
      const head = (styleBlocks(entry.text)[0] ?? '').slice(0, 500)
      if (!/\/\*[\s\S]*\*\//.test(head) || !/(丢失|重建)/.test(head)) missing.push(name)
    }
    expect(
      missing,
      '这些样式块开头的"原注释在恢复中丢失"说明没了——它是那次事故的唯一现场记录，别当废话删掉',
    ).toEqual([])
  })
})