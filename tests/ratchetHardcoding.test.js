// @vitest-environment node
/**
 * 阶段7 棘轮：硬编码颜色、断点、z-index、裸 `JSON.parse(localStorage)`、巨型文件。
 *
 * 【为什么值得守】阶段1~4 修掉的大部分问题都是「写死」造成的：写死浅色的全局告警条在深色主题
 * 下铺白块、写死的语义绿在深色底上掉到 1.9:1、两套 900/901 断点让同一张卡片在不同断点下
 * 走不同分支、`JSON.parse(localStorage)` 裸调用让一次脏数据直接掀翻启动流程。这些改动没有任何
 * 行为签名——构建照样过、既有测试照样全绿（既有守卫只检查行为），所以**回潮是静默的**。
 *
 * 棘轮的做法：数字全部是**实测值**（不是拍脑袋），只准降、不准升。想合法地升（比如并行任务
 * 合理地新增了一处颜色），就得来这里改数字——那正是这个守卫想要的效果：让「又写死了」必须
 * 被**意识到**，而不是悄悄发生。
 *
 * 【三份审查报告对应的位置】
 *   - 颜色：报告 #9~#19（写死浅色盒 / 语义绿碎片化 / 品牌渐变等）→ script/style/template 三个区
 *   - 断点：布局报告第 1、2 条（900/901 矛盾、约 12 套断点）→ 断点棘轮
 *   - z-index：布局报告第 34 条（阶梯散乱）→ z-index 棘轮
 *   - JSON.parse：工程报告 #3（10+ 处裸调用）→ 裸 JSON.parse 棘轮
 *   - 巨型文件：工程报告 #1（LedgerView 3473 / DataManager 2502 行）→ 巨型文件棘轮
 *
 * 【三个刻意的设计，都是为了让这条守卫不会退化成空断言】
 *   1. 计数器先用夹具验判别力：SFC 必须按块切分（`<style>` 里的颜色不能算进 script 区）、
 *      HTML 注释里的颜色不能算、`image/*` 这种字符串不是颜色、`try` 里的 JSON.parse 不算裸。
 *   2. 每个计数都带**下限**断言：正则写坏时结果是 0，那种「假绿」比漏报更危险。
 *   3. 颜色按 script / style / template 分三个区分别记账：script 区的 hex 绝大多数是**调色板真源**
 *      （theme.js 令牌定义、festive.js 节日色、canvas 彩带、课程色映射），不是可迁移的样式色；
 *      style 区才是本次迁移的主战场。混成一个数字就看不出谁在涨。
 *
 * 【计数口径】
 *   - 颜色：`#rgb`/`#rrggbb`/`#rrggbbaa` + `rgb(` / `rgba(` / `hsl(` / `hsla(`。
 *     **不剥块注释与行注释**：剥了会误伤 `accept="image/*"` 之类的字符串，且注释里的颜色计数
 *     同样稳定（口径不变 = 棘轮有效）；只有 HTML 注释必须剥——App.vue 模板注释里有字面量
 *     `<style>`，不剥会把整段模板当成样式块（这个坑本仓库踩过三次，见 styleComments.test.js）。
 *   - 断点：`@media` 头部里的 `(min-width|max-width): Npx`，N 必须落在本项目的断点档位上。
 *   - 裸 JSON.parse：`JSON.parse(localStorage…)` 必须落在某个未闭合的 `try` 里（花括号配平判断，
 *     不是「同一行有没有 try」——本仓库 10 处里 9 处的 try 在上一行，按行判会全部误报）。
 *   - 行数：按 `\r?\n` 切，含空行（与编辑器显示一致）。
 *
 * 【阶段7 之后仍留在原地的颜色，以及为什么留】（不是漏迁，每一条都有判据）
 *   1. **浅底没有对应令牌**：`--danger` / `--success` 只是文字色，没有 `--danger-soft` /
 *      `--success-soft`。把这类「浅底 + 深字」的字单独换成 var()，深色主题下会变成浅底压亮字。
 *      要迁必须先补令牌 —— 补令牌得同步改根目录 DESIGN_TOKENS.md（本阶段不动文档）。
 *      典型：AppearanceSettings 的 danger/success/muted 三行、FocusPanel 的浅绿提示条、
 *      App.vue 的三条全局告警条（报告 #9/#11 写死浅棕底）。
 *   2. **script 区的 148 处绝大多数是调色板真源**，不是可替换的样式色：theme.js 的令牌定义
 *      （69）、festive.js 节日色（16）、canvas 彩带/雪花（App.vue 13）、课程色映射与色选择器、
 *      OCR 画布的白底。
 *      这些换成本地令牌会让「数据」依赖「样式」，方向是反的。
 *   3. **并行任务文件**：`components/DataManager.vue`（script 4 / style 30）属于阶段6d，
 *      本阶段不碰。
 *   4. **z-index 的 20 个档位**是 App.vue 注释里文档化、且被 tests/modalStackOrder.test.js
 *      从源码解析后断言的阶梯（0 壁纸 → 1 布局 → 20 侧栏 → 90 任务胶囊 → 100–109 弹窗 →
 *      110 底部面板 → 130 右键菜单 → 200 Toast → 240/241 告警 → 250 快记提示 → 300 错误 →
 *      301 跳转链接）。合并档位要同时改注释与该守卫，没有视觉收益，本阶段只上棘轮、不改值。
 *   5. **断点已经收敛**：全仓 `@media` 里没有档位外的断点（0 处），也没有空查询。
 *      900 与 901 是一组互补边界（min 用 901、max 用 900），不是矛盾。
 *   6. **JSON.parse(localStorage) 已经 10/10 全部在 try 里**（工程报告写的"10+ 处裸调用"
 *      是按行判的假象：本仓库的 `try {` 基本都在上一行）。所以这条不是"收敛多少处"，
 *      而是"一处都不许裸" —— 基线直接是 0，新增一处立刻红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const srcDir = resolve(root, 'src')

/** 棘轮基线：阶段7 立规矩当天的实测值（只准降，不准升）。 */
export const BASELINE = {
  /** 阶段7 迁移前 153：colorMap 的 primary 组改引令牌（-3），并删掉一条注释里的两个 hex（-2）。 */
  scriptColors: 148,
  /**
   * 阶段7 迁移前 384：两处勾选框未勾选态的写死白底改用 --card（-2）。
   *
   * 385（+3）：SearchPanel 的筛选 chip、WeeklyReviewView 的热力图最深格、
   * ReviewPanel 的趋势区间选中态，三处新写的「主色/成功色实底上的文字色」。
   * 它们用的都是本仓库既有的 `var(--on-primary, #fff)` 写法 —— 全仓已有 12 处
   * 同样写法（style.css、EventsView、SwipeActionItem、TaskCenter…），
   * DESIGN_TOKENS.md §"为什么有 --on-primary" 也是这么示范的。
   * 也就是说这 3 处是**沿用约定**而不是回潮：写死的是兜底值，
   * 真正生效的是 --on-primary（:root 无条件定义，theme.js 还会按主题重写它）。
   * 属于"合法升基线"，故在此登记理由，而不是把那 3 处改成另一种写法、
   * 让同一份约定在仓库里出现两种长相。
   */
  styleColors: 385,
  templateColors: 3,
  offTierBreakpoints: 0,
  emptyMediaQueries: 0,
  distinctZIndex: 20,
  /** 未被 try 包住的 JSON.parse(localStorage…)：阶段7 当天实测 10/10 全部已有 try，基线 0。 */
  bareJsonParse: 0,
  // 旧设备同步与本地迁移路径删除后，当前安全解析调用点为 5；每个裸调用仍必须为 0。
  jsonParseOccurrences: 5,
}

