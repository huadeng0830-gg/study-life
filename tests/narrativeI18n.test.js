// @vitest-environment happy-dom
/**
 * 叙事文案的多语言（第五十四轮）。
 *
 * 【这条功能真正的问题不是翻译，而是"文案根本没上屏"】氛围引擎一直在产出节日名与
 * 祝福语，但全仓**没有一处渲染它们**（首页的问候语是纯时间问候）；设置页却已经写着
 * "首页的祝福语"。所以这一轮做了两件事：把叙事接进首页页头，并让它可以走多语言。
 *
 * 【判据分三层】
 *   ① 契约层：`festive.js` 能产出的每个**固定节日** key，英文表里都要有对应条目，
 *      且英文表里**不许含中日韩字符**（否则"翻译"只是抄了一遍原文）。
 *   ② 纯函数层：命中译文 / 回落原文 / 空输入 / 明确排除的动态文案，各自的行为。
 *   ③ 行为层：真挂载首页，只改语言偏好这一个变量，断言同一天渲染出的是英文还是中文，
 *      外加"氛围关掉时整行不出现"的对照。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApp, h, nextTick } from 'vue'
import FestiveSettings from '../src/components/FestiveSettings.vue'
import { LUNAR_DEFS, SOLAR_FIXED } from '../src/composables/festive.js'
import { flushStoredWrites } from '../src/composables/store/index.js'
import {
  DEFAULT_NARRATIVE_LANGUAGE,
  NARRATIVE_DYNAMIC_KEYS,
  NARRATIVE_LANGUAGES,
  NARRATIVE_LANGUAGE_KEY,
  NARRATIVE_TRANSLATIONS,
  narrativeFor,
} from '../src/composables/narrative.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** `festive.js` 会产出的静态节日 key（固定公历 + 农历表 + 生日）。 */
const staticFestiveKeys = [
  ...Object.values(SOLAR_FIXED).map((item) => item.key),
  ...Object.values(LUNAR_DEFS).map((item) => item.key),
  'birthday',
].sort()

