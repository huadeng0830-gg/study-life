// @vitest-environment node
/**
 * 两条关于「错误/成功提示对读屏可见」的规则。
 *
 * 一、操作反馈必须是实时区域。
 *   一条 `v-if` 存亡的错误提示，如果在 DOM 里既不 role="alert" 也没有 aria-live，
 *   读屏用户点完保存**什么都听不到**——视觉上红字出现了，听觉上世界毫无变化。
 *   本轮实测：这类「哑巴错误」曾经有 16 处（清单编辑、课程编辑、作息设置、数据管理…）。
 *
 *   判据刻意收窄到「消息类名集合」，并且**只看 `class="…"`、不看 `:class="…"`**，
 *   因此不需要任何例外清单：
 *     - `:class="{ invalid: row.error }"`、`:class="{ 'has-error': … }"` 是**纯样式绑定**，
 *       根本不含 `class=` 属性 → 天然不进判据（它们曾被我的普查脚本误报过，见报告 §1.25）；
 *     - `error-message` / `error-icon` / `error-text` / `batch-error-row` / `plan-row-error` /
 *       `plan-error-tip` / `global-error-close` 是**一条消息的内部零件**或**逐行标记**，
 *       不整体播报 → 不在集合里；
 *     - 逐行标记（表格每行一个）刻意不做实时区域：它们随着每次敲键变化，
 *       做成 aria-live 会疯狂播报。这一点写在报告里，而不是靠白名单糊过去。
 *
 *   成功提示同理，但要用 role="status"（礼貌播报）而不是 role="alert"（立即打断）——
 *   把成功当警报喊出来是语义错误，本轮修脚本误伤时正好验证了这条（§1.25）。
 *
 * 二、ARIA 引用不得悬空。
 *   `aria-describedby="x"` 指向一个不存在的 id 时，行为是静默失败：属性看着配了，
 *   读屏什么也读不到。判据从静态值和绑定表达式的**字符串字面量**里取出 id 逐个核对。
 *   表达式里写变量（`:aria-labelledby="titleId"`）无法静态解出，跳过——
 *   这是已知边界，不是遗漏。
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openTags, readTemplate, walkVueFiles } from './helpers/vueTemplate.js'

const srcDir = resolve(import.meta.dirname, '..', 'src')

/** 整体播报的错误消息类名。内层零件与逐行标记刻意不在内（见文件头）。 */
export const FEEDBACK_ERROR_CLASSES = ['error', 'task-error', 'custom-error', 'form-error', 'note-error']
/** 整体播报的成功消息类名。 */
export const FEEDBACK_SUCCESS_CLASSES = ['success', 'notice-success']

/** 只有静态 class="…" 才算；:class 是绑定，不进判据。 */
function staticClasses(attrs) {
  const m = attrs.match(/(?:^|\s)class="([^"]*)"/)
  return m ? m[1].split(/\s+/).filter(Boolean) : []
}

const hasLiveRegion = (attrs) => /(?:^|\s):?role="alert"/.test(attrs) || /(?:^|\s):?aria-live=/.test(attrs)

/** 找出「整体播报的错误消息却没有实时区域」的元素。 */
export function findSilentFeedbackErrors(template) {
  const out = []
  for (const { tag, attrs } of openTags(template)) {
    const classes = staticClasses(attrs)
    if (!classes.some((c) => FEEDBACK_ERROR_CLASSES.includes(c))) continue
    if (hasLiveRegion(attrs)) continue
    out.push({ tag, classes })
  }
  return out
}

/** 找出「成功提示没有用礼貌播报」的元素（role="alert" 算语义错误，也报出来）。 */
export function findUnannouncedSuccess(template) {
  const out = []
  for (const { tag, attrs } of openTags(template)) {
    const classes = staticClasses(attrs)
    if (!classes.some((c) => FEEDBACK_SUCCESS_CLASSES.includes(c))) continue
    if (/(?:^|\s):?role="status"/.test(attrs)) continue
    out.push({ tag, classes, assertive: /(?:^|\s):?role="alert"/.test(attrs) })
  }
  return out
}

