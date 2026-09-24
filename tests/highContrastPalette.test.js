// @vitest-environment happy-dom
/**
 * 高对比度在「跟随系统」主题下必须真的生效（第三十五轮新增守卫）。
 *
 * 【为什么补这条】高对比的色值一直只写在 `style.css` 的
 * `:root[data-contrast='high']` / `:root[data-theme='dark']:not([data-contrast='normal'])`
 * （以及 `@media (prefers-contrast: more)` 那一份）里。那对**具名主题**是有效的：
 * 它们走 `theme.js` 的 `else` 分支，只 `clearThemeVariables()` 且不写内联变量，
 * 所以样式表说了算。
 *
 * 但「跟随系统」主题走的是**另一个**分支：它把整张调色板写成**内联变量**，
 * 而内联样式优先于任何选择器（除非对面写 `!important`）。于是：
 * 跟随系统主题下高对比设置**完全不生效**——深色时 `--border` 停在 `#2a3248`
 * （本该 `#64749a`）、`--muted` 停在 `#8b95a8`（本该 `#bcc7db`）。
 * 而深色只能由「跟随系统 + 系统偏好深色」产生，受影响面并不小。
 *
 * 【注意】`tests/contrastAudit.test.js` 覆盖不到这个 bug ✗：它只解析**样式表**，
 * 验的正是那些从不生效的值——典型的假信心。所以这里断言的是**运行时**
 * `document.documentElement.style` 上的真实值。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CSS = readFileSync(resolve(import.meta.dirname, '..', 'src/style.css'), 'utf8')
const DELTA_TOKENS = ['--border', '--border-strong', '--ink-soft', '--ink-faint', '--muted', '--bg-tint']

/** 取出某个 `{` 起配平的块内容。 */
function braceBody(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return ''
}

/**
 * style.css 里所有「强对比」规则块。
 *
 * 四条：`@media (prefers-contrast: more)` 里的浅色与深色各一条，
 * `[data-contrast='high']` 的浅色与深色各一条。带 `data-theme='dark'` 的算深色。
 */
