<script setup>
import { computed, reactive, ref } from 'vue'
import Modal from '../Modal.vue'
import TaskProgress from '../TaskProgress.vue'

const props = defineProps({
  show: { type: Boolean, required: true },
  text: { type: String, required: true },
  rows: { type: Array, required: true },
  validCount: { type: Number, required: true },
  invalidCount: { type: Number, required: true },
  reviewCount: { type: Number, required: true },
  days: { type: Array, required: true },
  periods: { type: Array, required: true },
  maxWeek: { type: Number, default: 25 },
  progress: { type: Object, required: true },
  summary: { type: String, default: '' },
  message: { type: String, default: '' },
  error: { type: String, default: '' },
  canUndo: { type: Boolean, default: false },
})

const emit = defineEmits([
  'close',
  'update:text',
  'update:error',
  'clear',
  'import',
  'upload-image',
  'crop-image',
  'upload-excel',
  'cancel-progress',
  'retry-progress',
  'continue-progress',
  'wait-progress',
  'undo',
  'continue-import',
  'finish-import',
  'replace-row',
])

const weekTypeLabel = { all: '每周', odd: '单周', even: '双周' }

function onTextInput(event) {
  emit('update:text', event.target.value)
  emit('update:error', '')
}

function onFileChange(event) {
  emit('upload-image', event)
}

function onCropFileChange(event) {
  emit('crop-image', event)
}

function onExcelFileChange(event) {
  emit('upload-excel', event)
}

function coursePeriodText(row) {
  const start = row?.start
  const end = row?.end
  if (!start || !end) return '—'
  const startLabel = props.periods.find((period) => period.id === start)?.label || start
  const endLabel = props.periods.find((period) => period.id === end)?.label || end
  return start === end ? startLabel : `${startLabel} 至 ${endLabel}`
}

const showRowError = computed(() => Boolean(props.error) && !(props.progress?.state?.active && props.progress?.state?.visible))
const reviewRows = computed(() => props.rows.filter((row) => row.needsReview && !row.error))
const editingSourceIndex = ref(null)
const reviewDraft = reactive({
  name: '', day: 0, start: '', end: '', startWeek: 1, endWeek: 16, weekType: 'all', room: '', teacher: '',
})
const weekOptions = computed(() => Array.from({ length: Math.max(1, props.maxWeek) }, (_, index) => index + 1))
const canSaveReviewDraft = computed(() => Boolean(
  reviewDraft.name.trim()
  && reviewDraft.start
  && reviewDraft.end
  && props.periods.some((period) => period.id === reviewDraft.start)
  && props.periods.some((period) => period.id === reviewDraft.end)
  && props.periods.findIndex((period) => period.id === reviewDraft.start) <= props.periods.findIndex((period) => period.id === reviewDraft.end)
  && reviewDraft.startWeek >= 1
  && reviewDraft.endWeek >= reviewDraft.startWeek
  && reviewDraft.endWeek <= props.maxWeek,
))

function onStartWeekChange() {
  if (reviewDraft.endWeek < reviewDraft.startWeek) reviewDraft.endWeek = reviewDraft.startWeek
}

function startReviewEdit(row) {
  if (!row.data) return
  Object.assign(reviewDraft, {
    name: row.data.name || '',
    day: Number(row.data.day) || 0,
    start: row.data.start || '',
    end: row.data.end || '',
    startWeek: Number(row.data.startWeek) || 1,
    endWeek: Number(row.data.endWeek) || 16,
    weekType: row.data.weekType || 'all',
    room: row.data.room || '',
    teacher: row.data.teacher || '',
  })
  editingSourceIndex.value = row.sourceIndex
}

function saveReviewEdit() {
  if (!canSaveReviewDraft.value || editingSourceIndex.value === null) return
  emit('replace-row', {
    sourceIndex: editingSourceIndex.value,
    data: { ...reviewDraft, name: reviewDraft.name.trim(), room: reviewDraft.room.trim(), teacher: reviewDraft.teacher.trim() },
  })
  editingSourceIndex.value = null
}

