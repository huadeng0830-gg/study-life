// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({ route: null, spec: null, reduced: null, revision: null, getBlur: vi.fn() }))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  stubs.route = reactive({ path: '/' })
  return { useRoute: () => stubs.route }
})
vi.mock('../src/composables/appearance.js', async () => {
  const { ref } = await import('vue')
  stubs.spec = ref({ target: 'home', settings: { blur: 20, fit: 'cover', opacity: 80 } })
  return { activeWallpaperSpec: () => stubs.spec.value }
})
vi.mock('../src/composables/performanceMode.js', async () => {
  const { ref } = await import('vue')
  stubs.reduced = ref(false)
  return { reducedEffects: stubs.reduced, isIOSDevice: () => false }
})
vi.mock('../src/composables/wallpaperStorage.js', async () => {
  const { ref } = await import('vue')
  stubs.revision = ref(0)
  return {
    wallpaperRevision: stubs.revision,
    getWallpaper: vi.fn(async () => new Blob(['fictional original'])),
    getWallpaperBlurVariant: stubs.getBlur,
  }
})
import WallpaperLayer from '../src/components/WallpaperLayer.vue'

let app, host, urlIndex
async function flush() { for (let i = 0; i < 5; i++) { await Promise.resolve(); await nextTick() } }
async function mountWallpaper() {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(WallpaperLayer)
  app.mount(host)
  await flush()
  await vi.advanceTimersByTimeAsync(125)
  await flush()
  const value = host.querySelector('.wallpaper-layer').style.getPropertyValue('--wallpaper-image')
  const blurUrl = value.match(/blob:fixture-\d+/)?.[0]
  expect(blurUrl).toBeTruthy()
  return blurUrl
}
beforeEach(() => {
  vi.useFakeTimers()
  stubs.spec.value = { target: 'home', settings: { blur: 20, fit: 'cover', opacity: 80 } }
  stubs.reduced.value = false
  stubs.revision.value = 0
  stubs.getBlur.mockReset().mockResolvedValue(new Blob(['fictional blur']))
  urlIndex = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fixture-${++urlIndex}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20, height: 20, close() {} })))
})
afterEach(() => {
  app?.unmount(); host?.remove(); app = null; host = null
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
describe('engineering audit: wallpaper blob lifetimes', () => {
  it('releases the previous blur URL when effects are disabled', async () => {
    const blurUrl = await mountWallpaper()
    stubs.reduced.value = true
    await flush()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(blurUrl)
    expect(host.querySelector('.wallpaper-layer').style.getPropertyValue('--wallpaper-image')).not.toContain(blurUrl)
  })
  it('does not show the old route blur while the new variant is pending', async () => {
    const blurUrl = await mountWallpaper()
    stubs.getBlur.mockReturnValue(new Promise(() => {}))
    stubs.spec.value = { target: 'tasks', settings: { blur: 20, fit: 'cover', opacity: 80 } }
    await flush()
    expect(host.querySelector('.wallpaper-layer').style.getPropertyValue('--wallpaper-image')).not.toContain(blurUrl)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(blurUrl)
  })
  it.each(['missing', 'failed'])('releases a stale blur when the next variant is %s', async (kind) => {
    const blurUrl = await mountWallpaper()
    if (kind === 'failed') stubs.getBlur.mockRejectedValue(new Error('synthetic storage failure'))
    else stubs.getBlur.mockResolvedValue(null)
    stubs.revision.value++
    await flush()
    await vi.advanceTimersByTimeAsync(125)
    await flush()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(blurUrl)
    expect(host.querySelector('.wallpaper-layer').style.getPropertyValue('--wallpaper-image')).not.toContain(blurUrl)
  })
})
