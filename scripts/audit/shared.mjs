// scripts/audit/shared.mjs
//
// 【这个脚本回答什么问题】
//   它不回答业务问题，只提供三个发布自检脚本共用的底层能力：
//   1) 定位本机 Chrome 可执行文件（优先 CHROME_PATH，否则探测常见安装路径）；
//   2) 在系统临时目录里创建隔离工作目录（不污染仓库）；
//   3) 起一个只读本地静态服务器（供 reload-loop / 本地预览使用）；
//   4) 可靠地结束 Chrome 进程树、关闭服务器、删除临时目录。
//
// 【为什么需要它】
//   原来的临时脚本（rig.mjs / rig2.mjs / rig3.mjs / rig4.mjs / cdp-check.mjs）
//   每个文件都各自复制了一份 Chrome 路径硬编码、MIME 表、taskkill 逻辑和固定端口，
//   结果是：换一台机器（macOS/Linux、非默认安装路径）就直接崩，多个脚本同时跑会抢端口，
//   异常退出时还会留下 Chrome 僵尸进程。把这些收敛到一处，三个自检才能长期复用。
//
// 【怎么用】
//   import { findChromePath, makeTempDir, createStaticServer, killProcessTree } from './shared.mjs'
//   单独自检 Chrome 探测是否正常：
//     node scripts/audit/shared.mjs --print-chrome
//
// 【约定】
//   退出码：0 = 正常；2 = 环境/参数问题（例如找不到 Chrome），与「审计结论 RED」的 1 区分开。

import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 常见 MIME 表：本地静态服务用，够覆盖 Vite 产物即可。 */
export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.traineddata': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.map': 'application/json; charset=utf-8',
}

/** 探测顺序里的“候选路径”说明，用于找不到 Chrome 时的中文提示。 */
function chromeCandidates() {
  const list = []
  const push = (p) => { if (p) list.push(p) }

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const names = [
      'Google\\Chrome\\Application\\chrome.exe',
      'Google\\Chrome Beta\\Application\\chrome.exe',
      'Google\\Chrome Dev\\Application\\chrome.exe',
      'Google\\Chrome SxS\\Application\\chrome.exe',
      'Chromium\\Application\\chrome.exe',
    ]
    for (const name of names) {
      push(path.join(pf, name))
      push(path.join(pf86, name))
      if (local) push(path.join(local, name))
    }
  } else if (process.platform === 'darwin') {
    const homes = [process.env.HOME].filter(Boolean)
    const apps = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for (const app of apps) push(app)
    for (const home of homes) {
      push(path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
      push(path.join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium'))
    }
  } else {
    const bins = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']
    const dirs = ['/usr/bin', '/usr/local/bin', '/opt/google/chrome', '/snap/bin', '/opt/chromium.org/chromium']
    for (const dir of dirs) for (const bin of bins) push(path.join(dir, bin))
  }

  // PATH 里找同名的可执行文件（覆盖自定义安装目录）。
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : ['']
  const names = process.platform === 'win32'
    ? ['chrome', 'chrome.exe', 'chromium', 'chromium.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      push(path.join(dir, name))
      if (process.platform === 'win32' && !name.endsWith('.exe')) {
        for (const ext of exts) push(path.join(dir, `${name}${ext.toLowerCase()}`))
      }
    }
  }
  // 去重且保持探测顺序。
  return [...new Set(list)]
}

async function isExecutableFile(file) {
  try {
    const info = await stat(file)
    if (!info.isFile()) return false
    await access(file, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 找到 Chrome 可执行文件。
 * @param {{ exitOnFail?: boolean }} [options] exitOnFail=true 时找不到会打印中文提示并 exit(2)。
 * @returns {Promise<string|null>}
 */
export async function findChromePath({ exitOnFail = true } = {}) {
  const fromEnv = process.env.CHROME_PATH
  if (fromEnv) {
    if (await isExecutableFile(fromEnv)) return fromEnv
    if (exitOnFail) chromeMissing(`环境变量 CHROME_PATH 指向的文件不存在或不可执行：${fromEnv}`)
    return null
  }
  const candidates = chromeCandidates()
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) return candidate
  }
  if (exitOnFail) {
    chromeMissing(
      [
        '没有找到 Chrome 可执行文件，因此无法做真实浏览器自检。',
        '解决办法（任选其一）：',
        '  1) 安装 Google Chrome；',
        '  2) 设置环境变量指向浏览器，例如 PowerShell：',
        '       $env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
        '     或 bash：export CHROME_PATH="/usr/bin/google-chrome"；',
        '  3) 临时指定：CHROME_PATH=/path/to/chrome npm run audit:first-visit',
      ].join('\n'),
    )
  }
  return null
}

function chromeMissing(message) {
  process.stderr.write(`\n[audit] ${message}\n`)
  process.exit(2)
}

/** 创建本次运行专用的临时目录（默认在系统临时目录下）。 */
export async function makeTempDir(prefix) {
  const root = process.env.TEMP || process.env.TMPDIR || os.tmpdir()
  return mkdtemp(path.join(root, `${prefix}-`))
}

/** 递归复制目录（保持符号链接原样，产物目录里没有链接）。 */
export async function copyDir(from, to) {
  await cp(from, to, { recursive: true })
}

/** 递归列出目录下的相对路径（统一用 / 分隔，避免 Windows 反斜杠混入 URL）。 */
export async function walkFiles(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walkFiles(full, base)))
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

