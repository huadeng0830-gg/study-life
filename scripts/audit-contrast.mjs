#!/usr/bin/env node
/**
 * 颜色对比度 AA 级审计。
 *
 * 直接解析 src/style.css 与 src/composables/theme.js 里的调色板，
 * 对真实出现的「文字色 / 背景色」组合计算 WCAG 2.x 对比度，
 * 输出未达标的组合并以非零退出码结束，便于接进 CI。
 *
 * 判定阈值：
 *   - 正文（< 18.66px 或非粗体）：4.5:1（AA）
 *   - 大字号 / 非文字类描边：3.0:1（AA large）
 *
 * 用法：
 *   node scripts/audit-contrast.mjs            # 人类可读报告
 *   node scripts/audit-contrast.mjs --json     # 机器可读
 *   node scripts/audit-contrast.mjs --all      # 连达标项一起列出
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { stripCssComments } from './css-rules.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 剥掉打印相关的 at-rule（`@media print { … }` 与 `@page { … }`）。
 *
 * 【为什么必须剥】审计的块正则是 `([^{}]+)\{([^{}]*)\}`，它**看不懂嵌套**：
 * 加了打印块之后，里面的 `body, .layout, .content { background: #ffffff }`
 * 会被当成一条主题规则，于是"纯近白底必须用 --card / --bg-tint 令牌"直接报红。
 * 而打印色不是主题色——纸上就应该是纯黑纯白（`#000` 对 `#fff` 是 21:1），
 * 它的合法性由 `tests/printStyles.test.js` 单独守着，不该混进调色板审计。
 */
export function stripPrintStyles(css) {
  const text = String(css ?? '')
  let out = ''
  let index = 0
  while (index < text.length) {
    const at = /@(media\s+print|page)\b/.exec(text.slice(index))
    if (!at) { out += text.slice(index); break }
    const start = index + at.index
    const open = text.indexOf('{', start)
    out += text.slice(index, start)
    if (open === -1) break
    let depth = 0
    let end = open
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') {
        depth -= 1
        if (depth === 0) { end = i + 1; break }
      }
    }
    index = end
  }
  return out
}

// 先剥注释再解析：注释是**给人看的记录**，里面常常写着"这里原本有 --radius-m: 12px"
// 这类被删掉的令牌。不剥注释时 tokensIn() 会把注释正文当成真实声明，于是
// （1）已删除的令牌被复活成一个含中文与换行的"值"，(2) 它还会一路吞到下一个 `;`，
// 把紧随其后的 --focus-ring 真声明吸收掉 —— 设计侧拿到的 --tokens 导出因此是错的。
// stripCssComments 是等长替换（保留偏移与行号），所以下游的花括号配对不受影响。
const styleSheet = stripPrintStyles(stripCssComments(readFileSync(resolve(root, 'src/style.css'), 'utf8')))
const themeSource = readFileSync(resolve(root, 'src/composables/theme.js'), 'utf8')

/* ---------- 颜色与对比度 ---------- */

