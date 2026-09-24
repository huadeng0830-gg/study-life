// @vitest-environment happy-dom
/**
 * 标签与引用的完整性（第四十八轮）。
 *
 * 【为什么值得守】`for=` 写错一个字母、`aria-describedby` 指向一个被 `v-if` 藏起来的元素，
 * 都是**静默失效**：页面照常渲染、测试照常绿（如果没人查），但那个 label 不再关联控件、
 * 那段说明读屏用户永远听不到。这类 bug 不会有任何症状提示你去看它。
 *
 * 【为什么要分两层查】两层能看见的东西不一样：
 *   - **静态层**：`for=` / `aria-labelledby` / `aria-describedby` 的字面量引用能不能在本文件
 *     找到同名 id；以及**跨文件**有没有两个组件声明同一个 id（同页共存时就会撞车）。
 *   - **渲染层**：真实挂载 10 条路由后，整个文档里有没有重复 id、有没有渲染后指向空气的引用。
 *     静态查不出来的正是这类：id 明明写在文件里，但它所在的元素这次**没有被渲染**。
 *
 * 【第四次踩同一个坑，所以夹具里单列一条】写静态层时我忘了剥注释，`NotFoundView.vue` 里
 * 一句解释性注释（"本组件渲染在 App.vue 的 `<main id="main-content">` 内部"）被当成了
 * 真的 id 声明，于是报出"跨文件 id 撞车：main-content"。渲染层的 0 处重复当场说明它是假的。
 * 这个坑在本仓已经出现四次：`<style>` 写在 HTML 注释里、`@page` 被注释骗到、CSS 注释里
 * 的属性声明造出幽灵规则、以及这里的注释里的 id。**凡是要 parse 的东西，先剥注释。**
 *
 * 【顺带查过、确认不是问题的一条】"元素只靠 `title` 属性当可访问名称"（`title` 不是可靠的
 * 名称来源）——初筛报了 28 处，逐条看全是**组件的 `title` prop**（`<Modal title="…">`、
 * `<EmptyState title="…">`），不是 HTML `title` 属性。是我的探针把 PascalCase 组件一起算了，
 * 这条没有真问题，不设判据。
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gotoRoute, mountApp, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 先剥注释再 parse：本仓第四次踩的坑，见文件头。 */
export function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

function walk(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.vue$/.test(name)) out.push(full)
  }
  return out
}

const relOf = (file) => file.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1)
const templateOf = (text) => (text.includes('<template>') ? text.slice(text.indexOf('<template>'), text.indexOf('</template>')) : '')

/** 本文件里静态声明的 id 字面量（`{{ }}` 之类的动态值不算）。 */
export function declaredIds(template) {
  return [...template.matchAll(/\sid="([^"{}]+)"/g)].map((m) => m[1])
}

/**
 * 断裂的引用：`for` / `aria-labelledby` / `aria-describedby` 里的**字面量** id 在本文件找不到。
 * 动态引用（含 `{{ }}`、`$`、`{` 的）跳过——静态读不出它最终是什么。
 */
export function brokenReferences(template) {
  const ids = new Set(declaredIds(template))
  const broken = []
  for (const match of template.matchAll(/\sfor="([^"]+)"/g)) {
    if (!ids.has(match[1])) broken.push({ attr: 'for', value: match[1] })
  }
  for (const attr of ['aria-labelledby', 'aria-describedby']) {
    for (const match of template.matchAll(new RegExp(`\\s${attr}="([^"]+)"`, 'g'))) {
      const value = match[1]
      if (/[{}$]/.test(value)) continue
      for (const id of value.split(/\s+/).filter(Boolean)) {
        if (!ids.has(id)) broken.push({ attr, value: id })
      }
    }
  }
  return broken
}

/** 跨文件重复的 id 字面量（同页共存时就会撞车）。 */
export function crossFileIdCollisions(sources) {
  const byId = new Map()
  for (const { file, template } of sources) {
    for (const id of declaredIds(template)) {
      if (!byId.has(id)) byId.set(id, new Set())
      byId.get(id).add(file)
    }
  }
  return [...byId].filter(([, files]) => files.size > 1).map(([id, files]) => ({ id, files: [...files] }))
}

/* ---------- 夹具 ---------- */

