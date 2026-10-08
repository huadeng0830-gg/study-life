// scripts/audit/reload-loop.mjs
//
// 【这个脚本回答什么问题】
//   「如果发布出去的分包里有一个文件 404 了，用户的手机还会不会陷入无限刷新？」
//   做法：把 dist 复制到系统临时目录，把指定分包（默认 TodayView）改名使其 404，
//   起本地静态服务，在 index.html 注入「每次页面加载打一次 beacon」的探针，
//   用真 Chrome 跑约 22 秒，数页面到底加载了几次：
//     ≈ 2 次 = GREEN（首访失败 → 一次受控恢复重载 → 放弃并显示失败界面），
//     > 4 次 = RED（正在无限刷新，就是那个线上故障）。
//   再用 --dump-dom 断言页面最终出现了可见的失败界面文案（「页面没有完整加载」/「重新加载」），
//   而不是白屏或永久骨架屏——只压住刷新次数但让用户对着白屏，同样不算修好。
//
// 【为什么需要它】
//   这个故障不会在单元测试里出现：它需要真实 Service Worker、真实缓存、真实 404、
//   真实导航时序。原来的临时装置（rig2 + rig3）已经证明过一次 RED、修复后又能给出 GREEN，
//   所以把它固化成回归闸门：以后任何改动启动恢复/更新流程，跑一次就知道有没有退化。
//
// 【怎么用】
//   node scripts/audit/reload-loop.mjs <distDir> [brokenChunkPattern]
//   npm run audit:reload-loop                       # 默认 dist + TodayView
//   node scripts/audit/reload-loop.mjs dist TodayView
//   node scripts/audit/reload-loop.mjs dist "LedgerView|TasksView"   # 支持正则
//   可用环境变量：CHROME_PATH 指定浏览器；RELOAD_LOOP_SECONDS 覆盖观察秒数（默认 22）；
//                AUDIT_KEEP_TEMP=1 保留临时目录便于复盘（默认自动删除）。
//
// 【退出码 / 结论】
//   0 = GREEN：页面加载次数 ≤ 4（正常约 2 次）且能看到失败界面文案。
//   1 = RED  ：加载次数 > 4（无限刷新），或没有失败界面文案（白屏/永久骨架屏）。
//   2 = 环境/装置问题：dist 不存在、分包名匹配不到、Chrome 起不来、页面一次都没加载。
//
// 【输出】stdout 为稳定 JSON；stderr 为中文进度。临时目录、Chrome 进程、本地服务都会清理。

import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { access, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  copyDir,
  createStaticServerOnFreePort,
  findChromePath,
  killProcessTree,
  makeTempDir,
  removeQuietly,
  sleep,
} from './shared.mjs'

const DEFAULT_PATTERN = 'TodayView'
const DEFAULT_SECONDS = 22
const RED_LOAD_THRESHOLD = 4

const distDir = path.resolve(process.argv[2] || 'dist')
const brokenPattern = process.argv[3] || DEFAULT_PATTERN
const seconds = Number(process.env.RELOAD_LOOP_SECONDS || DEFAULT_SECONDS)
const keepTemp = process.env.AUDIT_KEEP_TEMP === '1'

const log = (message) => process.stderr.write(`[audit:reload-loop] ${message}\n`)

/** 装置/环境问题：抛出来交给统一的 catch 走退出码 2，并保证 finally 里的清理一定会执行。 */
class SetupFailure extends Error {}

const chromePath = await findChromePath()
log(`使用 Chrome：${chromePath}`)

// 探针：每次页面加载自增 localStorage 计数并打一个 beacon。
// 加 nobeacon 开关是为了让第二阶段（--dump-dom）不要污染计数。
const BEACON = `<script>(function(){try{if(location.search.indexOf('nobeacon')!==-1)return;var k='__sl_reload_loop_loads';var n=(+localStorage.getItem(k)||0)+1;localStorage.setItem(k,String(n));(new Image()).src='/__load?n='+n+'&t='+Date.now()}catch(e){}})()</script>`

const workDir = await makeTempDir('sl-reload-loop')
const siteDir = path.join(workDir, 'site')
let server
let chromeA
let chromeB

// 每个阶段独立计数：避免「装置阶段」的请求混进「结论阶段」。
let phase = 'setup'
const documentLoads = []
const beacons = []
const notFound = []

