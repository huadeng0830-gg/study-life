// @vitest-environment happy-dom
/**
 * 管理中心页面的渲染层守卫。
 *
 * 【为什么 model 的测试不够】`adminCenterModel.test.js` 守的是「状态怎么算」，
 * 而这个页面真正的风险在另一侧：分区链接指向不存在的页面、事项按钮点开的是
 * 另一个面板、诊断区把不该出现的东西导出去。这些只有挂载真页面才看得见。
 *
 * 【为什么直接复用 routes】链接断言需要真实路由表——另抄一份必然随实现漂移，
 * 那样就不是守卫了。复用真表顺带让本页进入 renderedHeadingOrder / referenceIntegrity
 * 这些既有 DOM 守卫的覆盖范围，不额外开一条只对本文件生效的通路。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../src/router/routes.js'
import { mountApp, settle } from './helpers/mountApp.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { silentErrors } from '../src/composables/globalError.js'
import { dismissPersistenceNotice, reportPersistenceFailure } from '../src/composables/store/persistenceState.js'
import { BACKUP_MODULES } from '../src/composables/backupArchive.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'

registerMirrorTeardown()
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

/** 页面里出现的分区必须能在真实路由表里解析，否则「查看」就是死链。 */
const ROUTE_PATHS = new Set(routes.filter((route) => route.name).map((route) => route.path))

let mounted = null
const modulePath = '/admin'

beforeEach(async () => {
  localStorage.clear()
  mounted = await mountApp({ routes, hash: modulePath })
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  localStorage.clear()
  clearAnnouncement()
  dismissPersistenceNotice()
  silentErrors.length = 0
  vi.restoreAllMocks()
})

const page = () => document.querySelector('#main-content .admin-center')
const panelText = () => page()?.textContent || ''

