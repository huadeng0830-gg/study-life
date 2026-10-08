<script setup>
import Modal from '../Modal.vue'
import { periodLabelById } from '../../composables/store/timeConfig.js'
import { weekLabel } from '../../composables/store/schedule.js'
import { createdDateKey } from '../../composables/settingsPolicy.js'
import { formatAppDate } from '../../composables/timeContext.js'

const props = defineProps({
  open: Boolean,
  courses: { type: Array, required: true },
  templates: { type: Array, required: true },
  selectedIds: { type: Array, required: true },
  templateName: { type: String, default: '' },
  message: { type: String, default: '' },
  error: { type: String, default: '' },
})

const emit = defineEmits([
  'close',
  'toggle-all',
  'toggle-course',
  'duplicate',
  'delete-selected',
  'clear',
  'update:template-name',
  'save-template',
  'import-template',
  'delete-template',
])

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function coursePeriodText(course) {
  const start = periodLabelById(course.start)
  const end = periodLabelById(course.end)
  return course.start === course.end ? start : `${start}至${end}`
}

// 模板保存日期。这是个**纯日期**标签，所以必须按应用的时区策略换算，
// 不能直接 new Date(createdAt).toLocaleDateString()——那个走**设备**时区，
// 用户把时区配置成非设备时区时，这里会与全应用其它日期（appToday / formatAppDate）
// 差一天，出现"模板保存于明天"这种自相矛盾的显示。
// createdDateKey 就是为 createdAt → 日期键这件事写的，注释见 settingsPolicy.js:113-116。
function templateDate(value) {
  const key = createdDateKey(value)
  return key ? formatAppDate(key, { withWeekday: false }) : ''
}

function selected(id) {
  return props.selectedIds.includes(id)
}
</script>

<template>
  <Modal :open="open" title="课程批量管理" wide @close="emit('close')">
    <div class="course-manager">
      <section class="manager-section">
        <div class="manager-head">
          <div><h4>当前课程</h4><span>共 {{ courses.length }} 门，已选择 {{ selectedIds.length }} 门</span></div>
          <div class="manager-actions">
            <button class="btn btn-ghost" :disabled="!courses.length" @click="emit('toggle-all')">{{ selectedIds.length === courses.length ? '取消全选' : '全选' }}</button>
            <button class="btn btn-ghost" :disabled="!selectedIds.length" @click="emit('duplicate')">创建副本</button>
            <button class="btn btn-danger" :disabled="!selectedIds.length" @click="emit('delete-selected')">删除选中</button>
          </div>
        </div>
        <div v-if="courses.length" class="manager-table-scroll">
          <table class="manager-table">
            <!-- 首个表头格是「选择」列（下面每行一个复选框），视觉上留空，但空 <th> 会让读屏
                 把这一列念成无名的表头。用 aria-label 给它一个名字：内容为空、名称不为空。
                 其余表头显式写 scope="col"（WCAG H63）。 -->
            <thead><tr><th scope="col" aria-label="选择"></th><th scope="col">课程</th><th scope="col">星期</th><th scope="col">节次</th><th scope="col">周次</th><th scope="col">地点</th><th scope="col">教师</th></tr></thead>
            <tbody>
              <tr v-for="course in courses" :key="course.id" :class="{ selected: selected(course.id) }">
                <td><input type="checkbox" :checked="selected(course.id)" :aria-label="`选择课程 ${course.name}`" @change="emit('toggle-course', course.id)" /></td>
                <td><b>{{ course.name }}</b></td><td>{{ DAYS[course.day] }}</td><td>{{ coursePeriodText(course) }}</td><td>{{ weekLabel(course) }}</td><td>{{ course.room || '—' }}</td><td>{{ course.teacher || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="manager-empty">当前还没有课程，可以批量录入或从下方模板导入。</p>
        <div class="clear-row"><span>清空前建议先保存课表模板或导出完整备份。</span><button class="btn btn-danger" :disabled="!courses.length" @click="emit('clear')">清空全部课程</button></div>
      </section>

      <section class="manager-section template-section">
        <div class="manager-head"><div><h4>学期课表模板</h4><span>保存当前整张课表，新学期可一键重新导入。</span></div></div>
        <div class="template-save"><input :value="templateName" aria-label="学期课表模板名称" placeholder="例如：2026 秋季学期" @input="emit('update:template-name', $event.target.value)" /><button class="btn btn-primary" @click="emit('save-template')">保存当前课表</button></div>
        <div v-if="templates.length" class="template-list">
          <div v-for="template in templates" :key="template.id" class="template-item"><div><b>{{ template.name }}</b><span>{{ template.courses.length }} 门课程 · {{ templateDate(template.createdAt) }}</span></div><div><button class="btn btn-ghost" @click="emit('import-template', template)">导入</button><button class="template-delete tap-target" aria-label="删除模板" @click="emit('delete-template', template)">✕</button></div></div>
        </div>
        <p v-else class="manager-empty compact">还没有保存过学期课表模板。</p>
      </section>
      <p v-if="message" class="manager-success">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
  </Modal>
</template>

<style scoped>
.course-manager { display: flex; flex-direction: column; gap: 14px; }
.manager-section { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--card); }
.manager-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; border-bottom: 1px solid var(--border); background: var(--bg-tint); }
.manager-head h4 { font-size: var(--fs-14); }
.manager-head span { display: block; margin-top: 3px; color: var(--muted); font-size: var(--fs-11); }
.manager-actions { display: flex; flex-wrap: wrap; gap: 7px; }
.manager-actions .btn, .clear-row .btn, .template-item .btn { padding: 7px 11px; font-size: var(--fs-12); }
.manager-table-scroll { max-height: 280px; overflow: auto; }
.manager-table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: var(--fs-12); }
.manager-table th, .manager-table td { padding: 9px 10px; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--border); }
.manager-table th { position: sticky; top: 0; z-index: 1; color: var(--muted); background: var(--card); }
.manager-table tr.selected td { background: var(--primary-soft); }
.manager-table input { accent-color: var(--primary); }
.manager-empty { padding: 30px 14px; color: var(--muted); font-size: var(--fs-13); text-align: center; }
.manager-empty.compact { padding: 18px 14px; }
.clear-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 14px; color: var(--muted); font-size: var(--fs-11); background: var(--card); }
.template-save { display: flex; gap: 8px; padding: 12px 14px; }
.template-save input { flex: 1; min-width: 0; }
.template-list { border-top: 1px solid var(--border); }
.template-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.template-item:last-child { border-bottom: none; }
.template-item > div:first-child { display: flex; flex-direction: column; gap: 2px; }
.template-item span { color: var(--muted); font-size: var(--fs-11); }
.template-item > div:last-child { display: flex; align-items: center; gap: 6px; }
.template-delete { display: grid; place-items: center; width: 30px; height: 30px; color: var(--muted); border: none; border-radius: var(--radius-7); background: transparent; }
.template-delete:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--card)); }
/* 成功提示落在 Modal 的 var(--card) 上：写死的 #07805d 在深色卡片上只有 3.22:1。 */
.manager-success { color: var(--success); font-size: var(--fs-13); }
@media (max-width: 760px) { .manager-head, .clear-row { align-items: flex-start; flex-direction: column; } .manager-actions, .manager-actions .btn, .clear-row .btn { width: 100%; } .template-save { flex-direction: column; } }
</style>
