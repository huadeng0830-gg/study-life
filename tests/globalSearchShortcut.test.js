// @vitest-environment happy-dom
/**
 * 全局搜索快捷键 "/"（第三十二轮新增守卫）。
 *
 * 【为什么补这条】搜索面板一直只能从侧栏按钮打开：键盘用户要找搜索，
 * 得先把焦点挪到侧栏。仓库里 `App.vue` 的全局 keydown 已经有一套成熟护栏
 * （Ctrl+K 快速记账、数字 1..N 跳页，并且在可编辑元素/带修饰键/有弹窗时一律放行），
 * 补上 "/"（GitHub、YouTube 的老习惯）属于顺理成章的收尾。
 *
 * 这条守卫真正要盯的不是"能打开"，而是**不许抢**：
 *   - 在输入框 / 文本域 / contenteditable 里打斜杠，必须原样落进去；
 *   - Ctrl/Cmd + / 不能被吃掉；
 *   - 已经有弹窗打开时不能再叠一个搜索面板。
 * 护栏是顺序敏感的（都写在"可编辑元素"那道 return 之前就会出事），
 * 所以断言必须落在**行为**上，而不是去读源码里的顺序。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountApp, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { closeSearch, searchOpen } from '../src/composables/globalSearch.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

let mounted = null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeout = 900) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (check()) return true
    await sleep(10)
  }
  return check()
}

/** 往 window 上发一次按键；App 的全局 keydown 就挂在 window。 */
function press(key, { on = document.body, ctrlKey = false, metaKey = false } = {}) {
  on.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, metaKey, bubbles: true }))
}

const searchInput = () => document.querySelector('.search-panel input[type="search"]')

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  closeSearch()
})

describe('"/" 打开全局搜索', () => {
  it('按 "/" 会打开面板，并且焦点已经落在输入框里', async () => {
    mounted = await mountApp({ routes })
    expect(searchOpen.value).toBe(false)

    press('/')
    expect(searchOpen.value, '快捷键没接上').toBe(true)
    await waitFor(() => searchInput() !== null)

    const input = searchInput()
    expect(input, '面板没渲染出搜索框').not.toBeNull()
    await waitFor(() => document.activeElement === input)
    expect(document.activeElement, '打开后应该能直接打字').toBe(input)
  })

  it('连按两次只开一个面板', async () => {
    mounted = await mountApp({ routes })
    press('/')
    press('/')
    await waitFor(() => searchInput() !== null)
    await settle()
    expect(document.querySelectorAll('.search-panel').length).toBe(1)
  })

  it('Escape 关掉之后再按 "/" 还能打开', async () => {
    mounted = await mountApp({ routes })
    press('/')
    await waitFor(() => searchInput() !== null)

    press('Escape')
    await waitFor(() => searchOpen.value === false)
    expect(searchOpen.value, 'Escape 应该能关掉').toBe(false)

    press('/')
    expect(searchOpen.value).toBe(true)
  })
})

describe('"/" 在三种情况下不许抢按键', () => {
  it('在输入框里打斜杠不会打开搜索', async () => {
    mounted = await mountApp({ routes })
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()

    press('/', { on: field })
    expect(searchOpen.value, '输入框里的斜杠被偷走了').toBe(false)
    field.remove()
  })

  it('文本域和 contenteditable 也一样', async () => {
    mounted = await mountApp({ routes })
    const area = document.createElement('textarea')
    const rich = document.createElement('div')
    rich.setAttribute('contenteditable', 'true')
    rich.tabIndex = 0
    document.body.append(area, rich)

    area.focus()
    press('/', { on: area })
    expect(searchOpen.value, '文本域里的斜杠被偷走了').toBe(false)

    rich.focus()
    press('/', { on: rich })
    expect(searchOpen.value, 'contenteditable 里的斜杠被偷走了').toBe(false)

    area.remove()
    rich.remove()
  })

  it('带 Ctrl/Cmd 的斜杠不归它管，弹窗打开时也不叠一层', async () => {
    mounted = await mountApp({ routes })

    press('/', { ctrlKey: true })
    expect(searchOpen.value, 'Ctrl+/ 不该被吃掉').toBe(false)
    press('/', { metaKey: true })
    expect(searchOpen.value, 'Cmd+/ 不该被吃掉').toBe(false)

    // Ctrl+K 打开快速记账（一个真正的弹窗），此时斜杠不该再叠出搜索面板。
    press('k', { ctrlKey: true })
    await waitFor(() => document.body.dataset.modalOpen === 'true' || document.body.style.overflow === 'hidden')
    await waitFor(() => document.querySelector('.modal') !== null)

    press('/')
    expect(searchOpen.value, '弹窗打开时不该再叠搜索面板').toBe(false)
  })
})