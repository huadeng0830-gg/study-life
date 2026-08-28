import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import './style.css'
import { initializeDataVault, redirectPreviewOrigin } from './composables/dataVault.js'

// iPhone 上 IndexedDB 偶尔会延迟打开；安全副本继续后台检查，不阻塞首屏。
const VAULT_STARTUP_BUDGET = 350
const PRELOAD_RELOAD_KEY = 'study_life_preload_reload'

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(() => resolve(null), ms))
}

function sessionGet(key) {
  try { return sessionStorage.getItem(key) } catch { return null }
}

function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value) } catch {}
}

function sessionRemove(key) {
  try { sessionStorage.removeItem(key) } catch {}
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
  document.querySelector('#startup-retry')?.addEventListener('click', () => window.location.reload())
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (sessionGet(PRELOAD_RELOAD_KEY)) {
    showStartupError()
    return
  }
  sessionSet(PRELOAD_RELOAD_KEY, '1')
  window.location.reload()
})

async function bootstrap() {
  if (redirectPreviewOrigin()) return

  const vaultTask = initializeDataVault()
  const restoredEarly = await Promise.race([vaultTask, delay(VAULT_STARTUP_BUDGET)])

  const { default: App } = await import('./App.vue')

  // 每次冷启动都从首页开始，不恢复上次的页面地址。
  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname + window.location.search)
  }

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', component: () => import('./views/HomeView.vue') },
      { path: '/schedule', component: () => import('./views/ScheduleView.vue') },
      { path: '/tasks', component: () => import('./views/TasksView.vue') },
      { path: '/exams', component: () => import('./views/ExamsView.vue') },
      { path: '/lists', component: () => import('./views/ListsView.vue') },
      { path: '/bills', component: () => import('./views/LedgerView.vue') },
      { path: '/food', component: () => import('./views/FoodView.vue') },
    ],
  })

  createApp(App).use(router).mount('#app')
  sessionRemove(PRELOAD_RELOAD_KEY)

  // 更新检查不再阻塞手机首屏；浏览器空闲后再注册更新服务。
  const startUpdater = () => void import('./composables/appUpdate.js')
  if ('requestIdleCallback' in window) window.requestIdleCallback(startUpdater, { timeout: 3000 })
  else window.setTimeout(startUpdater, 1200)

  // 若安全副本在首屏显示后才恢复，最多自动重载一次使数据进入响应式状态。
  if (restoredEarly === null) {
    void vaultTask.then((restored) => {
      if (!restored?.length) {
        sessionRemove('study_life_vault_reload')
        return
      }
      if (sessionGet('study_life_vault_reload')) return
      sessionSet('study_life_vault_reload', '1')
      window.location.reload()
    })
  } else {
    sessionRemove('study_life_vault_reload')
  }
}

bootstrap().catch(() => showStartupError())
