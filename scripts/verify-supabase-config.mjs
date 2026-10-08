import { readPublicSupabaseConfig } from './supabase-build-checks.mjs'

try {
  readPublicSupabaseConfig(process.argv[2] || 'production')
  console.log('✓ Supabase 公开账号配置有效')
} catch (error) {
  console.error(`✗ ${error.message}`)
  process.exit(1)
}
