import vue from '@vitejs/plugin-vue'
import { createHash } from 'node:crypto'
import { env } from 'node:process'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { RELEASE_NOTES, RELEASE_SOURCE_SIGNATURE, RELEASE_VERSION } from './release.config.js'
import { computeSourceSignature } from './scripts/source-signature.mjs'

// 相同源码永远得到相同版本；任何 Agent 修改发布源码后都会自动得到新版本。
// 签名计算集中在 scripts/source-signature.mjs，与 scripts/bump-release.mjs 共用，
// 保证 build 校验和“更新签名/说明”脚本看到的是同一套逻辑。
const sourceSignature = computeSourceSignature()
// 开发与测试期间允许逐步修改；正式 build 必须通过说明一致性检查。
if (env.NODE_ENV === 'production' && RELEASE_SOURCE_SIGNATURE !== sourceSignature) {
  throw new Error(
    `发布源码已经变化，但更新说明尚未同步。请先修改 release.config.js 中的 RELEASE_NOTES，` +
    `确认内容与本次修改一致后，将 RELEASE_SOURCE_SIGNATURE 更新为 '${sourceSignature}'。`
  )
}
const notesSignature = createHash('sha256').update(JSON.stringify(RELEASE_NOTES)).digest('hex').slice(0, 4)
const appRelease = env.VITE_APP_RELEASE?.trim() || RELEASE_VERSION

// https://vite.dev/config/
export default defineConfig({
  define: {
    'globalThis.__STUDY_LIFE_RELEASE__': JSON.stringify(appRelease),
  },
  build: {
    target: 'es2019',
    cssTarget: 'safari13',
      rollupOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vue-vendor', test: /[\\/]node_modules[\\/](@vue|vue|vue-router)[\\/]/ },
              { name: 'ocr-vendor', test: /[\\/]node_modules[\\/]tesseract\.js[\\/]/ },
              { name: 'transfer-vendor', test: /[\\/]node_modules[\\/](qrcode|jsqr)[\\/]/ },
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
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      // 图标只在安装 PWA 时读取，不占用页面切换缓存带宽。
      includeManifestIcons: false,
      includeAssets: ['favicon-v2.png', 'apple-touch-icon-v2.png'],
      manifest: {
        id: '/',
        name: '学习生活台',
        short_name: '学习生活',
        description: '个人的学习生活管理平台：课程表、待办、倒计时、清单、账单',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#4f7cff',
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
        // 体积大或极少用到的模块保持按需下载（首次访问由运行时缓存接管），
        // 避免拖慢首次安装体积与流量。课程表弹窗已按需加载，同样不预缓存。
        globIgnores: [
          'assets/LocalTransfer-*',
          'assets/transfer-vendor-*',
          'assets/ocr-vendor-*',
          'assets/TimeSettingsModal-*',
          'assets/CourseEditorModal-*',
          'assets/CourseManagerModal-*',
          'assets/BatchImportModal-*',
          'assets/ImportConflictModal-*',
          'assets/ExceptionsModal-*',
          'assets/SemesterModal-*',
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        // 旧懒加载资源保留一个发布周期，用户点击旧页面链接时仍有机会离线回退。
        cleanupOutdatedCaches: false,
        runtimeCaching: [
          {
            urlPattern: /\/ocr\/.*\.traineddata$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'study-life-ocr-language-v1',
              expiration: { maxEntries: 2, maxAgeSeconds: 365 * 24 * 60 * 60 },
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
    }),
  ],
})
