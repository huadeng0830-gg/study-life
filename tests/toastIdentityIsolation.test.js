// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '../src/components/Toast.vue'
import { accountUser } from '../src/composables/accountAuth.js'
import { accountDataOwner } from '../src/composables/accountSyncIdentity.js'

const originalUser = accountUser.value
const originalOwner = accountDataOwner.value
let app
let host
let open

beforeEach(() => {
  accountUser.value = null
  accountDataOwner.value = ''
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  document.body.innerHTML = ''
  accountUser.value = originalUser
  accountDataOwner.value = originalOwner
  app = null
  host = null
})

async function mountUndo(undoFn) {
  open = ref(true)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    setup() {
      return () => h(Toast, {
        open: open.value,
        message: '已删除示例记录',
        actionLabel: '撤销',
        undoFn,
        'onUpdate:open': (value) => { open.value = value },
        onClose: () => { open.value = false },
      })
    },
  })
  app.mount(host)
  await nextTick()
}

async function clickUndo() {
  host.querySelector('.toast-undo').click()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await nextTick()
}

describe('toast undo respects the data identity where the action was created', () => {
  it('refuses a stale undo after the account changes and closes the prompt', async () => {
    const undo = vi.fn()
    await mountUndo(undo)

    accountUser.value = { id: 'fictional-account-b' }
    accountDataOwner.value = 'fictional-account-b'
    await clickUndo()

    expect(undo).not.toHaveBeenCalled()
    expect(open.value).toBe(false)
  })

  it('still performs the undo while the original identity is current', async () => {
    const undo = vi.fn()
    await mountUndo(undo)
    await clickUndo()

    expect(undo).toHaveBeenCalledOnce()
    expect(open.value).toBe(false)
  })
})
