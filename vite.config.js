import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { env } from 'node:process'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import { getSupabaseConfig } from './src/services/supabase.js'
import { fileURLToPath } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'
import { APP_VERSION, LEGACY_RELEASE_VERSION, RELEASE_CHANNEL, RELEASE_NOTES, RELEASE_SOURCE_SIGNATURE, RELEASE_UPDATES } from './release.config.js'
import { ACCOUNT_SYNC_DATA_SCHEMA_VERSION } from './src/composables/accountSyncSchema.js'
import { DOMAIN_SCHEMA_VERSION } from './src/composables/domain/migrations.js'
import { createReleaseManifest } from './scripts/release-manifest.mjs'
import { computeSourceSignature } from './scripts/source-signature.mjs'

// 相同源码永远得到相同版本；任何 Agent 修改发布源码后都会自动得到新版本。
// 签名计算集中在 scripts/source-signature.mjs，与 scripts/bump-release.mjs 共用，
// 保证 build 校验和“更新签名/说明”脚本看到的是同一套逻辑。
const sourceSignature = computeSourceSignature()
const rootPackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const desktopPackage = JSON.parse(readFileSync(new URL('./desktop-app/package.json', import.meta.url), 'utf8'))
if (rootPackage.version !== APP_VERSION || desktopPackage.version !== APP_VERSION) {
  throw new Error(`正式版本来源不一致：release.config.js=${APP_VERSION}，package.json=${rootPackage.version}，desktop-app=${desktopPackage.version}。请运行 npm run release:bump。`)
}
// 发布闸门只对**正式发布构建**生效：Cloudflare Pages 的 `npm run build`、
// `npm run check:release` 与打包桌面版。日常开发与 `npm run check` 走
// scripts/build-check.mjs，它把 STUDY_LIFE_RELEASE_GATE 设为 0。
//
// 为什么必须分开：NODE_ENV 在 Vite 载入本配置之前就已被置为 production，
// 于是原先把闸门挂在 NODE_ENV 上等于「改一行 src 就必须先发一个版本」，
// `npm run check` 与 CI 质量门禁都会因此变红，只发 Web 也被迫改动 Windows 版本号。
// 发版一致性仍由 `npm run check:release` 与发布流程把关。
const releaseGateEnabled = env.STUDY_LIFE_RELEASE_GATE !== '0'
const releaseSourceSynced = RELEASE_SOURCE_SIGNATURE === sourceSignature
if (env.NODE_ENV === 'production' && releaseGateEnabled && !releaseSourceSynced) {
  throw new Error(
    `发布源码已经变化，但更新说明尚未同步。请运行 npm run release:bump -- --notes "说明一|说明二"，` +
    `再确认 README 中的版本和最近更新内容与本次改动一致。当前源码签名为 '${sourceSignature}'。`
  )
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const desktopBuild = mode === 'desktop'
  const androidBuild = mode === 'android'
  const nativeBuild = desktopBuild || androidBuild
  // 测试环境同样没有 `virtual:pwa-register` 的注入实现，而应用壳会静态导入它。
  // 别名到替身，免得每个挂载真实应用的用例都要自己 mock（见 tests/helpers/pwaRegisterStub.js）。
  const testBuild = env.VITEST === 'true' || mode === 'test'
  const accountEnv = loadEnv(mode, '.', ['VITE_SUPABASE_'])
  if ((accountEnv.VITE_SUPABASE_URL || accountEnv.VITE_SUPABASE_PUBLISHABLE_KEY) && !getSupabaseConfig(accountEnv)) {
    throw new Error('Supabase 账号配置不完整或密钥不安全：请使用有效项目 URL 与 publishable / anon key，禁止使用 secret / service_role key。')
  }
  // 版本号只能来自 release.config.js。环境变量覆盖会让界面、清单和桌面包分叉。
  const appRelease = APP_VERSION
  let commitId = env.CF_PAGES_COMMIT_SHA || env.GITHUB_SHA || ''
  if (!commitId) {
    try { commitId = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
    catch { commitId = 'unknown' }
  }
  commitId = /^[a-f0-9]{7,40}$/i.test(commitId) ? commitId.toLowerCase() : 'unknown'
  const deploymentUrl = env.CF_PAGES_URL
  const deploymentId = deploymentUrl ? (() => {
    try { return new URL(deploymentUrl).hostname.toLowerCase() } catch { return '' }
  })() : ''
  const buildId = deploymentId || (env.GITHUB_RUN_ID
    ? `gh-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}`
    : `${commitId.slice(0, 12)}-${sourceSignature}`)
  // releaseVerified=false 表示这次构建的源码与 release.config.js 的说明/版本尚未同步，
  // 只可能出现在本地非发布构建里；正式发布构建为 true。
  const buildInfo = Object.freeze({ buildId, commitId, sourceSignature, releaseVerified: releaseSourceSynced,
    schemaVersion: ACCOUNT_SYNC_DATA_SCHEMA_VERSION, domainSchemaVersion: DOMAIN_SCHEMA_VERSION })
  const releaseHistory = JSON.parse(readFileSync(new URL('./release-history.json', import.meta.url), 'utf8'))
  const releaseManifest = createReleaseManifest({ appVersion: APP_VERSION, legacyVersion: LEGACY_RELEASE_VERSION,
    channel: RELEASE_CHANNEL, release: RELEASE_UPDATES[0], releaseNotes: RELEASE_NOTES, releaseHistory,
    buildInfo, schemaVersion: ACCOUNT_SYNC_DATA_SCHEMA_VERSION,
    compatibility: { accountSyncSchemaVersion: ACCOUNT_SYNC_DATA_SCHEMA_VERSION, domainSchemaVersion: DOMAIN_SCHEMA_VERSION },
    releaseUrl: 'https://github.com/huadeng0830-gg/study-life/releases' })
  return {
  base: desktopBuild ? './' : '/',
  server: {
    // 浏览器回归测试的临时配置和数据库会被独占，开发服务器无需监视它们。
    watch: { ignored: ['**/.vitest-tmp/**', '**/.playwright-cli/**', '**/.tmp/**', '**/.tools/**', '**/android/**', '**/release-android/**'] },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      ...(nativeBuild ? {
        'virtual:pwa-register': fileURLToPath(new URL('./desktop/pwa-register-shim.js', import.meta.url)),
      } : testBuild ? {
        'virtual:pwa-register': fileURLToPath(new URL('./tests/helpers/pwaRegisterStub.js', import.meta.url)),
      } : {}),
    },
  },
  define: {
    'globalThis.__STUDY_LIFE_RELEASE__': JSON.stringify(appRelease),
    'globalThis.__STUDY_LIFE_BUILD_INFO__': JSON.stringify(buildInfo),
  },
  build: {
    outDir: desktopBuild ? 'dist-desktop' : androidBuild ? 'dist-android' : 'dist',
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
              // Merge only the static entry graph, preserving lazy routes and
              // heavy optional libraries. This avoids many tiny startup fetches.
              { name: 'startup-core', test: /[\\/]src[\\/]/, tags: ['$initial'] },
              // Preserve entry-specific code while merging neighboring tiny
              // shared state modules; avoid pulling entire feature views forward.
              { name: 'workspace-shared', test: /[\\/]src[\\/]composables[\\/]/, minShareCount: 2, entriesAware: true, entriesAwareMergeThreshold: 12000 },
            ],
        },
      },
    },
  },
  plugins: [
    {
      // 输出纯文本版本号，供应用更新检查与服务器版本比对（绕过一切缓存）。
      name: 'emit-release-version',
      transformIndexHtml() {
        return [
          { tag: 'meta', attrs: { name: 'study-life-release', content: LEGACY_RELEASE_VERSION }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'study-life-app-version', content: appRelease }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'study-life-build-id', content: buildInfo.buildId }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'study-life-commit-id', content: buildInfo.commitId }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'study-life-source-signature', content: sourceSignature }, injectTo: 'head' },
        ]
      },
      generateBundle() {
        // Keep the old date-like endpoint until deployed Web/PWA clients have migrated.
        this.emitFile({ type: 'asset', fileName: 'version.txt', source: LEGACY_RELEASE_VERSION })
        this.emitFile({ type: 'asset', fileName: 'release.json', source: `${JSON.stringify(releaseManifest, null, 2)}\n` })
        this.emitFile({ type: 'asset', fileName: 'release-history.json', source: `${JSON.stringify(releaseHistory, null, 2)}\n` })
      },
    },
    vue(),
    tailwindcss(),
    ...(nativeBuild ? [] : [VitePWA({
      registerType: 'prompt',
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
        skipWaiting: false,
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
            // Content-hashed assets never change at the same URL. A cache hit
            // needs no background revalidation or extra Cloudflare request.
            handler: 'CacheFirst',
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
