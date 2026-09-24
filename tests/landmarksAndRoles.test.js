// @vitest-environment node
/**
 * 两件事：
 *   1. 某些 ARIA 角色**必须**有可访问名称，否则读屏念出来的是一个没有身份的控件
 *      （「菜单」「标签页列表」，不知道是哪个）。这类缺失是硬缺陷，不是风格问题。
 *   2. 应用要有一条 skip link（WCAG 2.4.1 绕过区块）：侧边栏十几个导航项，
 *      键盘用户每换一页都得先 Tab 穿过它们。有 link 还不够——它必须是**第一个**
 *      可聚焦元素，排在后面就等于没写。
 *
 * 【判据为什么只收这些角色】ARIA 里「支持名称」和「要求名称」是两回事。
 * 本判据只收要求名称（或无名则失去意义的）角色：
 *   alertdialog dialog form grid listbox menu menubar radiogroup region search
 *   tablist tree treegrid
 * 刻意**不收**、并且理由经过核实的：
 *   - `status` / `alert`：全仓 36 处**都没有** aria-label，但这是正确的——
 *     实时区域靠**文本内容**播报（内容就是它的消息），加 label 反而是错的方向。
 *     把它们收进来会凭空造出 36 个假警，直接毁掉这条守卫的可信度。
 *   - `group` / `toolbar` / `navigation` / `table` / `list`：ARIA 里名称可选，
 *     单个无名导航、无名表格都是合法的。
 *
 * 已知边界：
 *   - 只看静态 `role="…"`。写成 `:role="…"` 的动态角色无法静态判定，本判据会跳过
 *     （全仓目前 0 处动态 role，已核实）。
 *   - skip link 的排位检查覆盖：本身可聚焦的标签、地标容器（nav/header/…）、
 *     以及**递归解析后**确认内含可聚焦控件的组件。**看不透普通 `<div>` 里包的按钮**——
 *     要百分百确定得渲染真实 DOM 再看 Tab 序，那需要给 App 搭一套 router + store 挂载环境。
 *     当前覆盖面已经挡住了真实发生过的回归（skip link 被埋到侧边栏之后）。
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { componentNameOf, isComponentTag, makeComponentResolver, openTags, readTemplate, templateOf, walkElements, walkVueFiles } from './helpers/vueTemplate.js'

const srcDir = resolve(import.meta.dirname, '..', 'src')

/** 名称是必需（或无名即失去意义）的角色。见文件头说明。 */
export const ROLES_REQUIRING_NAME = [
  'alertdialog', 'dialog', 'form', 'grid', 'listbox', 'menu', 'menubar',
  'radiogroup', 'region', 'search', 'tablist', 'tree', 'treegrid',
]

/** 实时区域：靠内容播报，不该要求 aria-label。列在这里是为了说明它们是有意排除的。 */
export const CONTENT_NAMED_ROLES = ['status', 'alert', 'log', 'marquee', 'timer']

const HAS_NAME = /(^|\s):?aria-(label|labelledby)\s*=/

/**
 * 找出「角色要求名称、却没有 aria-label / aria-labelledby」的元素。
 * 注意 `(?:^|\s)` 前缀：`role="menu"` 是 `:role="menu"` 的子串，
 * 不加前缀会把动态绑定误判成静态角色。
 */
export function findUnnamedRoles(template) {
  const out = []
  for (const { tag, attrs } of openTags(template)) {
    const m = attrs.match(/(?:^|\s)role="([\w-]+)"/)
    if (!m) continue
    if (!ROLES_REQUIRING_NAME.includes(m[1])) continue
    if (HAS_NAME.test(attrs)) continue
    out.push({ tag, role: m[1], attrs })
  }
  return out
}

const SKIP_LINK = /class="[^"]*\bskip-to-content\b"/
const FOCUSABLE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])

/** 可能含有可聚焦内容的 HTML 容器：它们自己不可聚焦，但里面的东西可能是。 */
const MAY_CONTAIN_FOCUS = new Set([
  'header', 'nav', 'aside', 'footer', 'section', 'form', 'main', 'fieldset', 'dialog',
])

