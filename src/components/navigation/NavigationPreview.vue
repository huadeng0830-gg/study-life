<script setup>
import { computed, ref } from 'vue'
import { FIXED_MOBILE_NAV_ITEMS, visibleDesktopNavigation, visibleNavigationItems } from '../../composables/navigationPreferences.js'

const props = defineProps({
  mode: { type: String, required: true },
  mobile: { type: Array, required: true },
  desktop: { type: Array, required: true },
  user: { type: Object, default: null },
  currentPath: { type: String, default: '/' },
})
const collapsed = ref(false)
const mobileItems = computed(() => visibleNavigationItems(props.mobile, props.user))
const groups = computed(() => visibleDesktopNavigation(props.desktop, props.user))
</script>

<template>
  <aside class="navigation-preview" aria-label="导航实时预览">
    <div class="preview-heading">
      <span>实时预览</span>
      <button v-if="mode === 'desktop'" class="nav-preview-collapse" type="button" :aria-expanded="!collapsed" :aria-pressed="collapsed" @click="collapsed = !collapsed">{{ collapsed ? '展开文字' : '仅看图标' }}</button>
      <small v-else>保存后生效</small>
    </div>
    <template v-if="mode === 'mobile'">
      <div class="mobile-preview-screen"><span aria-hidden="true">☷</span><b>你的常用页面</b><small>常用入口随手可达</small></div>
      <div class="mobile-nav-preview" :style="{ '--preview-count': mobileItems.length + FIXED_MOBILE_NAV_ITEMS }" aria-label="手机底部导航预览">
        <div v-for="item in mobileItems" :key="item.id" class="mobile-nav-preview-item" :class="{ selected: item.path === currentPath }">
          <span aria-hidden="true">{{ item.icon }}</span><small>{{ item.mobileLabel }}</small>
        </div>
        <div class="mobile-nav-preview-item capture"><span aria-hidden="true">＋</span><small>快速记录</small></div>
        <div class="mobile-nav-preview-item more" :class="{ selected: !mobileItems.some((item) => item.path === currentPath) }"><span aria-hidden="true">⋯</span><small>更多</small></div>
      </div>
    </template>
    <div v-else class="desktop-nav-preview" :class="{ collapsed }" aria-label="电脑侧栏预览">
      <div class="preview-brand"><span aria-hidden="true">☷</span><b v-if="!collapsed">三两事</b></div>
      <section v-for="group in groups" :key="group.id" class="desktop-nav-preview-group">
        <b v-if="!collapsed">{{ group.label }}</b>
        <div v-for="item in group.items" :key="item.id" class="desktop-nav-preview-item" :class="{ selected: item.path === currentPath }" :title="collapsed ? item.label : undefined">
          <span aria-hidden="true">{{ item.icon }}</span><small v-if="!collapsed">{{ item.label }}</small>
        </div>
      </section>
      <p v-if="!groups.length" class="preview-empty">{{ collapsed ? '…' : '添加常用页面后，这里会显示侧栏布局。' }}</p>
      <div class="preview-tool"><span aria-hidden="true">☷</span><small v-if="!collapsed">编辑导航</small></div>
    </div>
    <p class="preview-note">{{ mode === 'mobile' ? '快速记录与更多始终保留。' : '空分组在实际侧栏中自动隐藏。' }}</p>
  </aside>
</template>

<style scoped>
.navigation-preview { min-width: 0; overflow: hidden; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-14); background: var(--bg-tint); }
.preview-heading { display: flex; min-height: 32px; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; color: var(--text); font-size: var(--fs-12); font-weight: var(--fw-700); }
.preview-heading small { color: var(--muted); font-size: var(--fs-11); font-weight: var(--fw-400); }
.nav-preview-collapse { min-height: 32px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-7); background: var(--card); color: var(--primary); font-size: var(--fs-11); }
.nav-preview-collapse:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.mobile-preview-screen { display: flex; min-height: 98px; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 12px; border: 1px solid var(--border); border-bottom: 0; border-radius: var(--radius-12) var(--radius-12) 0 0; background: var(--card); }
.mobile-preview-screen > span { display: grid; width: 32px; height: 32px; place-items: center; border-radius: var(--radius-9); background: var(--primary-soft); color: var(--primary); font-size: var(--fs-19); }
.mobile-preview-screen b { font-size: var(--fs-13); }
.mobile-preview-screen small { color: var(--muted); font-size: var(--fs-11); }
.mobile-nav-preview { display: grid; grid-template-columns: repeat(var(--preview-count), minmax(0, 1fr)); gap: 2px; padding: 5px 3px; border: 1px solid var(--border); border-radius: 0 0 var(--radius-12) var(--radius-12); background: var(--card); }
.mobile-nav-preview-item { display: flex; min-width: 0; min-height: 54px; flex-direction: column; align-items: center; justify-content: center; gap: 5px; border-radius: var(--radius-7); color: var(--ink-soft); }
.mobile-nav-preview-item.selected { background: var(--primary-soft); color: var(--primary); }
.mobile-nav-preview-item > span { font-size: var(--fs-18); line-height: 1; }
.mobile-nav-preview-item small { max-width: 100%; overflow: hidden; font-size: var(--fs-10); text-overflow: ellipsis; white-space: nowrap; }
.mobile-nav-preview-item.capture > span { display: grid; width: 26px; height: 24px; place-items: center; border-radius: var(--radius-7); background: var(--primary-soft); color: var(--primary); }
.desktop-nav-preview { display: flex; width: 100%; flex-direction: column; gap: 14px; padding: 14px 10px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--card); }
.preview-brand { display: flex; align-items: center; gap: 8px; padding: 0 8px 8px; font-size: var(--fs-14); }
.preview-brand > span { color: var(--primary); }
.desktop-nav-preview-group { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.desktop-nav-preview-group > b { overflow: hidden; padding: 0 8px 4px; color: var(--muted); font-size: var(--fs-11); text-overflow: ellipsis; white-space: nowrap; }
.desktop-nav-preview-item, .preview-tool { display: flex; min-height: 34px; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-7); color: var(--ink-soft); }
.desktop-nav-preview-item.selected { background: var(--primary-soft); color: var(--primary); }
.desktop-nav-preview-item > span, .preview-tool > span { width: 20px; flex: 0 0 20px; text-align: center; font-size: var(--fs-15); }
.desktop-nav-preview-item small, .preview-tool small { overflow: hidden; font-size: var(--fs-12); text-overflow: ellipsis; white-space: nowrap; }
.preview-tool { border-top: 1px solid var(--border); border-radius: 0; color: var(--primary); }
.desktop-nav-preview.collapsed { width: 62px; margin: 0 auto; padding-inline: 5px; }
.collapsed .preview-brand, .collapsed .desktop-nav-preview-item, .collapsed .preview-tool { justify-content: center; padding-inline: 4px; }
.preview-note, .preview-empty { margin: 10px 0 0; color: var(--muted); font-size: var(--fs-11); line-height: 1.6; }
.preview-empty { margin: 0; padding: 8px; }
@media (max-width: 760px) {
  .desktop-nav-preview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .preview-brand, .preview-tool { grid-column: 1 / -1; }
  .desktop-nav-preview.collapsed { display: flex; width: 100%; flex-direction: row; flex-wrap: wrap; gap: 6px; }
  .collapsed .desktop-nav-preview-group { flex-direction: row; flex-wrap: wrap; }
  .collapsed .preview-brand, .collapsed .preview-tool { border: 0; }
  .mobile-preview-screen { min-height: 72px; }
}
</style>
