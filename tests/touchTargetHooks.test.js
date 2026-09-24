// @vitest-environment happy-dom
/**
 * 触控目标钩子接线守卫（第四十三轮）。
 *
 * 【为什么只守 `role="button"` 这一条】第五、六轮已经把触控目标梳理过一遍（`--tap-min: 44px`
 * 令牌 + `@media (pointer: coarse)` 统一兜底，`.tap-target` 用过十来处），并在报告里明确
 * **拒绝**了另一件事：拿字号和 padding 去推算像素高度、再断言"不足 44px"。那个结论不可靠，
 * 属于"假警的守卫最后一定会被人关掉"那一类——这里同样不做推算。
 *
 * 于是只守一件**确定**的事：`role="button"` 是作者**显式声明**"这是个按钮"，而粗指针下
 * 44px 兜底规则的目标选择器恰恰是 `[role='button'].tap-target`（见 style.css）。所以
 * "写了 role=button 却没接 tap-target"就是**漏接**，不推荐算。写死像素的地方一律不管。
 *
 * 【为什么不是全部可点击元素】`.chip` / `.segmented` / `.link-btn` / `.toast-btn` 这类密集
 * 内联控件是**刻意**靠间距而非尺寸达成可分性的（写在上面的 CSS 注释里），强行放大反而挤爆筛选行。
 * 全量筛查会把这个已知取舍重新翻出来，所以判据只覆盖"作者自己说了这是按钮"的那一类。
 *
 * 【判据分工】
 *   - 本文件：`[role="button"]` 必须接 `btn`/`tap-target`，否则必须进 ALLOWLIST 且写明理由；
 *   - ALLOWLIST 的**自我淘汰**：某一项哪天接上了钩子，测试会报"已不再是例外，请删掉"；
 *   - 规模棘轮：`tap-target` 元素数不得下降（防"顺手简化掉钩子"）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/* ---------- 模板扫描（自足实现，和 keyboardReachability 的扫描器一样不共享） ---------- */

function vueFiles(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) vueFiles(full, out)
    else if (full.endsWith('.vue')) out.push(full)
  }
  return out
}

/**
 * 取 `<template>` 段。用 `lastIndexOf('</template>')` 而不是第一个——
 * `<style>` 里可能（历史上确实）出现过字符串形式的 `<template>`。
 */
function templateOf(raw) {
  const start = raw.indexOf('<template>')
  if (start < 0) return ''
  const end = raw.lastIndexOf('</template>')
  return raw.slice(start, end > start ? end : raw.length)
}

/** 开标签枚举：先去注释，再按引号感知切分属性。 */
function openTags(text) {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '')
  const tags = []
  const re = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let match
  while ((match = re.exec(clean)) !== null) tags.push({ tag: match[1].toLowerCase(), attrs: match[2] })
  return tags
}

/** 取所有 class 属性（含 `:class`，单双引号都认）。 */
function classValues(attrs) {
  const values = []
  const re = /(?:\s|^):?class\s*=\s*("([^"]*)"|'([^']*)')/g
  let match
  while ((match = re.exec(attrs)) !== null) values.push(match[2] ?? match[3] ?? '')
  return values
}

const hasClass = (attrs, name) => classValues(attrs).some((value) => new RegExp(`(^|[\\s'"]|\\[)${name}([\\s'"]|\\]|$)`).test(value))

/**
 * 扫出「声明了 role="button"，但没接触控目标钩子」的元素。
 * 接上钩子 = class 里有 `btn` 或 `tap-target`（粗指针 44px 规则的四个目标之一）。
 */
export function findUnhookedRoleButtons(template) {
  const found = []
  for (const { attrs } of openTags(template)) {
    if (!/role\s*=\s*"button"/.test(attrs)) continue
    if (hasClass(attrs, 'btn') || hasClass(attrs, 'tap-target')) continue
    const classes = classValues(attrs).join(' ').trim()
    found.push({ classes, interactive: /@click|@keydown/.test(attrs) })
  }
  return found
}

export function countTapTargetElements(template) {
  let n = 0
  for (const { attrs } of openTags(template)) if (hasClass(attrs, 'tap-target')) n += 1
  return n
}

/**
 * 取出 CSS 里每个 `@media (pointer: coarse)` 块的**完整**内容（大括号配平）。
 * 不能用贪婪/懒惰的 `\{([\s\S]*?)\}`：块里有嵌套规则，第一个 `}` 就截断了。
 */
export function coarseBlocks(css) {
  const blocks = []
  const marker = /@media\s*\(pointer:\s*coarse\)\s*\{/g
  let match
  while ((match = marker.exec(css)) !== null) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    blocks.push(css.slice(start, i - 1))
  }
  return blocks
}

/* ---------- 例外清单 ---------- */

/**
 * 两条都是「布局已经在管尺寸」的情形。判据只要求**写明理由**，不要求它们是"对的"——
 * 但理由必须能被复核，所以每条都附上可查的证据（哪条 CSS 声明）。
 */
const ALLOWLIST = [
  {
    file: 'components/schedule/ScheduleGrid.vue',
    klasses: ['tt-cell'],
    reason: '自带 `min-height: 48px`（ScheduleGrid.vue 的 .tt-cell 规则，skin-timeline 下是 54px），'
      + '本来就 ≥ 44px，再加 tap-target 是**空操作**，所以不接钩子。'
      + '它是网格里的空格：高由网格行轨道决定，加 min-height 反而可能撑破轨道。',
  },
  {
    file: 'components/schedule/ScheduleGrid.vue',
    klasses: ['course'],
    reason: '高度由**网格行轨道**决定（模板里按 `grid-row: 起 / 止` 跨行，由课程占几节决定），'
      + '不是靠自身 padding 撑出来的。它是网格定位元素，加 min-height 有溢出轨道的风险，'
      + '这一点第五轮梳理时就已记录（".course 由网格定位给尺寸"）。',
  },
]