/** 模板里定义过的所有 id。 */
export function declaredIds(template) {
  const ids = new Set()
  for (const { attrs } of openTags(template)) {
    const m = attrs.match(/(?:^|\s)id="([^"]+)"/)
    if (m) ids.add(m[1])
  }
  return ids
}

const REF_ATTRS = ['aria-describedby', 'aria-labelledby', 'aria-errormessage', 'aria-controls', 'aria-owns']

/**
 * 找出指向不存在 id 的 ARIA 引用。
 *
 * 值的两种情况要分开处理，否则会把变量名当成 id：
 *   - `aria-describedby="a b"`（**未绑定**）→ 整个值就是 id 列表；
 *   - `:aria-describedby="e ? 'err' : undefined"`（**绑定**）→ 只有字符串字面量是 id，
 *     裸标识符（`titleId`）是变量，静态解不出来，跳过。
 * 早期版本没区分这两者，于是 `:aria-labelledby="titleId"` 被当成「id 叫 titleId」而误报悬空——
 * 是夹具里那条「写变量应跳过」的用例把它抓出来的。
 */
export function findDanglingAriaRefs(template) {
  const ids = declaredIds(template)
  const out = []
  for (const { tag, attrs } of openTags(template)) {
    for (const attr of REF_ATTRS) {
      const m = attrs.match(new RegExp(`(?:^|\\s)(:?)${attr}="([^"]*)"`))
      if (!m) continue
      const bound = m[1] === ':'
      const raw = m[2]
      const candidates = bound
        ? [...raw.matchAll(/'([^']+)'|"([^"]+)"/g)].map((mm) => mm[1] ?? mm[2])
        : raw.trim().split(/\s+/)
      for (const id of candidates) {
        if (!id || id === 'undefined') continue
        if (!ids.has(id)) out.push({ tag, attr, id })
      }
    }
  }
  return out
}

describe('操作反馈必须是实时区域', () => {
  const files = walkVueFiles(srcDir)
  const scanned = files.map((file) => ({ file, template: readTemplate(file) }))
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')

  it('扫描规模自证：确实扫到了反馈类消息（否则这条守卫在守空气）', () => {
    expect(scanned.length).toBeGreaterThan(45)
    let errors = 0
    let successes = 0
    for (const { template } of scanned) {
      for (const { attrs } of openTags(template)) {
        const classes = staticClasses(attrs)
        if (classes.some((c) => FEEDBACK_ERROR_CLASSES.includes(c))) errors += 1
        if (classes.some((c) => FEEDBACK_SUCCESS_CLASSES.includes(c))) successes += 1
      }
    }
    // 实测：错误消息 20+ 个，成功消息若干。任何一边归零都说明类名集合已经和仓库脱节。
    expect(errors, '仓库里再也扫不到错误消息类名').toBeGreaterThan(15)
    expect(successes, '仓库里再也扫不到成功消息类名').toBeGreaterThan(3)
  })

  it('全仓没有「看不见的错误提示」——每个错误消息都能被播报', () => {
    const offenders = scanned.flatMap(({ file, template }) => findSilentFeedbackErrors(template)
      .map(({ tag, classes }) => `${rel(file)} <${tag} class="${classes.join(' ')}">`))
    expect(offenders).toEqual([])
  })

  it('成功提示一律用 role="status"（礼貌播报），不得用 role="alert" 打断', () => {
    const offenders = scanned.flatMap(({ file, template }) => findUnannouncedSuccess(template)
      .map(({ tag, classes, assertive }) => `${rel(file)} <${tag} class="${classes.join(' ')}">${assertive ? '（误用了 alert）' : '（没有角色）'}`))
    expect(offenders).toEqual([])
  })

  // ---- 夹具 ----
  it('夹具：缺 role="alert" 的错误消息会被抓出来', () => {
    expect(findSilentFeedbackErrors('<p v-if="error" class="error">{{ error }}</p>')).toHaveLength(1)
    expect(findSilentFeedbackErrors('<p class="error conflict-tip">冲突</p>')).toHaveLength(1)
    expect(findSilentFeedbackErrors('<p v-if="x" class="task-error">失败</p>')).toHaveLength(1)
    expect(findSilentFeedbackErrors('<p class="error" role="alert">失败</p>')).toEqual([])
    expect(findSilentFeedbackErrors('<p class="error" aria-live="polite">失败</p>')).toEqual([])
  })

  it('夹具：消息内部零件、逐行标记、样式绑定一律不进判据（这是精度测试）', () => {
    expect(findSilentFeedbackErrors('<div class="error-message"><span class="error-icon">⚠️</span></div>')).toEqual([])
    expect(findSilentFeedbackErrors('<span class="error-text">3 行需修改</span>')).toEqual([])
    expect(findSilentFeedbackErrors('<tr class="batch-error-row"><td>x</td></tr>')).toEqual([])
    expect(findSilentFeedbackErrors('<span class="plan-row-error">时间冲突</span>')).toEqual([])
    expect(findSilentFeedbackErrors('<p class="plan-error-tip">存在时间问题</p>')).toEqual([])
    expect(findSilentFeedbackErrors('<button class="global-error-close">×</button>')).toEqual([])
    // :class 是纯样式绑定，不含 class= 属性，不该被当成消息
    expect(findSilentFeedbackErrors('<tr :class="{ invalid: row.error }"><td>x</td></tr>')).toEqual([])
    expect(findSilentFeedbackErrors('<div :class="{ \'has-error\': rowError(i) }"></div>')).toEqual([])
  })

  it('夹具：成功提示用 alert 属于语义错误，要单独报出来', () => {
    expect(findUnannouncedSuccess('<p v-if="m" class="success">已保存</p>')).toHaveLength(1)
    expect(findUnannouncedSuccess('<p v-if="m" class="success" role="alert">已保存</p>')[0].assertive).toBe(true)
    expect(findUnannouncedSuccess('<p v-if="m" class="success" role="status">已保存</p>')).toEqual([])
    expect(findUnannouncedSuccess('<p v-if="m" class="notice-success" role="status">已保存</p>')).toEqual([])
    // 错误消息不该被成功判据顺手抓走
    expect(findUnannouncedSuccess('<p class="error" role="alert">失败</p>')).toEqual([])
  })
})

