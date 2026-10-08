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

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.map', '.txt', '.json', '.xml', '.svg', '.webmanifest'])

function collectBundleFiles(directory) {
  if (!existsSync(directory)) throw new Error(`找不到构建目录：${directory}`)
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectBundleFiles(file))
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(file)
  }
  return files
}

function serviceRoleJwtIn(text) {
  for (const token of text.matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g)) {
    try {
      const payload = JSON.parse(Buffer.from(token[0].split('.')[1], 'base64url').toString('utf8'))
      if (payload.role === 'service_role') return true
    } catch { /* Ignore JWT-shaped non-credentials. */ }
  }
  return false
}

function findBundledSecret(text) {
  const checks = [
    ['Supabase service-role key name', /\b(?:VITE_)?SUPABASE_SERVICE_ROLE_KEY\b/i],
    ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{12,}\b/i],
    ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
    ['database connection string', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`]{8,}/i],
    ['API credential', /\b(?:sk_live_|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/i],
  ]
  for (const [label, pattern] of checks) if (pattern.test(text)) return label
  if (serviceRoleJwtIn(text)) return 'service-role JWT'
  return ''
}

export function verifySupabaseBundle(directory, config) {
  const files = collectBundleFiles(directory)
  const javaScriptFiles = files.filter((file) => /\.(?:js|mjs|cjs)$/i.test(file))
  if (javaScriptFiles.length === 0) throw new Error('构建目录中没有 JavaScript 资源')
  const code = javaScriptFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
  if (!code.includes(config.url) || !code.includes(config.key)) {
    throw new Error('构建产物未包含当前有效的 Supabase 项目地址和公开密钥；为防止发布出不可登录的版本，已阻止继续。')
  }
  for (const file of files) {
    const contents = readFileSync(file)
    if (contents.includes(0)) continue
    const secret = findBundledSecret(contents.toString('utf8'))
    if (secret) throw new Error(`构建产物检测到${secret}：${path.relative(directory, file)}`)
  }
  return javaScriptFiles.length
}