function parseColor(value) {
  const text = String(value ?? '').trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map((char) => char + char).join('')
      : hex[1]
    return [0, 2, 4].map((index) => Number.parseInt(raw.slice(index, index + 2), 16))
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((part) => Number(part))
  return null
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground, background) {
  const a = parseColor(foreground)
  const b = parseColor(background)
  if (!a || !b) return null
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

/* ---------- 从 style.css 提取调色板 ---------- */

/**
 * 取出某个选择器规则块里的声明。
 *
 * 原来的写法是 `new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\n\\}')`——要求
 * 块尾必须是「换行 + }」。这在本文件里出过一次真实的漏审：style.css 顶上有一组
 * 单行规则
 *
 *     :root[data-theme='purple'] { --focus-solid: #6d28d9; }
 *     :root[data-theme='green']  { --focus-solid: #0a7a56; }
 *     :root[data-theme='pink']   { --focus-solid: #be185d; }
 *
 * 查 green 时正则从 L106 的 `{` 起算，非贪婪地一路找到第一个「换行+}」才收尾，
 * 而那个 `}` 属于下面紫色主题块（L110–116）。于是绿色和粉色都拿到了**紫色**的
 * --primary/--primary-soft，`themePalettes()` 里三个具名主题的值一模一样；
 * 真实绿 #0a7a54 / 粉 #c02070 从来没进过审计。这不是数值问题，是解析器问题：
 * 一个把 A 主题当 B 主题审的守卫会一直报绿。
 *
 * 现在改成：找出该选择器的**所有**出现位置，逐个做花括号配对截取真正属于自己的
 * 块，再按 CSS 级联顺序（后面的覆盖前面的）合并。单行规则与多行规则都能正确处理，
 * 也不会越过自己的 `}` 去吃掉下一条规则。
 */
function blockFor(selector) {
  const merged = {}
  let index = 0
  while (index < styleSheet.length) {
    const at = styleSheet.indexOf(selector, index)
    if (at === -1) break
    index = at + selector.length
    // 选择器后面必须紧跟（可含空白）左花括号，否则只是注释或更长选择器的一部分
    const after = styleSheet.slice(index).match(/^[^\S\n]*\{/)
    if (!after) continue
    let cursor = index + after[0].length
    let depth = 1
    const start = cursor
    while (cursor < styleSheet.length && depth > 0) {
      if (styleSheet[cursor] === '{') depth += 1
      else if (styleSheet[cursor] === '}') depth -= 1
      cursor += 1
    }
    Object.assign(merged, tokensIn(styleSheet.slice(start, cursor - 1)))
  }
  return merged
}

/**
 * 从一个声明块里取出 `--token: value;`。
 *
 * ⚠ 调用方必须先把 CSS 注释剥掉（`stripCssComments`）。这里的正则认不出注释，
 * 而本仓的注释里恰恰经常写着被删除的令牌原文；不剥注释就会复活幽灵令牌、
 * 并吃掉紧随其后的真声明（`--focus-ring` 就这么丢过一次，见 styleSheet 上方注释）。
 * 导出它是为了让 tests/designTokenExport.test.js 能用夹具直接证明这一点。
 */
export function tokensIn(block) {
  const tokens = {}
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[match[1]] = match[2].trim()
  }
  return tokens
}

const baseTokens = blockFor(':root')
const themes = {
  '默认（蓝）': { ...baseTokens },
  '紫色': { ...baseTokens, ...blockFor(":root[data-theme='purple']") },
  '绿色': { ...baseTokens, ...blockFor(":root[data-theme='green']") },
  '粉色': { ...baseTokens, ...blockFor(":root[data-theme='pink']") },
  '高对比度': { ...baseTokens, ...blockFor(":root[data-contrast='high']") },
}

// 深色主题的变量由 theme.js 在运行时写入内联样式，从源码里取出那份调色板。
function darkPalette() {
  const darkBlock = /if\s*\(\s*prefersDark\.value\s*\)\s*\{\s*return\s*\{([\s\S]*?)\n\s*\}/.exec(themeSource)
  if (!darkBlock) return null
  const entries = {}
  for (const match of darkBlock[1].matchAll(/(\w+):\s*'(#[0-9a-f]{3,8})'/gi)) {
    entries[match[1]] = match[2]
  }
  return {
    '--primary': entries.primary,
    '--primary-hover': entries.primaryHover,
    '--primary-soft': entries.primarySoft,
    '--bg': entries.bg,
    '--card': entries.card,
    '--text': entries.text,
    '--muted': entries.muted,
    '--border': entries.border,
    '--border-strong': entries.borderStrong,
    '--ink-soft': entries.inkSoft,
    '--ink-faint': entries.inkFaint,
    '--bg-tint': entries.bgTint,
    '--danger': entries.danger,
    '--on-primary': entries.onPrimary,
    '--on-danger': entries.onDanger,
  }
}

const dark = darkPalette()
// 深色主题除了 theme.js 写入的主调色板，还有一小部分只写在 style.css 的
// `:root[data-theme='dark']` 里（语义色 --success/--warning 与专注环）。
// 只读 theme.js 会把它们漏掉，审计就会拿「浅色的 --success」去配深色底，
// 得出一个根本不存在的组合。这里把两处合并成深色实际生效的令牌表。
if (dark) themes['深色（跟随系统）'] = { ...dark, ...blockFor(":root[data-theme='dark']") }

/* ---------- 需要检查的真实组合 ---------- */

// size: normal = 正文（要求 4.5），large = 大字/非文字（要求 3.0）
const PAIRS = [
  { fg: '--text', bg: '--bg', label: '正文 / 页面底色', size: 'normal' },
  { fg: '--text', bg: '--card', label: '正文 / 卡片', size: 'normal' },
  { fg: '--muted', bg: '--card', label: '次要文字 / 卡片', size: 'normal' },
  { fg: '--ink-soft', bg: '--card', label: '辅助文字 / 卡片', size: 'normal' },
  { fg: '--ink-faint', bg: '--card', label: '最弱文字 / 卡片', size: 'normal' },
  { fg: '--ink-faint', bg: '--bg', label: '最弱文字 / 页面底色', size: 'normal' },
  { fg: '--primary', bg: '--primary-soft', label: '主色文字 / 主色浅底', size: 'normal' },
  { fg: '--on-primary', bg: '--primary', label: '主色实底上的文字', size: 'normal' },
  { fg: '--danger', bg: '--card', label: '危险色文字 / 卡片', size: 'normal' },
  { fg: '--on-danger', bg: '--danger', label: '危险色实底上的文字', size: 'normal' },
  // 语义色。--success/--warning 是后补的令牌，此前成功/警告提示一律写死色值，
  // 于是「浅色下就已经不达 AA」都没人发现（Toast 的成功提示曾只有 3.62:1）。
  // mix 表示「语义色按该比例混到 --card 上」的浅底，和组件里
  // color-mix(in srgb, var(--success) 10%, var(--card)) 的实际写法一致。
  { fg: '--success', bg: '--card', label: '成功色文字 / 卡片', size: 'normal' },
  { fg: '--success', bg: '--card', mix: 0.1, label: '成功色文字 / 成功浅底', size: 'normal' },
  { fg: '--warning', bg: '--card', label: '警告色文字 / 卡片', size: 'normal' },
  { fg: '--warning', bg: '--card', mix: 0.1, label: '警告色文字 / 警告浅底', size: 'normal' },
  { fg: '--danger', bg: '--card', mix: 0.08, label: '危险色文字 / 危险浅底', size: 'normal' },
  // 语义色大量出现在「没有自己底色」的规则里（提示文字、金额、状态标签），
  // 底来自父容器，最常见的就是 --bg-tint 区块。--bg-tint 在高对比度浅色下是
  // #eef1f7（比默认的 #f9fafd 深），是这几组里最紧的一档，必须单独核对。
  { fg: '--success', bg: '--bg-tint', label: '成功色文字 / 区块底色', size: 'normal' },
  { fg: '--warning', bg: '--bg-tint', label: '警告色文字 / 区块底色', size: 'normal' },
  { fg: '--danger', bg: '--bg-tint', label: '危险色文字 / 区块底色', size: 'normal' },
  // 语义浅底上通常还压着别的次级文字（状态卡片的说明行、时间戳），
  // 文字色与底色来自**两个不同**的令牌，所以用 tint 指定混合的来源色。
  // 组件里的实际约定是：含 var(--muted) 正文的表面只用 6% 混合
  // （10% 会把灰字压到浅 4.31 / 深 4.34），只有 --ink-soft 才敢用 10%。
  // 下面两组就是那个约定的数字化表达——此前这类「容器混色底 + 另一个令牌的字」
  // 完全没进审计，是手工扫全仓才发现的（见 UX_AUDIT_176_REPORT.md §1.16）。
  { fg: '--muted', bg: '--card', mix: 0.06, tint: '--success', label: '次要文字 / 成功浅底 6%', size: 'normal' },
  { fg: '--muted', bg: '--card', mix: 0.06, tint: '--warning', label: '次要文字 / 警告浅底 6%', size: 'normal' },
  { fg: '--ink-soft', bg: '--card', mix: 0.1, tint: '--success', label: '辅助文字 / 成功浅底 10%', size: 'normal' },
  { fg: '--ink-soft', bg: '--card', mix: 0.1, tint: '--warning', label: '辅助文字 / 警告浅底 10%', size: 'normal' },
  // 悬停/交互态浅底（.btn-pull:hover 用 6%、.btn-push:hover 用 14%）。
  // 悬停底是最容易被忽略的一档：它不在任何静态截图里，出问题时只有真去悬停才看得见。
  { fg: '--primary', bg: '--card', mix: 0.06, label: '主色文字 / 主色悬停底 6%', size: 'normal' },
  { fg: '--success', bg: '--card', mix: 0.14, label: '成功色文字 / 成功悬停底 14%', size: 'normal' },
]

const PRIMARY_TEXT_MIN = 4.5
const LARGE_MIN = 3

/** 把 --card 与某个语义色按 ratio 混出来的浅底（sRGB 直接插值，与 color-mix 一致）。 */
function mixWithCard(color, card, ratio) {
  const a = parseColor(color)
  const b = parseColor(card)
  if (!a || !b) return null
  return `#${a
    .map((channel, index) => Math.round(channel * ratio + b[index] * (1 - ratio)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

/** 跑一遍全部主题 × 全部组合，返回逐项结果。测试里也直接调用它。 */
export function auditContrast() {
  const results = []
  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const pair of PAIRS) {
      const fg = tokens[pair.fg] ?? pair.fg
      const bg = pair.mix === undefined
        ? tokens[pair.bg]
        : mixWithCard(tokens[pair.tint ?? pair.fg], tokens['--card'], pair.mix)
      const ratio = contrastRatio(fg, bg)
      if (ratio === null) continue
      const min = pair.size === 'large' ? LARGE_MIN : PRIMARY_TEXT_MIN
      results.push({
        theme: themeName,
        label: pair.label,
        fg: pair.fg,
        bg: pair.mix === undefined ? pair.bg : `${pair.bg}+${pair.tint ?? pair.fg} ${pair.mix * 100}%`,
        ratio: Number(ratio.toFixed(2)),
        min,
        pass: ratio >= min,
      })
    }
  }
  return results
}

/**
 * 另外两类逐条规则判据看不见的假阴性（§4 第 15 条点名）：
 *
 *  1. **`background-image` 白色/浅色渐变**：底不是 `background` 而是渐变，
 *     逐条判据只看 `background` 就漏了。这里对**每一个十六进制色停**都算一遍，
 *     取最差的那一档——文字落在渐变哪一段是不能静态确定的，按最浅的算最保守。
 *  2. **模板内联 `style="background:…"`**：采集器只读 `<style>` 块。
 *     本仓实测**一处都没有**，所以这条按棘轮写成"内联背景必须用令牌"：
 *     将来真出现写死的近白内联底时会被挡住，而不是悄悄从审计里溜过去。
 *
 * 只认**静态**的 `style="…"`，`v-bind:style` / `:style` 是运行时算出来的，
 * 静态判据读不到，也不该硬猜。
 */
export function gradientSurfaceOffenders(styles) {
  const offenders = []
  const stats = { gradientRules: 0, gradientWithColor: 0, stopsChecked: 0 }
  for (const { file, css } of styles) {
    for (const rule of cssRules(css)) {
      const decls = declarations(rule.body)
      const image = /gradient\(/i.test(decls['background-image'] ?? '') ? decls['background-image']
        : (/gradient\(/i.test(decls.background ?? '') ? decls.background : null)
      if (!image) continue
      stats.gradientRules += 1
      if (!decls.color) continue
      stats.gradientWithColor += 1
      const stops = [...image.matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => match[0])
      if (!stops.length) continue
      for (const [themeName, tokens] of Object.entries(themes)) {
        const foreground = toHexIn(decls.color, tokens)
        if (!foreground) continue
        for (const stop of stops) {
          stats.stopsChecked += 1
          const ratio = contrastRatio(foreground, stop)
          if (ratio === null || ratio >= PRIMARY_TEXT_MIN) continue
          offenders.push({
            file: String(file).replace(/\\/g, '/'),
            selector: rule.selector.replace(/\s+/g, ' '),
            theme: themeName,
            fg: foreground,
            bg: stop,
            bgRule: 'background-image 的色停',
            ratio: Number(ratio.toFixed(2)),
            min: PRIMARY_TEXT_MIN,
          })
        }
      }
    }
  }
  return { offenders: dedupeByWorst(offenders), stats }
}

/**
 * 模板里**静态**内联背景必须是令牌。返回违规项（本仓当前为零）。
 *
 * @param {{ file: string, text: string }[]} sources SFC 原文
 */
export function inlineSurfaceOffenders(sources) {
  const offenders = []
  const stats = { inlineBackgrounds: 0, scanned: sources.length }
  for (const { file, text } of sources) {
    const raw = String(text ?? '')
    const templateEnd = raw.indexOf('</template>')
    const template = templateEnd === -1 ? raw : raw.slice(0, templateEnd)
    for (const match of template.matchAll(/<[^>]*\sstyle="([^"]*)"[^>]*>/g)) {
      const declaration = /(?:^|;)\s*background(?:-color|-image)?\s*:\s*([^;]+)/i.exec(match[1])
      if (!declaration) continue
      const value = declaration[1].trim()
      stats.inlineBackgrounds += 1
      // 令牌（可带 color-mix）放行；写死色值、以及没有 var() 的渐变都要报
      if (/var\(\s*--[a-z0-9-]+\s*\)/i.test(value) || /^(none|transparent|inherit|unset|initial)$/i.test(value)) continue
      offenders.push({
        file: String(file).replace(/\\/g, '/'),
        selector: match[0].slice(0, 48).replace(/\s+/g, ' '),
        theme: '（与主题无关：值写死了）',
        fg: '—',
        bg: value,
        bgRule: '模板内联 style',
        ratio: null,
        min: PRIMARY_TEXT_MIN,
      })
    }
  }
  return { offenders, stats }
}

/** 同一个「文件 + 选择器 + 主题」只留最差的一条。 */
function dedupeByWorst(entries) {
  const worst = new Map()
  for (const entry of entries) {
    const key = `${entry.file}|${entry.selector}|${entry.theme}`
    if (!worst.has(key) || worst.get(key).ratio > entry.ratio) worst.set(key, entry)
  }
  return [...worst.values()].sort((a, b) => a.ratio - b.ratio)
}

/**
 * 同一条规则里**写死的字色 + 写死的底**（含渐变色停）。
 *
 * 跨规则判据只收「底跟令牌、字写死」（`asVar` 底）与「渐变+同规则字色」
 * （`gradientSurfaceOffenders`）；`color:#x; background:#y` 这种一条规则自己给底的
 * 组合两边都不碰——那是审计盲区，不是达标。本判据补上这条路。
 *
 * 只报**同规则**能静态读全的组合：不猜祖先、不跨选择器。
 */
export function sameRuleHardCodedOffenders(styles) {
  const offenders = []
  const stats = { pairedRules: 0, stopsChecked: 0 }
  for (const { file, css } of styles) {
    for (const rule of cssRules(css)) {
      const decls = declarations(rule.body)
      const foreground = asHex(decls.color)
      if (!foreground) continue
      const backgrounds = []
      const solid = asHex(decls.background) ?? asHex(decls['background-color'])
      if (solid) backgrounds.push(solid)
      const image = /gradient\(/i.test(decls['background-image'] ?? '') ? decls['background-image']
        : (/gradient\(/i.test(decls.background ?? '') ? decls.background : null)
      if (image) {
        for (const match of image.matchAll(/#[0-9a-f]{3,8}\b/gi)) backgrounds.push(match[0])
      }
      if (!backgrounds.length) continue
      stats.pairedRules += 1
      const min = largeTextThreshold({
        fontSize: decls['font-size'],
        fontWeight: decls['font-weight'],
      })
      for (const background of backgrounds) {
        stats.stopsChecked += 1
        const ratio = contrastRatio(foreground, background)
        if (ratio === null || ratio >= min) continue
        offenders.push({
          file: String(file).replace(/\\/g, '/'),
          selector: rule.selector.replace(/\s+/g, ' '),
          theme: '（与主题无关：两侧都写死了）',
          fg: foreground,
          bg: background,
          bgRule: '同一规则的 background',
          ratio: Number(ratio.toFixed(2)),
          min,
        })
      }
    }
  }
  return { offenders: dedupeByWorst(offenders), stats }
}

/** 主题名 → 该主题实际生效的令牌表，供测试按主题断言。 */
export function themePalettes() {
  return themes
}

/* ---------- 聚焦指示器的非文本对比度（第四十五轮，WCAG 1.4.11） ---------- */

/**
 * 焦点环会贴到的**元素背景**。注意 `outline-offset: 2px` 会在 outline 与元素边框之间
 * 露出一条缝，缝里是元素自己的背景——所以主色按钮的 `--primary` 也是相邻色，
 * 这正是"焦点环落在主色按钮上就看不见"那类缺陷的来源，也是本仓要同时画
 * outline + halo 两圈的原因。
 */
export const FOCUS_SURFACES = ['--bg', '--card', '--bg-tint', '--primary', '--primary-soft', '--danger', '--success']

/** 非文本对比度门槛（WCAG 1.4.11 Non-text Contrast 是 3:1，不是正文的 4.5）。 */
export const NON_TEXT_MIN = 3

/** 把 `rgba(...)` 按 alpha 混到不透明底色上，返回 `#rrggbb`（halo 是半透明的）。 */
export function blendColor(color, backdrop) {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(String(color).trim())
  if (!match) return color
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  const hex = (value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
  // 通道 i（1..3）在 `#rrggbb` 里是 slice(2i-1, 2i+1)——写成 slice(i, i+2) 会在
  // 第 2、3 个通道上取错位置，而"全透明 halo 应当等于底色"这条夹具会立刻抓住它。
  const channel = (i) => parseInt(backdrop.slice(2 * i - 1, 2 * i + 1), 16)
  const parts = [1, 2, 3].map((i) => channel(i) * (1 - alpha) + Number(match[i]) * alpha)
  return `#${parts.map(hex).join('')}`
}

/**
 * 「outline 与 halo 里**至少有一圈**对该背景达到 3:1」。
 *
 * 【为什么是"取优"而不是"各查各的"】两圈互为补位，这是设计意图：实色 outline 在浅底上
 * 很稳（默认主题对 `--card` 是 5.87），但压到主色按钮上只剩 1.11——此时 halo 顶上
 * （对 `--primary` 是 5.00）。要求"两圈都达标"会把一个**做对了的设计**判成缺陷；
 * 要求"至少一圈达标"才是 WCAG 1.4.11 真正要的可感知性。
 *
 * 【已知边界】halo 是半透明、且**不随壁纸切换**（style.css 里按浅/深主题各写死一档）。
 * 壁纸与主题不匹配时（浅色主题 + 浅色壁纸）halo 可能落在壁纸上看不出来，但那种情况下
 * outline 对元素背景仍然达标，指示器整体依旧可感知，所以这里不把壁纸纳入判据。
 */
export function focusIndicatorOffenders(palettes = themes, surfaces = FOCUS_SURFACES, min = NON_TEXT_MIN) {
  const offenders = []
  const stats = { combosChecked: 0, themes: 0, surfaces: surfaces.length }
  for (const [theme, tokens] of Object.entries(palettes)) {
    const solid = tokens['--focus-solid']
    if (!solid) continue
    stats.themes += 1
    const halo = tokens['--focus-halo']
    for (const name of surfaces) {
      const surface = tokens[name]
      if (!surface) continue
      stats.combosChecked += 1
      const solidRatio = contrastRatio(solid, surface)
      const haloRatio = halo ? contrastRatio(blendColor(halo, surface), surface) : null
      const best = Math.max(solidRatio ?? 0, haloRatio ?? 0)
      if (best < min) offenders.push({ theme, surface, solidRatio, haloRatio, best })
    }
  }
  return { offenders, stats }
}

/* ---------- 跨规则对比度（§4 第 15 条点名的那一类） ---------- */

/**
 * 「底由一条规则给、字由另一条规则给」——逐条规则的判定器结构上看不见这一类。
 * 手工全仓扫描（见 UX_AUDIT_176_REPORT.md §1.16）用的三条口径里，最可机械化、
 * 假阳性最低的是第二条：**底跟主题令牌、文字却写死**。这里把它做成守卫。
 *
 * 【为什么按"前导类链"分族】`.task-steps li { background: var(--card) }` 与
 * `.task-steps i { color: #a5adbc }` 是两条规则，共享前导类 `.task-steps`，
 * 在页面里通常处于同一个区块。族内配对是这条判据能成立的最小假设。
 *
 * 【底的优先级，从最可信到最保守】：
 *   1. **同元素**的规则：类集是当前规则类集的子集、且**末尾标签名相同**
 *      （`.switch span` 之于 `.switch.on span`）。此时取类集最大的那条。
 *      ——这一条专门修掉一个真实假阳性：`.switch.on span { color:#07805d }`
 *      的底其实是 `.switch span { background:#fff }` 那块**白色旋钮**，
 *      不是族里 `.switch.on` 的绿色。
 *   2. **祖先前缀**：选择器是当前选择器的前缀（`.a` 之于 `.a .b`），取最长的那条。
 *   3. **族内唯一的令牌底**：只有一个不同的令牌背景时用它；有多个就**跳过**
 *      （宁可漏报也不猜——猜错会把一个可读的界面判成缺陷）。
 *
 * 【已知边界，都是刻意的】不进入任何 `@media`（深色覆盖块需要另一套主题，
 * 保守跳过，`skipped.inAtRule` 计数）；不读字号，所以大字/图标这类 3:1 的情形
 * 会按正文 4.5 从严，只能用 `CROSS_RULE_ALLOWLIST` 逐条登记并写明理由。
 */
export const CROSS_RULE_ALLOWLIST = [
  // 目前为空 —— 判据在全仓零命中。留这个机制是为了以后遇到"确实达标但静态读不出来"
  // 的情形（例如字号未知导致按正文从严）能逐条登记并写明理由，而不是把阈值调松。
  //
  // 一次已查明的**近似命中**记录在这里，供以后参考：加上"元素级底优先级"之前，
  // `.switch.on span { color:#07805d }` 曾被报出 3.59:1；查证后发现它的底来自
  // `.switch span { background:#fff }` 那块**白色旋钮**（不是族里 `.switch.on` 的绿色），
  // 实测 4.93:1 达标，而且里面的对勾是**图标**不是文字。这个假阳性的修法是把
  // "同元素的更宽类集规则"提到优先级第一位，而不是往允许清单里塞一条。
]

const maskCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))

/** 花括号配对的规则遍历；进入 `@media` 的规则一律不返回（见上面的已知边界）。 */
function cssRules(css) {
  const masked = maskCssComments(String(css ?? ''))
  const out = []
  let i = 0
  while (i < masked.length) {
    while (i < masked.length && /\s/.test(masked[i])) i += 1
    if (i >= masked.length) break
    const brace = masked.indexOf('{', i)
    const closish = masked.indexOf('}', i)
    if (brace === -1) break
    if (closish !== -1 && closish < brace) { i = closish + 1; continue }
    const selector = masked.slice(i, brace).trim()
    let depth = 1
    let j = brace + 1
    while (j < masked.length && depth > 0) {
      if (masked[j] === '{') depth += 1
      else if (masked[j] === '}') depth -= 1
      j += 1
    }
    if (!selector.startsWith('@')) out.push({ selector, body: css.slice(brace + 1, j - 1) })
    i = j
  }
  return out
}

function declarations(body) {
  const map = {}
  for (const match of maskCssComments(body).matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
    map[match[1].toLowerCase()] = match[2].trim()
  }
  return map
}

const firstClassOf = (selector) => {
  const match = /\.(-?[a-zA-Z_][\w-]*)/.exec(selector)
  return match ? match[1] : null
}
const classSetOf = (selector) => new Set([...selector.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((m) => m[1]))
/** 选择器拆成"复合选择器"序列（`.a.b .c > d` → ['.a.b', '.c', 'd']）。 */
const compoundsOf = (selector) => String(selector ?? '').replace(/[>+~]/g, ' ').split(/\s+/).filter(Boolean)
/**
 * 选择器末尾的标签名（`div.a span` → `span`；`.knob` → 空串，因为 `knob` 是类名）。
 * 同元素判定必须用它：`.knob span` 与 `.knob.on span` 是同一个元素，而 `.probe li`
 * 与 `.probe i` 不是——只比类集会把这四种情形混在一起。
 */
const tagOf = (selector) => {
  const text = String(selector ?? '').replace(/\s*[>+~]\s*$/, '').trim()
  const match = /([a-zA-Z][\w-]*)\s*$/.exec(text)
  if (!match) return ''
  const before = text[match.index - 1]
  return before === '.' || before === '#' || before === '-' ? '' : match[1].toLowerCase()
}
const asHex = (value) => (/^#[0-9a-f]{3,8}$/i.test(String(value ?? '').trim()) ? String(value).trim() : null)
const asVar = (value) => (/^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(String(value ?? '').trim())?.[1] ?? null)
const toHexIn = (value, tokens) => {
  const hex = asHex(value)
  if (hex) return hex
  const name = asVar(value)
  return name && tokens[name] ? asHex(tokens[name]) : null
}

/**
 * 跑一遍跨规则判据。
 *
 * @param {{ file: string, css: string }[]} styles 待审样式（`src/` 下的 css 与各 SFC 的 style 块）
 * @returns {{ offenders: object[], allowlisted: object[], stats: object }}
 */
/**
 * 从声明里取出**可靠的字号下界**（px）。取不到就返回 null。
 *
 * 只接受"数学上一定能保证不小于这个值"的写法，因为判大的方向一旦错就是**放宽**门槛
 * （漏掉真缺陷），比误报更糟：
 *   - `30px`                    → 30 ✓
 *   - `clamp(30px, 3vw, 38px)`  → 30 ✓（clamp 的值**不小于**它的最小值）
 *   - `max(30px, 3vw)`          → 30 ✓（max 的值不小于任何一项）
 *   - `calc(30px + 1vw)`        → 30 ✓（vw 非负，只会更大）
 *   - `min(30px, 3vw)`          → null ✗（min 的值只会**更小**，不是下界）
 *   - `calc(30px - 1vw)`        → null ✗（减去的视口单位可能更大）
 *   - `max(3vw, 30px)`          → null ✗（第一项不是 px 就不猜，保守放过）
 *   - `1.5rem` / `150%` / `2em` → null ✗（相对值，静态读不出真实像素）
 *   - `var(--fs-24)`            → 24 ✓（阶段 4：`:root` 里的字号刻度令牌可静态解析）
 *   - `var(--fs-xl)`            → null ✗（未登记的令牌不猜，从严）
 * 特别注意 `%`：`parseFloat('150%')` 会得到 150，直接当 px 用会把 150% 判成"大字"
 * 从而**放宽**门槛——这是本轮夹具抓到的第一个真漏洞。
 */
export function fontSizeLowerBoundPx(value) {
  let text = String(value ?? '').trim()
  // 阶段 4 字号全量令牌化后，声明里常见 var(--fs-24)。只解析 :root 里登记过的
  // --fs-* 刻度（值必须是纯 px），未登记的一律保持 null → 按正文从严。
  const fsVar = /^var\(\s*(--fs-[\w-]+)\s*\)$/i.exec(text)
  if (fsVar) {
    const mapped = baseTokens[fsVar[1]]
    text = mapped && /^[\d.]+px$/i.test(String(mapped).trim()) ? String(mapped).trim() : text
    if (fsVar && text.startsWith('var(')) return null
  }
  const plain = /^([\d.]+)px$/i.exec(text)
  if (plain) return Number.parseFloat(plain[1])
  const grow = /^(?:clamp|max)\(\s*([\d.]+)px\s*,/i.exec(text)
  if (grow) return Number.parseFloat(grow[1])
  const add = /^calc\(\s*([\d.]+)px\s*\+/i.exec(text)
  if (add) return Number.parseFloat(add[1])
  return null
}

/** 把 `var(--fw-700)` 解析成 `700`（仅认 :root 登记过的 --fw-* 刻度）。 */
export function fontWeightTokenValue(value) {
  const text = String(value ?? '').trim()
  const fwVar = /^var\(\s*(--fw-[\w-]+)\s*\)$/i.exec(text)
  if (!fwVar) return text
  const mapped = baseTokens[fwVar[1]]
  return mapped != null && /^\d{3}$/.test(String(mapped).trim()) ? String(mapped).trim() : text
}

/**
 * WCAG 1.4.3 的"大字"门槛：≥24px，或 ≥18.66px 且加粗。
 *
 * 【为什么以前一律按 4.5 从严】跨规则判定器只看颜色，读不到字号，所以对大字也按正文判——
 * 结果是把"大字 3.5:1 达标"误报成缺陷（§4 第 15 条点名的 `FocusPanel .focus-clock.overtime`
 * 就是 `font-size: clamp(30px,3vw,38px)`，实测 3.27:1，按大字其实达标）。
 *
 * 【为什么只认可靠下界，而且只认**同一条规则**里的声明】
 *   1. 门槛读错的方向是**放宽**（漏掉真缺陷），比从严（误报）糟得多，所以只用能证明的下界，
 *      相对单位一律 null → 从严。见 fontSizeLowerBoundPx。
 *   2. 字号常写在祖先规则里靠继承生效，本判定器看不见祖先链，所以只有"同一条规则里
 *      明确写了大字"才降门槛；其余一律按正文 4.5 从严。
 */
export function largeTextThreshold(entry) {
  const size = fontSizeLowerBoundPx(entry?.fontSize)
  if (size === null) return PRIMARY_TEXT_MIN
  const weight = fontWeightTokenValue(entry?.fontWeight).trim().toLowerCase()
  const bold = weight === 'bold' || weight === 'bolder' || (/^\d{3}$/.test(weight) && Number(weight) >= 600)
  if (size >= 24) return LARGE_MIN
  if (size >= 18.66 && bold) return LARGE_MIN
  return PRIMARY_TEXT_MIN
}

export function crossRuleContrastOffenders(styles) {
  const families = new Map()
  const skipped = { atRule: 0, noClass: 0, noColorNoBg: 0, unresolved: 0, ambiguous: 0 }
  for (const { file, css } of styles) {
    for (const rule of cssRules(css)) {
      const family = firstClassOf(rule.selector)
      if (!family) { skipped.noClass += 1; continue }
      const decls = declarations(rule.body)
      if (!decls.color && !decls.background) { skipped.noColorNoBg += 1; continue }
      if (!families.has(family)) families.set(family, [])
      families.get(family).push({
        file: String(file).replace(/\\/g, '/'),
        selector: rule.selector.replace(/\s+/g, ' '),
        color: decls.color,
        background: decls.background,
        // 字号/字重也要留：WCAG 1.4.3 对"大字"只要 3:1，判定器不能一律按正文 4.5 从严
        fontSize: decls['font-size'],
        fontWeight: decls['font-weight'],
      })
    }
  }

  const offenders = []
  const stats = { families: families.size, tokenBackgrounds: 0, hardCodedColors: 0, pairsChecked: 0, largeTextRules: 0 }
  for (const [family, entries] of families) {
    const backgroundRules = entries.filter((entry) => entry.background && asVar(entry.background))
    stats.tokenBackgrounds += backgroundRules.length
    const colorRules = entries.filter((entry) => entry.color && asHex(entry.color) && !entry.background)
    stats.hardCodedColors += colorRules.length
    for (const colorRule of colorRules) {
      const targetCompounds = compoundsOf(colorRule.selector)
      const tag = tagOf(colorRule.selector)
      /**
       * 1. 同元素：候选的复合选择器个数与当前规则相同，且**逐复合**都是更宽的类集
       *    （`.knob span` 之于 `.knob.on span`）。逐复合比较是关键——只比整串类集的话，
       *    后代选择器 `.a .b` 会被当成 `.a` 的同一个元素。
       */
      const sameElement = entries
        .filter((entry) => {
          if (!entry.background) return false
          const compounds = compoundsOf(entry.selector)
          if (compounds.length !== targetCompounds.length) return false
          if (tagOf(entry.selector) !== tag) return false
          return compounds.every((compound, index) => [...classSetOf(compound)]
            .every((name) => classSetOf(targetCompounds[index]).has(name)))
        })
        .sort((a, b) => classSetOf(b.selector).size - classSetOf(a.selector).size)[0]
      // 2. 祖先前缀：复合选择器序列是当前规则的前缀（`.a` 之于 `.a .b`），取最长的那条
      const ancestor = entries
        .filter((entry) => {
          if (!entry.background) return false
          const compounds = compoundsOf(entry.selector)
          if (compounds.length >= targetCompounds.length) return false
          return compounds.every((compound, index) => compound === targetCompounds[index])
        })
        .sort((a, b) => b.selector.length - a.selector.length)[0]
      // 3. 族内唯一的令牌底：有多个不同的令牌底说明祖先链不确定，宁可漏报也不猜
      const distinct = new Set(backgroundRules.map((entry) => asVar(entry.background)))
      const sole = distinct.size === 1 ? backgroundRules[0] : null
      // 祖先分支同样受歧义闸门约束：`.multi` 与 `.multi .a` 都可能坐在 `.multi em` 上面
      const background = sameElement ?? (distinct.size === 1 ? ancestor : null) ?? sole
      if (!background) {
        if (distinct.size > 1) skipped.ambiguous += 1
        else skipped.unresolved += 1
        continue
      }
      // 门槛取自"字色那条规则"自己声明的字号；读不到就按正文从严（见 largeTextThreshold）
      const min = largeTextThreshold(colorRule)
      if (min === LARGE_MIN) stats.largeTextRules += 1
      for (const [themeName, tokens] of Object.entries(themes)) {
        const backgroundHex = toHexIn(background.background, tokens)
        const foregroundHex = asHex(colorRule.color)
        if (!backgroundHex || !foregroundHex) continue
        stats.pairsChecked += 1
        const ratio = contrastRatio(foregroundHex, backgroundHex)
        if (ratio === null || ratio >= min) continue
        offenders.push({
          file: colorRule.file,
          selector: colorRule.selector,
          theme: themeName,
          fg: foregroundHex,
          bg: backgroundHex,
          bgRule: background.selector,
          ratio: Number(ratio.toFixed(2)),
          min,
        })
      }
    }
  }
  const isAllowed = (offender) => CROSS_RULE_ALLOWLIST.some(
    (entry) => offender.file.endsWith(entry.file) && offender.selector === entry.selector,
  )
  const worst = new Map()
  for (const offender of offenders) {
    const key = `${offender.file}|${offender.selector}|${offender.theme}`
    if (!worst.has(key) || worst.get(key).ratio > offender.ratio) worst.set(key, offender)
  }
  const all = [...worst.values()].sort((a, b) => a.ratio - b.ratio)
  return { offenders: all.filter((entry) => !isAllowed(entry)), allowlisted: all.filter(isAllowed), stats }
}

function main() {
  const arguments_ = process.argv.slice(2)
  const asJson = arguments_.includes('--json')
  const showAll = arguments_.includes('--all')

  // --tokens：把解析出来的调色板按主题导出为 JSON，交给设计侧对齐
  // （对应审计里"设计令牌可导出"的诉求，完全不联网、不依赖 Figma）。
  if (arguments_.includes('--tokens')) {
    console.log(JSON.stringify(themePalettes(), null, 2))
    process.exit(0)
  }

  // 跨规则那一类（§4 第 15 条点名）要遍历 src 下所有 css 与 SFC 的 style 块。
  const crossStyles = []
  const sources = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (name.endsWith('.css')) crossStyles.push({ file: full, css: stripPrintStyles(stripCssComments(readFileSync(full, 'utf8'))) })
      else if (name.endsWith('.vue')) {
        const text = readFileSync(full, 'utf8')
        sources.push({ file: full, text })
        for (const match of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
          crossStyles.push({ file: full, css: stripPrintStyles(stripCssComments(match[1])) })
        }
      }
    }
  }
  walk(resolve(root, 'src'))
  const cross = crossRuleContrastOffenders(crossStyles)
  const gradient = gradientSurfaceOffenders(crossStyles)
  const inline = inlineSurfaceOffenders(sources)
  const focus = focusIndicatorOffenders()
  const sameRule = sameRuleHardCodedOffenders(crossStyles)
  const surfaceFailures = [...gradient.offenders, ...inline.offenders, ...sameRule.offenders]

  const results = auditContrast()
  const failures = results.filter((entry) => !entry.pass)

  if (asJson) {
    console.log(JSON.stringify({
      checked: results.length,
      failures,
      crossRule: cross,
      gradientSurface: gradient,
      inlineSurface: inline,
      sameRuleHardCoded: sameRule,
      focusIndicator: focus,
    }, null, 2))
    process.exit(failures.length || cross.offenders.length || surfaceFailures.length || focus.offenders.length ? 1 : 0)
  }

  const rows = showAll ? results : failures
  if (!rows.length && !cross.offenders.length && !surfaceFailures.length && !focus.offenders.length) {
    console.log(`✅ 对比度审计通过：${results.length} 组配色全部达标（AA）`)
    console.log(`✅ 跨规则审计通过：${cross.stats.families} 个族、${cross.stats.pairsChecked} 组配对`
      + `（其中 ${cross.stats.largeTextRules} 条字色规则自身声明了大字，按 3:1 判），`
      + `另有 ${cross.allowlisted.length} 处已在允许清单里登记理由`)
    console.log(`✅ 渐变与内联底审计通过：${gradient.stats.gradientRules} 条渐变规则`
      + `（其中 ${gradient.stats.gradientWithColor} 条同时给了字色、核了 ${gradient.stats.stopsChecked} 个色停），`
      + `静态内联背景 ${inline.stats.inlineBackgrounds} 处全部用令牌`)
    console.log(`✅ 同规则写死字色+底审计通过：${sameRule.stats.pairedRules} 条同规则配对`
      + `、核了 ${sameRule.stats.stopsChecked} 组色值`)
    console.log(`✅ 聚焦指示器审计通过：${focus.stats.themes} 个主题 × ${focus.stats.surfaces} 类相邻背景`
      + `共 ${focus.stats.combosChecked} 组，outline 与 halo 至少有一圈达到 ${NON_TEXT_MIN}:1`)
    process.exit(0)
  }

  console.log('主题'.padEnd(16) + '组合'.padEnd(26) + '色值'.padEnd(22) + '对比度  要求')
  console.log('─'.repeat(78))
  for (const entry of rows) {
    const colors = `${entry.fg} / ${entry.bg}`
    console.log(
      entry.theme.padEnd(14)
      + entry.label.padEnd(24)
      + colors.padEnd(30)
      + `${entry.ratio}:1`.padEnd(9)
      + `${entry.min}:1 ${entry.pass ? '✓' : '✗'}`,
    )
  }
  if (cross.offenders.length || surfaceFailures.length) {
    console.log('')
    console.log('跨规则（底跟主题令牌、文字却写死）：')
    for (const entry of cross.offenders) {
      console.log(`  ${entry.file.replace(root, '').replace(/^[\\/]/, '')}  ${entry.selector}`)
      console.log(`      ${entry.fg} 压在 ${entry.bg}（底来自 ${entry.bgRule}）＝ ${entry.ratio}:1`
        + `，要求 ${entry.min}:1  [${entry.theme}]`)
    }
    console.log('')
    console.log('渐变底与模板内联底：')
    for (const entry of surfaceFailures) {
      console.log(`  ${entry.file.replace(root, '').replace(/^[\\/]/, '')}  ${entry.selector}`)
      console.log(`      ${entry.fg} 压在 ${entry.bg}（${entry.bgRule}）`
        + `${entry.ratio === null ? '' : `＝ ${entry.ratio}:1，要求 ${entry.min}:1`}  [${entry.theme}]`)
    }
  }
  console.log('')
  console.log(`✗ ${failures.length} / ${results.length} 组未达 AA 标准`
    + `，另有 ${cross.offenders.length} 处跨规则、${surfaceFailures.length} 处渐变/内联底不达标`
    + `（跨规则允许清单内 ${cross.allowlisted.length} 处）`)
  process.exit(1)
}

// 只有直接执行时才跑主流程；被 import 时（例如测试）只暴露函数。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()