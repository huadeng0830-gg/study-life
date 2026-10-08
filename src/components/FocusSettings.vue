<script setup>
import { ref, watch } from 'vue'
import Modal from './Modal.vue'
import { useStoredRef } from '../composables/store/index.js'
import { DEFAULT_FOCUS_SETTINGS } from '../composables/focusTimer.js'
import { focusSettingsDraftOf, prepareFocusSettingsSave } from '../composables/focusSettingsEditor.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const settings = useStoredRef('sl_focus_settings', DEFAULT_FOCUS_SETTINGS)
const draft = ref(focusSettingsDraftOf(DEFAULT_FOCUS_SETTINGS))
const error = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    draft.value = focusSettingsDraftOf(settings.value)
    error.value = ''
  }
)

async function save() {
  const result = prepareFocusSettingsSave(settings.value, draft.value)
  if (!result.ok) {
    error.value = result.error
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
  settings.value = result.settings
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
        <h4>番茄轮次</h4>
        <label class="rounds-setting" for="focus-rounds">每组轮数
          <input id="focus-rounds" v-model.number="draft.pomodoroRounds" type="number" min="1" max="12" step="1" inputmode="numeric" />
          <span>轮</span>
        </label>
        <p class="hint">专注计时结束后自动开始休息；每组最后一轮休息 10 分钟，其余轮次休息 5 分钟。</p>
      </section>

      <section>
        <h4>完成提醒</h4>
        <label class="toggle-row"><input v-model="draft.soundEnabled" type="checkbox" /> <span><b>声音</b><small>专注结束时播放提示音</small></span></label>
        <label class="toggle-row"><input v-model="draft.vibrationEnabled" type="checkbox" /> <span><b>震动</b><small>支持的移动设备会震动提醒</small></span></label>
        <label class="toggle-row"><input v-model="draft.systemNotificationEnabled" type="checkbox" /> <span><b>系统通知</b><small>需要浏览器通知权限；未授权时自动跳过</small></span></label>
      </section>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
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
  font-size: var(--fs-14);
  margin: 0;
}
.hint {
  margin: 0;
  color: var(--ink-soft);
  font-size: var(--fs-12);
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
  border-radius: var(--radius-10);
  padding: 8px 10px;
  font-size: var(--fs-13);
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
  font-size: var(--fs-12);
}
.rounds-setting { display: flex; align-items: center; gap: 8px; color: var(--ink-soft); font-size: var(--fs-12); }
.rounds-setting input { width: 72px; min-height: 38px; padding: 7px 8px; text-align: center; }
.reset-btn {
  align-self: flex-start;
  padding: 6px 12px;
  font-size: var(--fs-12-5);
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
  font-size: var(--fs-12);
}
.error {
  color: var(--danger);
  font-size: var(--fs-12-5);
  margin: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
@media (max-width: 520px) {
  .time-grid {
    grid-template-columns: 1fr;
  }
}
</style>