describe('管理中心：分区清单与链接', () => {
  it('分区「查看」链接全部指向真实路由，且确实渲染出来了', () => {
    const links = [...page().querySelectorAll('.admin-module-link')]
    expect(links.length, '一个分区链接都没渲染出来，守卫在守空气').toBeGreaterThanOrEqual(5)

    for (const link of links) {
      const href = link.getAttribute('href') || ''
      const target = href.replace(/^#/, '')
      expect(ROUTE_PATHS, `分区链接指向不存在的路由：${href}`).toContain(target)
    }
  })

  it('没有页面的分区说明它归属哪里，而不是显示一句会让人去找页面的「设置」', () => {
    const statics = [...page().querySelectorAll('.admin-module-static')].map((el) => el.textContent.trim())
    expect(statics.length).toBeGreaterThanOrEqual(1)
    for (const text of statics) expect(text, `占位文案没有说明归属：${text}`).not.toBe('设置')
  })

  it('每个备份分区都在清单里有交代（链接或归属说明），不留下静默空缺', () => {
    const rows = [...page().querySelectorAll('.admin-module-list li')]
    expect(rows.length).toBe(BACKUP_MODULES.length)

    for (const row of rows) {
      const label = row.querySelector('.admin-module-title b')?.textContent?.trim()
      const known = BACKUP_MODULES.some((mod) => mod.label === label)
      expect(known, `清单里出现了备份协议之外的分区：${label}`).toBe(true)
      const hasExit = row.querySelector('.admin-module-link, .admin-module-static')
      expect(hasExit, `分区「${label}」既没有查看链接也没有归属说明`).toBeTruthy()
    }
  })
})

describe('管理中心：需要处理的事项', () => {
  it('同一屏不出现两个作用相同的刷新按钮', () => {
    // 概览卡片与分区清单都会渲染刷新；管理中心下面已有完整的分区清单，
    // 再放一个概览里的就是重复控件。
    const refreshes = [...page().querySelectorAll('button')]
      .filter((btn) => btn.textContent.replace(/\s+/g, '').includes('刷新'))
    expect(refreshes).toHaveLength(1)
  })

  it('分区明细不在概览里重复出现一次', () => {
    expect(page().querySelector('.inventory-details'), '概览里的分区明细与下方清单重复了').toBeNull()
    // 下方那份清单仍然在，且是完整的一份。
    expect(page().querySelectorAll('.admin-module-list li').length).toBe(BACKUP_MODULES.length)
  })

  it('事项按钮文案由模型给出，点击后打开对应面板', async () => {
    // 未登录 + 7 天未备份 ⇒ 应出现一条指向数据管理的事项。
    const buttons = [...page().querySelectorAll('.admin-text-action')]
    expect(buttons.length, '全新 profile 下应至少提示一次导出备份').toBeGreaterThanOrEqual(1)
    for (const button of buttons) {
      expect(['查看账号', '打开数据管理']).toContain(button.textContent.trim())
    }

    const openBackup = buttons.find((button) => button.textContent.trim() === '打开数据管理')
    openBackup.click()
    await settle()
    expect(document.body.textContent, '点了「打开数据管理」但数据管理面板没出现').toContain('数据管理')
  })

  it('事项数量与列表条数一致，读屏听到的数字不会和内容对不上', () => {
    const count = Number(page().querySelector('.admin-count')?.textContent?.trim())
    const items = page().querySelectorAll('.admin-attention-list li').length
    expect(count).toBe(items)
  })
})

describe('管理中心：运行状态诚实呈现', () => {
  it('状态列表是合法的 dl 结构（dl 内只允许 dt/dd）', () => {
    const list = page().querySelector('.admin-status-list')
    expect(list.tagName).toBe('DL')

    // <dl> 里的 <div> 只能装 dt/dd。曾经这里放的是 <p>，是无效结构。
    for (const group of list.querySelectorAll(':scope > div')) {
      for (const child of group.children) {
        expect(['DT', 'DD'], `<dl> 的分组里出现了 <${child.tagName.toLowerCase()}>`).toContain(child.tagName)
      }
    }
    // 每个术语都要有对应的描述，否则读屏只念出一个孤零零的标题。
    expect(list.querySelectorAll('dt').length).toBe(list.querySelectorAll('.admin-status-detail').length)
  })

  it('设备网络与在线服务分列，且不把「联网」说成「服务可用」', () => {
    const text = panelText()
    expect(text).toContain('设备网络')
    expect(text).toContain('在线服务')
    // 无论 navigator.onLine 是什么，服务侧仍然没有探针，措辞不能变。
    expect(text).toContain('未接入监测')
    expect(text).not.toContain('在线服务正常')
  })

  it('版本区展示构建与通道，信息排查时不必再去翻关于页面', () => {
    const version = page().querySelector('.admin-version')
    const text = version?.textContent || ''
    for (const label of ['应用版本', '发布通道', '业务数据结构', '账号同步结构', '构建标识', '代码提交']) {
      expect(text, `版本区缺少「${label}」`).toContain(label)
    }
  })
})

describe('管理中心：本机数据体检', () => {
  it('按设置阈值归档异常待办，并可通过提示撤销', async () => {
    const domain = useDomainCommands()
    domain.tasks.value = []
    const stale = domain.createTask({ title: '虚构的旧待办', dueDate: '2026-01-01' })
    await settle()
    page().querySelector('.admin-refresh').click()
    await settle()

    const card = page().querySelector('#admin-data-health')
    expect(card.textContent).toContain('本机数据体检')
    const threshold = card.querySelector('input[aria-label], input')
    expect(threshold).toBeTruthy()
    const staleIssue = [...card.querySelectorAll('.admin-health-issues > li')]
      .find((item) => item.textContent.includes('长期未完成的待办'))
    expect(staleIssue).toBeTruthy()
    staleIssue.querySelector('details > summary').click()
    await settle()
    staleIssue.querySelector('.admin-text-action').click()
    await settle()
    const archiveConfirm = [...document.body.querySelectorAll('button')].find((button) => button.textContent.trim() === '确认并继续')
    archiveConfirm?.click()
    await settle()

    let saved = JSON.parse(localStorage.getItem('sl_tasks'))
    expect(saved.find((item) => item.id === stale.id)?.archivedAt).toBeTruthy()
    const undo = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '撤销')
    expect(undo).toBeTruthy()
    undo.click()
    await settle()
    saved = JSON.parse(localStorage.getItem('sl_tasks'))
    expect(saved.find((item) => item.id === stale.id)?.archivedAt).toBeFalsy()
  })

  it('保存阈值并合并重复待办备注，撤销时恢复两条原记录', async () => {
    const domain = useDomainCommands()
    domain.tasks.value = []
    const primary = domain.createTask({ title: '虚构的同组事项', dueDate: '2026-11-20', note: '主记录备注' })
    const duplicate = domain.createTask({ title: '虚构的同组事项', dueDate: '2026-11-20', note: '重复记录备注' })
    await settle()
    page().querySelector('.admin-refresh').click()
    await settle()

    const card = page().querySelector('#admin-data-health')
    const input = card.querySelector('input[type="number"]')
    input.value = '120'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    card.querySelector('.admin-health-save').click()
    await settle()
    expect(JSON.parse(localStorage.getItem('sl_data_health_settings')).staleTaskDays).toBe(120)

    const duplicateIssue = [...card.querySelectorAll('.admin-health-issues > li')]
      .find((item) => item.textContent.includes('重复待办'))
    expect(duplicateIssue).toBeTruthy()
    duplicateIssue.querySelector('details > summary').click()
    duplicateIssue.querySelectorAll('.admin-text-action')[0].click()
    await settle()
    const mergeConfirm = [...document.body.querySelectorAll('button')].find((button) => button.textContent.trim() === '确认并继续')
    mergeConfirm?.click()
    await settle()

    let saved = JSON.parse(localStorage.getItem('sl_tasks'))
    expect(saved.find((item) => item.id === primary.id)?.note).toContain('重复记录备注')
    expect(saved.find((item) => item.id === duplicate.id)?.archivedAt).toBeTruthy()
    const undo = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '撤销')
    expect(undo).toBeTruthy()
    undo.click()
    await settle()
    saved = JSON.parse(localStorage.getItem('sl_tasks'))
    expect(saved.find((item) => item.id === primary.id)?.note).toBe('主记录备注')
    expect(saved.find((item) => item.id === duplicate.id)?.archivedAt).toBeFalsy()
  })

  it('大量异常记录按页展示，每页只挂载有限的逐条处理控件', async () => {
    const domain = useDomainCommands()
    domain.tasks.value = []
    for (let index = 0; index < 11; index += 1) {
      domain.createTask({ title: '分页虚构待办', dueDate: '2026-11-22' })
    }
    await settle()
    page().querySelector('.admin-refresh').click()
    await settle()

    const issue = [...page().querySelectorAll('.admin-health-issues > li')]
      .find((item) => item.textContent.includes('重复待办'))
    issue.querySelector('details > summary').click()
    await settle()
    expect(issue.querySelectorAll('.admin-health-samples > li')).toHaveLength(8)
    expect(issue.querySelector('.admin-health-pagination').textContent).toContain('第 1 / 2 组')

    issue.querySelector('.admin-health-pagination button:last-child').click()
    await settle()
    expect(issue.querySelectorAll('.admin-health-samples > li')).toHaveLength(2)
    expect(issue.querySelector('.admin-health-pagination').textContent).toContain('第 2 / 2 组')
    expect(issue.querySelector('.admin-health-pagination button:last-child').disabled).toBe(true)
  })
})

