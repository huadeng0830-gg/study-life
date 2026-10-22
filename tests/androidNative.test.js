// @vitest-environment node
/**
 * 安卓安装版的原生层守卫。
 *
 * 【为什么原生层要单独守】网页层的样式与逻辑有大量测试盯着，
 * 但 android/ 目录里的东西（清单、主题、图标、FileProvider 路径）**一次都没被测过**。
 * 后果是这个仓库里真实发生过、并且已经修好的安卓缺陷：
 *   - 没有 values/colors.xml → @color/colorPrimary 落到 Capacitor 库自带的
 *     #3F51B5，启动画面是 Material 默认的靛蓝，与应用自己的蓝色完全不是一回事；
 *   - 桌面图标的前景是整张 512px 图直接塞进 108dp 画布 → 启动器只截中间 2/3，
 *     桌面上的图标是被放大裁掉一圈的便签，与网页图标对不上；
 *   - FileProvider 只声明了 cache-path → <input type="file" capture> 拍照写文件时
 *     拿不到授权，「拍照设置壁纸」在安卓上必然失败；
 *   - 清单里没有 windowSoftInputMode → 键盘弹出时的行为由系统随意决定。
 *
 * 这些都是"编译能过、装到手机上才发现"的坑，所以这里逐条钉住。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const resDir = join(root, 'android', 'app', 'src', 'main', 'res')
const readRes = (relative) => readFileSync(join(resDir, relative), 'utf8')

/** 去掉 XML 注释，避免注释里的字样被当成真实配置。 */
const stripXmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, '')

