import path from 'node:path'
import { PROJECT_ROOT, readPublicSupabaseConfig, verifySupabaseBundle } from './supabase-build-checks.mjs'

const directory = path.resolve(PROJECT_ROOT, process.argv[2] || 'dist')
const mode = process.argv[3] || 'production'

try {
  const count = verifySupabaseBundle(directory, readPublicSupabaseConfig(mode))
  console.log(`✓ 已检查 ${count} 个 JavaScript 资源，账号配置已正确打入构建产物`)
} catch (error) {
  console.error(`✗ Supabase 构建产物校验失败：${error.message}`)
  process.exit(1)
}
