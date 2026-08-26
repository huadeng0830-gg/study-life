<script setup>
import { computed, ref } from 'vue'
import Modal from './Modal.vue'
import LocalTransfer from './LocalTransfer.vue'
import { checkForAppUpdate, updateMessage } from '../composables/appUpdate.js'
import { markBackedUp, needsBackup } from '../composables/backupReminder.js'
import {
  exportWallpapersForTransfer,
  importWallpapersFromTransfer,
} from '../composables/wallpaperStorage.js'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const selectedBackup = ref(null)
const selectedName = ref('')
const error = ref('')
const message = ref('')
const showTransfer = ref(false)
const includeWallpapers = ref(false)

const STORAGE_KEYS = {
  courses: 'sl_courses',
  countdowns: 'sl_exams',
  tasks: 'sl_tasks',
  courseTemplates: 'sl_course_templates',
  checklists: 'sl_checklists',
  bills: 'sl_bills',
  timeConfig: 'sl_timecfg',
  semester: 'sl_semester',
  theme: 'sl_theme',
  countdownShowPast: 'sl_countdown_show_past',
  foodPlaces: 'sl_food_places',
  foodHistory: 'sl_food_history',
  appearance: 'sl_appearance',
  wallpaperConfig: 'sl_wallpaper_config',
  autoWallpaperColor: 'sl_auto_wallpaper_color',
  wallpaperAccent: 'sl_wallpaper_accent',
}

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function makeBackup() {
  return {
    app: 'study-life',
    version: 5,
    exportedAt: new Date().toISOString(),
    data: {
      courses: readStored(STORAGE_KEYS.courses, []),
      countdowns: readStored(STORAGE_KEYS.countdowns, []),
      tasks: readStored(STORAGE_KEYS.tasks, []),
      courseTemplates: readStored(STORAGE_KEYS.courseTemplates, []),
      checklists: readStored(STORAGE_KEYS.checklists, []),
      bills: readStored(STORAGE_KEYS.bills, []),
      timeConfig: readStored(STORAGE_KEYS.timeConfig, null),
      semester: readStored(STORAGE_KEYS.semester, null),
      theme: readStored(STORAGE_KEYS.theme, 'blue'),
      countdownShowPast: readStored(STORAGE_KEYS.countdownShowPast, false),
      foodPlaces: readStored(STORAGE_KEYS.foodPlaces, []),
      foodHistory: readStored(STORAGE_KEYS.foodHistory, []),
      appearance: readStored(STORAGE_KEYS.appearance, null),
      wallpaperConfig: readStored(STORAGE_KEYS.wallpaperConfig, null),
      autoWallpaperColor: readStored(STORAGE_KEYS.autoWallpaperColor, false),
      wallpaperAccent: readStored(STORAGE_KEYS.wallpaperAccent, '#456fe8'),
    },
  }
}