describe('静态扫描器的判别力', () => {
  it('断裂的 for / aria-describedby 会被抓出来', () => {
    expect(brokenReferences('<label for="a"></label><input id="a" />')).toEqual([])
    expect(brokenReferences('<label for="b"></label><input id="a" />')).toEqual([{ attr: 'for', value: 'b' }])
    expect(brokenReferences('<input aria-describedby="x y" /><p id="x"></p>')).toEqual([{ attr: 'aria-describedby', value: 'y' }])
  })

  it('动态引用跳过（静态读不出最终 id）', () => {
    expect(brokenReferences('<input :aria-describedby="`hint-${id}`" />')).toEqual([])
    expect(brokenReferences('<input :for="target" />')).toEqual([])
    expect(brokenReferences('<input aria-labelledby="{{ dynamic }}" />')).toEqual([])
  })

  it('注释里的 id 造不出幽灵声明（本仓第四次踩的坑）', () => {
    const template = '<!-- 本组件渲染在 App.vue 的 <main id="main-content"> 内部 --><div id="real"></div>'
    expect(declaredIds(stripComments(template))).toEqual(['real'])
    expect(declaredIds(template), '不剥注释就会读到注释里的 id').toContain('main-content')
    // 对照：低层扫描器不负责剥注释（剥注释是调用方的事），所以这里用两种输入
    // 展示"剥不剥"的差别——本轮的真实假阳性就是这个形状。
    const other = { file: 'App.vue', template: '<main id="main-content"></main>' }
    const stripped = { file: 'NotFoundView.vue', template: stripComments(template) }
    expect(crossFileIdCollisions([other, stripped]), '剥了注释就不该有撞车').toHaveLength(0)
    expect(crossFileIdCollisions([other, { file: 'NotFoundView.vue', template }]), '不剥注释会误报撞车').toHaveLength(1)
  })

  it('真撞车会被抓出来', () => {
    expect(crossFileIdCollisions([
      { file: 'a.vue', template: '<p id="dup"></p>' },
      { file: 'b.vue', template: '<p id="dup"></p>' },
    ])).toHaveLength(1)
  })
})

/* ---------- 静态层 ---------- */

describe('静态引用完整性', () => {
  const sources = walk().map((file) => {
    const text = stripComments(readFileSync(file, 'utf8'))
    return { file: relOf(file), template: templateOf(text) }
  })

  it('每个文件里的字面量引用都能找到对应 id', () => {
    const broken = []
    for (const { file, template } of sources) {
      for (const entry of brokenReferences(template)) {
        broken.push(`${file}  ${entry.attr}="${entry.value}" 在本文件找不到同名 id`)
      }
    }
    expect(broken, '这些引用指向不存在的 id：label 不再关联控件/说明读屏听不到').toEqual([])
  })

  it('规模自证：引用与 id 的数量不能太少（判据和实现脱节时这里会红）', () => {
    const all = sources.map((s) => s.template).join('\n')
    expect((all.match(/\sfor="/g) ?? []).length, 'for= 数量低于实测值').toBeGreaterThanOrEqual(18)
    expect((all.match(/aria-labelledby="/g) ?? []).length).toBeGreaterThanOrEqual(8)
    expect((all.match(/aria-describedby="/g) ?? []).length).toBeGreaterThanOrEqual(1)
    expect(sources.flatMap((s) => declaredIds(s.template)).length).toBeGreaterThanOrEqual(45)
  })

  it('没有两个文件声明同一个 id 字面量（同页共存就会撞车）', () => {
    const collisions = crossFileIdCollisions(sources)
    expect(
      collisions.map((entry) => `${entry.id}: ${entry.files.join(' + ')}`),
      '这些 id 在两个组件里重复声明，同页出现时会产生重复 id',
    ).toEqual([])
  })
})

/* ---------- 渲染层 ---------- */

describe('真实渲染后的引用完整性', () => {
  it('10 条路由渲染后没有重复 id，也没有指向空气的引用', async () => {
    const app = await mountApp({ routes })
    try {
      const paths = routes.filter((route) => route.component).map((route) => route.path)
      expect(paths.length, '没找到可渲染的路由').toBeGreaterThanOrEqual(10)
      const dupes = []
      const broken = []
      for (const path of paths) {
        await gotoRoute(app, path)
        await settle()
        // 整个文档都查：弹窗与提示会被 teleport 到 body，只查 #main-content 会漏
        const ids = new Map()
        for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1)
        for (const [id, count] of ids) if (count > 1) dupes.push(`${path}  id="${id}" 出现 ${count} 次`)
        for (const el of document.querySelectorAll('[for]')) {
          const target = el.getAttribute('for')
          if (target && !document.getElementById(target)) broken.push(`${path}  for="${target}" 渲染后找不到目标`)
        }
        for (const attr of ['aria-labelledby', 'aria-describedby']) {
          for (const el of document.querySelectorAll(`[${attr}]`)) {
            for (const id of (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)) {
              if (!document.getElementById(id)) broken.push(`${path}  ${attr}="${id}" 渲染后找不到该元素`)
            }
          }
        }
      }
      expect(dupes, '渲染后出现重复 id（aria 引用会指向错误元素，读屏可能报错）').toEqual([])
      expect(broken, '这些引用指向的元素这次没有被渲染出来，说明等于没有').toEqual([])
    } finally {
      app.unmount()
    }
  }, 60000)
})