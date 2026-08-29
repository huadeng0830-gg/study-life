import pluginVue from 'eslint-plugin-vue'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'dev-dist/**'],
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
