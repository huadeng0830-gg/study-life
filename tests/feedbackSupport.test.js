// @vitest-environment happy-dom
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFeedbackSupport } from '../src/composables/feedbackSupport.js'
import { accountOpen, accountUser } from '../src/composables/accountAuth.js'
const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('../src/services/campusCommunity.js', () => ({ campusFeedbackVotes: api.read, setCampusFeedbackVote: api.write }))
let scope
function setup() {
  const items = ref([{ id: 'fictional-feedback', like_count: 5 }])
  const detail = ref(null)
  scope = effectScope()
  const model = scope.run(() => useFeedbackSupport(items, detail))
  return { items, detail, model }
}
beforeEach(() => {
  vi.clearAllMocks(); accountOpen.value = false
  accountUser.value = { id: 'fictional-reader' }
  api.read.mockResolvedValue({ likedIds: [], counts: [{ id: 'fictional-feedback', like_count: 5 }] })
  api.write.mockResolvedValue({ liked: true, likeCount: 6 })
})
afterEach(() => { scope?.stop(); accountUser.value = null })
describe('feedback support concurrency', () => {
  it('requires login without changing the count', async () => {
    accountUser.value = null
    const { model, items } = setup()
    await model.toggle(items.value[0])
    expect(accountOpen.value).toBe(true)
    expect(items.value[0].like_count).toBe(5)
    expect(api.write).not.toHaveBeenCalled()
  })
  it('applies authoritative count, allows cancellation and blocks duplicate in-flight requests', async () => {
    const { model, items } = setup()
    await vi.waitFor(() => expect(model.loading.value).toBe(false))
    let resolve
    api.write.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = model.toggle(items.value[0])
    await model.toggle(items.value[0])
    expect(api.write).toHaveBeenCalledTimes(1)
    resolve({ liked: true, likeCount: 6 }); await pending
    expect(model.liked['fictional-feedback']).toBe(true)
    api.write.mockResolvedValueOnce({ liked: false, likeCount: 5 })
    await model.toggle(items.value[0])
    expect(api.write).toHaveBeenLastCalledWith('fictional-feedback', false)
    expect(items.value[0].like_count).toBe(5)
  })
  it('keeps server failure visible and never invents a successful count', async () => {
    const { model, items } = setup()
    await vi.waitFor(() => expect(model.loading.value).toBe(false))
    api.write.mockRejectedValue(new Error('fictional network failure'))
    await model.toggle(items.value[0])
    expect(model.error.value).toBeTruthy()
    expect(model.liked['fictional-feedback']).toBe(false)
    expect(items.value[0].like_count).toBe(5)
  })
  it('discards an old accounts late write and never marks the new account as supporting', async () => {
    const { model, items } = setup()
    await vi.waitFor(() => expect(model.loading.value).toBe(false))
    let resolve
    api.write.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = model.toggle(items.value[0])
    accountUser.value = { id: 'fictional-second-reader' }
    await vi.waitFor(() => expect(model.loading.value).toBe(false))
    resolve({ liked: true, likeCount: 6 }); await pending
    expect(model.liked['fictional-feedback']).toBe(false)
    expect(items.value[0].like_count).toBe(5)
  })
  it('prevents a stale read from undoing a vote completed while changing pages', async () => {
    const { model, items } = setup()
    await vi.waitFor(() => expect(model.loading.value).toBe(false))
    let finishWrite, finishRead
    api.write.mockImplementationOnce(() => new Promise(done => { finishWrite = done }))
    const write = model.toggle(items.value[0])
    api.read.mockImplementationOnce(() => new Promise(done => { finishRead = done }))
    const read = model.refresh()
    finishWrite({ liked: true, likeCount: 6 }); await write
    finishRead({ likedIds: [], counts: [{ id: 'fictional-feedback', like_count: 5 }] }); await read
    expect(model.liked['fictional-feedback']).toBe(true)
    expect(items.value[0].like_count).toBe(6)
    await nextTick()
  })
})
