import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import './style.css'
import { initializeDataVault, redirectPreviewOrigin } from './composables/dataVault.js'
// 副作用导入：高对比度开关必须在应用启动时就生效，而不是等用户打开外观设置才注册。
import './composables/contrast.js'
import { recoverInterruptedSync } from './composables/cloudSync.js'
import { installGlobalErrorHandling } from './composables/globalError.js'
import { clearPwaStartupRecovery, recoverPwaStartupResources } from './composables/pwaStartupRecovery.js'
import { prepareDomainData } from './composables/startupData.js'
import { runStartupGate } from './composables/startupGate.js'
import { markStartupStep } from './composables/startupStatus.js'
import { recallScroll, rememberScroll, resolveScrollPosition, scrollMemoryKey } from './composables/viewScrollMemory.js'
import { animationsEnabled } from './composables/motion.js'
import { enableLocalSafeMode } from './composables/localSafeMode.js'
import { downloadEmergencyBackup } from './composables/emergencyExport.js'
import { routes } from './router/routes.js'

let startupRecoveryInFlight = false
// 界面是否已经挂载成功。挂载之后的异常都发生在**可选预热**里（更新检查、预加载），
// 不能按"启动失败"处理：那会清掉 Service Worker 与缓存再整页重载，把一个能用的界面换掉。
let appBooted = false

/**
 * 「有空再做」的任务（更新检查、按时段预测预加载）。
 *
 * 【为什么必须包一层，不能直接裸调 requestIdleCallback】iPhone/iPad 上的 Safari
 * 长期没有 `requestIdleCallback`（iOS 17.4 以前完全没有）。它被裸调时抛的是
 * `ReferenceError`，而这段代码跑在 `bootstrap()` 里，于是**一次本来成功的启动**被
 * `.catch()` 判成启动失败 → 注销 Service Worker、清缓存、整页重载 → 重新加载仍然抛
 * （时段没变）→ 自动恢复预算用尽 → 弹出「页面没有完整加载」。用户点「重新加载」也只是
 * 再来一遍。桌面 Chrome 有这个 API，所以同一份代码在电脑上一直正常。
 * 没有该 API 时退化为 setTimeout：预热晚一点没关系，打不开才是事故。
 */
function whenIdle(task, { timeout = 5000, fallbackDelay = 1200 } = {}) {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(task, { timeout })
  else window.setTimeout(task, fallbackDelay)
}

function showStartupError() {
  const root = document.querySelector('#app')
  if (!root) return
  root.innerHTML = `
    <main class="startup-error">
      <h1>页面没有完整加载</h1>
      <p>本地课程和记录不会因此删除。请保持联网后重新打开。</p>
      <button type="button" id="startup-retry">重新加载</button>
    </main>
  `
  document.querySelector('#startup-retry')?.addEventListener('click', () => {
    clearPwaStartupRecovery()
    recoverStartupResources()
  })
}

function showRecoveryRequired() {
  const root = document.querySelector('#app')
  if (!root) return
  root.innerHTML = `
    <main class="startup-error">
      <h1>本机数据恢复未完成</h1>
      <p>同步恢复失败，但本机数据仍可在安全模式中读取、修改和导出。安全模式会暂停自动同步和手动拉取/推送，直到恢复完成。</p>
      <div class="startup-actions">
        <button type="button" class="btn btn-primary" id="startup-safe-mode">以本机安全模式继续</button>
        <button type="button" class="btn" id="startup-export">先导出本机数据</button>
        <button type="button" class="btn" id="startup-retry">重新检查恢复状态</button>
      </div>
      <p id="startup-status" role="status"></p>
    </main>
  `
  document.querySelector('#startup-safe-mode')?.addEventListener('click', () => {
    enableLocalSafeMode()
    void bootstrap({ skipGate: true })
  })
  document.querySelector('#startup-export')?.addEventListener('click', () => {
    const status = document.querySelector('#startup-status')
    try {
      downloadEmergencyBackup()
      if (status) status.textContent = '本机数据备份已交给浏览器下载。'
    } catch {
      if (status) status.textContent = '导出失败；请不要关闭此页面，并检查浏览器的本地存储权限。'
    }
  })
  document.querySelector('#startup-retry')?.addEventListener('click', () => window.location.reload())
}

// 此路径发生在 App.vue 动态导入之前；不能调用延后加载的 appUpdate 恢复逻辑。
function recoverStartupResources() {
  if (startupRecoveryInFlight) return
  startupRecoveryInFlight = true
  void recoverPwaStartupResources()
    .then((recovered) => {
      if (recovered) return
      // 界面已经在跑：这一次失败的是懒加载分包，路由与页面自己有局部失败界面。
      // 把整页换成「启动失败」既毁掉一个能用的界面，也会让 Vue 在悬空的 DOM 上继续打补丁
      // （实测刷出 `Cannot read properties of null (reading 'insertBefore')`）。
      if (appBooted) return
      showStartupError()
    })
    .finally(() => { startupRecoveryInFlight = false })
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  recoverStartupResources()
})