/**
 * 这份模板渲染出来会不会含有可聚焦元素。组件递归判断，带去重与深度上限。
 *
 * 递归是必需的，不是洁癖：`<WallpaperLayer />` 在源码里只是一个自闭合标签，
 * 只看 App.vue 无从知道它渲染的是两个纯装饰 <div>（零可聚焦元素）还是十几个按钮。
 * 前者放在 skip link 前面完全无害，后者会把 skip link 埋掉。不递归就只能二选一：
 * 要么一律放过（对真正的回归假绿），要么一律拦下（对 <WallpaperLayer /> 假警）——
 * 这条判据的第一版正是栽在「一律放过」上。
 *
 * 刻意不看 `aria-hidden`：它**不会**把元素移出 Tab 序，所以「aria-hidden 里包着按钮」
 * 依然会截住键盘用户，依然算挡路（而且那本身是另一个缺陷）。
 */
export function rendersFocusable(template, resolveComponent = () => null, seen = new Set(), depth = 0) {
  if (!template || depth > 6) return false
  for (const openTag of openTags(template)) {
    if (FOCUSABLE_TAGS.has(openTag.tag)) return true
    if (/tabindex="0"/.test(openTag.attrs)) return true
    const name = componentNameOf(openTag)
    if (!isComponentTag(openTag) || seen.has(name)) continue
    seen.add(name)
    if (rendersFocusable(resolveComponent(name), resolveComponent, seen, depth + 1)) return true
  }
  return false
}

/** 会挡住 skip link 的「先行者」清单。 */
export function blockingPredecessors(tags, linkIndex, resolveComponent = () => null) {
  const out = []
  for (let i = 0; i < linkIndex; i += 1) {
    const openTag = tags[i]
    const name = componentNameOf(openTag)
    if (FOCUSABLE_TAGS.has(openTag.tag) || /tabindex="0"/.test(openTag.attrs)) {
      out.push(`${name}（本身可聚焦）`)
    } else if (MAY_CONTAIN_FOCUS.has(openTag.tag)) {
      out.push(name)
    } else if (isComponentTag(openTag) && rendersFocusable(resolveComponent(name), resolveComponent)) {
      out.push(`${name}（内部有可聚焦控件）`)
    }
  }
  return out
}

/** 跳过导航的链接在标签序列里的下标；-1 表示没有。 */
export function findSkipLinkIndex(template) {
  return [...openTags(template)].findIndex(({ tag, attrs }) => tag === 'a' && SKIP_LINK.test(attrs))
}

/** 返回 skip link 的问题列表；空数组表示合格。 */
export function skipLinkIssues(template, resolveComponent = () => null) {
  // 全部判断都在**同一个** tags 数组里按下标做。openTags 每次调用都产出全新的对象，
  // 跨两次调用比较元素引用会恒不相等（写这条守卫时踩过：明明排在第一却报「前面还有 <a>」）。
  const tags = [...openTags(template)]
  const linkIndex = tags.findIndex(({ tag, attrs }) => tag === 'a' && SKIP_LINK.test(attrs))
  if (linkIndex === -1) return ['整份模板里没有跳过导航的链接（class 带 skip-to-content 的 <a>）']

  const link = tags[linkIndex]
  const issues = []
  const href = link.attrs.match(/(?:^|\s)href="([^"]*)"/)?.[1] ?? ''
  const id = href.startsWith('#') ? href.slice(1) : ''
  if (!id) {
    issues.push(`href 必须是页内锚点，现在是 ${href || '(没有 href)'}`)
  } else if (!new RegExp(`(?:^|\\s)id="${id}"`).test(template)) {
    issues.push(`没有元素带 id="${id}"，锚点落空，按下去什么都不会发生`)
  }

  const blockers = blockingPredecessors(tags, linkIndex, resolveComponent)
  if (blockers.length) {
    issues.push(
      `skip link 不是第一个可聚焦元素——它前面还有 ${blockers.join('、')}，`
      + '键盘用户得先 Tab 过前面的东西才轮得到它，等于没写',
    )
  }
  return issues
}

