// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExamsView from '../src/views/ExamsView.vue'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { accountUser } from '../src/composables/accountAuth.js'
import { accountDataOwner } from '../src/composables/accountSyncIdentity.js'
import { flushStoredWrites } from '../src/composables/store/core.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const domain = useDomainCommands()
const originalUser = accountUser.value, originalOwner = accountDataOwner.value
let app, host
beforeEach(async () => {
  accountUser.value = null; accountDataOwner.value = ''
  domain.milestones.value = []; domain.tasks.value = []; domain.courses.value = []
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/exams', component: ExamsView }] })
  await router.push('/exams')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(ExamsView).use(router); app.mount(host)
  await nextTick()
})
afterEach(() => { app.unmount(); host.remove(); accountUser.value = originalUser; accountDataOwner.value = originalOwner })
const button = (text) => [...document.querySelectorAll('button')].find(node => node.textContent.trim().includes(text))
async function click(node) { await new Promise(resolve => setTimeout(resolve, 8)); node.click(); await nextTick() }
async function input(id, value) { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await nextTick() }
const form = () => document.querySelector('form.form')
async function submit() { form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await nextTick(); await nextTick() }

describe('important date progressive form and actual persistence', () => {
  it('creates with just a name and target date, while optional details remain folded and footer save is associated', async () => {
    await click(button('添加重要日期'))
    expect(form().querySelector('.milestone-details').open).toBe(false)
    const submitter = document.querySelector(`button[form="${form().id}"]`)
    expect(submitter.form).toBe(form())
    await input('exams-name', '示例日期')
    await input('exams-target-date', '2026-12-10')
    await submit()
    expect(form()).toBeNull()
    expect(domain.milestones.value[0]).toMatchObject({ name: '示例日期', date: '2026-12-10', time: '', note: '', pinned: false, reviewProgress: 0 })
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem('sl_exams'))[0].name).toBe('示例日期')
  })

  it('opens hidden details and focuses the actual invalid reminder field without losing typed values', async () => {
    await click(button('添加重要日期'))
    await input('exams-name', '示例日期')
    await input('exams-target-date', '2026-12-10')
    await input('dates-reminder', '-1')
    await submit()
    expect(form().querySelector('.milestone-details').open).toBe(true)
    expect(document.activeElement.id).toBe('dates-reminder')
    expect(document.getElementById('exams-name').value).toBe('示例日期')
    expect(domain.milestones.value).toHaveLength(0)
  })

  it('accepts a registration deadline without an exam date and rejects reversed registration dates', async () => {
    await click(button('校外考试'))
    await input('exams-name', '示例报名')
    await input('external-register-start', '2026-12-20')
    await input('external-register-deadline', '2026-12-10')
    await submit()
    expect(document.activeElement.id).toBe('external-register-deadline')
    expect(domain.milestones.value).toHaveLength(0)
    await input('external-register-start', '')
    await submit()
    expect(domain.milestones.value[0]).toMatchObject({ kind: 'externalExam', registerStart: '', registerDeadline: '2026-12-10', examDate: '' })
  })

  it('外部考试日期快捷选择清除考试日期字段的校验错误', async () => {
    await click(button('校外考试'))
    await input('exams-name', '示例考试')
    await submit()
    expect(document.activeElement.id).toBe('exams-exam-date')
    expect(document.getElementById('dates-form-error').textContent).toContain('考试日期')
    await click([...document.querySelectorAll('.date-shortcuts button')].find((node) => node.textContent.trim() === '明天'))
    expect(document.getElementById('dates-form-error')).toBeNull()
    expect(document.getElementById('exams-exam-date').getAttribute('aria-invalid')).toBeNull()
  })

  it('keeps the draft and rejects saving it into an account opened after the form', async () => {
    await click(button('添加重要日期'))
    await input('exams-name', '原账号示例草稿')
    await input('exams-target-date', '2026-12-10')
    accountUser.value = { id: 'fictional-account-b' }; accountDataOwner.value = 'fictional-account-b'
    await submit()
    expect(domain.milestones.value).toHaveLength(0)
    expect(form()).toBeTruthy()
    expect(document.getElementById('exams-name').value).toBe('原账号示例草稿')
    expect(document.getElementById('dates-form-error').textContent).toContain('变化')
  })
})
