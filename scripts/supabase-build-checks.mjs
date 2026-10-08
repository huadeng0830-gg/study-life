import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { getSupabaseConfig } from '../src/services/supabase.js'

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))

export function readPublicSupabaseConfig(mode = 'production') {
  const loaded = loadEnv(mode, PROJECT_ROOT, 'VITE_SUPABASE_')
  const config = getSupabaseConfig({
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || loaded.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || loaded.VITE_SUPABASE_PUBLISHABLE_KEY,
  })
  if (!config) {
    throw new Error('缺少有效的 VITE_SUPABASE_URL 或 VITE_SUPABASE_PUBLISHABLE_KEY；本地请检查 .env.local，GitHub Actions 请设置同名 Actions Variables。')
  }
  return config
}

function collectJavaScriptFiles(directory) {
  if (!existsSync(directory)) throw new Error(`找不到构建目录：${directory}`)
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(file))
    else if (/\.(?:js|mjs)$/i.test(entry.name)) files.push(file)
  }
  return files
}

export function verifySupabaseBundle(directory, config) {
  const files = collectJavaScriptFiles(directory)
  if (files.length === 0) throw new Error('构建目录中没有 JavaScript 资源')
  const code = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  if (!code.includes(config.url) || !code.includes(config.key)) {
    throw new Error('构建产物未包含当前有效的 Supabase 项目地址和公开密钥；为防止发布出不可登录的版本，已阻止继续。')
  }
  return files.length
}
