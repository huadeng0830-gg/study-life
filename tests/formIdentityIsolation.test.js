// @vitest-environment happy-dom
import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountUser } from '../src/composables/accountAuth.js'
import { accountDataOwner } from '../src/composables/accountSyncIdentity.js'
import { useTaskEditor } from '../src/composables/tasks/useTaskEditor.js'
import { useEventEditor } from '../src/composables/events/useEventEditor.js'
import { useQuickEntryForm } from '../src/composables/ledgerView/useQuickEntryForm.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
let scope
const initialUser = accountUser.value
const initialOwner = accountDataOwner.value
beforeEach(() => { accountUser.value = null; accountDataOwner.value = ''; scope = effectScope() })
afterEach(() => { scope.stop(); accountUser.value = initialUser; accountDataOwner.value = initialOwner })
const switchedAccount = () => { accountUser.value = { id: 'fictional-account-b' }; accountDataOwner.value = 'fictional-account-b' }
const domain = () => ({ tasks: ref([]), events: ref([]), courses: ref([]), transactions: ref([]), createTask: vi.fn(), createEvent: vi.fn(), createTransaction: vi.fn() })

describe('an open personal form cannot write its old draft into another account', () => {
  it('retains an old task draft but refuses to save it after an account switch', () => {
    const commands = domain()
    const editor = scope.run(() => useTaskEditor({ domain: commands, tasks: commands.tasks, courses: commands.courses, events: commands.events }))
    editor.openAdd()
    editor.form.value.title = '原账号的示例草稿'
    switchedAccount()
    editor.save()
    expect(commands.createTask).not.toHaveBeenCalled()
    expect(editor.showForm.value).toBe(true)
    expect(editor.form.value.title).toBe('原账号的示例草稿')
    expect(editor.error.value).toContain('变化')
    editor.openAdd()
    editor.form.value.title = '新账号的示例待办'
    editor.save()
    expect(commands.createTask).toHaveBeenCalledOnce()
  })

  it('refuses an event draft captured before an account change', () => {
    const commands = domain()
    const editor = scope.run(() => useEventEditor(commands, vi.fn()))
    editor.openCreate('')
    editor.form.value.title = '原账号的示例日程'
    switchedAccount()
    editor.save()
    expect(commands.createEvent).not.toHaveBeenCalled()
    expect(editor.formOpen.value).toBe(true)
    expect(editor.formError.value).toContain('变化')
  })

  it('does not let a stale task conflict confirmation follow a reopened form', () => {
    const commands = domain()
    const date = '2026-10-20'
    const occupied = (start, end) => [{ id: 'fictional-stage', label: '示例安排', kind: 'scheduled', start: { date, time: start }, end: { date, time: end }, reminders: [] }]
    commands.tasks.value = [{ id: 'fictional-task', title: '示例冲突', dueDate: date, dueTime: '09:00', timeStages: occupied('09:00', '10:00') }]
    const editor = scope.run(() => useTaskEditor({ domain: commands, tasks: commands.tasks, courses: commands.courses, events: commands.events }))
    editor.openAdd()
    Object.assign(editor.form.value, { title: '旧账号草稿', dueDate: date, dueTime: '09:30', timeStages: occupied('09:30', '10:30') })
    editor.save()
    const staleConflict = editor.saveConflict.value
    expect(staleConflict).toBeTruthy()

    switchedAccount()
    editor.openAdd()
    editor.saveConflict.value = staleConflict // An already queued confirm callback can outlive the visible form.
    editor.confirmConflictSave()
    expect(commands.createTask).not.toHaveBeenCalled()
    expect(editor.showForm.value).toBe(true)
    expect(editor.error.value).toContain('重新打开')
  })

  it('refuses a ledger draft before creating a record for the new account', async () => {
    const commands = domain()
    const editor = scope.run(() => useQuickEntryForm({ baseCurrency: ref('CNY'), domain: commands, notify: vi.fn(), closeSwipe: vi.fn(), ledgerNowHM: () => '12:00' }))
    editor.openQuick({ amount: 12, name: '原账号的示例记录' })
    switchedAccount()
    expect(await editor.saveExpense()).toBe(false)
    expect(commands.createTransaction).not.toHaveBeenCalled()
    expect(editor.amountInput.value).toBe('12')
    expect(editor.formError.value).toContain('变化')
  })
})