describe('管理中心：诊断信息', () => {
  it('导出的诊断是合法 JSON，且不含记录内容或账号标识', async () => {
    const details = page().querySelector('.admin-diagnostics details, details.admin-diagnostics')
    expect(details, '诊断区没有渲染出来').toBeTruthy()
    details.open = true
    await settle()

    const textarea = page().querySelector('.admin-diagnostics-text')
    expect(textarea).toBeTruthy()

    const report = JSON.parse(textarea.value)
    expect(report.app).toBe('study-life')
    expect(report.version).toHaveProperty('appVersion')
    expect(report.version).toHaveProperty('commitId')
    expect(report.localData).toHaveProperty('pendingWriteCount')

    // 隐私边界：邮箱、用户标识和原始错误文案都不许出现。
    const text = textarea.value
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(text).not.toContain('本次修改未能保存到本机')
    for (const entry of Object.values(report.status)) {
      if (entry) expect(Object.keys(entry).sort()).toEqual(['label', 'tone'])
    }
  })

  it('复制按钮成功与失败都会留下可读的结果', async () => {
    const details = page().querySelector('details.admin-diagnostics')
    details.open = true
    await settle()

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    details.querySelector('.admin-refresh').click()
    await settle()
    expect(writeText).toHaveBeenCalled()
    expect(page().querySelector('.admin-copy-result, [role="status"]').textContent).toContain('已复制')

    writeText.mockRejectedValue(new Error('denied'))
    details.querySelector('.admin-refresh').click()
    await settle()
    expect(page().querySelector('[role="status"]').textContent).toContain('手动复制')
  })
})

