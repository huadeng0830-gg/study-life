import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import './style.css'
import { initializeDataVault, redirectPreviewOrigin } from './composables/dataVault.js'

async function bootstrap() {
  if (redirectPreviewOrigin()) return
  await initializeDataVault()
  await import('./composables/appUpdate.js')
  await import('./composables/theme.js')

  const { default: App } = await import('./App.vue')

  // 每次冷启动都从"今日总览"开始，不恢复上次的页面地址。
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
      { path: '/bills', component: () => import('./views/BillsView.vue') },
      { path: '/food', component: () => import('./views/FoodView.vue') },
    ],
  })

  createApp(App).use(router).mount('#app')
}

bootstrap()