/** 本项目的断点档位：520/760 是常规两档，900 与 901 是一组互补边界（见布局报告第 1 条）。 */
export const BREAKPOINT_TIERS = [520, 760, 900, 901]

/** 超过这个行数的文件必须登记在册；登记过的文件另有自己的行数上限。 */
export const GIANT_LINE_LIMIT = 1200
export const GIANT_ALLOWLIST = {
  'views/LedgerView.vue': 1323,
  'views/ProjectsView.vue': 1550,
}

/** 每个超过 800 行的文件单独设上限，避免只守总数时把瘦身空间转移给另一个文件。 */
export const LARGE_FILE_LIMITS = Object.freeze({
  'views/LedgerView.vue': 1323,
  // 齐行把项目、任务、成果和团队时间的操作留在同一个路由视图中，避免多个页面之间丢失当前项目上下文；
  // 本次按实测行数设上限，后续新增功能需要先拆分或压缩。
  'views/ProjectsView.vue': 1550,
  'components/AppearanceSettings.vue': 1115,
  'views/TodayView.vue': 1012,
  'views/TasksView.vue': 1011,
  // 【一次性升基线，+16 行，理由是补一个"用户根本点不到"的入口】
  // FestiveSettings.vue 从加进仓库起全 `src/` 只有测试直接 import 它，Sidebar 从未挂载：
  // 「开关节日氛围 / 生日 / 开始使用日期 / 纪念日与农历纪念日」这一整块设置没有任何入口。
  // 补入口必须落在 Sidebar（桌面按钮 + 手机「更多」格 + 懒加载预热 + 挂载点各一处），
  // 与其把这段接线塞进别的文件变成跨文件隐式约定，不如就地写清楚。
  // 上限按实测行数收口，仍然只准缩：后续再加东西必须先把别处减下来。
  'components/Sidebar.vue': 1004,
  'style.css': 947,
  // 【一次性升基线，+25 行，理由是修一个 P1 外壳缺陷，不是回潮】
  // 五条外壳级提示原来各自 `position:fixed` 在同一个 top/left 上，z-index 241 的保存/备份条
  // 会把 240 的同步告警**整条**盖住（「重试同步」「打开数据管理」根本点不到）。改法是把它们收进
  // 一个 fixed 纵向 flex 队列（放进来的：.global-alert-stack 与 `.global-alert-stack > *` 两条规则
  // 连同取舍说明 18 行、预留高度改成按可见条数算 4 行、队列槽位在 JS 里算 7 行）。
  // 已经先从别处减下来过：五份重复的 `<Transition name="global-sync">` 收成一个 TransitionGroup
  // （-8 行）、`hasGlobalAlert` 并进 `alertCount`（-5 行）、删掉 `.global-alert-reserve` 上那条
  // 死的 `flex:0 0 54px`。剩下的差额是"容器规则 + 它为什么这么写的注释"，没有再压的空间。
  'App.vue': 969,
  'components/FocusPanel.vue': 899,
  'views/ExamsView.vue': 886,
  'components/QuickRecordPanel.vue': 866,
  'views/ledger-panels/LedgerHomePanel.vue': 812,
})

