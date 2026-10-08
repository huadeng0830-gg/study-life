import pluginVue from 'eslint-plugin-vue'

export default [
  {
    // 构建产物和历史产物不属于源代码检查范围；否则旧 bundle 会产生海量无关告警。
    // public/ocr 下是随包分发的第三方产物（tesseract 引擎与 worker，已压缩），
    // 不是本仓库源码：tesseract-core-*.wasm.js 内嵌了 base64 的 wasm，
    // 对它跑 no-var 之类的规则只会产出成百上千条与本项目无关的报错。
    ignores: [
      'dist/**',
      'dist-desktop/**',
      'release-desktop/**',
      'dist-bak/**',
      'node_modules/**',
      '.wrangler/**',
      'dev-dist/**',
      'public/ocr/**',
      // 与 .gitignore 保持一致：这两个产物目录本地存在时也不该被 lint。
      'coverage/**',
      '.playwright-cli/**',
    ],
  },
  ...pluginVue.configs['flat/essential'],
  {
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        indexedDB: 'readonly',
        navigator: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        getComputedStyle: 'readonly',
        CompressionStream: 'readonly',
        DecompressionStream: 'readonly',
        createImageBitmap: 'readonly',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      // 基础健壮性规则：禁止 var、禁止抛非 Error 值、禁止无意义的 catch 再抛。
      'no-var': 'error',
      'no-throw-literal': 'error',
      'no-useless-catch': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'properties'],
    },
  },
]
