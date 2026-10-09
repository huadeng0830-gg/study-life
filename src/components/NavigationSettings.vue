<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { accountUser } from '../composables/accountAuth.js'
import { useNavigationEditor } from '../composables/navigationEditor.js'
import {
  MAX_DESKTOP_NAV_GROUPS, MAX_MOBILE_NAV_ITEMS, MAX_NAV_GROUP_LABEL_LENGTH,
  navigationItem,
} from '../composables/navigationPreferences.js'
import { useTabKeys } from '../composables/tabKeys.js'
import Modal from './Modal.vue'
import ActionButton from './ActionButton.vue'
import NavigationPreview from './navigation/NavigationPreview.vue'
import NavigationFeaturePicker from './navigation/NavigationFeaturePicker.vue'

const props = defineProps({ open: Boolean, initialMode: { type: String, default: '' } })
const emit = defineEmits(['close'])
const route = useRoute()
const router = useRouter()
const editor = useNavigationEditor({ initialMode: props.initialMode
  || (window.matchMedia?.('(max-width: 900px)').matches ? 'mobile' : 'desktop') })
const { mode, drafts, availableItems, dirty, hasChanges, conflicts,
  saving, error, message, canUndo, canRedo, isDefault } = editor
const editorEl = ref(null)
const navAction = ref(null)
const newGroupLabel = ref('')
const targetGroup = ref('')
const pendingDeparture = ref(null)
const pendingGroupRemoval = ref(null)
const removalTarget = ref('')
const draggingId = ref('')
watch(hasChanges, (value) => { if (value && !saving.value && navAction.value?.phase !== 'idle') navAction.value?.cancel() })
const instanceId = useId()
const panelId = `nav-panel-${instanceId}`
const groupInputId = `nav-group-${instanceId}`
let editSequence = 0
const renameBatch = ref(null)
let drag = null

const availableIds = computed(() => new Set(availableItems.value.map((item) => item.id)))
const mobileItems = computed(() => drafts.value.mobile.flatMap((id, draftIndex) => {
  const item = navigationItem(id)
  return item && availableIds.value.has(id) ? [{ ...item, label: item.mobileLabel, draftIndex }] : []
}))
const desktopGroups = computed(() => drafts.value.desktop.map((group) => ({
  ...group,
  items: group.items.flatMap((id, draftIndex) => {
    const item = navigationItem(id)
    return item && availableIds.value.has(id) ? [{ ...item, draftIndex }] : []
  }),
})))
const pinnedIds = computed(() => mode.value === 'mobile' ? drafts.value.mobile : drafts.value.desktop.flatMap((group) => group.items))
const mobileFull = computed(() => drafts.value.mobile.length >= MAX_MOBILE_NAV_ITEMS)
const removalGroups = computed(() => drafts.value.desktop.filter((group) => group.id !== pendingGroupRemoval.value?.id))
const deviceLabel = (device) => device === 'mobile' ? '手机导航' : '电脑侧栏'
async function saveNavigation() {
  const saved = await editor.save()
  if (!saved && error.value) throw new Error(error.value)
  return saved
}
const { onKeydown: onModeKeydown, tabIndexFor } = useTabKeys({
  keys: ['mobile', 'desktop'], active: () => mode.value,
  select: (key) => { if (saving.value || drag) return false; mode.value = key },
})

watch(() => props.open, (open) => {
  if (open) {
    editor.begin()
    newGroupLabel.value = ''
    pendingDeparture.value = null
    pendingGroupRemoval.value = null
  } else finishDrag(true)
}, { immediate: true })
watch(() => drafts.value.desktop.map((group) => group.id), (ids) => {
  if (!ids.includes(targetGroup.value)) targetGroup.value = ids[0] || ''
}, { immediate: true })
watch(() => accountUser.value?.id, () => {
  finishDrag(false)
  pendingDeparture.value = null
  pendingGroupRemoval.value = null
  newGroupLabel.value = ''
})
watch(hasChanges, (changed) => {
  window.removeEventListener('beforeunload', guardUnload)
  if (changed && props.open) window.addEventListener('beforeunload', guardUnload)
})
onBeforeUnmount(() => {
  finishDrag(false)
  window.removeEventListener('beforeunload', guardUnload)
})