/** 剥 HTML 注释（等长替换，保留行号）。 */
export function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 取 SFC 三个区的内容（先剥 HTML 注释，避免注释里的字面量 `<style>` 被当成块起点）。 */
export function sfcBlocks(text) {
  const source = stripHtmlComments(text)
  const out = { script: '', style: '', template: '' }
  const re = /<(script|style|template)([^>]*)>([\s\S]*?)<\/\1>/g
  let match
  while ((match = re.exec(source))) out[match[1]] += `\n${match[3]}`
  return out
}

/** 颜色出现次数：hex（≥3 位，避免把 `#1` 这种锚点当颜色）+ rgb/hsl 函数。 */
export function countColors(text) {
  const hex = text.match(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g) ?? []
  const fn = text.match(/\b(?:rgba?|hsla?)\(/g) ?? []
  return hex.length + fn.length
}

/**
 * 该位置是否落在某个**未闭合**的 try 块里。
 *
 * 判据用花括号配平，而不是「同一行有没有 try」：本仓库 10 处 `JSON.parse(localStorage…)`
 * 里有 9 处的 `try {` 在上一行（甚至中间还隔着别的语句），按行判会把它们全部误报成裸调用——
 * 阶段7 立规矩当天就踩了这个坑，所以这里专门留夹具把四种形状钉死。
 */
export function isInsideTry(text, index) {
  let from = index
  while (from > 0) {
    const tryIdx = text.lastIndexOf('try', from)
    if (tryIdx === -1) return false
    const before = tryIdx === 0 ? '' : text[tryIdx - 1]
    const brace = /^\s*\{/.exec(text.slice(tryIdx + 3))
    if ((before === '' || !/[a-zA-Z0-9_$]/.test(before)) && brace) {
      const openIdx = tryIdx + 3 + brace[0].length - 1
      if (openIdx < index) {
        let depth = 0
        let closed = false
        for (let j = openIdx; j < index; j++) {
          const ch = text[j]
          if (ch === '{') depth += 1
          else if (ch === '}') {
            depth -= 1
            if (depth <= 0) { closed = true; break }
          }
        }
        if (!closed) return true
      }
    }
    from = tryIdx - 1
  }
  return false
}

/** 未被 try 包住的 `JSON.parse(localStorage…)`（含跨行写法），返回 `文件:行号`。 */
export function unprotectedJsonParses(text) {
  const out = []
  const re = /JSON\.parse\(\s*(?:(?:window\.)?localStorage|[A-Za-z_$][\w$]*\.getItem(?=\s*\())/g
  let match
  while ((match = re.exec(text)) !== null) {
    if (isInsideTry(text, match.index)) continue
    out.push(`第 ${text.slice(0, match.index).split(/\r?\n/).length} 行: ${match[0].replace(/\s+/g, ' ')}`)
  }
  return out
}

/** `@media` 头部里不落在档位上的断点声明。 */
export function offTierBreakpoints(styleText) {
  const found = []
  for (const head of styleText.matchAll(/@media([^{}]*)\{/g)) {
    for (const width of head[1].matchAll(/\((?:min|max)-width:\s*(\d+)px\)/g)) {
      const px = Number(width[1])
      if (!BREAKPOINT_TIERS.includes(px)) found.push(px)
    }
  }
  return found
}

function walk(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|js|css)$/.test(name)) out.push(full)
  }
  return out
}

const relOf = (file) => file.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1)

/** 全仓扫描结果：每个文件一行，按区记账。 */
export function scan() {
  const files = walk().map((file) => {
    const text = readFileSync(file, 'utf8')
    const blocks = file.endsWith('.vue') ? sfcBlocks(text) : file.endsWith('.css') ? { script: '', style: text, template: '' } : { script: text, style: '', template: '' }
    return { file: relOf(file), text, blocks }
  })
  const sum = (pick) => files.reduce((total, entry) => total + countColors(pick(entry.blocks)), 0)
  const mediaText = files.map((entry) => entry.blocks.style).join('\n')
  const zValues = new Set()
  for (const entry of files) {
    for (const hit of entry.text.matchAll(/z-index\s*:\s*(-?\d+)|\bzIndex\s*[:=]\s*(-?\d+)/g)) {
      zValues.add(String(Number(hit[1] ?? hit[2])))
    }
  }
  return {
    files,
    scriptColors: sum((b) => b.script),
    styleColors: sum((b) => b.style),
    templateColors: sum((b) => b.template),
    offTierBreakpoints: offTierBreakpoints(mediaText),
    emptyMediaQueries: (mediaText.match(/@media[^{]*\{\s*\}/g) ?? []).length,
    zIndexValues: [...zValues].sort((a, b) => Number(a) - Number(b)),
    jsonParseTotal: files.reduce((total, entry) => total + (entry.text.match(/JSON\.parse\(\s*(?:(?:window\.)?localStorage|[A-Za-z_$][\w$]*\.getItem(?=\s*\())/g) ?? []).length, 0),
    // 用整文件文本而不是块：块是拼接出来的，行号会串位。
    bareJsonParse: files.flatMap((entry) => unprotectedJsonParses(entry.text).map((line) => `${entry.file}: ${line}`)),
    linesOf: Object.fromEntries(files.map((entry) => [entry.file, entry.text.split(/\r?\n/).length])),
  }
}

describe('计数器本身的判别力', () => {
  it('SFC 按块切分：样式块里的颜色不算进 script 区', () => {
    const sfc = '<style>.a { color: #3d63d8 }</style>\n<script>const a = 1</script>\n<template><div /></template>'
    const blocks = sfcBlocks(sfc)
    expect(countColors(blocks.style)).toBe(1)
    expect(countColors(blocks.script)).toBe(0)
    expect(countColors(blocks.template)).toBe(0)
  })

  it('模板注释里的字面量 <style> 不会骗到它', () => {
    const sfc = '<!-- 见 <style> 里的 .skip-to-content -->\n<template><div /></template>\n<style>.a { color: #fff }</style>'
    expect(sfcBlocks(sfc).style).toContain('#fff')
    expect(sfcBlocks(sfc).style, '样式块不该包含模板').not.toContain('template')
  })

  it('HTML 注释里的颜色不计数，但普通代码里的计数', () => {
    expect(countColors(stripHtmlComments('<!-- #ffffff --><div style="color:#172033">'))).toBe(1)
  })

  it('`image/*` 这种字符串不是颜色，rgb/深色写法是', () => {
    expect(countColors('accept="image/*"')).toBe(0)
    expect(countColors("background:'rgba(0,0,0,.4)'")).toBe(1)
    // 只有 1~2 位 hex 的锚点/色号片段不算（`#1`、`#a1`）
    expect(countColors('href="#123"')).toBe(1)
    expect(countColors('index#1')).toBe(0)
  })

  it('try 里的 JSON.parse 不算裸，裸的才算（四种形状都钉死）', () => {
    const protectedSameLine = 'try { return JSON.parse(localStorage.getItem(k)) } catch { return {} }'
    const protectedNextLine = 'function f() {\n  try {\n    const v = JSON.parse(localStorage.getItem(k))\n  } catch { return null }\n}'
    const protectedAfterStatement = 'function f() {\n  try {\n    const legacy = localStorage.getItem(old)\n    const v = JSON.parse(localStorage.getItem(k))\n  } catch { return null }\n}'
    const bare = 'function f() {\n  const v = JSON.parse(localStorage.getItem(k))\n  return v\n}'
    const bareAfterClosedTry = 'try { a() } catch { b() }\nconst v = JSON.parse(localStorage.getItem(k))'
    const bareWithTryLikeWord = 'const entry = { dirty: true }\nconst v = JSON.parse(localStorage.getItem(k))'
    const protectedAdapter = 'function read(storage) {\n  try {\n    return JSON.parse(storage.getItem(k))\n  } catch { return null }\n}'
    const bareAdapter = 'function read(storage) {\n  return JSON.parse(storage.getItem(k))\n}'
    expect(unprotectedJsonParses(protectedSameLine)).toEqual([])
    expect(unprotectedJsonParses(protectedNextLine)).toEqual([])
    expect(unprotectedJsonParses(protectedAfterStatement)).toEqual([])
    expect(unprotectedJsonParses(bare)).toHaveLength(1)
    expect(unprotectedJsonParses(bareAfterClosedTry)).toHaveLength(1)
    expect(unprotectedJsonParses(bareWithTryLikeWord), 'entry/dirty 里的 try 不该被当成 try').toHaveLength(1)
    expect(unprotectedJsonParses(protectedAdapter)).toEqual([])
    expect(unprotectedJsonParses(bareAdapter)).toHaveLength(1)
  })

  it('断点档位判别：900/901 合法，902/768 非法', () => {
    expect(offTierBreakpoints('@media (min-width:900px){.a{}}')).toEqual([])
    expect(offTierBreakpoints('@media (max-width:901px){.a{}}')).toEqual([])
    expect(offTierBreakpoints('@media (min-width:902px){.a{}}')).toEqual([902])
    expect(offTierBreakpoints('@media (min-width:768px){.a{}}')).toEqual([768])
    expect(offTierBreakpoints('@media (min-width:520px) and (pointer:coarse){.a{}}')).toEqual([])
  })

  it('z-index 读的是声明和内联绑定两种写法', () => {
    const hit = [...'a{z-index:130} b{style:{zIndex:7}}'.matchAll(/z-index\s*:\s*(-?\d+)|\bzIndex\s*[:=]\s*(-?\d+)/g)]
    expect(hit.map((m) => String(Number(m[1] ?? m[2])))).toEqual(['130', '7'])
  })
})

describe('全仓扫描的判别力（防假绿）', () => {
  const result = scan()

  it('真的扫到了整个 src：150+ 个文件、250+ 条样式', () => {
    expect(result.files.length).toBeGreaterThan(150)
    expect(result.files.filter((entry) => entry.file.endsWith('.vue')).length).toBeGreaterThan(50)
    expect(result.styleColors).toBeGreaterThan(250)
  })

  it('script 区也真的扫到了颜色（正则写坏会是 0）', () => {
    expect(result.scriptColors).toBeGreaterThan(100)
  })
})

describe('script 区颜色棘轮（调色板真源在这一区，只准降不准升）', () => {
  const result = scan()

  it(`script 区 hex/rgb/hsl 命中数 ≤ ${BASELINE.scriptColors}`, () => {
    expect(result.scriptColors).toBeLessThanOrEqual(BASELINE.scriptColors)
  })

  it('命中明细可定位（涨了要能一眼看出是谁涨的）', () => {
    const worst = result.files
      .map((entry) => `${entry.file}=${countColors(entry.blocks.script)}`)
      .filter((line) => !line.endsWith('=0'))
      .sort((a, b) => Number(b.split('=')[1]) - Number(a.split('=')[1]))
    expect(worst.length).toBeGreaterThan(10)
  })
})

describe('style / template 区颜色棘轮（本次迁移的主战场）', () => {
  const result = scan()

  it(`style 区 hex/rgb/hsl 命中数 ≤ ${BASELINE.styleColors}`, () => {
    expect(result.styleColors).toBeLessThanOrEqual(BASELINE.styleColors)
  })

  it(`template 区 hex/rgb/hsl 命中数 ≤ ${BASELINE.templateColors}`, () => {
    expect(result.templateColors).toBeLessThanOrEqual(BASELINE.templateColors)
  })
})

describe('断点棘轮（布局报告第 1、2 条）', () => {
  const result = scan()

  it(`非档位断点数量 = ${BASELINE.offTierBreakpoints}（档位：${BREAKPOINT_TIERS.join('/')}px）`, () => {
    expect(result.offTierBreakpoints).toEqual([])
    expect(result.offTierBreakpoints).toHaveLength(BASELINE.offTierBreakpoints)
  })

  it('真的扫到了 @media（正则写坏会是 0 条）', () => {
    const media = result.files.flatMap((entry) => entry.blocks.style.match(/@media[^{]*\{/g) ?? [])
    expect(media.length).toBeGreaterThan(50)
  })

  it(`空 @media 查询数量 ≤ ${BASELINE.emptyMediaQueries}`, () => {
    expect(result.emptyMediaQueries).toBeLessThanOrEqual(BASELINE.emptyMediaQueries)
  })
})

describe('z-index 阶梯棘轮（布局报告第 34 条）', () => {
  const result = scan()

  it(`distinct z-index 值 ≤ ${BASELINE.distinctZIndex}`, () => {
    expect(result.zIndexValues.length).toBeLessThanOrEqual(BASELINE.distinctZIndex)
    expect(result.zIndexValues.length).toBeGreaterThan(5)
  })

  it('取值跨度被记录在案（散到 1000+ 说明阶梯失控）', () => {
    const span = Math.max(...result.zIndexValues.map(Number)) - Math.min(...result.zIndexValues.map(Number))
    expect(span).toBeLessThanOrEqual(301)
  })
})

describe('JSON.parse(localStorage) 必须被 try 包住（工程报告 #3）', () => {
  const result = scan()

  it(`未被 try 包住的调用 = ${BASELINE.bareJsonParse} 处`, () => {
    expect(result.bareJsonParse, `裸调用：${result.bareJsonParse.join(' | ')}`).toHaveLength(BASELINE.bareJsonParse)
  })

  it('真的扫到了调用点（正则写坏会是 0 条，那样上面那条就成了空断言）', () => {
    expect(result.jsonParseTotal).toBeGreaterThanOrEqual(BASELINE.jsonParseOccurrences)
  })
})

describe('巨型文件棘轮（工程报告 #1）', () => {
  const result = scan()

  it(`超过 ${GIANT_LINE_LIMIT} 行的文件必须登记在册`, () => {
    const unlisted = Object.entries(result.linesOf)
      .filter(([file, lines]) => lines > GIANT_LINE_LIMIT && !(file in GIANT_ALLOWLIST))
      .map(([file, lines]) => `${file}=${lines}`)
    expect(unlisted, `新增巨型文件：${unlisted.join(', ')}`).toEqual([])
  })

  it('登记在册的文件也在自己的上限内', () => {
    for (const [file, limit] of Object.entries(GIANT_ALLOWLIST)) {
      expect(result.linesOf[file], `${file} 不存在了`).toBeTruthy()
      expect(result.linesOf[file], `${file} 超过登记上限 ${limit} 行`).toBeLessThanOrEqual(limit)
    }
  })

  it('超过 800 行的文件逐个受上限保护', () => {
    const heavy = Object.entries(result.linesOf).filter(([, lines]) => lines > 800)
    const unlisted = heavy.filter(([file]) => !(file in LARGE_FILE_LIMITS)).map(([file, lines]) => `${file}=${lines}`)
    expect(unlisted, `未登记的大文件：${unlisted.join(', ')}`).toEqual([])
    for (const [file, limit] of Object.entries(LARGE_FILE_LIMITS)) {
      expect(result.linesOf[file], `${file} 超过登记上限 ${limit} 行`).toBeLessThanOrEqual(limit)
    }
  })
})