/** 把 ISO 日期往后推若干天（用于构造"不在今天"的纪念日夹具）。 */
const shiftDays = (iso, days) => {
  const next = new Date(`${iso}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

let mounted = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  localStorage.clear()
})

async function bootToday({ lang, config }) {
  vi.resetModules()
  const { appToday } = await import('../src/composables/timeContext.js')
  const today = appToday.value
  localStorage.setItem('sl_festive_config', JSON.stringify(config(today)))
  localStorage.setItem(NARRATIVE_LANGUAGE_KEY, JSON.stringify(lang))
  const { mountApp, gotoRoute, settle } = await import('./helpers/mountApp.js')
  const { routes } = await import('../src/router/routes.js')
  mounted = await mountApp({ routes })
  await gotoRoute(mounted, '/')
  await settle()
  return today
}

const festiveLine = () => document.querySelector('.festive-narrative')

describe('契约层：固定节日的英文表必须齐全且真的是英文', () => {
  it('festive.js 能产出的每个静态节日 key，英文表里都有条目', () => {
    expect(staticFestiveKeys.length, '没解析出节日 key').toBeGreaterThan(10)
    const missing = staticFestiveKeys.filter((key) => !NARRATIVE_TRANSLATIONS.en[key])
    expect(missing, `英文表缺这些节日：${missing.join(', ')}`).toEqual([])
  })

  it('英文条目都有名字与祝福语，且不含中日韩字符', () => {
    const empty = Object.entries(NARRATIVE_TRANSLATIONS.en)
      .filter(([, value]) => !value.name?.trim() || !value.message?.trim())
      .map(([key]) => key)
    expect(empty, `这些条目是空的：${empty.join(', ')}`).toEqual([])
    const contaminated = Object.entries(NARRATIVE_TRANSLATIONS.en)
      .filter(([, value]) => CJK.test(`${value.name}${value.message}`))
      .map(([key]) => key)
    expect(contaminated, `这些"译文"里还有中日韩字符：${contaminated.join(', ')}`).toEqual([])
  })

  it('动态文案是**明确排除**的，不是漏掉的', () => {
    // 纪念日会把用户填的标签拼进句子、使用周年会把年数拼进句子——整句翻译会丢信息。
    expect(NARRATIVE_DYNAMIC_KEYS).toEqual(['anniversary', 'anniversary-start'])
    for (const key of NARRATIVE_DYNAMIC_KEYS) {
      expect(NARRATIVE_TRANSLATIONS.en[key], `${key} 不该有整句译文`).toBeUndefined()
    }
    // 反过来：静态节日里不许有人被顺手排除掉。
    for (const key of staticFestiveKeys) expect(NARRATIVE_DYNAMIC_KEYS).not.toContain(key)
  })

  it('语言清单自带默认语言，且默认语言是中文（原文的语言）', () => {
    expect(NARRATIVE_LANGUAGES.map((item) => item.id)).toContain(DEFAULT_NARRATIVE_LANGUAGE)
    expect(DEFAULT_NARRATIVE_LANGUAGE).toBe('zh')
  })
})

describe('纯函数层：命中译文与回落原文', () => {
  const festive = { key: 'newyear', name: '元旦', message: '新年快乐，翻开崭新的一页。' }

  it('英文命中译文并标记 translated', () => {
    const result = narrativeFor(festive, 'en')
    expect(result.name).toBe(NARRATIVE_TRANSLATIONS.en.newyear.name)
    expect(result.message).toBe(NARRATIVE_TRANSLATIONS.en.newyear.message)
    expect(result.translated).toBe(true)
    expect(CJK.test(`${result.name}${result.message}`)).toBe(false)
  })

  it('中文直接回原文（译文表里没有中文副本，避免两份会漂移的真源）', () => {
    const result = narrativeFor(festive, 'zh')
    expect(result.name).toBe('元旦')
    expect(result.message).toBe('新年快乐，翻开崭新的一页。')
    expect(result.translated).toBe(false)
  })

  it('判别力自证：同一份输入换个语言，输出必须真的不同', () => {
    expect(narrativeFor(festive, 'en').message).not.toBe(narrativeFor(festive, 'zh').message)
  })

  it('没有条目时回落原文而不是显示空白或 key', () => {
    const unknown = { key: 'zz-unknown', name: '未知节日', message: '原文。' }
    const result = narrativeFor(unknown, 'en')
    expect(result.name).toBe('未知节日')
    expect(result.message).toBe('原文。')
    expect(result.translated).toBe(false)
  })

  it('动态文案在英文下也回落中文原文（有意的边界）', () => {
    const anniversary = { key: 'anniversary', name: '在一起', message: '在一起快乐，一起记住今天。' }
    const result = narrativeFor(anniversary, 'en')
    expect(result.message).toBe('在一起快乐，一起记住今天。')
    expect(result.translated).toBe(false)
  })

  it('空输入返回 null（调用方据此不渲染整行）', () => {
    expect(narrativeFor(null, 'en')).toBeNull()
    expect(narrativeFor(undefined, 'en')).toBeNull()
    expect(narrativeFor({ name: '没有 key' }, 'en')).toBeNull()
  })

  it('不认识的语言退回中文原文，不会抛错', () => {
    expect(narrativeFor(festive, 'zz').message).toBe('新年快乐，翻开崭新的一页。')
  })
})

describe('行为层：首页真的显示叙事，且跟着语言变', () => {
  const birthdayToday = (iso) => ({ enabled: true, birthday: iso.slice(5) })

  it('英文偏好下首页显示英文祝福语', async () => {
    await bootToday({ lang: 'en', config: birthdayToday })
    const line = festiveLine()
    expect(line, '首页应当出现节日叙事行').toBeTruthy()
    expect(line.textContent).toContain('Happy birthday')
    expect(CJK.test(line.textContent), `英文偏好下不该出现中文祝福语：${line.textContent}`).toBe(false)
  })

  it('中文偏好下同一份夹具显示中文原文', async () => {
    await bootToday({ lang: 'zh', config: birthdayToday })
    const line = festiveLine()
    expect(line, '首页应当出现节日叙事行').toBeTruthy()
    expect(line.textContent).toContain('生日快乐')
  })

  it('对照：关掉节日氛围后整行不出现', async () => {
    await bootToday({ lang: 'en', config: (iso) => ({ ...birthdayToday(iso), enabled: false }) })
    expect(festiveLine(), '氛围关掉时不该显示叙事行').toBeNull()
  })

  it('对照：生日不在今天时，绝不会显示生日祝福', async () => {
    // 今天可能恰好是别的固定/农历节日（那行会合理地出现，且是那个节日的文案），
    // 但**绝不能**是生日文案 —— 这条判据与"今天是不是节日"无关，所以是确定的。
    await bootToday({ lang: 'en', config: (iso) => ({ enabled: true, birthday: shiftDays(iso, 1).slice(5) }) })
    expect(festiveLine()?.textContent ?? '', '生日不在今天却显示了生日祝福').not.toContain('Happy birthday')
    expect(festiveLine()?.textContent ?? '').not.toContain('生日快乐')
  })
})

describe('设置面板里的语言开关（接线判据）', () => {
  const source = readFileSync(resolve(import.meta.dirname, '..', 'src', 'components', 'FestiveSettings.vue'), 'utf8')
  let direct = null

  afterEach(() => {
    direct?.app.unmount()
    direct?.host.remove()
    direct = null
  })

  const mountPanel = () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp({ render: () => h(FestiveSettings, { open: true }) })
    app.mount(host)
    direct = { app, host }
  }

  it('开关绑在 narrativeLang 上，选项来自 NARRATIVE_LANGUAGES（不是写死两种语言）', () => {
    expect(source, '开关没绑到语言偏好').toContain('v-model="narrativeLang"')
    expect(source, '选项没走常量：加一种语言就得改两处').toContain('v-for="item in NARRATIVE_LANGUAGES"')
    expect(source, '选项被写死了').not.toMatch(/<option[^>]*value="zh"/)
  })

  it('开关有可访问名（label for 与 id 对得上）', () => {
    expect(source).toMatch(/<label for="festive-language">/)
    expect(source).toMatch(/id="festive-language"/)
  })

  it('判别力对照：把选项写死的版本会被同一套判据抓住', () => {
    const fixture = '<select id="festive-language" v-model="narrativeLang"><option value="zh">中文</option></select>'
    expect(/<option[^>]*value="zh"/.test(fixture), '写死选项的夹具没被抓住').toBe(true)
  })

  it('改这个下拉会真的写进 sl_ui_language（真挂载面板，不是看源码）', async () => {
    localStorage.removeItem(NARRATIVE_LANGUAGE_KEY)
    mountPanel()
    const select = document.querySelector('#festive-language')
    expect(select, '面板里没找到语言下拉').toBeTruthy()

    select.value = 'en'
    select.dispatchEvent(new Event('change'))
    await nextTick()
    await flushStoredWrites()

    expect(JSON.parse(localStorage.getItem(NARRATIVE_LANGUAGE_KEY)), '下拉没写进存储').toBe('en')
  })

  it('对照：不碰下拉时语言偏好不会被改成英文（防上面那条"永远为真"）', async () => {
    localStorage.removeItem(NARRATIVE_LANGUAGE_KEY)
    mountPanel()
    await nextTick()
    await flushStoredWrites()
    // 没操作时要么没写、要么仍是默认中文 —— 两种情况都不该出现 'en'。
    expect(JSON.parse(localStorage.getItem(NARRATIVE_LANGUAGE_KEY) ?? '"zh"')).toBe('zh')
  })
})