describe('要求名称的 ARIA 角色必须有可访问名称', () => {
  const files = walkVueFiles(srcDir)
  const scanned = files.map((file) => ({ file, template: readTemplate(file) }))
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')

  it('扫描规模自证：确实走进了全部 .vue，并且真的读到了角色', () => {
    // 当前 53 个文件；下面的角色计数按实测留余量，但绝不能是 0——
    // 正则写坏时的假绿比漏报更危险。
    expect(scanned.length).toBeGreaterThan(45)
    const roles = scanned.flatMap(({ template }) => [...openTags(template)]
      .map(({ attrs }) => attrs.match(/(?:^|\s)role="([\w-]+)"/)?.[1])
      .filter(Boolean))
    expect(roles.length).toBeGreaterThan(40)
    // 本判据关注的角色必须真的存在于仓库里，否则这条守卫是在守空气
    for (const role of ['dialog', 'tablist', 'menu']) {
      expect(roles, `仓库里再也找不到 role="${role}"，判据可能已失效`).toContain(role)
    }
  })

  it('全仓没有「要求名称却没名字」的角色元素', () => {
    const offenders = scanned.flatMap(({ file, template }) => findUnnamedRoles(template)
      .map(({ tag, role }) => `${rel(file)} <${tag} role="${role}">`))
    expect(offenders).toEqual([])
  })

  it('核实：status / alert 是靠内容播报的，不该出现在本判据里', () => {
    // 这条是防「好心办坏事」：后人若觉得 status 缺 aria-label 是缺陷而把它们加进
    // ROLES_REQUIRING_NAME，会立刻冒出三十多个假警。这里把理由钉住。
    for (const role of CONTENT_NAMED_ROLES) {
      expect(ROLES_REQUIRING_NAME).not.toContain(role)
    }
  })

  // ---- 夹具：证明判据既能抓，也不会乱抓 ----
  it('夹具：无名称的 menu / tablist / dialog 都会被抓出来', () => {
    expect(findUnnamedRoles('<div role="menu" tabindex="-1"><button role="menuitem">a</button></div>'))
      .toHaveLength(1)
    expect(findUnnamedRoles('<div class="tabs" role="tablist"><button role="tab">a</button></div>'))
      .toHaveLength(1)
    expect(findUnnamedRoles('<div role="dialog" aria-modal="true"></div>')).toHaveLength(1)
  })

  it('夹具：aria-label 与 aria-labelledby 都算有名字，且动态绑定也认', () => {
    expect(findUnnamedRoles('<div role="menu" aria-label="操作菜单"></div>')).toEqual([])
    expect(findUnnamedRoles('<div role="menu" :aria-labelledby="titleId"></div>')).toEqual([])
    expect(findUnnamedRoles('<div role="tablist" :aria-label="label"></div>')).toEqual([])
  })

  it('夹具：不需要名称的角色一律放行（这是精度测试，不是宽容）', () => {
    expect(findUnnamedRoles('<p role="status">已保存</p>')).toEqual([])
    expect(findUnnamedRoles('<div role="alert">出错了</div>')).toEqual([])
    expect(findUnnamedRoles('<div role="group"><button>a</button></div>')).toEqual([])
    expect(findUnnamedRoles('<nav role="navigation"><a href="/">首页</a></nav>')).toEqual([])
    expect(findUnnamedRoles('<button role="menuitem">删除</button>')).toEqual([])
    expect(findUnnamedRoles('<div role="list"><div role="listitem">x</div></div>')).toEqual([])
  })

  it('夹具：`:role` 动态绑定不得被当成静态 role="…"', () => {
    // `role="menu"` 是 `:role="menu"` 的子串，前缀断言就是为了挡住这种情况。
    expect(findUnnamedRoles('<div :role="\'menu\'"></div>')).toEqual([])
  })
})

/**
 * 一个文档只能有一个 `main` 地标，而且 `main` 不能是 `main` 的后代。
 *
 * 这是个真缺陷，不是理论问题：`NotFoundView.vue`（404 路由组件）原本自带 `<main>`，
 * 而它是经 `<router-view>` 渲染在 App.vue 的 `<main id="main-content">` **内部**的——
 * 于是渲染出来的文档里出现嵌套 main。后果是读屏的地标导航里冒出两个「主内容」，
 * 并且按规范内层那个是无效的，部分实现会直接忽略它：404 页的内容就没了区域。
 *
 * 判据：只有应用外壳可以声明 `main`。路由视图永远渲染在外壳的 main 里面，
 * 它们自己再声明一个就是重复。
 */
