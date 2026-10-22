// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  share: vi.fn(async () => ({})),
  writeFile: vi.fn(async () => ({ uri: 'file:///private/cache/exports/fiction.json' })),
  readdir: vi.fn(async () => ({ files: [] })),
  deleteFile: vi.fn(async () => ({})),
}))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: native, Directory: { Cache: 'CACHE' } }))
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }))

let installBridge
beforeAll(async () => {
  vi.stubEnv('MODE', 'android')
  installBridge = (await import('../src/composables/androidRuntime.js')).installAndroidExportBridge
  installBridge()
})
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['fictional export'], { type: 'text/plain' }) })))
})
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function exportClick() {
  const anchor = document.createElement('a')
  anchor.href = 'blob:https://study-life.pages.dev/fictional-export'
  anchor.download = '虚构导出.txt'
  document.body.appendChild(anchor)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  anchor.dispatchEvent(event)
  anchor.remove()
  return event
}

describe('Android export bridge', () => {
  it('exports through a private cache and native sharing before an app view is mounted', async () => {
    expect(exportClick().defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(native.share).toHaveBeenCalledOnce())
    expect(native.writeFile.mock.calls[0][0]).toMatchObject({ directory: 'CACHE', recursive: true })
    expect(native.writeFile.mock.calls[0][0].path).toMatch(/^exports\/.+虚构导出\.txt$/)
    expect(native.share.mock.calls[0][0].url).toBe('file:///private/cache/exports/fiction.json')
    expect(native.deleteFile).not.toHaveBeenCalled()
  })

  it('does not install duplicate listeners and limits old private exports', async () => {
    installBridge()
    native.readdir.mockResolvedValueOnce({ files: Array.from({ length: 12 }, (_, index) => ({ name: `fiction-${index}.txt`, type: 'file', mtime: Date.now() - index })) })
    exportClick()
    await vi.waitFor(() => expect(native.share).toHaveBeenCalledOnce())
    expect(native.deleteFile).toHaveBeenCalledTimes(3)
    expect(native.deleteFile.mock.calls.every(([entry]) => entry.path.startsWith('exports/'))).toBe(true)
  })
})