async function exportBackup() {
  error.value = ''
  const backup = makeBackup()
  try {
    if (includeWallpapers.value) {
      const images = await exportWallpapersForTransfer()
      if (Object.keys(images).length) backup.data.__wallpaper_images = images
    }
  } catch {
    error.value = '壁纸导出失败，已改为仅备份文字数据。'
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `控制台备份-${date}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  message.value = backup.data.__wallpaper_images
    ? `备份文件已导出（含 ${Object.keys(backup.data.__wallpaper_images).length} 张壁纸），请妥善保存。`
    : '备份文件已导出，请妥善保存。'
  markBackedUp()
}

function sanitizeWallpaperImages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value).filter(
    ([target, dataUrl]) => typeof target === 'string' && /^data:image\//.test(String(dataUrl))
  )
  return entries.length ? Object.fromEntries(entries) : null
}

function validateBackup(value) {
  if (!value || value.app !== 'study-life' || ![1, 2, 3, 4, 5].includes(value.version) || !value.data) {
    throw new Error('这不是有效的控制台备份文件')
  }
  const data = value.data
  if (!Array.isArray(data.courses) || !Array.isArray(data.countdowns)) {
    throw new Error('备份文件中的课程或倒计时数据不完整')
  }
  return {
    ...value,
    data: {
      courses: data.courses,
      countdowns: data.countdowns,
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      courseTemplates: Array.isArray(data.courseTemplates) ? data.courseTemplates : [],
      checklists: Array.isArray(data.checklists) ? data.checklists : [],
      bills: Array.isArray(data.bills) ? data.bills : [],
      timeConfig: data.timeConfig && typeof data.timeConfig === 'object' ? data.timeConfig : null,
      semester: data.semester && typeof data.semester === 'object' ? data.semester : null,
      theme: typeof data.theme === 'string' ? data.theme : 'blue',
      countdownShowPast: Boolean(data.countdownShowPast),
      foodPlaces: Array.isArray(data.foodPlaces) ? data.foodPlaces : [],
      foodHistory: Array.isArray(data.foodHistory) ? data.foodHistory : [],
      appearance: data.appearance && typeof data.appearance === 'object' ? data.appearance : null,
      wallpaperConfig: data.wallpaperConfig && typeof data.wallpaperConfig === 'object' ? data.wallpaperConfig : null,
      autoWallpaperColor: Boolean(data.autoWallpaperColor),
      wallpaperAccent: typeof data.wallpaperAccent === 'string' ? data.wallpaperAccent : '#456fe8',
      __wallpaper_images: sanitizeWallpaperImages(data.__wallpaper_images),
    },
  }
}

async function selectFile(event) {
  error.value = ''
  message.value = ''
  selectedBackup.value = null
  const file = event.target.files?.[0]
  if (!file) return
  selectedName.value = file.name
  try {
    selectedBackup.value = validateBackup(JSON.parse(await file.text()))
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法读取这个备份文件'
  } finally {
    event.target.value = ''
  }
}

const summary = computed(() => {
  const data = selectedBackup.value?.data
  if (!data) return null
  return {
    courses: data.courses.length,
    countdowns: data.countdowns.length,
    tasks: data.tasks.length,
    courseTemplates: data.courseTemplates.length,
    checklists: data.checklists.length,
    bills: data.bills.length,
    foodPlaces: data.foodPlaces.length,
    wallpapers: data.__wallpaper_images ? Object.keys(data.__wallpaper_images).length : 0,
  }
})

async function restoreBackup() {
  const backup = selectedBackup.value
  if (!backup) return
  if (!window.confirm('恢复后将覆盖当前浏览器中的课程、倒计时和待办数据，是否继续？')) return

  const { data } = backup
  try {
    localStorage.setItem(STORAGE_KEYS.courses, JSON.stringify(data.courses))
    localStorage.setItem(STORAGE_KEYS.countdowns, JSON.stringify(data.countdowns))
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(data.tasks))
    localStorage.setItem(STORAGE_KEYS.courseTemplates, JSON.stringify(data.courseTemplates))
    localStorage.setItem(STORAGE_KEYS.checklists, JSON.stringify(data.checklists))
    localStorage.setItem(STORAGE_KEYS.bills, JSON.stringify(data.bills))
    if (data.timeConfig) localStorage.setItem(STORAGE_KEYS.timeConfig, JSON.stringify(data.timeConfig))
    if (data.semester) localStorage.setItem(STORAGE_KEYS.semester, JSON.stringify(data.semester))
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(data.theme))
    localStorage.setItem(STORAGE_KEYS.countdownShowPast, JSON.stringify(data.countdownShowPast))
    localStorage.setItem(STORAGE_KEYS.foodPlaces, JSON.stringify(data.foodPlaces))
    localStorage.setItem(STORAGE_KEYS.foodHistory, JSON.stringify(data.foodHistory))
    if (data.appearance) localStorage.setItem(STORAGE_KEYS.appearance, JSON.stringify(data.appearance))
    if (data.wallpaperConfig) localStorage.setItem(STORAGE_KEYS.wallpaperConfig, JSON.stringify(data.wallpaperConfig))
    localStorage.setItem(STORAGE_KEYS.autoWallpaperColor, JSON.stringify(data.autoWallpaperColor))
    localStorage.setItem(STORAGE_KEYS.wallpaperAccent, JSON.stringify(data.wallpaperAccent))
    if (data.__wallpaper_images) {
      await importWallpapersFromTransfer(data.__wallpaper_images, 'replace')
    }
    window.location.reload()
  } catch {
    error.value = '恢复失败，浏览器可能已禁止本地存储或存储空间不足'
  }
}
</script>

<template>
  <Modal :open="open" title="数据备份与恢复" @close="emit('close')">
    <div class="data-manager">
      <p v-if="needsBackup" class="backup-hint">⚠️ 本地数据可能被 iPhone 系统清空（清理后台、删除图标等）。已超过 7 天未备份，建议先导出一份。</p>
      <section class="data-section">
        <div class="section-icon">↓</div>
        <div class="section-copy">
          <h4>导出本地数据</h4>
          <p>将课程、待办、清单、账单、吃饭地点和个性化设置保存为备份文件。可勾选携带壁纸（文件会明显变大）。</p>
          <label class="wallpaper-option"><input v-model="includeWallpapers" type="checkbox" /> 同时包含壁纸图片</label>
          <button class="btn btn-primary" @click="exportBackup">导出备份文件</button>
        </div>
      </section>

      <section class="data-section">
        <div class="section-icon update">↻</div>
        <div class="section-copy">
          <h4>苹果桌面版更新</h4>
          <p>直接在原桌面应用中检查并更新，不要删除图标重新安装；卸载可能同时删除该桌面应用的本地记录。</p>
          <button class="btn btn-primary" @click="checkForAppUpdate()">检查并更新</button>
          <span v-if="updateMessage" class="update-message">{{ updateMessage }}</span>
        </div>
      </section>

      <section class="data-section">
        <div class="section-icon transfer">▦</div>
        <div class="section-copy">
          <h4>本地二维码迁移</h4>
          <p>电脑生成加密二维码，手机扫码后选择合并或覆盖。数据只在两台设备之间传递，不上传服务器。</p>
          <button class="btn btn-primary" @click="showTransfer = true">打开二维码迁移</button>
        </div>
      </section>

      <section class="data-section">
        <div class="section-icon restore">↑</div>
        <div class="section-copy">
          <h4>从备份恢复</h4>
          <p>选择此前导出的 JSON 文件。确认恢复前不会修改当前数据。</p>
          <label class="file-button">
            选择备份文件
            <input type="file" accept="application/json,.json" @change="selectFile" />
          </label>
        </div>
      </section>

      <div v-if="summary" class="restore-preview">
        <b>{{ selectedName }}</b>
        <span>{{ summary.courses }} 门课程</span>
        <span>{{ summary.countdowns }} 个倒计时</span>
        <span>{{ summary.tasks }} 项待办</span>
        <span>{{ summary.courseTemplates }} 个课表模板</span>
        <span>{{ summary.checklists }} 份生活清单</span>
        <span>{{ summary.bills }} 项固定账单</span>
        <span>{{ summary.foodPlaces }} 个吃饭地点</span>
        <span v-if="summary.wallpapers">{{ summary.wallpapers }} 张壁纸</span>
        <button class="btn btn-primary" @click="restoreBackup">确认恢复</button>
      </div>

      <p v-if="message" class="success">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="local-note">
        数据保存在当前浏览器，并同步保留一份设备内安全副本。换设备或清理浏览器前仍建议导出备份。
        <b class="ios-warning">iPhone 注意：清理后台后重开、或删除桌面图标，都可能触发系统清空本地数据（安全副本无法幸免）。请养成定期导出备份的习惯，重要数据建议用二维码迁移到第二台设备。</b>
      </p>
    </div>
  </Modal>

  <LocalTransfer :open="showTransfer" @close="showTransfer = false" />
</template>

<style scoped>
.data-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.backup-hint {
  padding: 10px 12px;
  border: 1px solid #f2d08c;
  border-radius: 10px;
  background: #fffaf0;
  color: #8a6845;
  font-size: 12px;
  line-height: 1.55;
}
.data-section {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fafbfd;
}
.section-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  color: var(--primary);
  font-size: 20px;
  font-weight: 800;
  border-radius: 10px;
  background: var(--primary-soft);
}
.section-icon.restore {
  color: #07805d;
  background: #e7f8f1;
}
.section-icon.transfer {
  color: #89520a;
  background: #fff1d8;
}
.section-icon.update {
  color: #7755d0;
  background: #f0ebff;
}
.update-message {
  color: var(--primary);
  font-size: 11px;
}
.section-copy {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 7px;
}
.section-copy h4 {
  font-size: 14px;
}
.section-copy p,
.local-note {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.file-button {
  display: inline-flex;
  padding: 8px 14px;
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 8px;
  background: var(--primary-soft);
}
.file-button input {
  display: none;
}
.wallpaper-option {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  font-size: 12px;
}
.restore-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  font-size: 12px;
  border: 1px solid #b9e6d5;
  border-radius: 10px;
  background: #f2fbf7;
}
.restore-preview b {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.restore-preview span {
  padding: 4px 7px;
  color: #16745a;
  border-radius: 6px;
  background: #e1f5ed;
}
.restore-preview .btn {
  margin-left: auto;
}
.success {
  color: #07805d;
  font-size: 13px;
}
.error {
  color: var(--danger);
  font-size: 13px;
}
.local-note {
  padding: 0 4px;
}
.ios-warning {
  display: block;
  margin-top: 6px;
  color: #a35e22;
}
</style>