export function findMainLandmarks(template) {
  return [...walkElements(template)]
    .filter(({ tag, attrs }) => tag === 'main' || /(?:^|\s)role="main"/.test(attrs))
    .map(({ tag, line }) => ({ tag, line }))
}

describe('整个应用只有一个 main 地标', () => {
  const files = walkVueFiles(srcDir)
  const scanned = files.map((file) => ({ file, template: readTemplate(file) }))
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')
  const SHELL = 'App.vue'

  it('只有应用外壳声明 main，其余文件一个都不能有', () => {
    const offenders = scanned
      .filter(({ file }) => rel(file) !== SHELL)
      .flatMap(({ file, template }) => findMainLandmarks(template).map((m) => `${rel(file)} <${m.tag}@${m.line}>`))
    expect(offenders, '路由视图渲染在外壳的 main 内部，自己不能再声明 main').toEqual([])
  })

  it('自证不空转：外壳确实声明了恰好一个 main（否则上一条可能只是没扫到）', () => {
    const shell = scanned.find(({ file }) => rel(file) === SHELL)
    expect(shell, 'App.vue 没被扫到，判据已与实现脱节').toBeTruthy()
    expect(findMainLandmarks(shell.template)).toHaveLength(1)
    // 扫描规模下限：遍历或正则写坏时命中数会掉到 0，那种假绿比漏报更危险
    expect(scanned.length).toBeGreaterThan(45)
  })

  it('夹具：main 标签与 role="main" 都算，注释里的不算，长得像的不算', () => {
    expect(findMainLandmarks('<main id="main-content" tabindex="-1">x</main>')).toHaveLength(1)
    expect(findMainLandmarks('<div role="main">x</div>')).toHaveLength(1)
    // 修好之后的样子：404 页用的是 div
    expect(findMainLandmarks('<div class="route-not-found"><h1>页面不存在</h1></div>')).toEqual([])
    // role="mainx"、class 里带 main，都不算
    expect(findMainLandmarks('<div role="mainx">x</div>')).toEqual([])
    expect(findMainLandmarks('<div class="main-content">x</div>')).toEqual([])
    // 剥注释发生在上游 templateOf（readTemplate 走的就是它），所以注释里的样例代码
    // 根本到不了这个函数；这条用真实管线证明它不会被样例骗到
    expect(findMainLandmarks(templateOf('<template><!-- <main>注释里的样例</main> --><div>x</div></template>'))).toEqual([])
  })
})

