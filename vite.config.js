import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  build: {
    target: 'es2019',
    cssTarget: 'safari13',
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vue-vendor', test: /[\\/]node_modules[\\/](@vue|vue|vue-router)[\\/]/ },
          ],
        },
      },
    },
  },
  plugins: [
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
          'assets/index-*.{js,css}',
          'assets/vue-vendor-*.js',
          'assets/App-*.{js,css}',
          'assets/appearance-*.js',
          'assets/appUpdate-*.js',
          // 侧栏两个常用工具离线可用，首次打开不再等待网络。
          'assets/AppearanceSettings-*.{js,css}',
          'assets/DataManager-*.{js,css}',
          // 普通页面全部预缓存，首次点击课程/待办等页面不再等待网络。
          'assets/*View-*.{js,css}',
          'assets/Modal-*.{js,css}',
          'assets/VirtualList-*.{js,css}',
          'assets/SwipeActionItem-*.{js,css}',
          'assets/UpdateNotes-*.{js,css}',
          'assets/hero-*.png',
          'assets/_plugin-vue_export-helper-*.js',
        ],
        // 二维码编解码依赖体积大，继续在用户打开迁移功能时按需下载。
        globIgnores: ['assets/LocalTransfer-*'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
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