function contrastBlocks() {
  const found = []
  for (const match of CSS.matchAll(/[^\n{]*\[data-contrast='(?:normal|high)'\][^\n{]*\{/g)) {
    const selector = match[0].slice(0, -1).trim()
    const decls = {}
    for (const decl of braceBody(CSS, match.index + match[0].length - 1).matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      decls[decl[1]] = decl[2].toLowerCase()
    }
    found.push({ selector, dark: /data-theme='dark'/.test(selector), decls })
  }
  return found
}

const root = () => document.documentElement
const inlineVar = (name) => root().style.getPropertyValue(name).trim().toLowerCase()

/** 以指定的系统偏好重新加载 theme.js（模块缓存会记住 matchMedia 的初值）。 */
async function loadTheme(queries) {
  vi.resetModules()
  window.matchMedia = (query) => ({
    matches: Boolean(queries[query]),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })
  // 两个模块必须来自同一份重置后的模块图，否则 highContrast 是两份不同的 ref。
  const theme = await import('../src/composables/theme.js')
  const contrast = await import('../src/composables/contrast.js')
  return { ...theme, highContrast: contrast.highContrast }
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-contrast')
  document.documentElement.removeAttribute('style')
})
afterEach(() => { vi.restoreAllMocks() })

describe('高对比度在跟随系统主题下真的生效', () => {
  it('跟随系统 + 深色 + 应用内高对比：内联变量必须用强对比值', async () => {
    const theme = await loadTheme({ '(prefers-color-scheme: dark)': true })
    theme.themeKey.value = 'system'
    theme.highContrast.value = true
    await nextTick()

    expect(root().dataset.theme, '前提：确实进了深色').toBe('dark')
    expect(root().dataset.contrast, '前提：确实打开了高对比').toBe('high')
    // 修好之前这里读到的是普通深色值 #2a3248 —— 高对比被内联样式压掉了。
    expect(inlineVar('--border'), '深色高对比的边框色没生效').toBe('#64749a')
    expect(inlineVar('--muted')).toBe('#bcc7db')
    // 第三十六轮把深色高对比的 tint 从 #1b2333 改成 #0d1320：
    // 前者与 --card(#1b2233) 只差一个绿通道值，内嵌区与卡片肉眼同色。
    expect(inlineVar('--bg-tint')).toBe('#0d1320')
  })

  it('跟随系统 + 浅色 + 应用内高对比：同样要用强对比值', async () => {
    const theme = await loadTheme({ '(prefers-color-scheme: dark)': false })
    theme.themeKey.value = 'system'
    theme.highContrast.value = true
    await nextTick()

    expect(root().dataset.theme).toBe('light')
    expect(inlineVar('--border')).toBe('#8b97ae')
    expect(inlineVar('--muted')).toBe('#3d4759')
    expect(inlineVar('--bg-tint')).toBe('#eef1f7')
  })

  it('系统级 prefers-contrast: more 也要生效（应用内开关不用打开）', async () => {
    const theme = await loadTheme({
      '(prefers-color-scheme: dark)': true,
      '(prefers-contrast: more)': true,
    })
    theme.themeKey.value = 'system'
    await nextTick()

    expect(theme.highContrast.value, '前提：应用内开关是关的').toBe(false)
    expect(inlineVar('--border'), '系统高对比没被跟随').toBe('#64749a')
  })

  it('没有高对比时不许强行用强对比值（负例）', async () => {
    const theme = await loadTheme({ '(prefers-color-scheme: dark)': true })
    theme.themeKey.value = 'system'
    theme.highContrast.value = false
    await nextTick()

    expect(inlineVar('--border')).toBe('#2a3248')
    expect(inlineVar('--muted')).toBe('#8b95a8')
    expect(inlineVar('--bg-tint')).toBe('#161d2c')
  })

  it('具名主题仍然不写内联变量（样式表说了算的那条路不能坏）', async () => {
    const theme = await loadTheme({ '(prefers-color-scheme: dark)': true })
    theme.themeKey.value = 'system'
    await nextTick()
    expect(inlineVar('--border'), '前提：跟随系统会写内联').not.toBe('')

    theme.themeKey.value = 'blue'
    await nextTick()
    for (const token of ['--border', '--card', '--bg-tint', '--muted']) {
      expect(inlineVar(token), `切到具名主题后 ${token} 必须清掉，否则会串色`).toBe('')
    }
  })
})

describe('两份强对比色值不许漂移', () => {
  it('style.css 的四条强对比块内部一致（浅色两条相同、深色两条相同）', () => {
    const blocks = contrastBlocks()
    expect(blocks.length, '没解析到强对比块').toBeGreaterThanOrEqual(4)
    for (const token of DELTA_TOKENS) {
      const light = new Set(blocks.filter((b) => !b.dark).map((b) => b.decls[token]).filter(Boolean))
      const dark = new Set(blocks.filter((b) => b.dark).map((b) => b.decls[token]).filter(Boolean))
      expect(light.size, `浅色的 ${token} 在两条块里不一致：${[...light].join('/')}`).toBe(1)
      expect(dark.size, `深色的 ${token} 在两条块里不一致：${[...dark].join('/')}`).toBe(1)
    }
  })

  it('theme.js 在跟随系统下写出的值，与 style.css 里那份逐字一致', async () => {
    const byMode = {}
    for (const dark of [false, true]) {
      const theme = await loadTheme({ '(prefers-color-scheme: dark)': dark })
      theme.themeKey.value = 'system'
      theme.highContrast.value = true
      await nextTick()
      byMode[dark ? 'dark' : 'light'] = Object.fromEntries(DELTA_TOKENS.map((token) => [token, inlineVar(token)]))
    }

    for (const block of contrastBlocks()) {
      const mode = block.dark ? 'dark' : 'light'
      for (const token of DELTA_TOKENS) {
        const fromCss = block.decls[token]
        if (!fromCss) continue
        expect(byMode[mode][token], `${block.selector} 的 ${token} 与 theme.js 漂移了`).toBe(fromCss)
      }
    }
  })
})

describe('层次不能糊在一起（第三十六轮新增）', () => {
  /**
   * 最大通道差。用它而不是对比度公式，是因为这里要判的是「两片颜色看起来是不是同一块」，
   * 而不是「文字读不读得清」。
   *
   * 阈值取 4 是有实测依据的：本仓库刻意做得很含蓄的那一档是
   * 浅色普通模式的 `--bg-tint(#f9fafd)` 对 `--card(#ffffff)`，差 6；
   * 而踩过的坑是深色高对比的 `#1b2333` 对 `#1b2233`——**只差 1**，肉眼完全是同一块。
   */
  const channelDiff = (a, b) => Math.max(...[1, 3, 5].map((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))))

  async function paletteFor(dark, contrast) {
    const theme = await loadTheme({
      '(prefers-color-scheme: dark)': dark,
      '(prefers-contrast: more)': false,
    })
    theme.themeKey.value = 'system'
    theme.highContrast.value = Boolean(contrast)
    await nextTick()
    return {
      card: inlineVar('--card'),
      bg: inlineVar('--bg'),
      tint: inlineVar('--bg-tint'),
      label: `${dark ? '深色' : '浅色'}${contrast ? '高对比' : '普通'}`,
    }
  }

  it('四种组合下 --bg-tint 都必须与 --card、--bg 分得开', async () => {
    for (const dark of [false, true]) {
      for (const contrast of [false, true]) {
        const { card, bg, tint, label } = await paletteFor(dark, contrast)
        expect(channelDiff(tint, card), `${label}：--bg-tint(${tint}) 与 --card(${card}) 几乎同色，内嵌区与卡片分不出来`).toBeGreaterThanOrEqual(4)
        // 与 --bg 的阈值统一提到 4（原来是 3）：四档实测值为
        // 浅色普通 4、浅色高对比 5、深色高对比 6、深色普通 6。
        // 之前这里是 3，唯一的原因就是**深色普通只有 3**（#131a29 vs #121826）——
        // 第四十二轮把它提到 #161d2c（差 6），"落在页面底色上的内嵌区看不出边界"
        // 这个问题就没了，阈值顺势收到 4（四档全过），不再给任何一档留 3 的口子。
        // 为什么不是更高的 6：最大通道差的上限就是 --bg 与 --card 之间的 13，
        // tint 与两边都要明显过 4，能分给"与 --bg 的差"的本就不高；
        // 浅色普通那一档 #f9fafd 与 --bg 只差 4 是**刻意含蓄**的既有取值。
        expect(channelDiff(tint, bg), `${label}：--bg-tint(${tint}) 与 --bg(${bg}) 几乎同色`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('高对比的层次差不得小于普通模式（"高对比"要的是更清楚，不是更糊）', async () => {
    for (const dark of [false, true]) {
      const normal = await paletteFor(dark, false)
      const high = await paletteFor(dark, true)
      const dNormal = channelDiff(normal.tint, normal.card)
      const dHigh = channelDiff(high.tint, high.card)
      expect(dHigh, `${dark ? '深色' : '浅色'}：高对比的 tint/card 差 ${dHigh} 反而小于普通的 ${dNormal}`).toBeGreaterThanOrEqual(dNormal)
    }
  })
})