/** 安全删除目录/文件，失败不抛错（清理阶段不该影响退出码）。 */
export async function removeQuietly(target) {
  if (!target) return
  await rm(target, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 端口占用检测：用于在临时端口已被别人占用时重试。 */
async function portAvailable(port, host) {
  return new Promise((resolve) => {
    const probe = http.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, host)
  })
}

/**
 * 只读静态文件服务器。
 * @param {object} options
 * @param {string} options.root 站点根目录（dist 或其副本）
 * @param {string} [options.host]
 * @param {number} [options.port] 0 = 由系统分配空闲端口（默认；避免多个自检互相抢固定端口）
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL) => boolean|Promise<boolean>} [options.onRequest]
 *        自定义路由钩子，返回 true 表示已处理（例如 beacon 探针接口）。
 * @returns {Promise<{ server: import('node:http').Server, port: number, origin: string, close: () => Promise<void> }>}
 */
export async function createStaticServer({ root, host = '127.0.0.1', port = 0, onRequest } = {}) {
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url || '/', `http://${host}`)
        if (onRequest && (await onRequest(req, res, url))) return
        await serveStaticFile(root, req, res, url)
      } catch {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('local static server error')
      }
    })()
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  const actualPort = server.address().port
  return {
    server,
    port: actualPort,
    origin: `http://${host}:${actualPort}`,
    close: async () => {
      // 先断开 keep-alive 连接，否则 server.close() 会等到超时。
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

/** 依次尝试若干端口，返回第一个成功监听的服务器（默认从系统分配开始）。 */
export async function createStaticServerOnFreePort(options = {}) {
  const preferred = options.port ?? 0
  const tries = preferred ? [preferred, 0] : [0]
  let lastError
  for (const port of tries) {
    if (port && !(await portAvailable(port, options.host || '127.0.0.1'))) continue
    try {
      return await createStaticServer({ ...options, port })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('无法在本地起静态服务器')
}

async function serveStaticFile(root, req, res, url) {
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const full = path.resolve(root, `.${path.posix.normalize(rel)}`)
  const rootResolved = path.resolve(root)
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
    return false
  }
  try {
    const info = await stat(full)
    if (!info.isFile()) throw new Error('not a file')
    const headers = { 'content-type': MIME_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream' }
    // 关键：模拟真实部署上的缓存语义，否则“旧 HTML + 新资源”这类缓存竞态根本复现不出来。
    if (rel.endsWith('.html')) headers['cache-control'] = 'must-revalidate, no-cache'
    else if (rel.endsWith('sw.js') || rel.endsWith('version.txt') || rel.endsWith('.webmanifest')) headers['cache-control'] = 'no-store'
    else headers['cache-control'] = 'public, max-age=31536000, immutable'
    if (req.method === 'HEAD') {
      headers['content-length'] = String(info.size)
      res.writeHead(200, headers)
      res.end()
      return true
    }
    const { createReadStream } = await import('node:fs')
    res.writeHead(200, headers)
    createReadStream(full).pipe(res)
    return true
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return false
  }
}

/**
 * 结束一个进程及其整棵子进程树（Chrome 会派生多个 renderer/gpu 进程，只杀父进程会留残渣）。
 */
export async function killProcessTree(child, { timeoutMs = 5000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => {
    child.once('exit', resolve)
    setTimeout(resolve, timeoutMs)
  })
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.once('exit', resolve)
      killer.once('error', resolve)
      setTimeout(resolve, timeoutMs)
    })
  } else {
    try { child.kill('SIGKILL') } catch { /* 进程可能已退出 */ }
  }
  await exited
}

/** 判断本模块是否被直接执行（`node shared.mjs`），用于打印 Chrome 探测结果。 */
function isMainModule() {
  const entry = process.argv[1]
  if (!entry) return false
  return path.resolve(entry) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  const args = new Set(process.argv.slice(2))
  if (args.has('--print-chrome')) {
    const chrome = await findChromePath()
    process.stdout.write(`${JSON.stringify({ platform: process.platform, chrome }, null, 2)}\n`)
  } else {
    process.stdout.write('用法: node scripts/audit/shared.mjs --print-chrome\n')
  }
}