function guardUnload(event) {
  if (!hasChanges.value || !props.open) return
  event.preventDefault()
  event.returnValue = ''
}

function changeMode(device) {
  if (!saving.value && !drag) mode.value = device
}

function reorderMobileItem(index, offset) {
  const item = mobileItems.value[index]
  const target = mobileItems.value[index + offset]
  if (item && target) editor.apply({ type: 'mobile:move', id: item.id, to: target.draftIndex })
}

function reorderDesktopItem(group, index, offset) {
  const item = group.items[index]
  const target = group.items[index + offset]
  if (item && target) editor.apply({ type: 'desktop:move-item', id: item.id, groupId: group.id, to: target.draftIndex })
}

function startDrag(event, device, id, groupId = '') {
  if (saving.value || drag || !event.isPrimary || event.button !== 0) return
  event.preventDefault()
  const captureTarget = editorEl.value || event.currentTarget
  drag = { pointerId: event.pointerId, device, id, groupId, handle: captureTarget,
    changed: false, batch: `drag-${++editSequence}` }
  draggingId.value = id
  captureTarget.setPointerCapture?.(event.pointerId)
}

function continueDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const row = document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('[data-nav-id]')
  // A missing hit must never be mistaken for the first row.
  if (!row || !editorEl.value?.contains(row) || row.dataset.navDevice !== drag.device
    || (row.dataset.navGroup || '') !== drag.groupId) return
  const ids = drag.device === 'mobile' ? drafts.value.mobile
    : drafts.value.desktop.find((group) => group.id === drag.groupId)?.items
  const to = ids?.indexOf(row.dataset.navId)
  if (!Number.isInteger(to) || to < 0 || row.dataset.navId === drag.id) return
  const changed = editor.apply({ type: drag.device === 'mobile' ? 'mobile:move' : 'desktop:move-item',
    id: drag.id, groupId: drag.groupId, to }, { batch: drag.batch })
  drag.changed ||= changed
}

function finishDrag(cancel = false) {
  if (!drag) return
  const current = drag
  drag = null
  draggingId.value = ''
  if (cancel && current.changed) editor.undo({ cancel: true })
  if (current.handle.hasPointerCapture?.(current.pointerId)) current.handle.releasePointerCapture?.(current.pointerId)
}

function endDrag(event) {
  if (event.pointerId === drag?.pointerId) finishDrag(event.type !== 'pointerup')
}

async function onOrderKeydown(event, device, id, groupId = '') {
  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const ids = device === 'mobile' ? drafts.value.mobile : drafts.value.desktop.find((group) => group.id === groupId)?.items
  const index = ids?.indexOf(id)
  if (!Number.isInteger(index) || index < 0) return
  editor.apply({ type: device === 'mobile' ? 'mobile:move' : 'desktop:move-item', id, groupId,
    to: index + (event.key === 'ArrowUp' ? -1 : 1) })
  await nextTick()
  editorEl.value?.querySelector(`[data-nav-id="${id}"] .nav-drag-handle`)?.focus()
}

function addGroup() {
  if (!editor.apply({ type: 'desktop:add-group', label: newGroupLabel.value })) return
  targetGroup.value = drafts.value.desktop.at(-1).id
  newGroupLabel.value = ''
}

function requestRemoveGroup(group) {
  if (drafts.value.desktop.length <= 1 || saving.value) return
  if (!group.items.length) { editor.apply({ type: 'desktop:remove-group', id: group.id }); return }
  pendingGroupRemoval.value = { id: group.id, label: group.label, count: group.items.length }
  removalTarget.value = drafts.value.desktop.find((entry) => entry.id !== group.id).id
}

function removeGroup() {
  editor.apply({ type: 'desktop:remove-group', id: pendingGroupRemoval.value.id, groupId: removalTarget.value })
  pendingGroupRemoval.value = null
}