describe('应用有一条排在最前面的 skip link', () => {
  const appTemplate = readTemplate(resolve(srcDir, 'App.vue'))

  // 递归解析真实组件源码：只有「渲染出来真的会含可聚焦控件」的先行组件才算挡路。
  const resolveComponent = makeComponentResolver(srcDir)

  it('skip link 存在、锚点落在真实存在的 id 上、且前面没有会截住键盘的东西', () => {
    expect(skipLinkIssues(appTemplate, resolveComponent)).toEqual([])
  })

  it('核实：排在它前面的 WallpaperLayer 是纯装饰，一个可聚焦元素都没有', () => {
    // 把「为什么它不算挡路」钉住。若哪天有人往壁纸层里塞了按钮，上面那条会红——
    // 那时是**真**回归（aria-hidden 不会把元素移出 Tab 序，键盘照样会停在里面），
    // 而不是判据过严。这条同时证明递归判断不是摆设。
    const wallpaper = [...openTags(appTemplate)].find(({ raw }) => /^WallpaperLayer\b/.test(raw))
    expect(wallpaper, 'App.vue 里找不到 <WallpaperLayer>').toBeTruthy()
    expect(rendersFocusable(resolveComponent('WallpaperLayer'), resolveComponent)).toBe(false)
  })

  it('核实：递归判断确实有检测力——Sidebar 内部真的含可聚焦控件', () => {
    // 没有这条，上一条也可能是「函数恒返回 false」造成的假绿。
    expect(rendersFocusable(resolveComponent('Sidebar'), resolveComponent)).toBe(true)
  })

  it('skipped-to 的主内容地标本身可被聚焦（否则各浏览器行为不一致）', () => {
    // 只给 id 的话有的浏览器只移动「顺序焦点起点」而不移动焦点，
    // 所以 <main> 需要 tabindex="-1"。这条把该属性钉住。
    const main = [...openTags(appTemplate)].find(({ tag, attrs }) => (
      tag === 'main' && /id="main-content"/.test(attrs)
    ))
    expect(main, '找不到 <main id="main-content">').toBeTruthy()
    expect(main.attrs).toMatch(/tabindex="-1"/)
  })

  it('skip link 排在侧边栏之前——这正是它存在的意义', () => {
    // 这条是上一条的「具体版」。侧边栏是自闭合组件，源码级扫描看不见它内部渲染出的
    // 十几个导航项，所以判据必须按「谁在前」而不是「哪个标签可聚焦」来判断。
    const tags = [...openTags(appTemplate)]
    const linkIndex = findSkipLinkIndex(appTemplate)
    const sidebarIndex = tags.findIndex(({ raw }) => /^Sidebar\b/.test(raw))
    expect(linkIndex, '找不到 skip link').toBeGreaterThanOrEqual(0)
    expect(sidebarIndex, '找不到 <Sidebar>').toBeGreaterThanOrEqual(0)
    expect(linkIndex).toBeLessThan(sidebarIndex)
  })

  it('夹具：缺 link、锚点落空、排位靠后三种情况都要报出来', () => {
    const missing = skipLinkIssues('<div class="layout"><main id="main-content"></main></div>')
    expect(missing.join(' ')).toMatch(/没有跳过导航的链接/)

    const dangling = skipLinkIssues(
      '<a class="skip-to-content" href="#nope">跳到主内容</a><main id="main-content"></main>',
    )
    expect(dangling.join(' ')).toMatch(/锚点落空/)

    const late = skipLinkIssues(
      '<nav><button>菜单</button></nav>'
      + '<a class="skip-to-content" href="#main-content">跳到主内容</a>'
      + '<main id="main-content" tabindex="-1"></main>',
    )
    expect(late.join(' ')).toMatch(/不是第一个可聚焦元素/)

    const ok = skipLinkIssues(
      '<a class="skip-to-content" href="#main-content">跳到主内容</a>'
      + '<main id="main-content" tabindex="-1"></main>',
    )
    expect(ok).toEqual([])
  })

  it('夹具：排在「内部有控件」的组件之后必须报错，排在纯装饰组件之后放行', () => {
    // 这是本判据最容易假绿的地方：<Sidebar /> 本身是不可聚焦的标签，若只问
    // 「前面有没有 button/a」，它会显得很安全，于是「skip link 被埋到侧边栏后面」
    // 这种回归一路绿灯（写这条时真的踩到了）。
    const stub = (name) => {
      if (name === 'Sidebar') return '<nav><button>首页</button></nav>'
      if (name === 'WallpaperLayer') return '<div class="wallpaper" aria-hidden="true"></div>'
      return null
    }
    const page = (inner) => `<div class="layout">${inner}<main id="main-content" tabindex="-1"></main></div>`
    const link = '<a class="skip-to-content" href="#main-content">跳到主内容</a>'

    expect(skipLinkIssues(page(`<Sidebar />${link}`), stub).join(' '))
      .toMatch(/Sidebar（内部有可聚焦控件）/)
    expect(skipLinkIssues(page(`${link}<Sidebar />`), stub)).toEqual([])

    // 精度面：纯装饰组件放在前面不该被误伤（真实仓库里的 WallpaperLayer 就是这种）
    expect(skipLinkIssues(page(`<WallpaperLayer />${link}`), stub)).toEqual([])

    // 递归要能穿过中间层：A 只渲染 B，B 里才有按钮
    const nested = (name) => (name === 'Outer' ? '<Inner />' : name === 'Inner' ? '<button>x</button>' : null)
    expect(skipLinkIssues(page(`<Outer />${link}`), nested).join(' ')).toMatch(/Outer（内部有可聚焦控件）/)
  })
})