/** 读取 PNG 的宽高（IHDR 固定在文件头第 16–24 字节）。 */
function pngSize(file) {
  const buffer = readFileSync(file)
  if (buffer.length < 24) return null
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

describe('Capacitor 配置', () => {
  const config = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8'))

  it('WebView 底色与应用页面底色一致（避免启动时闪一下黑/白）', () => {
    // style.css 的 --bg 就是页面底色；原生窗口底色不一致时，
    // WebView 画出第一帧之前屏幕上会先出现系统默认色。
    const styleCss = readFileSync(join(root, 'src', 'style.css'), 'utf8')
    const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(styleCss)?.[1]
    expect(bg, '读不到 style.css 的 --bg').toBeTruthy()
    expect(config.android?.backgroundColor?.toLowerCase()).toBe(bg.toLowerCase())
  })

  it('声明 viewport-fit=cover 的初始值，避免首屏布局跳动', () => {
    // Capacitor 的 SystemBars 插件靠这个提示决定 insets 要不要"穿透"给 WebView。
    // 不给的话它会先按"不穿透"给窗口加内边距，等页面提交后再改回来 —— 整个界面会跳一下。
    expect(config.plugins?.SystemBars?.initialViewportFitValueHint).toBe('cover')
  })

  it('状态栏图标默认按浅色底处理（应用默认主题是浅色）', () => {
    expect(config.plugins?.SystemBars?.style).toBe('LIGHT')
  })

  it('仍然禁用明文流量、混合内容与发布版 WebView 调试', () => {
    expect(config.android?.allowMixedContent).toBe(false)
    expect(config.android?.webContentsDebuggingEnabled).toBe(false)
  })
})

describe('AndroidManifest', () => {
  const manifest = stripXmlComments(readFileSync(join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8'))

  it('窗口声明 adjustResize，键盘不会盖住输入框', () => {
    expect(manifest).toMatch(/android:windowSoftInputMode="adjustResize"/)
  })

  it('显式开启预测式返回（targetSdk 36 起 onBackPressed 不再被调用）', () => {
    expect(manifest).toMatch(/android:enableOnBackInvokedCallback="true"/)
  })

  it('声明震动权限，否则专注结束的震动反馈被系统丢弃', () => {
    expect(manifest).toMatch(/android:name="android\.permission\.VIBRATE"/)
  })

  it('声明安装未知应用的权限，否则应用内更新装不上', () => {
    expect(manifest).toMatch(/android:name="android\.permission\.REQUEST_INSTALL_PACKAGES"/)
  })

  it('继续禁用系统备份与明文流量', () => {
    expect(manifest).toMatch(/android:allowBackup="false"/)
    expect(manifest).toMatch(/android:usesCleartextTraffic="false"/)
  })
})

describe('安卓主题与品牌色', () => {
  const styles = stripXmlComments(readRes('values/styles.xml'))
  const colors = stripXmlComments(readRes('values/colors.xml'))

  it('colorPrimary 与 style.css 的 --primary 同值', () => {
    // 两边不同值 = 启动画面与应用内主色对不上。
    const styleCss = readFileSync(join(root, 'src', 'style.css'), 'utf8')
    const primary = /--primary:\s*(#[0-9a-f]{6})/i.exec(styleCss)?.[1]
    const declared = /name="colorPrimary">\s*(#[0-9a-f]{6})/i.exec(colors)?.[1]
    expect(primary, '读不到 style.css 的 --primary').toBeTruthy()
    expect(declared, 'values/colors.xml 里没有 colorPrimary').toBeTruthy()
    expect(declared.toLowerCase()).toBe(primary.toLowerCase())
  })

  it('窗口底色有值，不会先闪一下系统默认色', () => {
    expect(styles).toMatch(/<item name="android:windowBackground">@color\/appBackground<\/item>/)
  })

  it('启动画面用自适应图标，并且底色不是 Material 默认靛蓝', () => {
    expect(styles).toMatch(/<item name="windowSplashScreenAnimatedIcon">@mipmap\/ic_launcher<\/item>/)
    expect(styles).toMatch(/<item name="windowSplashScreenBackground">@color\/splashBackground<\/item>/)
    // @color/colorPrimary 会落到 @capacitor/android 库自带的 #3F51B5，必须避开。
    expect(styles).not.toMatch(/windowSplashScreenBackground">@color\/colorPrimary</)
  })
})

describe('安卓图标', () => {
  it('没有遗留的旧版 splash 位图（Capacitor 3 之前的资源）', () => {
    const leftovers = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name === 'splash.png') leftovers.push(full)
      }
    }
    walk(resDir)
    expect(leftovers, '这些 splash.png 从来没有被引用，只是白白占安装包体积').toEqual([])
  })

  it('每个密度都有正确尺寸的传统图标', () => {
    // 传统图标的边长 = 48dp × 密度倍率。
    const expected = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
    for (const [density, size] of Object.entries(expected)) {
      const file = join(resDir, `mipmap-${density}`, 'ic_launcher.png')
      expect(existsSync(file), `缺少 ${file}`).toBe(true)
      expect(pngSize(file), `${file} 的尺寸不对`).toEqual({ width: size, height: size })
    }
  })

  it('自适应图标的前景是 108dp 画布里居中的 72dp 图案', () => {
    // 前景层画布 = 108dp × 密度；图案 = 72dp（系统真正显示的安全区）。
    // 曾经把整张 512px 图当成 108dp 铺满 → 启动器只截中间 2/3，桌面图标是"放大的便签"。
    const expected = { mdpi: [108, 72], hdpi: [162, 108], xhdpi: [216, 144], xxhdpi: [324, 216], xxxhdpi: [432, 288] }
    for (const [density, [canvas, art]] of Object.entries(expected)) {
      const file = join(resDir, `mipmap-${density}`, 'ic_launcher_foreground.png')
      expect(existsSync(file), `缺少 ${file}`).toBe(true)
      expect(pngSize(file), `${file} 的画布尺寸不对`).toEqual({ width: canvas, height: canvas })
      expect(art).toBeLessThan(canvas)
    }
  })
})

describe('FileProvider 的路径', () => {
  const paths = stripXmlComments(readRes('xml/file_paths.xml'))

  it('导出的分享目录仍然只暴露私有缓存', () => {
    expect(paths).toMatch(/<cache-path name="exports" path="exports\/" \/>/)
  })

  it('声明相机目录，否则拍照取壁纸在安卓上必然失败', () => {
    // Capacitor 的 <input type="file" capture> 把照片写到
    // getExternalFilesDir(DIRECTORY_PICTURES)，再交给相机应用；少这条路径，
    // FileProvider.getUriForFile 找不到匹配的根会抛异常并被吞掉，相机拍完什么都没有。
    expect(paths).toMatch(/<external-files-path name="camera" path="Pictures\/" \/>/)
  })

  it('声明安装包下载目录，否则系统安装器打不开下载好的 APK', () => {
    expect(paths).toMatch(/<cache-path name="updates" path="updates\/" \/>/)
  })
})

describe('应用内更新的原生插件', () => {
  const javaDir = join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'sanliangshi', 'study', 'life')
  const pluginPath = join(javaDir, 'ApkUpdatePlugin.java')
  const activityPath = join(javaDir, 'MainActivity.java')

  it('插件文件在位，并且用 @CapacitorPlugin 声明了名字', () => {
    expect(existsSync(pluginPath), '缺少 ApkUpdatePlugin.java').toBe(true)
    const source = readFileSync(pluginPath, 'utf8')
    expect(source).toMatch(/@CapacitorPlugin\(name = "ApkUpdate"\)/)
  })

  it('MainActivity 在 super.onCreate 之前登记插件', () => {
    // BridgeActivity 的 onCreate 末尾就创建 Bridge 并加载插件，
    // 那之后再登记就来不及了 —— 插件会静默缺失。
    const source = readFileSync(activityPath, 'utf8')
    expect(source).toMatch(/registerPlugin\(ApkUpdatePlugin\.class\)/)
    const registerAt = source.indexOf('registerPlugin(ApkUpdatePlugin.class)')
    const superAt = source.indexOf('super.onCreate(savedInstanceState)')
    expect(registerAt).toBeGreaterThan(-1)
    expect(superAt).toBeGreaterThan(-1)
    expect(registerAt).toBeLessThan(superAt)
  })

  it('只接受 https 的 GitHub 下载地址', () => {
    const source = readFileSync(pluginPath, 'utf8')
    expect(source).toMatch(/isTrustedDownloadUrl/)
    expect(source).toMatch(/https/)
    expect(source).toMatch(/github\.com/)
  })

  it('下载产物写在私有缓存里，不落到可被外部读取的位置', () => {
    const source = readFileSync(pluginPath, 'utf8')
    expect(source).toMatch(/getCacheDir\(\)/)
    expect(source).toMatch(/UPDATE_DIR = "updates"/)
  })
})

describe('安全区变量', () => {
  const srcDir = join(root, 'src')
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.(vue|css|js|ts)$/.test(full)) out.push(full)
    }
    return out
  }

  it('--safe-* 四个变量都有定义', () => {
    const safeAreaCss = readFileSync(join(srcDir, 'styles', 'safe-area.css'), 'utf8')
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(safeAreaCss, `缺少 --safe-${side}`).toMatch(new RegExp(`--safe-${side}\\s*:`))
    }
  })

  it('全仓不再直接写 env(safe-area-inset-*)', () => {
    // 安卓的安全区是原生层注入的 CSS 变量（--safe-area-inset-*），
    // env() 在很多安卓内核上恒为 0；iOS 那边才认 env()。
    // 两路都在 styles/safe-area.css 里合并成 --safe-*，其余地方只准用它。
    // 【先剥注释】本仓规矩：凡是要 parse 的东西先剥注释 —— 注释里提到
    // env(safe-area-inset-*) 是解释，不是用法。
    const stripComments = (text) => text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const offenders = []
    for (const file of walk(srcDir)) {
      if (file.endsWith(join('styles', 'safe-area.css'))) continue
      const text = stripComments(readFileSync(file, 'utf8'))
      if (/env\(safe-area-inset-/.test(text)) offenders.push(file.replace(srcDir + '\\', ''))
    }
    expect(offenders, '这些地方还在直接读 env(safe-area-inset-*)').toEqual([])
  })

  it('原生注入的变量名在运行时来源里有登记', () => {
    // --safe-area-inset-* 由原生运行时注入，不是 CSS 声明的令牌；
    // 必须有一份名单说明它们从哪来，否则就成了"读了却没人定义"的幽灵变量。
    const runtime = readFileSync(join(srcDir, 'composables', 'androidRuntime.js'), 'utf8')
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(runtime, `原生变量名单里缺少 --safe-area-inset-${side}`).toContain(`'--safe-area-inset-${side}'`)
    }
  })
})

describe('安卓运行时', () => {
  const runtime = readFileSync(join(root, 'src', 'composables', 'androidRuntime.js'), 'utf8')

  it('返回键在最外层要按两次才退出', () => {
    // 一按就退出会让误触返回键的用户丢掉当前页面与滚动位置；
    // 安卓自己的惯例是"再按一次退出"。
    expect(runtime).toMatch(/EXIT_CONFIRM_WINDOW_MS/)
    expect(runtime).toMatch(/ANDROID_EXIT_HINT/)
  })

  it('导出结果会回传给调用方（分享面板被取消时不能算"已备份"）', () => {
    expect(runtime).toMatch(/ANDROID_EXPORT_EVENT/)
    expect(runtime).toMatch(/export function expectAndroidExport/)
  })

  it('系统状态栏跟随应用主题，而不是跟随系统深浅', () => {
    expect(runtime).toMatch(/SystemBars/)
    expect(runtime).toMatch(/data-theme/)
  })
})