try {
  // -------------------------------------------------------------------------
  // 0. 参数与产物自检
  // -------------------------------------------------------------------------
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new SetupFailure(`观察秒数不合法：${process.env.RELOAD_LOOP_SECONDS}`)
  }
  try {
    await access(path.join(distDir, 'index.html'))
  } catch {
    throw new SetupFailure(`找不到 ${path.join(distDir, 'index.html')}。请先构建（npm run build），或把 dist 目录路径作为第一个参数传入。`)
  }

  // -------------------------------------------------------------------------
  // 1. 造一个「分包缺失」的部署副本
  // -------------------------------------------------------------------------
  log(`复制 ${distDir} → ${siteDir}`)
  await copyDir(distDir, siteDir)

  const assetsDir = path.join(siteDir, 'assets')
  let assetNames = []
  try {
    assetNames = await readdir(assetsDir)
  } catch {
    throw new SetupFailure(`复制出来的产物里没有 assets/ 目录：${assetsDir}`)
  }

  let matcher
  try {
    matcher = new RegExp(brokenPattern)
  } catch {
    matcher = null
  }
  const brokenAssets = []
  for (const name of assetNames) {
    const matched = matcher ? matcher.test(name) : false
    if (!matched && !name.includes(brokenPattern)) continue
    await rename(path.join(assetsDir, name), path.join(assetsDir, `${name}.broken`))
    brokenAssets.push(name)
  }
  if (brokenAssets.length === 0) {
    throw new SetupFailure(`在 assets/ 里没有找到匹配「${brokenPattern}」的分包，无法制造 404。请换一个分包名（例如 TodayView、LedgerView、TasksView）。`)
  }
  log(`已打断 ${brokenAssets.length} 个分包：${brokenAssets.join(', ')}`)

  const htmlPath = path.join(siteDir, 'index.html')
  const html = await readFile(htmlPath, 'utf8')
  if (!html.includes('<head>')) throw new SetupFailure('index.html 里没有 <head>，无法注入探针（构建产物结构变了？）')
  await writeFile(htmlPath, html.replace('<head>', `<head>${BEACON}`))

  // -------------------------------------------------------------------------
  // 2. 本地静态服务 + beacon 探针
  // -------------------------------------------------------------------------
  server = await createStaticServerOnFreePort({
    root: siteDir,
    onRequest: (req, res, url) => {
      if (url.pathname === '/__load') {
        beacons.push({ n: Number(url.searchParams.get('n')), at: Date.now(), phase })
        res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' })
        res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'))
        return true
      }
      // 独立于 localStorage 的第二路证据：数服务端收到的「文档导航」响应。
      // 注意必须用 Sec-Fetch-Mode: navigate 过滤：Service Worker 安装预缓存时也会 fetch
      // index.html（Sec-Fetch-Dest: empty），把它算进来会把 2 次导航误报成 3 次。
      res.on('finish', () => {
        const isDocumentPath = req.method === 'GET' && (url.pathname === '/' || url.pathname.endsWith('/index.html'))
        const fetchMode = req.headers['sec-fetch-mode']
        const isNavigation = fetchMode ? fetchMode === 'navigate' : /text\/html/i.test(String(req.headers.accept || ''))
        if (isDocumentPath && isNavigation && res.statusCode === 200) documentLoads.push({ at: Date.now(), phase })
        if (res.statusCode === 404 && notFound.length < 200) notFound.push({ path: url.pathname, at: Date.now(), phase })
      })
      return false
    },
  })
  log(`本地服务：${server.origin}（分包在这里 404）`)

  const chromeBaseArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=390,844',
  ]

  // -------------------------------------------------------------------------
  // 3. 阶段 A：全新 profile 打开页面，约 22 秒里数页面加载次数
  // -------------------------------------------------------------------------
  phase = 'A'
  const profileA = path.join(workDir, 'profile-a')
  log(`阶段 A：全新 profile 打开 ${server.origin}/，观察 ${seconds} 秒`)
  chromeA = spawn(chromePath, [
    ...chromeBaseArgs,
    `--user-data-dir=${profileA}`,
    `${server.origin}/`,
  ], { stdio: ['ignore', 'ignore', openSync(path.join(workDir, 'chrome-a.log'), 'w')] })
  await sleep(seconds * 1000)
  await killProcessTree(chromeA)
  await sleep(500)

  const loadsA = documentLoads.filter((item) => item.phase === 'A')
  const beaconsA = beacons.filter((item) => item.phase === 'A')
  const notFoundA = notFound.filter((item) => item.phase === 'A')
  const intervalsA = loadsA.slice(1).map((item, index) => item.at - loadsA[index].at)
  const beaconIntervalsA = beaconsA.slice(1).map((item, index) => item.at - beaconsA[index].at)
  log(`阶段 A 结果：页面导航 ${loadsA.length} 次，beacon ${beaconsA.length} 次（两者应当一致）`)
  if (loadsA.length === 0) {
    throw new SetupFailure('阶段 A 页面一次都没加载成功：本地服务或 Chrome 启动有问题，无法给出结论。')
  }

  // -------------------------------------------------------------------------
  // 4. 阶段 B：另一个全新 profile，用 --dump-dom 断言失败界面可见
  // -------------------------------------------------------------------------
  phase = 'B'
  const profileB = path.join(workDir, 'profile-b')
  log('阶段 B：另一个全新 profile，--dump-dom 抓取最终 DOM')
  chromeB = spawn(chromePath, [
    ...chromeBaseArgs,
    '--virtual-time-budget=15000',
    '--dump-dom',
    `--user-data-dir=${profileB}`,
    `${server.origin}/?nobeacon=1`,
  ], { stdio: ['ignore', 'pipe', openSync(path.join(workDir, 'chrome-b.log'), 'w')] })

  let dom = ''
  chromeB.stdout.setEncoding('utf8')
  chromeB.stdout.on('data', (chunk) => { dom += chunk })
  const domExit = await Promise.race([
    chromeB.exitCode !== null
      ? Promise.resolve(chromeB.exitCode)
      : new Promise((resolve) => chromeB.once('exit', (code) => resolve(code))),
    sleep(45000).then(() => 'timeout'),
  ])
  if (domExit === 'timeout') {
    log('--dump-dom 超过 45 秒未结束（无限刷新时 DOM 永远不收敛），强制结束浏览器后继续判定。')
    await killProcessTree(chromeB)
  }
  const loadsB = documentLoads.filter((item) => item.phase === 'B')

  const failureMarkers = ['页面没有完整加载', '页面加载失败']
  const retryMarkers = ['重新加载', '重新打开']
  const skeletonMarkers = ['data-startup-placeholder', '正在打开三两事']
  const countOf = (needles) => Object.fromEntries(needles.map((needle) => [needle, dom.split(needle).length - 1]))
  const failureFound = countOf(failureMarkers)
  const retryFound = countOf(retryMarkers)
  const skeletonFound = countOf(skeletonMarkers)
  const failureTextPresent = Object.values(failureFound).some((count) => count > 0)
  const hasStartupErrorClass = dom.includes('startup-error')
  const skeletonPresent = Object.values(skeletonFound).some((count) => count > 0)

  const domFile = path.join(workDir, 'dom-b.html')
  await writeFile(domFile, dom)
  const markerIndex = failureMarkers.map((needle) => dom.indexOf(needle)).find((index) => index >= 0) ?? -1
  const domEvidence = markerIndex >= 0 ? dom.slice(Math.max(0, markerIndex - 120), markerIndex + 200).replace(/\s+/g, ' ').trim() : ''

  // -------------------------------------------------------------------------
  // 5. 判定
  // -------------------------------------------------------------------------
  const loopRed = loadsA.length > RED_LOAD_THRESHOLD
  const uiRed = !failureTextPresent
  const reasons = []
  if (loopRed) reasons.push(`页面加载 ${loadsA.length} 次（阈值 >${RED_LOAD_THRESHOLD} 判 RED）：启动恢复仍在无限刷新`)
  if (uiRed) reasons.push(`DOM 里没有失败界面文案（${failureMarkers.join(' / ')}）：用户看到的是白屏或永久骨架屏`)
  const verdict = loopRed || uiRed ? 'RED' : 'GREEN'

  const report = {
    tool: 'reload-loop',
    distDir,
    brokenPattern,
    brokenAssets,
    seconds,
    pageLoads: loadsA.length,
    beaconCount: beaconsA.length,
    // 无限刷新时间隔数组会有几百项，报告里只保留前 20 个（其余是同一个信号）。
    loadIntervalsMs: intervalsA.slice(0, 20),
    loadIntervalsTruncated: intervalsA.length > 20,
    beaconIntervalsMs: beaconIntervalsA.slice(0, 20),
    missingRequests: [...new Set(notFoundA.map((item) => item.path))].slice(0, 10),
    failureUi: {
      failureTextPresent,
      retryTextPresent: Object.values(retryFound).some((count) => count > 0),
      startupErrorClassPresent: hasStartupErrorClass,
      skeletonStillPresent: skeletonPresent,
      failureMarkers: failureFound,
      retryMarkers: retryFound,
      skeletonMarkers: skeletonFound,
      evidence: domEvidence,
    },
    phaseB: { documentLoads: loadsB.length, domBytes: dom.length, domExit },
    domFile: keepTemp ? domFile : null,
    reasons,
    verdict,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  log(`结论：${verdict}｜页面加载 ${loadsA.length} 次（前几次间隔 ${intervalsA.slice(0, 6).join(', ') || '-'}ms）｜失败界面 ${failureTextPresent ? '可见' : '不可见'}｜骨架屏残留 ${skeletonPresent}`)
  process.exitCode = verdict === 'RED' ? 1 : 0
} catch (error) {
  if (error instanceof SetupFailure) {
    process.stderr.write(`[audit:reload-loop] ${error.message}\n`)
    process.stdout.write(`${JSON.stringify({ tool: 'reload-loop', distDir, brokenPattern, verdict: 'SETUP_FAILED', reason: error.message }, null, 2)}\n`)
  } else {
    process.stderr.write(`[audit:reload-loop] 运行异常：${String(error?.stack || error)}\n`)
    process.stdout.write(`${JSON.stringify({ tool: 'reload-loop', distDir, brokenPattern, verdict: 'ERROR', reason: String(error?.message || error) }, null, 2)}\n`)
  }
  process.exitCode = 2
} finally {
  await killProcessTree(chromeA)
  await killProcessTree(chromeB)
  try { await server?.close() } catch { /* 已关闭 */ }
  if (keepTemp) log(`已保留临时目录（AUDIT_KEEP_TEMP=1）：${workDir}`)
  else await removeQuietly(workDir)
  log('已清理本地服务、Chrome 进程与临时目录')
}