function pin(id) {
  editor.apply({ type: mode.value === 'mobile' ? 'mobile:add' : 'desktop:pin', id, groupId: targetGroup.value })
}

async function depart(intent) {
  if (intent?.path) await router.push(intent.path)
  pendingDeparture.value = null
  emit('close')
}

function requestClose(path = '') {
  if (saving.value) return
  finishDrag(false)
  const intent = { path }
  if (hasChanges.value) pendingDeparture.value = intent
  else void depart(intent)
}

async function saveAndLeave() {
  const intent = pendingDeparture.value
  if (await editor.save()) await depart(intent)
}

function discardAndLeave() {
  const intent = pendingDeparture.value
  editor.begin()
  void depart(intent)
}
</script>

<template>
  <Modal :open="open" title="编辑导航" wide sheet :sheet-detents="[0.85, 0.96]" @close="requestClose()">
    <section ref="editorEl" class="navigation-settings" aria-label="导航自定义" :aria-busy="saving" @pointermove="continueDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
      <div class="navigation-mode-tabs" role="tablist" aria-label="选择要编辑的导航" @keydown="onModeKeydown">
        <button :id="`nav-mobile-${instanceId}`" type="button" role="tab" :tabindex="tabIndexFor('mobile')" :aria-controls="panelId" :aria-selected="mode === 'mobile'" :class="{ on: mode === 'mobile' }" :disabled="saving" @click="changeMode('mobile')"><span aria-hidden="true">▤</span> 手机导航 <i v-if="dirty.mobile" aria-label="有未保存修改"></i></button>
        <button :id="`nav-desktop-${instanceId}`" type="button" role="tab" :tabindex="tabIndexFor('desktop')" :aria-controls="panelId" :aria-selected="mode === 'desktop'" :class="{ on: mode === 'desktop' }" :disabled="saving" @click="changeMode('desktop')"><span aria-hidden="true">☷</span> 电脑侧栏 <i v-if="dirty.desktop" aria-label="有未保存修改"></i></button>
      </div>

      <div :id="panelId" class="navigation-mode-panel" role="tabpanel" :aria-labelledby="`nav-${mode}-${instanceId}`">
        <div class="navigation-section-heading">
          <div><h3>{{ mode === 'mobile' ? '把常用页面放在手边' : '按你的习惯整理侧栏' }}</h3><p>{{ mode === 'mobile' ? `自选 ${MAX_MOBILE_NAV_ITEMS} 个页面，与快速记录、更多一起组成底栏。` : '调整分组与顺序，把常用页面固定到侧栏。' }}</p></div>
          <button class="nav-restore" type="button" :disabled="saving || isDefault" @click="editor.apply({ type: 'defaults' })">恢复默认</button>
        </div>

        <div v-for="device in conflicts" :key="device" class="navigation-conflict" role="alert">
          <p>{{ deviceLabel(device) }}已有更新，当前草稿已保留。</p>
          <div><button type="button" :disabled="saving" @click="editor.rebase(device)">载入最新布局</button><button type="button" :disabled="saving" @click="editor.rebase(device, true)">保留草稿并覆盖</button></div>
        </div>

        <fieldset class="navigation-workspace" :disabled="saving">
          <legend class="sr-only">{{ deviceLabel(mode) }}布局编辑</legend>
          <NavigationPreview :mode="mode" :mobile="drafts.mobile" :desktop="drafts.desktop" :user="accountUser" :current-path="route.path" />
          <div class="navigation-arrangement">
            <div class="navigation-section-heading compact"><h4>{{ mode === 'mobile' ? '已添加的页面' : '侧栏分组' }} <small>{{ mode === 'mobile' ? `${drafts.mobile.length} / ${MAX_MOBILE_NAV_ITEMS}` : `${drafts.desktop.length} / ${MAX_DESKTOP_NAV_GROUPS}` }}</small></h4></div>
            <p class="nav-sort-hint">拖动手柄或点击箭头排序。键盘可在手柄上按 Alt + ↑ / ↓。</p>
            <ol v-if="mode === 'mobile'" class="navigation-edit-list">
              <li v-for="(item, index) in mobileItems" :key="item.id" class="navigation-edit-row" :class="{ dragging: draggingId === item.id }" :data-nav-id="item.id" data-nav-device="mobile" :data-mobile-index="index">
                <button class="nav-drag-handle" type="button" :aria-label="`调整${item.label}顺序`" title="拖动排序，或按 Alt + 上下方向键" @pointerdown="startDrag($event, 'mobile', item.id)" @keydown="onOrderKeydown($event, 'mobile', item.id)">⠿</button>
                <span class="nav-row-number" aria-hidden="true">{{ index + 1 }}</span><span class="nav-item-icon" aria-hidden="true">{{ item.icon }}</span><span class="nav-item-name">{{ item.label }}</span>
                <div class="nav-row-actions"><button type="button" :aria-label="`将${item.label}上移`" :disabled="index === 0" @click="reorderMobileItem(index, -1)">↑</button><button type="button" :aria-label="`将${item.label}下移`" :disabled="index === mobileItems.length - 1" @click="reorderMobileItem(index, 1)">↓</button><button type="button" class="nav-remove" :aria-label="`移除${item.label}`" @click="editor.apply({ type: 'mobile:remove', id: item.id })">移除</button></div>
              </li>
              <li v-if="!mobileItems.length" class="nav-empty-note">还没有自选页面，从下方添加常用功能。</li>
            </ol>

            <div v-else class="desktop-nav-groups">
              <section v-for="(group, groupIndex) in desktopGroups" :key="group.id" class="desktop-nav-edit-group">
                <header class="desktop-nav-group-header">
                  <input :value="group.label" :aria-label="`${group.label || '未命名'}分组名称`" :aria-invalid="!group.label.trim()" :maxlength="MAX_NAV_GROUP_LABEL_LENGTH" placeholder="分组名称" @focus="renameBatch = `rename-${++editSequence}`" @input="editor.apply({ type: 'desktop:rename-group', id: group.id, label: $event.target.value }, { batch: renameBatch })" @blur="renameBatch = null" />
                  <div class="nav-row-actions"><button type="button" :aria-label="`将${group.label}分组上移`" :disabled="groupIndex === 0" @click="editor.apply({ type: 'desktop:move-group', id: group.id, to: groupIndex - 1 })">↑</button><button type="button" :aria-label="`将${group.label}分组下移`" :disabled="groupIndex === desktopGroups.length - 1" @click="editor.apply({ type: 'desktop:move-group', id: group.id, to: groupIndex + 1 })">↓</button><button type="button" class="nav-remove" :aria-label="`移除${group.label}分组`" :disabled="desktopGroups.length <= 1" @click="requestRemoveGroup(group)">移除分组</button></div>
                </header>
                <ol class="navigation-edit-list desktop-group-items">
                  <li v-for="(item, itemIndex) in group.items" :key="item.id" class="navigation-edit-row" :class="{ dragging: draggingId === item.id }" :data-nav-id="item.id" data-nav-device="desktop" :data-nav-group="group.id">
                    <button class="nav-drag-handle" type="button" :aria-label="`调整${item.label}顺序`" title="拖动排序，或按 Alt + 上下方向键" @pointerdown="startDrag($event, 'desktop', item.id, group.id)" @keydown="onOrderKeydown($event, 'desktop', item.id, group.id)">⠿</button>
                    <span class="nav-item-icon" aria-hidden="true">{{ item.icon }}</span><span class="nav-item-name">{{ item.label }}</span>
                    <select class="nav-destination" :value="group.id" :aria-label="`将${item.label}移动到分组`" @change="editor.apply({ type: 'desktop:move-item', id: item.id, groupId: $event.target.value })"><option v-for="option in drafts.desktop" :key="option.id" :value="option.id">{{ option.label.trim() || '未命名分组' }}</option></select>
                    <div class="nav-row-actions"><button type="button" :aria-label="`将${item.label}上移`" :disabled="itemIndex === 0" @click="reorderDesktopItem(group, itemIndex, -1)">↑</button><button type="button" :aria-label="`将${item.label}下移`" :disabled="itemIndex === group.items.length - 1" @click="reorderDesktopItem(group, itemIndex, 1)">↓</button><button type="button" class="nav-remove" :aria-label="`取消固定${item.label}`" @click="editor.apply({ type: 'desktop:unpin', id: item.id })">取消固定</button></div>
                  </li>
                  <li v-if="!group.items.length" class="nav-empty-note">此分组暂无页面。可从下方添加，或把其他分组的页面移到这里。</li>
                </ol>
              </section>
              <form class="nav-add-group" @submit.prevent="addGroup"><label :for="groupInputId">新建分组</label><input :id="groupInputId" v-model="newGroupLabel" :maxlength="MAX_NAV_GROUP_LABEL_LENGTH" placeholder="例如：我的常用" /><button type="submit" :disabled="drafts.desktop.length >= MAX_DESKTOP_NAV_GROUPS">添加分组</button></form>
            </div>
            <div v-if="mode === 'mobile'" class="nav-fixed-note"><span aria-hidden="true">⌑</span> 快速记录、更多为常驻入口</div>
          </div>
        </fieldset>

        <NavigationFeaturePicker v-model:target-group="targetGroup" :mode="mode" :items="availableItems" :pinned-ids="pinnedIds" :groups="drafts.desktop" :full="mode === 'mobile' && mobileFull" :disabled="saving" @pin="pin" @open="requestClose" />
      </div>
    </section>

    <template #foot>
      <div class="navigation-footer">
        <p v-if="error" class="navigation-feedback error" role="alert">{{ error }}</p>
        <p v-else-if="message" class="navigation-feedback" role="status">{{ message }}</p>
        <div class="navigation-save-row">
          <div class="navigation-save-copy"><b :class="{ dirty: hasChanges }">{{ hasChanges ? '有未保存的修改' : '布局已保存' }}</b><small>{{ accountUser?.id ? '保存后生效，并跟随当前账号同步。' : '保存在本机，登录后可随账号同步。' }}</small></div>
          <div class="navigation-footer-actions"><button class="nav-history" type="button" aria-label="撤销上一步" :disabled="!canUndo || Boolean(draggingId)" @click="editor.undo()">↶ <span>撤销</span></button><button class="nav-history" type="button" aria-label="重做上一步" :disabled="!canRedo || Boolean(draggingId)" @click="editor.redo()">↷ <span>重做</span></button><ActionButton ref="navAction" class="nav-save" kind="important" :action="saveNavigation" :busy="saving" :show-error="false" :disabled="!hasChanges || Boolean(draggingId)" success-label="已保存">{{ dirty.mobile && dirty.desktop ? '保存两端修改' : '保存导航' }}</ActionButton></div>
        </div>
      </div>
    </template>
  </Modal>

  <Modal v-if="pendingDeparture" :open="true" title="保存导航修改？" @close="!saving && (pendingDeparture = null)">
    <p class="nav-dialog-message">{{ [dirty.mobile && '手机导航', dirty.desktop && '电脑侧栏'].filter(Boolean).join('和') }}还有未保存的修改。</p>
    <p v-if="error" class="navigation-feedback error" role="alert">{{ error }}</p>
    <template #foot><div class="nav-dialog-actions"><button class="btn btn-ghost" type="button" :disabled="saving" @click="pendingDeparture = null">继续编辑</button><button class="btn btn-ghost nav-discard" type="button" :disabled="saving" @click="discardAndLeave">放弃修改</button><ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="saving" kind="frequent" feedback="external" :show-error="false" :action="() => saveAndLeave()">{{ saving ? '正在保存…' : '保存并离开' }}</ActionButton></div></template>
  </Modal>

  <Modal v-if="pendingGroupRemoval" :open="true" title="移除分组" @close="pendingGroupRemoval = null">
    <p class="nav-dialog-message">「{{ pendingGroupRemoval.label }}」中的 {{ pendingGroupRemoval.count }} 个页面将移到以下分组：</p>
    <select v-model="removalTarget" class="nav-removal-target" aria-label="移除分组后页面的目标分组"><option v-for="group in removalGroups" :key="group.id" :value="group.id">{{ group.label.trim() || '未命名分组' }}</option></select>
    <template #foot><div class="nav-dialog-actions"><button class="btn btn-ghost" type="button" @click="pendingGroupRemoval = null">取消</button><button class="btn btn-primary" type="button" @click="removeGroup">移动页面并移除分组</button></div></template>
  </Modal>