async function bootstrap({ skipGate = false } = {}) {
  if (redirectPreviewOrigin()) return

  const startupTiming = import.meta.env.DEV
    ? (entry) => console.debug('[Study Life startup]', entry.label, `${entry.durationMs}ms`)
    : undefined

  if (!skipGate) {
    const startup = await runStartupGate({
      initializeVault: initializeDataVault,
      recoverSync: recoverInterruptedSync,
      prepareApp: prepareDomainData,
      onTiming: startupTiming,
      // 让 index.html 里的静态占位跟着真实阶段走，
      // 用户看到的是「现在做到哪一步」而不是一句不变的文案。
      onStep: (step) => markStartupStep(step),
    })
    if (!startup.ok) {
      showRecoveryRequired()
      return
    }
  } else {
    // 初始化已完成但同步恢复失败时，安全模式仍需准备本机业务数据。
    await prepareDomainData()
  }

  const appImportStarted = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const { default: App } = await import('./App.vue')
  startupTiming?.({ label: 'app-import', durationMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - appImportStarted) * 100) / 100 })

  const router = createRouter({
    history: createWebHashHistory(),
    routes,
    // 记住上次浏览位置：列表页翻到一半跳走再回来，回到原来的位置。
    // 记录发生在导航生效之前，所以读到的 window.scrollY 仍是旧页面的位置。
    scrollBehavior(to, from, savedPosition) {
      // 前进/后退交给浏览器自带的位置；只有它没有时才考虑锚点或记忆位置。
      // 锚点跳转门控同上：显式 'smooth' 会覆盖 CSS 的 scroll-behavior 降级。
      if (!savedPosition && to.hash) {
        return { el: to.hash, behavior: animationsEnabled() ? 'smooth' : 'auto' }
      }
      return resolveScrollPosition({
        savedPosition,
        remembered: recallScroll(scrollMemoryKey(to)),
      })
    },
  })

  router.beforeEach((to, from) => {
    // 初始导航的 from 是 START_LOCATION（没有 name），不需要记录
    if (from.name) rememberScroll(scrollMemoryKey(from), window.scrollY)
    return true
  })

  const app = createApp(App)
  installGlobalErrorHandling(app)
  const mountStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  app.use(router).mount('#app')
  appBooted = true
  startupTiming?.({ label: 'mount', durationMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - mountStartedAt) * 100) / 100 })
  if (typeof window !== 'undefined') {
    const interactiveStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    window.requestAnimationFrame?.(() => startupTiming?.({ label: 'interactive', durationMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - interactiveStartedAt) * 100) / 100 }))
  }
  // 这里**故意不调用** clearPwaStartupRecovery()：挂载成功不等于资源都拿到了。
  // 分包 404 时 App 照样挂载（路由把失败兜成错误界面），若此时清空恢复预算，
  // 就会「404 → 恢复重载 → 挂载成功 → 清预算 → 再 404」无限刷新（实测约 110ms 一轮）。
  // 预算只在用户显式点「重新加载」时清空（见 showStartupError）。

  // 从这里往下全部是**可选预热**：更新检查、悬停预加载、按时段预测预加载。
  // 整体兜一层异常——预热是投机行为，失败不该影响任何功能，更不该升级成「启动失败」
  // 去清 Service Worker 与缓存重载整页（今天的 requestIdleCallback 事故就是这样升级的）。
  try {
    startOptionalWarmup()
  } catch (error) {
    console.warn('[startup] 可选预热任务失败，已忽略', error)
  }
}

/**
 * 可选预热：更新检查、鼠标悬停预加载、按时段预测预加载。跑在界面挂载之后。
 * 单独成函数只是为了在 bootstrap 末尾统一兜异常；内部逻辑与之前一致。
 */
function startOptionalWarmup() {
  // 更新检查不再阻塞手机首屏；浏览器空闲后再注册更新服务。
  const startUpdater = () => void import('./composables/appUpdate.js')
  whenIdle(startUpdater, { timeout: 3000, fallbackDelay: 1200 })

  // 异步组件预加载策略：基于路由导航预加载
  const preloadedRoutes = new Set()
  function preloadRoute(routeName) {
    if (preloadedRoutes.has(routeName)) return
    preloadedRoutes.add(routeName)
    // 定义路由到组件的映射
    const routeComponentMap = {
      'ScheduleView': () => import('./views/ScheduleView.vue'),
      'TasksView': () => import('./views/TasksView.vue'),
      'LedgerView': () => import('./views/LedgerView.vue'),
      'ExamsView': () => import('./views/ExamsView.vue'),
      'ListsView': () => import('./views/ListsView.vue'),
      'NotesView': () => import('./views/NotesView.vue'),
    }
    const loader = routeComponentMap[routeName]
    if (loader) void loader()
  }

  // 鼠标悬停导航项 200ms 后预加载目标页面
  let hoverPreloadTimer = null
  document.addEventListener('mouseover', (e) => {
    const navLink = e.target.closest('[data-preload-route]')
    if (!navLink) return
    const routeName = navLink.dataset.preloadRoute
    if (!routeName) return
    hoverPreloadTimer = setTimeout(() => preloadRoute(routeName), 200)
  })
  document.addEventListener('mouseout', (e) => {
    const navLink = e.target.closest('[data-preload-route]')
    if (!navLink) return
    clearTimeout(hoverPreloadTimer)
  })

  // 基于用户行为模式预测预加载（如每天早上打开课程表）
  const hour = new Date().getHours()
  if (hour >= 6 && hour <= 10) {
    // 早上预加载课程表和待办
    whenIdle(() => {
      preloadRoute('ScheduleView')
      preloadRoute('TasksView')
    }, { timeout: 5000, fallbackDelay: 2200 })
  } else if (hour >= 18 && hour <= 22) {
    // 晚上预加载账本和复盘
    whenIdle(() => {
      preloadRoute('LedgerView')
      preloadRoute('ExamsView')
    }, { timeout: 5000, fallbackDelay: 2200 })
  }
}

bootstrap().catch((error) => {
  // 界面已经挂载：挂载之后才抛出的都是可选预热任务，界面本身是好的。
  // 清 Service Worker 与缓存再整页重载只会把一个能用的界面换掉（还可能刷出一屏报错），
  // 所以这里只记录，不做恢复。
  if (appBooted) {
    console.warn('[startup] 挂载后的可选任务异常，已忽略', error)
    return
  }
  recoverStartupResources()
})

// update-e2e-marker