describe('管理中心：静默失败可被看到', () => {
  it('静默失败报作用域与时间，但不把可能含用户内容的错误原文带进页面', async () => {
    // 环形缓冲是模块级的共享对象，别处（镜像写盘失败等）也会往里写。
    // 这里先清空再放一条断言自己的记录，最后只按「包含」判断，不假设缓冲区里只有它。
    silentErrors.length = 0
    silentErrors.push({ scope: 'storage-local', message: 'QuotaExceededError: 私密内容', at: '2026-10-13T00:00:00.000Z' })
    // 触发一次重新读取，让诊断反映刚发生的失败。
    page().querySelector('.admin-refresh')?.click()
    await settle()

    const textarea = page().querySelector('.admin-diagnostics-text')
    const report = JSON.parse(textarea.value)

    expect(report.recentSilentFailures).toContainEqual({ scope: 'storage-local', at: '2026-10-13T00:00:00.000Z' })
    // 每条都只允许作用域与时间两个字段——这是「错误原文不进页面」的结构性保证。
    for (const entry of report.recentSilentFailures) {
      expect(Object.keys(entry).sort()).toEqual(['at', 'scope'])
    }
    expect(textarea.value).not.toContain('私密内容')
    expect(textarea.value).not.toContain('QuotaExceededError')
    expect(page().textContent).not.toContain('私密内容')
  })
})

describe('管理中心：写入失败会浮到页面上', () => {
  it('存储写入失败后，「需要处理」出现未保存事项且按钮真的打开数据管理', async () => {
    // 全新 profile 本来就有「尚未备份」提醒，所以只断言**未保存**这条不在，
    // 而不是笼统地断言没有待处理事项。
    const itemsBefore = [...page().querySelectorAll('.admin-attention-list li')]
    expect(itemsBefore.some((li) => li.textContent.includes('尚未保存')), '健康状态下不该提示未保存').toBe(false)

    // 触发真实写入失败路径（与 store 内部同一条 reportPersistenceFailure）。
    reportPersistenceFailure(new Error('QuotaExceededError'), 'sl_tasks', 'local')
    page().querySelector('.admin-refresh')?.click()
    await settle()

    const items = [...page().querySelectorAll('.admin-attention-list li')]
    const pending = items.find((li) => li.textContent.includes('尚未保存'))
    expect(pending, '写入失败后页面没有提示未保存，刷新就会丢数据').toBeTruthy()
    // 计数徽标要跟列表条数一致，读屏听到的数字才对得上。
    expect(Number(page().querySelector('.admin-count').textContent.trim())).toBe(items.length)

    const button = pending.querySelector('.admin-text-action')
    expect(button.textContent.trim()).toBe('打开数据管理')
    button.click()
    await settle()
    expect(document.body.textContent).toContain('数据管理')

    // 收尾：这条告警是模块级状态，不清掉会漏到后续用例。
    dismissPersistenceNotice()
  })
})