function reviewReason(row) {
  const reasons = Array.isArray(row.reviewReasons) ? [...row.reviewReasons] : []
  const details = row.confidence?.details || {}
  const fields = [
    ['hasName', '课程名称'],
    ['hasWeekday', '星期'],
    ['hasPeriod', '节次'],
    ['hasWeek', '周次'],
    ['hasRoom', '地点'],
    ['hasTeacher', '教师'],
  ]
  const uncertain = fields.filter(([key]) => details[key] === false).map(([, label]) => label)
  if (uncertain.length) reasons.push(`${uncertain.join('、')}未可靠识别`)
  if (!reasons.length) reasons.push(`整体识别置信度 ${Math.round((Number(row.confidence?.score) || 0) * 100)}%`)
  return [...new Set(reasons)].join('；')
}

function reviewCourseSummary(row) {
  if (!row.data) return '未形成完整课程数据'
  return [
    daysLabel(row.data.day),
    coursePeriodText(row.data),
    row.data.room ? `地点：${row.data.room}` : '地点：未识别',
    row.data.teacher ? `教师：${row.data.teacher}` : '教师：未识别',
  ].join(' · ')
}

function daysLabel(day) {
  return props.days[day] || '星期未识别'
}
</script>

<template>
  <Modal v-if="show" :open="show" title="批量录入课程" wide @close="emit('close')">
    <div class="batch-import">
      <div class="batch-help">
        <b>方式一：粘贴文字</b>（字段顺序不限，分隔符随意）
        <span>每行一门课，自动识别"周一/星期三"、节次"1-2节/第3节"、周次"1-16周/全学期"、单双周、地点、教师。支持 Tab/逗号/空格/中文标点混用。</span>
      </div>

      <div class="batch-help">
        <b>方式二：上传教务系统课表截图/照片</b>
        <span>会读取文字在表格中的位置，自动还原星期、节次、周次、教室和教师。图片不上传服务器，本地完成。</span>
      </div>

      <div class="batch-help">
        <b>方式三：直接上传 Excel 课程表</b>
        <span>支持教务系统导出的 XLSX/XLS/CSV/ODS：既可识别“课程名称、星期、节次”清单，也可识别按星期排布的课表。解析后仍须确认预览才会写入。</span>
      </div>

      <div class="batch-input-row">
        <textarea
          :value="text"
          rows="7"
          placeholder="高等数学 周一 1-2节 1-16周 A201 张老师&#10;大学英语,星期三,3-4,1-16,单周,B305,李老师"
          @input="onTextInput"
          @keydown.stop
          @click.stop
          class="batch-textarea"
        ></textarea>
        <div class="batch-image-upload" @click.stop>
          <label class="file-button" :class="{ busy: progress.state.status === 'running' }">
            <input type="file" accept="image/*" multiple :disabled="progress.state.status === 'running'" @change="onFileChange" hidden />
            <span v-if="progress.state.status === 'running'">🔄 {{ progress.state.latestActivity }}</span>
            <span v-else>📷 上传图片识别</span>
          </label>
          <label class="crop-button" :class="{ busy: progress.state.status === 'running' }">
            <input type="file" accept="image/*" :disabled="progress.state.status === 'running'" @change="onCropFileChange" hidden />
            ✂️ 先框选再识别（单张）
          </label>
          <label class="excel-button" :class="{ busy: progress.state.status === 'running' }">
            <input type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" :disabled="progress.state.status === 'running'" @change="onExcelFileChange" hidden />
            📊 上传 Excel 自动识别
          </label>
          <p class="ocr-hint">支持一次选择多张 PNG/JPG/WebP；长截图会保留小字清晰度，结果逐张追加且不会覆盖已修改内容</p>
          <p class="ocr-hint">Excel 文件仅在当前设备解析；会保留原有预览内容并追加新结果。</p>
          <p v-if="summary" class="ocr-result-hint">{{ summary }}</p>
        </div>
      </div>

      <TaskProgress
        :task="progress.state"
        :elapsed-seconds="progress.elapsedSeconds.value"
        :activity-age-seconds="progress.activityAgeSeconds.value"
        :stalled="progress.isStalled.value"
        @cancel="emit('cancel-progress')"
        @retry="emit('retry-progress')"
        @continue="emit('continue-progress')"
        @wait="emit('wait-progress')"
      />

      <section v-if="reviewRows.length" class="review-checklist" aria-live="polite">
        <header>
          <div>
            <b>请逐项确认以下 {{ reviewRows.length }} 门课程</b>
            <span>核对课程、星期、节次、地点和教师；当前作息设置共有 {{ periods.length }} 个编号节次，可直接在卡片中修改。</span>
          </div>
        </header>
        <ol>
          <li v-for="row in reviewRows" :key="`review-${row.sourceIndex}`">
            <div class="review-course-title">
              <strong>{{ row.data?.name || row.cells?.[0] || '未识别课程' }}</strong>
              <span>第 {{ row.sourceIndex }} 行</span>
              <button v-if="row.data && editingSourceIndex !== row.sourceIndex" type="button" @click="startReviewEdit(row)">直接修改</button>
            </div>
            <template v-if="editingSourceIndex === row.sourceIndex">
              <div class="review-edit-grid">
                <label class="wide"><span>课程名称</span><input v-model="reviewDraft.name" /></label>
                <label><span>星期</span><select v-model.number="reviewDraft.day"><option v-for="(day, index) in days" :key="day" :value="index">{{ day }}</option></select></label>
                <label><span>开始节次</span><select v-model="reviewDraft.start"><option v-for="period in periods" :key="period.id" :value="period.id">第 {{ period.number }} 节 · {{ period.label }}</option></select></label>
                <label><span>结束节次</span><select v-model="reviewDraft.end"><option v-for="period in periods" :key="period.id" :value="period.id">第 {{ period.number }} 节 · {{ period.label }}</option></select></label>
                <label><span>开始周</span><select v-model.number="reviewDraft.startWeek" @change="onStartWeekChange"><option v-for="week in weekOptions" :key="`start-${week}`" :value="week">第 {{ week }} 周</option></select></label>
                <label><span>结束周</span><select v-model.number="reviewDraft.endWeek"><option v-for="week in weekOptions" :key="`end-${week}`" :value="week" :disabled="week < reviewDraft.startWeek">第 {{ week }} 周</option></select></label>
                <label><span>单双周</span><select v-model="reviewDraft.weekType"><option value="all">每周</option><option value="odd">单周</option><option value="even">双周</option></select></label>
                <label><span>地点</span><input v-model="reviewDraft.room" /></label>
                <label><span>教师</span><input v-model="reviewDraft.teacher" /></label>
              </div>
              <div class="review-edit-actions">
                <button type="button" @click="editingSourceIndex = null">取消</button>
                <button type="button" class="save" :disabled="!canSaveReviewDraft" @click="saveReviewEdit">保存并重新校验</button>
              </div>
            </template>
            <template v-else>
              <p>{{ reviewCourseSummary(row) }}</p>
              <em>需要确认：{{ reviewReason(row) }}</em>
            </template>
          </li>
        </ol>
      </section>

      <div v-if="rows.length" class="batch-preview-wrap">
        <div class="batch-summary">
          <b>导入预览</b>
          <span class="ok-text">{{ validCount }} 行可导入</span>
          <span v-if="invalidCount" class="error-text">{{ invalidCount }} 行需修改</span>
          <span v-if="reviewCount" class="warning-text">{{ reviewCount }} 行需要确认</span>
        </div>
        <div class="batch-table-scroll batch-desktop-preview">
          <table class="batch-table">
            <thead>
              <tr>
                <th>行</th><th>课程</th><th>星期</th><th>节次</th><th>周次</th><th>类型</th><th>地点</th><th>教师</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in rows" :key="row.sourceIndex">
                <tr :class="{ invalid: row.error, needsReview: row.needsReview }">
                  <td>{{ row.sourceIndex }}</td>
                  <td>{{ row.data?.name || (row.cells && row.cells[0]) || '—' }}</td>
                  <td>{{ row.data ? days[row.data.day] : (row.cells && row.cells[1]) || '—' }}</td>
                  <td>{{ row.data ? coursePeriodText(row.data) : (row.cells && row.cells[2]) || '—' }}</td>
                  <td>{{ row.data ? `${row.data.startWeek}-${row.data.endWeek}` : (row.cells && row.cells[3]) || '—' }}</td>
                  <td>{{ row.data ? weekTypeLabel[row.data.weekType] : (row.cells && row.cells[4]) || '—' }}</td>
                  <td>{{ row.data?.room || (row.cells && row.cells[5]) || '—' }}</td>
                  <td>{{ row.data?.teacher || (row.cells && row.cells[6]) || '—' }}</td>
                </tr>
                <tr v-if="row.error" class="batch-error-row">
                  <td></td><td colspan="7">
                    <div class="error-message">
                      <span class="error-icon">⚠️</span>
                      <span>{{ row.error }}</span>
                    </div>
                  </td>
                </tr>
                <tr v-if="row.needsReview && !row.error" class="batch-review-row">
                  <td></td><td colspan="7">
                    <div class="review-message">
                      <span class="review-icon">ℹ️</span>
                      <span>需要确认：{{ reviewReason(row) }}</span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div class="batch-mobile-preview">
          <article
            v-for="row in rows"
            :key="`mobile-${row.sourceIndex}`"
            class="batch-mobile-card"
            :class="{ invalid: row.error, needsReview: row.needsReview }"
          >
            <div class="batch-mobile-head">
              <span>第 {{ row.sourceIndex }} 行</span>
              <b>{{ row.data?.name || row.cells?.[0] || '未识别课程' }}</b>
              <em v-if="row.error">需修改</em><em v-else-if="row.needsReview">请确认</em><em v-else class="ok">可导入</em>
            </div>
            <dl v-if="row.data">
              <div><dt>星期</dt><dd>{{ days[row.data.day] }}</dd></div>
              <div><dt>节次</dt><dd>{{ coursePeriodText(row.data) }}</dd></div>
              <div><dt>周次</dt><dd>{{ row.data.startWeek }}-{{ row.data.endWeek }}周 · {{ weekTypeLabel[row.data.weekType] }}</dd></div>
              <div><dt>地点</dt><dd>{{ row.data.room || '—' }}</dd></div>
              <div><dt>教师</dt><dd>{{ row.data.teacher || '—' }}</dd></div>
            </dl>
            <p v-if="row.error">⚠️ {{ row.error }}</p>
            <p v-else-if="row.needsReview">ℹ️ 需要确认：{{ reviewReason(row) }}</p>
          </article>
        </div>
      </div>

      <p v-if="showRowError" class="error">{{ error }}</p>
      <div v-if="message" class="batch-success">
        <b>✓ {{ message }}</b>
        <span>课程已经保存在本机，可以继续录入或返回课表检查。</span>
        <div>
          <button v-if="canUndo" class="btn btn-ghost" @click="emit('undo')">撤销本次导入</button>
          <button class="btn btn-ghost" @click="emit('continue-import')">继续录入</button>
          <button class="btn btn-primary" @click="emit('finish-import')">完成并查看课表</button>
        </div>
      </div>
      <div v-else class="actions">
        <button class="btn btn-ghost" @click="emit('clear')">清空</button>
        <button class="btn btn-primary" :disabled="!validCount || invalidCount" @click="emit('import')">
          导入 {{ validCount }} 门课程
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.batch-import {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.batch-help {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
  border-radius: 10px;
  background: var(--primary-soft);
}
.batch-help b {
  color: var(--text);
}
.batch-input-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.batch-input-row textarea {
  width: 100%;
  min-height: 148px;
  resize: vertical;
  line-height: 1.6;
}
.batch-textarea { box-sizing: border-box; }
.batch-image-upload {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-self: flex-start;
}
.batch-image-upload .file-button {
  display: inline-flex;
  align-items: center;
  padding: 9px 14px;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.batch-image-upload .crop-button{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;color:var(--primary);font-size:12px;font-weight:700;border:1px solid var(--primary);border-radius:8px;background:var(--primary-soft);cursor:pointer}.batch-image-upload .crop-button.busy{opacity:.55;cursor:not-allowed}
.batch-image-upload .excel-button{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;color:#2268ba;font-size:12px;font-weight:700;border:1px solid #8bb7ec;border-radius:8px;background:#f1f7ff;cursor:pointer}.batch-image-upload .excel-button.busy{opacity:.55;cursor:not-allowed}
.file-button.busy {
  pointer-events: none;
  opacity: 0.7;
}
.ocr-hint {
  color: var(--muted);
  font-size: 11px;
  margin: 0;
}
.ocr-result-hint {
  margin: 2px 0 0;
  padding: 8px 10px;
  color: #08785a;
  font-size: 11px;
  line-height: 1.55;
  border: 1px solid #b8e5d7;
  border-radius: 8px;
  background: #effbf7;
}
.batch-preview-wrap {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.batch-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  background: #fafbfd;
}
.batch-summary b { font-size: 12px; }
.ok-text { color: #07805d; }
.error-text { color: var(--danger); }
.warning-text { color: #b88921; }
.batch-table-scroll {
  max-height: 260px;
  overflow: auto;
}
.batch-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 12px;
}
.batch-table th,
.batch-table td {
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
}
.batch-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--muted);
  background: #fff;
}
.batch-table tr.invalid td {
  color: var(--danger);
  background: #fff7f7;
}
.batch-table tr.needsReview td {
  background: #fffbef;
}
.batch-error-row td {
  padding-top: 2px;
  color: var(--danger);
  background: #fff7f7;
}
.batch-review-row td {
  padding-top: 2px;
  color: #9a6414;
  background: #fffbef;
}
.batch-mobile-preview { display: none; }
.batch-success {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  color: #08785a;
  border: 1px solid #a7e3d2;
  border-radius: 12px;
  background: #effbf7;
}
.batch-success span { color: var(--muted); font-size: 12px; line-height: 1.55; }
.batch-success>div { display: flex; justify-content: flex-end; gap: 8px; }
.error-message { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
.review-message { display: flex; align-items: center; gap: 6px; padding: 6px 8px; color: #9a6414; }
.review-checklist {
  padding: 12px;
  color: #7a5317;
  border: 1px solid #edca7b;
  border-radius: 10px;
  background: #fffbef;
}
.review-checklist header b { display: block; color: #62400e; font-size: 13px; }
.review-checklist header span { display: block; margin-top: 3px; font-size: 11px; line-height: 1.5; }
.review-checklist ol {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  max-height: 240px;
  margin: 10px 0 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.review-checklist li { min-width: 0; padding: 9px 10px; border: 1px solid #f0d99e; border-radius: 8px; background: #fff; }
.review-course-title { display: flex; align-items: center; gap: 8px; }
.review-course-title strong { overflow: hidden; color: var(--text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.review-course-title span { flex: none; margin-left: auto; color: var(--muted); font-size: 10px; }
.review-course-title button,
.review-edit-actions button { flex: none; padding: 4px 7px; color: #835711; font-size: 10px; font-weight: 700; border: 1px solid #e3c171; border-radius: 6px; background: #fff8e4; cursor: pointer; }
.review-checklist p { margin: 5px 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
.review-checklist em { color: #9a6414; font-size: 10px; font-style: normal; font-weight: 700; line-height: 1.5; }
.review-edit-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin-top: 9px; }
.review-edit-grid label { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.review-edit-grid label.wide { grid-column: span 2; }
.review-edit-grid label span { color: var(--muted); font-size: 9px; }
.review-edit-grid input,
.review-edit-grid select { width: 100%; min-width: 0; box-sizing: border-box; padding: 6px 7px; font-size: 11px; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
.review-edit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.review-edit-actions button.save { color: #fff; border-color: var(--primary); background: var(--primary); }
.review-edit-actions button:disabled { cursor: not-allowed; opacity: .5; }

@media (max-width: 760px) {
  .review-checklist ol { grid-template-columns: 1fr; max-height: 300px; }
  .review-edit-grid { grid-template-columns: 1fr 1fr; }
  .review-edit-grid label.wide { grid-column: 1 / -1; }
  .batch-summary { flex-wrap: wrap; gap: 6px 10px; }
  .batch-desktop-preview { display: none; }
  .batch-mobile-preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 9px;
  }
  .batch-mobile-card {
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: #fff;
  }
  .batch-mobile-card.invalid { border-color: #f3b7b7; background: #fff7f7; }
  .batch-mobile-card.needsReview:not(.invalid) { border-color: #f1d38b; background: #fffbef; }
  .batch-mobile-head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 7px;
  }
  .batch-mobile-head span { color: var(--muted); font-size: 10px; }
  .batch-mobile-head b {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .batch-mobile-head em {
    padding: 2px 5px;
    color: var(--danger);
    font-size: 9px;
    font-style: normal;
    border-radius: 5px;
    background: #feecec;
  }
  .batch-mobile-head em.ok { color: #08785a; background: #e8f8f2; }
  .batch-mobile-card dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 10px;
    margin: 9px 0 0;
  }
  .batch-mobile-card dl>div { min-width: 0; }
  .batch-mobile-card dt { color: var(--muted); font-size: 9px; }
  .batch-mobile-card dd {
    overflow: hidden;
    margin: 1px 0 0;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .batch-mobile-card p { margin: 8px 0 0; color: var(--danger); font-size: 10px; line-height: 1.5; }
  .batch-success>div { display: grid; grid-template-columns: 1fr 1fr; }
}
</style>
