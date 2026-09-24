// @vitest-environment happy-dom
/**
 * 交互替代路径与页面标题（第四十七轮）。
 *
 * 【一】有拖拽的文件必须写出非拖拽的替代（WCAG 2.5.7 Dragging Movements，2.2 新增）。
 * 这一条整类都容易被漏掉：拖拽对明眼触屏用户太自然了，写的人不会觉得"缺了什么"，
 * 而键盘用户、用不了精细指针的用户会直接卡死。仓里此前**没有任何**判据碰过这一类。
 *
 * 判据只认两件事，避免变成"清单说啥就是啥"：
 *   1. **候选**由扫描得出（同一文件里既有 down 又有 move），而不是手写；
 *   2. 每条清单必须给出一个**仍然存在的替代钩子**（needle）——写不出就是没做。
 * 反向也守：清单里的文件若**不再**是拖拽候选，也会红，逼着人删条目而不是留一堆过期记录。
 *
 * 【为什么 ExamsView / longPress.js 这种"长按"不算】`onPointerMove` 在那里是用来
 * **取消**长按的（手指一移动就取消，见 longPress.js 的 moveTolerance），不是拖拽操作本身。
 * 长按不属于 2.5.7 管的拖拽，而且卡片本身是可点开的入口。
 *
 * 【二】每个有组件的路由都必须有标题，且互不相同（WCAG 2.4.2 Page Titled）。
 * SPA 里全部页面共用一个标题是常见缺陷：读屏与浏览器历史里分不清页面。
 * App.vue 用的是 `route.meta?.title || '学习生活台'`，所以缺 meta.title 的路由会**静默**
 * 退回通用标题——这种"有兜底所以不报错"的写法最容易漏，得靠判据守。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')

function walk(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|js)$/.test(full)) out.push(full)
  }
  return out
}

const relOf = (file) => file.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1)

const DOWN = /pointerdown|mousedown|touchstart/
const MOVE = /pointermove|mousemove|touchmove/

/** 拖拽候选取自扫描：同一份文件里既有 down 也有 move。 */
export function dragCandidates(sources) {
  return sources
    .filter(({ text }) => DOWN.test(text) && MOVE.test(text))
    .map(({ file, text }) => ({
      file,
      down: (text.match(new RegExp(DOWN, 'g')) ?? []).length,
      move: (text.match(new RegExp(MOVE, 'g')) ?? []).length,
    }))
    .sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * 清单：每个拖拽候选都要给出**仍然存在**的替代钩子。
 * 注意 needle 是代码里真实存在的字符串（不是解释性注释），这样"替代"烂掉时会红。
 */
export const DRAG_ALTERNATIVES = [
  {
    file: 'components/schedule/ImageCropModal.vue',
    needles: ['onStageKeydown', '@keydown="onStageKeydown"', 'tabindex="0"', 'aria-describedby="crop-hint"'],
    reason: '拖动框选：键盘用方向键移动、Shift 收小、Ctrl 放大，见 tests/imageCropKeyboard.test.js。',
  },
  {
    file: 'components/AppearanceSettings.vue',
    needles: ['onModuleDragKeydown', '@keydown="onModuleDragKeydown($event, module.id)"'],
    reason: '拖动排序首页模块：手柄按钮上 Alt + 上下方向键移动，焦点跟随模块。',
  },
  {
    file: 'components/Modal.vue',
    needles: ['Escape', "emit('close')"],
    reason: '底部弹层拖动关闭：Esc 与关闭按钮都能关（拖动只是快捷方式）。',
  },
  {
    file: 'components/Sidebar.vue',
    needles: ['Escape', 'aria-label="关闭更多功能"', '@click.self="closeMobileMore(true)"'],
    reason: '≤900px「更多功能」抽屉的右划关闭：手势只是快捷方式，'
      + '× 按钮（aria-label="关闭更多功能"）、点遮罩（@click.self）与 Escape 三条非拖拽出口都在，'
      + '键盘用户完全不依赖手势。判定与吸附是纯函数（composables/drawerDrag.js），'
      + '见 tests/drawerDrag.test.js 与 tests/sidebarDrawer.test.js。',
  },
  {
    file: 'components/SwipeActionItem.vue',
    needles: ['role="button"', 'tabindex', '@click'],
    reason: '滑动露出操作：条目本身是 role=button + tabindex，回车/点击打开详情面板，那里有全部真按钮。',
  },
  {
    file: 'views/ExamsView.vue',
    needles: ['createLongPress', 'shouldSuppressClick'],
    reason: '长按（不是拖拽）打开快捷菜单：卡片本来就有点击入口，长按只是叠加在上面的快捷方式'
      + '（shouldSuppressClick 正说明"没触发长按时点击照常生效"）。'
      + 'onPointerMove 来自 longPress.js，用途是"手指一动就取消长按"，见那边的 moveTolerance，'
      + '不是拖拽操作本身，因此不属于 2.5.7 管的拖拽。',
  },
]

/** 路由解析：routes.js 一行一个路由，逐行读即可（规模自证会保证这个前提没变）。 */
export function parseRoutes(source) {
  const routes = []
  for (const line of source.split('\n')) {
    if (!/^\s*\{[^}]*path:/.test(line)) continue
    routes.push({
      path: (/path:\s*'([^']*)'/.exec(line) ?? [])[1] ?? '',
      title: (/meta:\s*\{\s*title:\s*'([^']+)'/.exec(line) ?? [])[1] ?? '',
      hasComponent: /component:/.test(line),
      isRedirect: /redirect:/.test(line),
    })
  }
  return routes
}

