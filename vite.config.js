import vue from '@vitejs/plugin-vue'
import { env } from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import { getSupabaseConfig } from './src/services/supabase.js'
import { fileURLToPath } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'
import { RELEASE_SOURCE_SIGNATURE, RELEASE_VERSION } from './release.config.js'
import { computeSourceSignature } from './scripts/source-signature.mjs'

// 相同源码永远得到相同版本；任何 Agent 修改发布源码后都会自动得到新版本。
// 签名计算集中在 scripts/source-signature.mjs，与 scripts/bump-release.mjs 共用，
// 保证 build 校验和“更新签名/说明”脚本看到的是同一套逻辑。
const sourceSignature = computeSourceSignature()
// 开发与测试期间允许逐步修改；正式 build 必须通过说明一致性检查。
if (env.NODE_ENV === 'production' && RELEASE_SOURCE_SIGNATURE !== sourceSignature) {
  throw new Error(
    `发布源码已经变化，但更新说明尚未同步。请运行 npm run release:bump -- --notes "说明一|说明二"，` +
    `再确认 README 中的版本和最近更新内容与本次改动一致。当前源码签名为 '${sourceSignature}'。`
  )
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const desktopBuild = mode === 'desktop'
  const accountEnv = loadEnv(mode, '.', 'VITE_SUPABASE_')
  if ((accountEnv.VITE_SUPABASE_URL || accountEnv.VITE_SUPABASE_PUBLISHABLE_KEY) && !getSupabaseConfig(accountEnv)) {
    throw new Error('Supabase 账号配置不完整或密钥不安全：请使用有效项目 URL 与 publishable / anon key，禁止使用 secret / service_role key。')
  }
  // 【必须走 loadEnv，不能读 process.env】
  // 原来这里用的是 `env.VITE_APP_RELEASE`（node:process.env）。于是同一条配置里
  // VITE_SUPABASE_* 被 loadEnv 正常读到、VITE_APP_RELEASE 却被静默忽略 ——
  // 在 .env.local 里改版本号不会有任何报错，只会让 version.txt 仍然是
  // RELEASE_VERSION，客户端一比对就永远显示「已是最新版本」，
  // 也就是**这个开关根本没法用来救急**。下面第 26 行才是对的写法。
  const appRelease = accountEnv.VITE_APP_RELEASE?.trim() || RELEASE_VERSION
  return {
  base: desktopBuild ? './' : '/',
  server: {
    // 浏览器回归测试的临时配置和数据库会被独占，开发服务器无需监视它们。
    watch: { ignored: ['**/.vitest-tmp/**', '**/.playwright-cli/**'] },
  },
  resolve: desktopBuild ? {
    alias: {
      'virtual:pwa-register': fileURLToPath(new URL('./desktop/pwa-register-shim.js', import.meta.url)),
    },
  } : undefined,
  define: {
    'globalThis.__STUDY_LIFE_RELEASE__': JSON.stringify(appRelease),
  },
  build: {
    outDir: desktopBuild ? 'dist-desktop' : 'dist',
    target: 'es2019',
    cssTarget: 'safari13',
      rollupOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vue-vendor', test: /[\\/]node_modules[\\/](@vue|vue|vue-router)[\\/]/ },
              // The account SDK is dynamically imported on demand; keep it out of the app shell cache.
              { name: 'supabase-vendor', test: /[\\/]node_modules[\\/](@supabase)[\\/]/ },
              { name: 'ocr-vendor', test: /[\\/]node_modules[\\/]tesseract\.js[\\/]/ },
            ],
        },
      },
    },
  },
  plugins: [
    {
      // 输出纯文本版本号，供应用更新检查与服务器版本比对（绕过一切缓存）。
      name: 'emit-release-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.txt', source: appRelease })
      },
    },
    vue(),
    ...(desktopBuild ? [] : [VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      // 图标只在安装 PWA 时读取，不占用页面切换缓存带宽。
      includeManifestIcons: false,
      includeAssets: ['favicon-v2.png', 'apple-touch-icon-v2.png'],
      manifest: {
        id: '/',
        name: '三两事',
        short_name: '三两事',
        description: '把课程、待办、重要日期、生活记录与账目放在一起的个人工作台。',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#456fe8',
        background_color: '#f4f6fa',
        icons: [
          {
            src: 'pwa-v2-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'pwa-v2-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'favicon-v2.png',
          'apple-touch-icon-v2.png',
          // 预缓存全部页面与共享代码：安装后点击任意入口都直接进入，不再现场下载。
          'assets/*.{js,css}',
        ],
        // 预缓存全部应用分包，只保留体积大、且仅特定功能才用到的供应商库按需加载：
        // Excel 解析（课程表导入）、OCR 引擎（图片识课）和账号 SDK 按需加载。
        // 其余分包（数据管理、同步绑定、课程弹窗等）全部预缓存，
        // 避免发版后这些懒加载入口因分包 hash 变更而打不开（PWA 缓存错位）。
        //
        // Supabase client 与 OCR 引擎只在用户触发相应功能后下载。
        globIgnores: [
          'assets/xlsx-*',
          'assets/ocr-vendor-*',
          'assets/supabase-vendor-*',
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/desktop-auth-return(?:\/|$)/],
        skipWaiting: true,
        clientsClaim: true,
        // Remove old Workbox cache buckets so obsolete release chunks do not accumulate.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 语言模型、SIMD 引擎与 worker 都在 public/ocr 下，同属"首次识课后长期复用"。
            // 原先只匹配 .traineddata，于是自托管的引擎与 worker 不走缓存，
            // 每个会话都要重下 3.8MB。maxEntries 从 2 提到 4 以覆盖这 3 个文件
            // （tesseract.js-core 的其他变体不会用到，不预留位置）。
            urlPattern: /\/ocr\/.*\.(?:traineddata|wasm\.js|js)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'study-life-ocr-language-v1',
              expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /\/assets\/.*\.(?:js|css|png|svg)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'study-life-lazy-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    })]),
  ],
  // 测试配置放在 vite.config.js 里，而不是另建 vitest.config.js：
  // 用例中有 `vi.mock('virtual:pwa-register', ...)`，依赖 VitePWA 插件注册该虚拟模块。
  // 一旦单独建 vitest.config.js，vite.config.js 会被整体忽略，虚拟模块随即解析失败。
  test: {
    // 这里刻意**不**设置 environment：140 个用例文件各自用 `// @vitest-environment`
    // 注释声明环境，其余 37 个纯逻辑用例依赖 vitest 默认的 node 环境。
    // 统一改成 happy-dom 会让 happy-dom 的 URL 接管 `new URL(相对, 基础)`，
    // 把基准从 file:// 换成文档地址，导致读文件的用例报 "The URL must be of scheme file"。
    setupFiles: ['./tests/helpers/webStorage.js'],
  },
  }
})
