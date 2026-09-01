<script setup>
import { ref, watch } from 'vue'
import Modal from './Modal.vue'
import { useStoredRef } from '../composables/store/index.js'
import { DEFAULT_FOCUS_SETTINGS, normalizeFocusSettings } from '../composables/focusTimer.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const settings = useStoredRef('sl_focus_settings', DEFAULT_FOCUS_SETTINGS)
const draft = ref({
  quickTimes: [...normalizeFocusSettings(DEFAULT_FOCUS_SETTINGS).quickTimes],
  soundEnabled: true,
  vibrationEnabled: true,
  systemNotificationEnabled: true,
})
const error = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const value = normalizeFocusSettings(settings.value)
    draft.value = {
      quickTimes: [...value.quickTimes],
      soundEnabled: value.soundEnabled,
      vibrationEnabled: value.vibrationEnabled,
      systemNotificationEnabled: value.systemNotificationEnabled,
    }
    error.value = ''
  }
)

async function save() {
  const quickTimes = draft.value.quickTimes.map((value) => Number(value))
  if (quickTimes.some((value) => !Number.isFinite(value) || value < 5 || value > 180)) {
    error.value = '常用时间必须是 5～180 之间的整数'
    return
  }
  const unique = [...new Set(quickTimes.map((value) => Math.round(value)))]
  if (unique.length !== 4) {
    error.value = '4 个常用时间不能重复'
    return
  }
  if (draft.value.systemNotificationEnabled) {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      draft.value.systemNotificationEnabled = false
      error.value = '当前浏览器不支持系统通知，已关闭该选项；声音和震动仍可使用'
      return
    }
    try {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission
      if (permission !== 'granted') {
        draft.value.systemNotificationEnabled = false
        error.value = permission === 'denied'
          ? '浏览器已拒绝通知权限，请在站点设置中允许后再开启'
          : '未获得通知权限，已关闭该选项'
        return
      }
    } catch {
      draft.value.systemNotificationEnabled = false
      error.value = '通知权限请求失败，已关闭该选项；可稍后重试'
      return
    }
  }
  settings.value = normalizeFocusSettings({
    ...normalizeFocusSettings(settings.value),
    quickTimes: unique,
    soundEnabled: draft.value.soundEnabled,
    vibrationEnabled: draft.value.vibrationEnabled,
    systemNotificationEnabled: draft.value.systemNotificationEnabled,
  })
  emit('close')
}
</script>

<template>
  <Modal :open="open" title="⏱ 专注设置" @close="emit('close')">
    <div class="focus-settings">
      <section>
        <h4>常用快捷时间</h4>
        <p class="hint">主界面固定显示 4 个快捷时间 + 自定义，不会增加按钮数量。</p>
        <div class="time-grid">
          <label v-for="(_, index) in 4" :key="index">
            <span>快捷 {{ index + 1 }}</span>
            <input v-model.number="draft.quickTimes[index]" type="number" min="5" max="180" inputmode="numeric" placeholder="5-180" />
            <small>分钟</small>
          </label>
        </div>
        <button class="btn btn-ghost reset-btn" type="button" @click="draft.quickTimes = [...DEFAULT_FOCUS_SETTINGS.quickTimes]">恢复默认 15/25/45/60</button>
      </section>

      <section>
        <h4>完成提醒</h4>
        <label class="toggle-row"><input v-model="draft.soundEnabled" type="checkbox" /> <span><b>声音</b><small>倒计时完成时播放提示音</small></span></label>
        <label class="toggle-row"><input v-model="draft.vibrationEnabled" type="checkbox" /> <span><b>震动</b><small>支持的移动设备会震动提醒</small></span></label>
        <label class="toggle-row"><input v-model="draft.systemNotificationEnabled" type="checkbox" /> <span><b>系统通知</b><small>需要浏览器通知权限；未授权时自动跳过</small></span></label>
      </section>

      <p v-if="error" class="error">{{ error }}</p>
      <div class="actions">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" @click="save">保存设置</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.focus-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.focus-settings section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.focus-settings h4 {
  font-size: 14px;
  margin: 0;
}
.hint {
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.5;
}
.time-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.time-grid label {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--ink-soft);
}
.time-grid input {
  width: 68px;
  flex: 0 0 68px;
  text-align: center;
  padding: 6px 8px;
}
.time-grid small {
  color: var(--ink-faint);
  font-size: 12px;
}
.reset-btn {
  align-self: flex-start;
  padding: 6px 12px;
  font-size: 12.5px;
}
.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--text);
}
.toggle-row input {
  margin-top: 3px;
  accent-color: var(--primary);
}
.toggle-row b,
.toggle-row small {
  display: block;
}
.toggle-row small {
  margin-top: 2px;
  color: var(--ink-faint);
  font-size: 12px;
}
.error {
  color: var(--danger);
  font-size: 12.5px;
  margin: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
@media (max-width: 420px) {
  .time-grid {
    grid-template-columns: 1fr;
  }
}
</style>
