import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

export function assertProductionDeployPreflight({ branch, status, localHead, remoteHead }) {
  if (branch !== 'main') throw new Error(`生产部署只允许从 main 分支执行（当前：${branch || 'detached HEAD'}）。`)
  if (String(status || '').trim()) throw new Error('生产部署要求干净的 Git 工作区；请先完成审查并提交变更。')
  if (!localHead || !remoteHead || localHead !== remoteHead) {
    throw new Error('本地 HEAD 必须与已获取的 origin/main 一致；请先同步并审查远端 main。')
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function gitText(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || '无法读取 Git 发布状态。')
  return result.stdout
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertProductionDeployPreflight({
      branch: gitText(['branch', '--show-current']).trim(),
      status: gitText(['status', '--porcelain', '--untracked-files=all']),
      localHead: gitText(['rev-parse', 'HEAD']).trim(),
      remoteHead: gitText(['rev-parse', 'origin/main']).trim(),
    })

    run('npm', ['run', 'supabase:verify-config', '--', 'production'])
    run('npm', ['run', 'pages:verify-config'])
    run('npm', ['run', 'build'])
    run('npm', ['run', 'supabase:verify-bundle', '--', 'dist', 'production'])

    const packageJsonPath = path.join(ROOT, 'node_modules', 'wrangler', 'package.json')
    if (!existsSync(packageJsonPath)) throw new Error('本机未安装锁定版本的 wrangler，请先运行 npm ci。')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.wrangler
    if (!bin) throw new Error('锁定版本的 wrangler 没有 CLI 入口。')
    const cli = path.resolve(path.dirname(packageJsonPath), bin)
    if (!existsSync(cli)) throw new Error('找不到本机安装的 wrangler CLI。')
    run(process.execPath, [cli, 'pages', 'deploy', 'dist', '--project-name=study-life', '--branch=main'])
  } catch (error) {
    console.error(`✗ 生产部署已阻止：${error.message}`)
    process.exit(1)
  }
}
