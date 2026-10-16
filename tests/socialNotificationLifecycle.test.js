// @vitest-environment happy-dom
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ channel: vi.fn(), remove: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', () => ({ accountUser: ref({ id: 'fictional-reader' }) }))
vi.mock('../src/composables/accountVerification.js', () => ({ hasVerifiedContactEmail: () => true }))
vi.mock('../src/composables/accountSyncState.js', () => ({ accountSyncStatus: ref('synced'), syncAccountNow: vi.fn() }))
vi.mock('../src/composables/accountSyncMode.js', () => ({ accountSyncViaAccount: ref(true) }))
vi.mock('../src/services/supabase.js', () => ({ getSupabaseClient: async () => ({ channel: mock.channel, removeChannel: mock.remove }) }))
import { subscribeSocialNotifications } from '../src/services/social.js'
import { accountUser } from '../src/composables/accountAuth.js'
let stop
const visibility = value => { Object.defineProperty(document, 'visibilityState', { configurable: true, value }); document.dispatchEvent(new Event('visibilitychange')) }
beforeEach(() => {
  accountUser.value = { id: 'fictional-reader' }
  visibility('visible')
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  mock.remove.mockReset().mockResolvedValue('ok')
  mock.channel.mockReset().mockImplementation(() => { const channel = { on: vi.fn(() => channel), subscribe: vi.fn(callback => { queueMicrotask(() => callback?.('SUBSCRIBED')); return channel }) }; return channel })
})
afterEach(() => { stop?.(); vi.restoreAllMocks() })
describe('notification Realtime lifetime', () => {
  it('pauses when hidden, refreshes once on return, and removes all listeners on leave', async () => {
    const changed = vi.fn()
    stop = await subscribeSocialNotifications('fictional-reader', changed)
    expect(mock.channel).toHaveBeenCalledTimes(1)
    visibility('hidden')
    await vi.waitFor(() => expect(mock.remove).toHaveBeenCalledTimes(1))
    visibility('visible')
    await vi.waitFor(() => expect(mock.channel).toHaveBeenCalledTimes(2))
    expect(changed).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mock.channel).toHaveBeenCalledTimes(2)
    stop()
    visibility('hidden'); visibility('visible')
    expect(mock.channel).toHaveBeenCalledTimes(2)
  })
  it('does not open a channel while hidden or restore a previous account', async () => {
    visibility('hidden')
    stop = await subscribeSocialNotifications('fictional-reader', vi.fn())
    expect(mock.channel).not.toHaveBeenCalled()
    accountUser.value = { id: 'fictional-other' }
    visibility('visible')
    expect(mock.channel).not.toHaveBeenCalled()
  })
  it('waits for an old channel to leave before rapid visibility changes reconnect it', async () => {
    let finish
    mock.remove.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    stop = await subscribeSocialNotifications('fictional-reader', vi.fn())
    visibility('hidden'); visibility('visible'); visibility('hidden'); visibility('visible')
    expect(mock.channel).toHaveBeenCalledTimes(1)
    finish('ok')
    await vi.waitFor(() => expect(mock.channel).toHaveBeenCalledTimes(2))
  })
  it('refreshes missed events after an initially hidden subscription becomes ready', async () => {
    visibility('hidden')
    const changed = vi.fn()
    stop = await subscribeSocialNotifications('fictional-reader', changed)
    visibility('visible')
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
    expect(mock.channel).toHaveBeenCalledTimes(1)
  })
  it('waits for SUBSCRIBED before catch-up and ignores old channel readiness and events', async () => {
    const channels = []
    mock.channel.mockImplementation(() => {
      const channel = { on: vi.fn((_event, _filter, callback) => { channel.changed = callback; return channel }), subscribe: vi.fn(callback => { channel.ready = callback; return channel }) }
      channels.push(channel)
      return channel
    })
    const changed = vi.fn()
    stop = await subscribeSocialNotifications('fictional-reader', changed)
    visibility('hidden'); visibility('visible')
    await vi.waitFor(() => expect(channels).toHaveLength(2))
    expect(changed).not.toHaveBeenCalled()
    channels[0].ready('SUBSCRIBED')
    channels[0].changed({ old: true })
    expect(changed).not.toHaveBeenCalled()
    channels[1].ready('SUBSCRIBED')
    expect(changed).toHaveBeenCalledTimes(1)
    channels[1].ready('SUBSCRIBED')
    expect(changed).toHaveBeenCalledTimes(1)
    stop()
    channels[1].ready('SUBSCRIBED')
    channels[1].changed({ disposed: true })
    expect(changed).toHaveBeenCalledTimes(1)
  })
})
