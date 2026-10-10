// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAllWallpapers, removeWallpaper, setWallpaper, wallpaperRevision } from '../src/composables/wallpaperStorage.js'

afterEach(() => vi.unstubAllGlobals())

describe('壁纸存储事务提交结果', () => {
  it.each([
    ['保存', () => setWallpaper('home', new Blob(['fictional image']))],
    ['删除', () => removeWallpaper('home')],
    ['清空', () => clearAllWallpapers()],
  ])('%s 在 request 成功但 transaction 失败时不得报成功', async (_label, action) => {
    const failure = new DOMException('虚构的事务提交失败', 'QuotaExceededError')
    const db = {
      close: vi.fn(),
      transaction() {
        const transaction = { error: failure }
        const request = () => {
          const operation = {}
          queueMicrotask(() => {
            operation.onsuccess?.()
            queueMicrotask(() => transaction.onabort?.())
          })
          return operation
        }
        transaction.objectStore = () => ({ put: request, delete: request, clear: request })
        return transaction
      },
    }
    vi.stubGlobal('indexedDB', { open() {
      const request = { result: db }
      queueMicrotask(() => request.onsuccess?.())
      return request
    } })
    const revision = wallpaperRevision.value
    await expect(action()).rejects.toBe(failure)
    expect(wallpaperRevision.value).toBe(revision)
    expect(db.close).toHaveBeenCalledOnce()
  })
})
