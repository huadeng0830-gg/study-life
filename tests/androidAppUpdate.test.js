// @vitest-environment happy-dom
/**
 * 安卓应用内更新的协议层测试。
 *
 * 【为什么单独测】这一段处理的是**外部不可信数据**（GitHub Releases 的 JSON）
 * 和**原生桥**（ApkUpdate 插件）。两头都容易悄悄坏掉：
 *   - 解析太宽松 → 拿到的版本号或下载地址不可信；
 *   - 原生桥不存在时没兜底 → 界面一直转圈或报错文案对不上。
 * 所以这里把"能不能安全地解析、能不能优雅地退化"钉死。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const APK_URL = 'https://github.com/huadeng0830-gg/study-life/releases/download/v1.14.0/sanliangshi-1.14.0.apk'

function releasePayload(overrides = {}) {
  return {
    tag_name: 'v1.14.0',
    name: '三两事 1.14.0',
    body: '这一版修了一些问题',
    draft: false,
    prerelease: false,
    published_at: '2026-10-22T08:00:00Z',
    html_url: 'https://github.com/huadeng0830-gg/study-life/releases/tag/v1.14.0',
    assets: [{ name: 'sanliangshi-1.14.0.apk', browser_download_url: APK_URL, size: 8123456 }],
    ...overrides,
  }
}

/** 以安卓模式重新载入模块（isAndroidApp 是模块级的构建期常量）。 */
async function loadModule() {
  vi.resetModules()
  vi.stubEnv('MODE', 'android')
  return import('../src/composables/androidAppUpdate.js')
}

function installPlugin(overrides = {}) {
  const plugin = {
    download: vi.fn().mockResolvedValue({ path: '/cache/updates/a.apk', bytes: 8123456 }),
    install: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
    canInstallPackages: vi.fn().mockResolvedValue({ allowed: true }),
    openInstallPermissionSettings: vi.fn().mockResolvedValue({}),
    addListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
    ...overrides,
  }
  globalThis.Capacitor = { Plugins: { ApkUpdate: plugin } }
  return plugin
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  delete globalThis.Capacitor
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('下载地址白名单', () => {
  it('只认 https 的 GitHub 域名', async () => {
    const { isTrustedDownloadUrl } = await loadModule()
    expect(isTrustedDownloadUrl(APK_URL)).toBe(true)
    expect(isTrustedDownloadUrl('https://objects.githubusercontent.com/x/y.apk')).toBe(true)
    expect(isTrustedDownloadUrl('http://github.com/x.apk')).toBe(false)
    expect(isTrustedDownloadUrl('https://github.com.evil.test/x.apk')).toBe(false)
    expect(isTrustedDownloadUrl('https://evil.test/x.apk')).toBe(false)
    expect(isTrustedDownloadUrl('javascript:alert(1)')).toBe(false)
    expect(isTrustedDownloadUrl('https://user:pass@github.com/x.apk')).toBe(false)
  })
})

describe('发布载荷解析', () => {
  it('正常载荷能解析出版本、说明与安装包', async () => {
    const { parseAndroidRelease } = await loadModule()
    const parsed = parseAndroidRelease(releasePayload())
    expect(parsed).not.toBeNull()
    expect(parsed.version).toBe('1.14.0')
    expect(parsed.apkUrl).toBe(APK_URL)
    expect(parsed.apkBytes).toBe(8123456)
    expect(parsed.notes).toContain('修了一些问题')
  })

  it('草稿与预发布不接受', async () => {
    const { parseAndroidRelease } = await loadModule()
    expect(parseAndroidRelease(releasePayload({ draft: true }))).toBeNull()
    expect(parseAndroidRelease(releasePayload({ prerelease: true }))).toBeNull()
  })

  it('没有 APK 附件就不算一次可用更新', async () => {
    const { parseAndroidRelease } = await loadModule()
    expect(parseAndroidRelease(releasePayload({ assets: [] }))).toBeNull()
    expect(parseAndroidRelease(releasePayload({ assets: [{ name: 'notes.txt', browser_download_url: APK_URL }] }))).toBeNull()
  })

  it('下载地址不在白名单里就整个丢掉', async () => {
    const { parseAndroidRelease } = await loadModule()
    const payload = releasePayload()
    payload.assets[0].browser_download_url = 'https://evil.test/sanliangshi.apk'
    expect(parseAndroidRelease(payload)).toBeNull()
  })

  it('版本号不是纯 SemVer 就丢掉', async () => {
    const { parseAndroidRelease } = await loadModule()
    expect(parseAndroidRelease(releasePayload({ tag_name: 'latest' }))).toBeNull()
    expect(parseAndroidRelease(releasePayload({ tag_name: 'v1.14' }))).toBeNull()
    expect(parseAndroidRelease(releasePayload({ tag_name: 'v1.14.0-beta.1' }))).toBeNull()
  })

  it('不是对象或数组时丢掉', async () => {
    const { parseAndroidRelease } = await loadModule()
    expect(parseAndroidRelease(null)).toBeNull()
    expect(parseAndroidRelease([])).toBeNull()
    expect(parseAndroidRelease('release')).toBeNull()
  })
})

describe('检查更新', () => {
  it('发现更高版本时进入 available 并记下安装包信息', async () => {
    const { androidUpdateState, checkAndroidAppUpdate } = await loadModule()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => releasePayload() })
    const ok = await checkAndroidAppUpdate()
    expect(ok).toBe(true)
    expect(androidUpdateState.value.stage).toBe('available')
    expect(androidUpdateState.value.availableVersion).toBe('1.14.0')
    expect(androidUpdateState.value.apkName).toBe('sanliangshi-1.14.0.apk')
  })

  it('版本相同或更旧时判定为最新', async () => {
    const { androidUpdateState, checkAndroidAppUpdate } = await loadModule()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => releasePayload({ tag_name: 'v1.0.0' }) })
    await checkAndroidAppUpdate()
    expect(androidUpdateState.value.stage).toBe('latest')
    expect(androidUpdateState.value.availableVersion).toBe('')
  })

  it('请求失败时报错并给出可读文案', async () => {
    const { androidUpdateState, checkAndroidAppUpdate } = await loadModule()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const ok = await checkAndroidAppUpdate()
    expect(ok).toBe(false)
    expect(androidUpdateState.value.stage).toBe('error')
    expect(androidUpdateState.value.error?.message).toContain('无法连接更新服务')
  })

  it('静默检查失败时不弹错误状态', async () => {
    const { androidUpdateState, checkAndroidAppUpdate } = await loadModule()
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    const ok = await checkAndroidAppUpdate({ silent: true })
    expect(ok).toBe(false)
    expect(androidUpdateState.value.stage).toBe('idle')
    expect(androidUpdateState.value.error).toBeNull()
  })

  it('自动检查有节流，手动检查没有', async () => {
    const { androidUpdateState, checkAndroidAppUpdate } = await loadModule()
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => releasePayload() })
    globalThis.fetch = fetcher
    await checkAndroidAppUpdate({ silent: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
    // 紧接着再自动检查一次：不该再打一次更新服务。
    await checkAndroidAppUpdate({ silent: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
    // 手动检查永远可以问。
    await checkAndroidAppUpdate()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(androidUpdateState.value.availableVersion).toBe('1.14.0')
  })
})

