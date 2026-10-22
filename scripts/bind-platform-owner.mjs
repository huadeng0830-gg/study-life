// 绑定平台所有者到 public.platform_admins。
//
// 【为什么需要它】迁移只创建表，从不写入所有者；仓库里唯一的 insert 在
// supabase/tests/platform_admin.sql，而那是事务内会回滚的测试数据。
// 生产库因此通常是空表，platform-admin 的 isOwner() 恒为 false，
// 每个请求 403，页面显示"此账号没有平台管理权限"。
//
// 【为什么走 REST 而不是 db execute】迁移里已经
// `grant select, insert, update, delete on table public.platform_admins to service_role`，
// service_role 又绕过 RLS。所以只要一个 service_role key 就能完成绑定，
// 不需要数据库密码——而数据库密码是所有凭据里最不该到处贴的一个。
//
// 用法：
//   node scripts/bind-platform-owner.mjs owner@example.com [--dry-run]
//
// 需要已登录的 supabase CLI（npx supabase login）。
// 详见 scripts/bind-platform-owner.md。
import { spawnSync } from 'node:child_process'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'xyuwjmswqmxfwtyzakan'
const DRY_RUN = process.argv.includes('--dry-run')
const email = String(process.argv.slice(2).find((arg) => !arg.startsWith('--')) || '').trim()

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** 调 supabase CLI 并解析 JSON 输出（数组或对象，CLI 可能带非 JSON 前缀行）。 */
function cli(args) {
  const result = spawnSync('npx', ['supabase', ...args], { encoding: 'utf8', shell: process.platform === 'win32' })
  if (result.error) fail(`无法调用 supabase CLI：${result.error.message}`)
  if (result.status !== 0) fail(result.stderr?.trim() || `supabase ${args[0]} 执行失败。`)
  const arrayStart = result.stdout.indexOf('[')
  const objectStart = result.stdout.indexOf('{')
  const start = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart
  if (start < 0) return null
  try { return JSON.parse(result.stdout.slice(start)) } catch { return null }
}

function request(path, { method = 'GET', body, key, query = '' } = {}) {
  const response = spawnSync('curl.exe', [
    '-s', '-X', method,
    `https://${PROJECT_REF}.supabase.co${path}${query}`,
    '-H', `apikey: ${key}`,
    '-H', `Authorization: Bearer ${key}`,
    '-H', 'Content-Type: application/json',
    ...(body ? ['-d', JSON.stringify(body)] : []),
  ], { encoding: 'utf8' })
  if (response.error) fail(`无法请求 Supabase：${response.error.message}`)
  try { return JSON.parse(response.stdout || '{}') } catch { return {} }
}

if (!email) fail('用法：node scripts/bind-platform-owner.mjs owner@example.com [--dry-run]')
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`邮箱格式不正确：${email}`)

const keys = cli(['projects', 'api-keys', '--project-ref', PROJECT_REF, '--output', 'json'])
const entries = Array.isArray(keys) ? keys : []
const serviceKey = entries.find((entry) => /service_role/i.test(String(entry.name || entry.type || '')))?.api_key
if (!serviceKey) fail('未能取到 service_role key，请先 npx supabase login。')

const REST = '/rest/v1'
const existing = request(`${REST}/platform_admins?select=user_id`, { key: serviceKey })
if (Array.isArray(existing) && existing.length) {
  console.log(`✓ 已有 ${existing.length} 位所有者，未做改动。`)
  process.exit(0)
}

const found = request('/auth/v1/admin/users', { key: serviceKey, query: `?page=1&per_page=200` })
const user = (found.users || []).find((item) => String(item.email || '').toLowerCase() === email.toLowerCase())
if (!user) fail('auth.users 里没有这个邮箱。请确认账号已注册，或先用账号面板完成注册。')
if (!user.email_confirmed_at) fail('该邮箱尚未完成验证。Edge Function 会以 email_verification_required 拒绝，请先验证邮箱。')

if (DRY_RUN) {
  console.log('--dry-run：将会执行')
  console.log(`insert into public.platform_admins (user_id) values ('${user.id}');`)
  process.exit(0)
}

const inserted = request(`${REST}/platform_admins`, { method: 'POST', key: serviceKey, body: { user_id: user.id } })
if (inserted.user_id !== user.id) {
  fail(`绑定失败：${JSON.stringify(inserted).slice(0, 200)}`)
}
console.log(`✓ 已绑定所有者：${email}`)
console.log('现在用该账号登录后打开「管理中心 → 平台运维」即可。')