describe('ARIA 引用不得悬空', () => {
  const files = walkVueFiles(srcDir)
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')

  it('全仓没有指向不存在 id 的 aria-* 引用', () => {
    const offenders = files.flatMap((file) => findDanglingAriaRefs(readTemplate(file))
      .map(({ tag, attr, id }) => `${rel(file)} <${tag} ${attr}="${id}"> 找不到该 id`))
    expect(offenders).toEqual([])
  })

  it('自证：确实核对过若干条引用（否则等于没查）', () => {
    let checked = 0
    for (const file of files) {
      const template = readTemplate(file)
      for (const { attrs } of openTags(template)) {
        if (REF_ATTRS.some((a) => new RegExp(`(?:^|\\s):?${a}=`).test(attrs))) checked += 1
      }
    }
    expect(checked, '仓库里再也找不到 aria 引用属性').toBeGreaterThan(10)
  })

  it('夹具：静态值与绑定表达式里的字面量都要核对', () => {
    expect(findDanglingAriaRefs('<input aria-describedby="a"><p id="a">x</p>')).toEqual([])
    expect(findDanglingAriaRefs('<input aria-describedby="nope"><p id="a">x</p>')).toHaveLength(1)
    // 绑定表达式里引用的 id 常常是写在字符串字面量里的，也要认出来
    expect(findDanglingAriaRefs('<input :aria-describedby="e ? \'err\' : undefined"><p id="err">x</p>')).toEqual([])
    expect(findDanglingAriaRefs('<input :aria-describedby="e ? \'err\' : undefined">')).toHaveLength(1)
    // 多个 id 用空格分隔
    expect(findDanglingAriaRefs('<input aria-describedby="a b"><p id="a"></p><p id="b"></p>')).toEqual([])
    expect(findDanglingAriaRefs('<input aria-describedby="a b"><p id="a"></p>')).toHaveLength(1)
    // 写变量时无法静态解出 → 跳过，不是漏报
    expect(findDanglingAriaRefs('<input :aria-labelledby="titleId"><h2 :id="titleId"></h2>')).toEqual([])
  })
})