/* ---------- 夹具 ---------- */

describe('dragCandidates 的判别力', () => {
  it('down + move 才算候选；只有一边不算', () => {
    expect(dragCandidates([{ file: 'a.vue', text: '@pointerdown="x" @pointermove="y"' }])).toHaveLength(1)
    expect(dragCandidates([{ file: 'a.vue', text: '@pointerdown="x"' }])).toHaveLength(0)
    expect(dragCandidates([{ file: 'a.vue', text: '@pointermove="y"' }])).toHaveLength(0)
    expect(dragCandidates([{ file: 'a.vue', text: 'const mousemove = 1' }])).toHaveLength(0)
  })
})

describe('parseRoutes 的判别力', () => {
  it('把 path / title / component / redirect 读出来', () => {
    const routes = parseRoutes("  { path: '/a', name: 'a', meta: { title: '甲' }, component: asyncRoute('/a') },\n"
      + "  { path: '/b', redirect: '/' },")
    expect(routes).toHaveLength(2)
    expect(routes[0]).toMatchObject({ path: '/a', title: '甲', hasComponent: true, isRedirect: false })
    expect(routes[1]).toMatchObject({ path: '/b', title: '', hasComponent: false, isRedirect: true })
  })

  it('注释行不会被当成路由', () => {
    expect(parseRoutes("// { path: '/x', component: y }")).toEqual([])
  })
})

/* ---------- 全仓 ---------- */

describe('拖拽交互必须有非拖拽替代（WCAG 2.5.7）', () => {
  const sources = walk().map((file) => ({ file: relOf(file), text: readFileSync(file, 'utf8') }))

  it('候选文件全部在清单里，且每条清单的替代钩子仍然存在', () => {
    const candidates = dragCandidates(sources)
    expect(candidates.length, '扫描没找到任何拖拽候选，判据可能已和实现脱节').toBeGreaterThanOrEqual(5)
    const listed = new Set(DRAG_ALTERNATIVES.map((entry) => entry.file))
    const unlisted = candidates.filter((entry) => !listed.has(entry.file)).map((entry) => entry.file)
    expect(
      unlisted,
      '这些文件里有拖拽操作，却没有说明非拖拽替代在哪（键盘用户会在这一步卡死）',
    ).toEqual([])
    for (const entry of DRAG_ALTERNATIVES) {
      const source = sources.find((s) => s.file === entry.file)
      expect(source, `清单里的 ${entry.file} 不存在了`).toBeTruthy()
      for (const needle of entry.needles) {
        expect(source.text, `${entry.file} 里找不到替代钩子 \`${needle}\`——替代烂掉或还没做（理由写的是：${entry.reason}）`).toContain(needle)
      }
    }
  })

  it('清单不许留过期条目：不再是拖拽候选的文件要删掉', () => {
    const candidates = new Set(dragCandidates(sources).map((entry) => entry.file))
    const stale = DRAG_ALTERNATIVES.filter((entry) => !candidates.has(entry.file)).map((entry) => entry.file)
    expect(stale, '这些文件已经不拖拽了，清单条目该删（否则清单会慢慢变成噪声）').toEqual([])
  })
})

describe('每个页面都有唯一标题（WCAG 2.4.2）', () => {
  const routerSource = readFileSync(join(srcDir, 'router', 'routes.js'), 'utf8')
  const routes = parseRoutes(routerSource)

  it('路由解析规模自证', () => {
    expect(routes.length, 'routes.js 的写法变了，逐行解析可能已经读不到路由').toBeGreaterThanOrEqual(10)
    expect(routes.filter((route) => route.hasComponent).length).toBeGreaterThanOrEqual(9)
    // 反向：确实存在 redirect 条目，说明"redirect 豁免"不是空条件
    expect(routes.some((route) => route.isRedirect && !route.title)).toBe(true)
  })

  it('有组件的路由必须写 meta.title', () => {
    const missing = routes.filter((route) => route.hasComponent && !route.title).map((route) => route.path)
    expect(
      missing,
      '这些路由没有 meta.title，会静默退回通用标题"学习生活台"，读屏与浏览器历史里分不清页面',
    ).toEqual([])
  })

  it('没有标题的路由只能是重定向', () => {
    const bad = routes.filter((route) => !route.title && !route.isRedirect).map((route) => route.path)
    expect(bad).toEqual([])
  })

  it('标题互不相同（否则等于没标）', () => {
    const titles = routes.map((route) => route.title).filter(Boolean)
    const dupes = titles.filter((title, index) => titles.indexOf(title) !== index)
    expect(dupes, `重复的页面标题：${dupes.join('、')}`).toEqual([])
  })

  it('App.vue 确实把 meta.title 用在 document.title 上', () => {
    const app = readFileSync(join(srcDir, 'App.vue'), 'utf8')
    expect(app).toContain('route.meta?.title')
    expect(app).toContain('document.title')
  })
})