import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { readPublicSupabaseConfig } from './supabase-build-checks.mjs'

// Uses the Storage API, never mutates storage.objects or deletes user files.
// Admin keys stay in process memory and are never printed or written to disk.
async function main() {
  const config = readPublicSupabaseConfig('production')
  let adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''
  if (!adminKey && process.env.SUPABASE_CLI) {
    const projectRef = new URL(config.url).hostname.split('.')[0]
    if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('请使用托管 Supabase 项目地址。')
    let parsed
    try {
      const output = execFileSync(process.env.SUPABASE_CLI, ['projects', 'api-keys', '--project-ref', projectRef, '--output', 'json', '--reveal'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: 'true', DO_NOT_TRACK: '1' },
      })
      parsed = JSON.parse(output)
    } catch { throw new Error('无法读取管理员密钥，请先完成 Supabase CLI 登录或设置服务端环境变量。') }
    const keys = Array.isArray(parsed) ? parsed : parsed.keys || parsed.data || parsed.result?.keys || parsed.result
    adminKey = Array.isArray(keys) ? keys.find(item => item.name === 'service_role')?.api_key || '' : ''
  }
  if (!adminKey) throw new Error('需要服务端 SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY 或已登录的 SUPABASE_CLI 路径；禁止使用 VITE_ 变量保存管理员密钥。')
  const client = createClient(config.url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const bucketId = 'qixing-deliverables'
  const before = await client.storage.getBucket(bucketId)
  if (before.error || !before.data) throw new Error('无法读取项目附件存储配置。')
  if (before.data.public) throw new Error('附件 bucket 必须保持私有；请先核查当前配置。')
  if (process.argv.includes('--apply')) {
    const result = await client.storage.updateBucket(bucketId, {
      public: false, fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: before.data.allowed_mime_types,
    })
    if (result.error) throw new Error('服务器未接受文件大小限制。')
    const after = await client.storage.getBucket(bucketId)
    if (after.error || after.data?.public || after.data?.file_size_limit !== 5 * 1024 * 1024) throw new Error('服务器文件限制读回核验失败。')
    console.log('✓ 私有成果附件的新上传上限已设为 5 MiB，服务器读回核验通过。')
  } else console.log(JSON.stringify({ bucket: bucketId, private: true, currentLimitBytes: before.data.file_size_limit, proposedLimitBytes: 5 * 1024 * 1024, applied: false }))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