/* ---------- 夹具：判据的判别力 ---------- */

describe('findUnhookedRoleButtons 的判别力', () => {
  it('抓得住：有 role="button" 却没接钩子的', () => {
    expect(findUnhookedRoleButtons('<div role="button" tabindex="0" @click="x()">行</div>')).toEqual([
      { classes: '', interactive: true },
    ])
  })

  it('放行：接了 btn 或 tap-target 的', () => {
    expect(findUnhookedRoleButtons('<div role="button" class="row tap-target" @click="x()">行</div>')).toEqual([])
    expect(findUnhookedRoleButtons('<div role="button" class="btn" @click="x()">按钮</div>')).toEqual([])
    expect(findUnhookedRoleButtons("<div role=\"button\" :class=\"['row', 'tap-target']\" @click=\"x()\">行</div>")).toEqual([])
  })

  it('放行：没声明 role="button" 的元素（密集内联控件是刻意的另一类）', () => {
    expect(findUnhookedRoleButtons('<button class="chip" @click="x()">标签</button>')).toEqual([])
    expect(findUnhookedRoleButtons('<span class="recent-chip" @click="x()">最近</span>')).toEqual([])
  })

  it('不会被注释里的 role="button" 骗到', () => {
    expect(findUnhookedRoleButtons('<!-- <div role="button" @click="x()">旧写法</div> -->')).toEqual([])
  })

  it('countTapTargetElements 只数 class 属性里的，不数注释提及', () => {
    expect(countTapTargetElements('<!-- 说明里点名 tap-target --><div class="a tap-target"></div><button class="b"></button>')).toBe(1)
  })
})

/* ---------- 全仓扫描 ---------- */

describe('全仓触控目标钩子接线', () => {
  const files = vueFiles()

  it('扫描规模自证：确实扫到了整个 src', () => {
    expect(files.length, '扫到的 .vue 文件太少，判据可能已经和目录结构脱节').toBeGreaterThanOrEqual(50)
  })

  it('每个 role="button" 都接上了 btn/tap-target，或已在例外清单里写明理由', () => {
    const offenders = []
    for (const file of files) {
      const rel = file.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1)
      for (const found of findUnhookedRoleButtons(templateOf(readFileSync(file, 'utf8')))) {
        const exempt = ALLOWLIST.some((entry) => entry.file === rel && entry.klasses.every((k) => found.classes.includes(k)))
        if (!exempt) offenders.push(`${rel}: class="${found.classes}"${found.interactive ? '（可交互）' : ''}`)
      }
    }
    expect(offenders, `这些 [role="button"] 没接触控目标钩子，粗指针下拿不到 44px 兜底：\n${offenders.join('\n')}`).toEqual([])
  })

  it('例外清单自我淘汰：哪一条接上了钩子就必须删掉', () => {
    for (const entry of ALLOWLIST) {
      const file = join(srcDir, entry.file)
      const found = findUnhookedRoleButtons(templateOf(readFileSync(file, 'utf8')))
      const stillThere = found.some((item) => entry.klasses.every((k) => item.classes.includes(k)))
      expect(stillThere, `${entry.file} 的 ${entry.klasses.join('/')} 已不再是例外（接上钩子了），请从 ALLOWLIST 里删掉`).toBe(true)
    }
  })

  it('约定本身还在：style.css 的粗指针规则必须仍然覆盖 [role="button"].tap-target', () => {
    const css = readFileSync(join(srcDir, 'style.css'), 'utf8')
    expect(css, '--tap-min 令牌不见了').toMatch(/--tap-min:\s*44px/)
    // 文件里有**多个** @media (pointer: coarse) 块（表单控件、触控目标……），
    // 所以不能拿第一个就下结论：按大括号配平把每个块都取出来，只要有**一个**
    // 块同时覆盖 [role='button'].tap-target 与 min-height:var(--tap-min) 就算数。
    const blocks = coarseBlocks(css)
    expect(blocks.length, '一个粗指针媒体查询都找不到').toBeGreaterThan(0)
    const covering = blocks.filter((block) => /\[role='button'\]\.tap-target/.test(block) && /min-height:\s*var\(--tap-min\)/.test(block))
    expect(covering.length, `粗指针规则不再覆盖 [role='button'].tap-target，钩子就白接了（共找到 ${blocks.length} 个粗指针块）`).toBeGreaterThan(0)
  })

  it('规模棘轮：tap-target 元素数不得下降（防顺手"简化"掉钩子）', () => {
    const total = files.reduce((sum, file) => sum + countTapTargetElements(templateOf(readFileSync(file, 'utf8'))), 0)
    // 实测 14（本轮把 LedgerView 的 .feed-item / .cd-row 接上后从 12 涨到 14）。
    // 注意：报告早期记的"15 处"是**提到 tap-target 的行数**（含注释），不是元素数——
    // 这里按元素数棘轮，因为注释多写几个字不该让守卫变绿。
    expect(total, 'tap-target 元素数下降了，可能有人把钩子删了').toBeGreaterThanOrEqual(14)
  })
})