</template>

<style scoped>
.navigation-settings { display: flex; min-width: 0; flex-direction: column; gap: 20px; color: var(--text); }
.navigation-mode-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 5px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--bg); }
.navigation-mode-tabs button { display: flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; padding: 6px; border: 0; border-radius: var(--radius-8); background: transparent; color: var(--muted); font-size: var(--fs-14); font-weight: var(--fw-650); }
.navigation-mode-tabs button.on { background: var(--card); color: var(--primary); box-shadow: var(--shadow-sm); }
.navigation-mode-tabs i { width: 6px; height: 6px; border-radius: var(--radius-circle); background: var(--warning); }
.navigation-mode-panel { display: flex; min-width: 0; flex-direction: column; gap: 20px; }
.navigation-section-heading { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 14px; }
.navigation-section-heading h3, .navigation-section-heading h4 { margin: 0; }
.navigation-section-heading h3 { font-size: var(--fs-16); }
.navigation-section-heading h4 { font-size: var(--fs-14); }
.navigation-section-heading p { margin: 6px 0 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.7; }
.navigation-section-heading h4 small { margin-left: 5px; color: var(--muted); font-size: var(--fs-12); font-weight: var(--fw-400); }
.nav-restore { min-height: 36px; flex: 0 0 auto; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--card); color: var(--primary); font-size: var(--fs-12); }
.navigation-workspace { display: grid; min-width: 0; grid-template-columns: minmax(220px, .8fr) minmax(0, 1.7fr); align-items: start; gap: 20px; margin: 0; padding: 0; border: 0; }
.navigation-arrangement { display: flex; min-width: 0; flex-direction: column; gap: 10px; }
.nav-sort-hint { margin: 0; color: var(--muted); font-size: var(--fs-11); line-height: 1.6; }
.navigation-edit-list { display: flex; min-width: 0; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.navigation-edit-row { display: flex; min-width: 0; min-height: 50px; align-items: center; gap: 7px; padding: 6px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--card); }
.navigation-edit-row.dragging { border-color: var(--primary); background: var(--primary-soft); box-shadow: var(--shadow-sm); }
.nav-drag-handle { display: grid; width: 26px; height: 36px; flex: 0 0 26px; place-items: center; padding: 0; border: 0; border-radius: var(--radius-7); background: transparent; color: var(--muted); font-size: var(--fs-18); cursor: grab; touch-action: none; user-select: none; }
.nav-drag-handle:active { cursor: grabbing; }
.nav-row-number { display: grid; width: 20px; height: 20px; flex: 0 0 20px; place-items: center; border-radius: var(--radius-circle); background: var(--bg); color: var(--muted); font-size: var(--fs-10); }
.nav-item-icon { width: 22px; flex: 0 0 22px; text-align: center; font-size: var(--fs-16); }
.nav-item-name { min-width: 0; flex: 1; overflow: hidden; font-size: var(--fs-13); font-weight: var(--fw-600); text-overflow: ellipsis; white-space: nowrap; }
.nav-row-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.nav-row-actions button { min-width: 32px; min-height: 34px; padding: 5px 7px; border: 1px solid var(--border); border-radius: var(--radius-7); background: var(--bg); color: var(--text); font-size: var(--fs-12); }
.nav-row-actions .nav-remove { border-color: transparent; background: transparent; color: var(--muted); }
.nav-remove:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
.nav-fixed-note { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--radius-9); background: var(--bg); color: var(--muted); font-size: var(--fs-12); }
.nav-empty-note { margin: 0; padding: 14px 8px; color: var(--muted); font-size: var(--fs-12); line-height: 1.7; }
.desktop-nav-groups { display: flex; min-width: 0; flex-direction: column; gap: 10px; }
.desktop-nav-edit-group { display: flex; min-width: 0; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--bg-tint); }
.desktop-nav-group-header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }
.desktop-nav-group-header input { width: 100%; min-width: 0; min-height: 36px; flex: 1; padding: 6px 8px; border: 1px solid transparent; border-radius: var(--radius-7); background: transparent; color: var(--text); font-size: var(--fs-13); font-weight: var(--fw-700); }
.desktop-nav-group-header input:hover, .desktop-nav-group-header input:focus { border-color: var(--border); background: var(--card); }
.desktop-nav-group-header input[aria-invalid='true'] { border-color: var(--danger); }
.desktop-group-items .navigation-edit-row { flex-wrap: wrap; gap: 5px; }
.desktop-group-items .nav-item-name { flex-basis: calc(100% - 70px); }
.nav-destination { min-width: 0; min-height: 34px; max-width: calc(100% - 160px); flex: 1; margin-left: 31px; padding: 4px 7px; border: 1px solid var(--border); border-radius: var(--radius-7); background: var(--bg); color: var(--ink-soft); font-size: var(--fs-11); }
.nav-add-group { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px; padding: 4px 0; }
.nav-add-group label { width: 100%; color: var(--ink-soft); font-size: var(--fs-12); }
.nav-add-group input { width: 0; min-width: 0; min-height: 40px; flex: 1; padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--card); color: var(--text); font-size: var(--fs-13); }
.nav-add-group button { min-height: 40px; flex: 0 0 auto; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--primary-soft); color: var(--primary); font-size: var(--fs-12); }
.navigation-footer { display: flex; flex-direction: column; gap: 8px; }
.navigation-save-row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 14px; }
.navigation-save-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.navigation-save-copy b { color: var(--muted); font-size: var(--fs-12); font-weight: var(--fw-600); }
.navigation-save-copy b.dirty { color: var(--warning); }
.navigation-save-copy small { color: var(--muted); font-size: var(--fs-11); line-height: 1.5; }
.navigation-footer-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
.nav-history { min-height: 40px; padding: 6px 9px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--card); color: var(--ink-soft); font-size: var(--fs-13); }
.nav-save { min-height: 40px; white-space: nowrap; }
.navigation-feedback { margin: 0; color: var(--success); font-size: var(--fs-12); line-height: 1.6; }
.navigation-feedback.error { color: var(--danger); }
.navigation-conflict { padding: 12px; border: 1px solid var(--warning); border-radius: var(--radius-10); background: var(--card); }
.navigation-conflict p { margin: 0 0 8px; color: var(--warning); font-size: var(--fs-12); }
.navigation-conflict > div { display: flex; flex-wrap: wrap; gap: 8px; }
.navigation-conflict button { min-height: 36px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg); color: var(--text); font-size: var(--fs-12); }
.nav-dialog-message { margin: 0 0 12px; color: var(--ink-soft); font-size: var(--fs-14); line-height: 1.7; }
.nav-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.nav-discard { color: var(--danger); }
.nav-removal-target { width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--card); color: var(--text); }
.navigation-settings button:disabled, .navigation-footer button:disabled { cursor: not-allowed; opacity: .48; }
.navigation-settings button:focus-visible, .navigation-settings input:focus-visible, .navigation-settings select:focus-visible, .navigation-footer button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
@media (max-width: 760px) {
  .navigation-workspace { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .navigation-section-heading { gap: 8px; }
  .navigation-save-row { flex-wrap: wrap; gap: 10px; }
  .navigation-save-copy { width: 100%; }
  .navigation-footer-actions { width: 100%; }
  .nav-save { flex: 1; }
  .navigation-edit-row { gap: 5px; }
  .nav-row-number { display: none; }
}
@media (max-width: 360px) {
  .nav-row-actions { gap: 2px; }
  .nav-row-actions button { padding-inline: 5px; }
  .nav-destination { margin-left: 0; max-width: calc(100% - 150px); }
}
</style>