describe('下载与安装', () => {
  it('下载走原生插件，进度事件会更新状态', async () => {
    const { androidUpdateState, checkAndroidAppUpdate, downloadAndroidAppUpdate } = await loadModule()
    let progress = null
    const plugin = installPlugin({
      addListener: vi.fn((_name, handler) => { progress = handler; return { remove: vi.fn() } }),
    })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => releasePayload() })
    await checkAndroidAppUpdate()
    const ok = await downloadAndroidAppUpdate()
    expect(ok).toBe(true)
    expect(plugin.download).toHaveBeenCalledWith({ url: APK_URL, fileName: 'sanliangshi-1.14.0.apk' })
    expect(androidUpdateState.value.stage).toBe('ready')
    progress?.({ received: 1024, total: 2048 })
    expect(androidUpdateState.value.percent).toBe(50)
  })

  it('没有原生插件时给出可操作的提示，而不是静默失败', async () => {
    const { androidUpdateState, checkAndroidAppUpdate, downloadAndroidAppUpdate } = await loadModule()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => releasePayload() })
    await checkAndroidAppUpdate()
    const ok = await downloadAndroidAppUpdate()
    expect(ok).toBe(false)
    expect(androidUpdateState.value.stage).toBe('error')
    expect(androidUpdateState.value.error?.message).toContain('缺少更新组件')
  })

  it('系统未授权"安装未知应用"时先带用户去设置', async () => {
    const { androidUpdateState, checkAndroidAppUpdate, downloadAndroidAppUpdate, installAndroidAppUpdate } = await loadModule()
    const plugin = installPlugin({ canInstallPackages: vi.fn().mockResolvedValue({ allowed: false }) })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => releasePayload() })
    await checkAndroidAppUpdate()
    await downloadAndroidAppUpdate()
    const ok = await installAndroidAppUpdate()
    expect(ok).toBe(false)
    expect(plugin.openInstallPermissionSettings).toHaveBeenCalled()
    expect(plugin.install).not.toHaveBeenCalled()
    expect(androidUpdateState.value.message).toContain('安装未知应用')
  })

  it('已授权时交给系统安装器', async () => {
    const { androidUpdateState, checkAndroidAppUpdate, downloadAndroidAppUpdate, installAndroidAppUpdate } = await loadModule()
    const plugin = installPlugin()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => releasePayload() })
    await checkAndroidAppUpdate()
    await downloadAndroidAppUpdate()
    const ok = await installAndroidAppUpdate()
    expect(ok).toBe(true)
    expect(plugin.install).toHaveBeenCalledWith({ fileName: 'sanliangshi-1.14.0.apk' })
    expect(androidUpdateState.value.stage).toBe('completed')
  })

  it('还没下载就点安装会被拦住', async () => {
    const { androidUpdateState, installAndroidAppUpdate } = await loadModule()
    installPlugin()
    const ok = await installAndroidAppUpdate()
    expect(ok).toBe(false)
    expect(androidUpdateState.value.stage).toBe('error')
  })
})

describe('非安卓环境', () => {
  it('网页里不提供这套能力', async () => {
    vi.resetModules()
    vi.stubEnv('MODE', 'web')
    const { androidUpdateState, checkAndroidAppUpdate, downloadAndroidAppUpdate } = await import('../src/composables/androidAppUpdate.js')
    expect(androidUpdateState.value.stage).toBe('unavailable')
    expect(await checkAndroidAppUpdate()).toBe(false)
    expect(await downloadAndroidAppUpdate()).toBe(false)
  })
})
