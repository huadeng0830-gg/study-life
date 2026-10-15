import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPublicSupabaseConfig } from './supabase-build-checks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
try {
  const apply = process.argv.includes('--apply')
  if (apply && !process.argv.includes('--free-plan-confirmed')) throw new Error('部署前须核实当前账户为 Workers Free，再使用 --free-plan-confirmed；脚本不会开通或升级套餐。')
  const source = JSON.parse(readFileSync(path.join(root, 'workers/public-api/wrangler.jsonc'), 'utf8'))
  if (['r2_buckets', 'd1_databases', 'kv_namespaces', 'durable_objects', 'queues', 'ai', 'services', 'routes'].some(key => key in source)) throw new Error('公开 API 不允许附带额外服务绑定或站点路由，请先审查配置。')
  const account = readPublicSupabaseConfig('production')
  const dir = path.join(root, '.wrangler', 'public-api-deploy')
  mkdirSync(dir, { recursive: true })
  const config = { ...source, $schema: path.join(root, 'node_modules/wrangler/config-schema.json'), main: path.join(root, 'workers/public-api/index.ts'), vars: { ...source.vars, SUPABASE_URL: account.url, SUPABASE_PUBLISHABLE_KEY: account.key } }
  const configPath = path.join(dir, 'wrangler.jsonc')
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  const args = [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', configPath]
  if (!apply) args.push('--dry-run', '--outdir', path.join(dir, 'build'))
  // Wrangler prints environment bindings, so capture stdout and emit only safe
  // deploy status. The generated config contains public keys only and is ignored.
  let output
  try {
    output = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000,
      env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, '.wrangler/logs'), WRANGLER_SEND_METRICS: 'false' } })
  } catch { throw new Error('Worker 部署未完成，请检查 Cloudflare CLI 登录、权限和本地 .wrangler 日志；不要通过开通付费套餐解决。') }
  const url = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i)?.[0]
  console.log(apply ? `✓ Worker 已部署${url ? `：${url}` : '，请核验 workers.dev 地址。'}` : '✓ Worker 使用当前项目公开配置的 dry-run 构建通过。')
} catch (error) { console.error(error.message); process.exitCode = 1 }
