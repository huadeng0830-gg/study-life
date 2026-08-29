<script setup>
import { computed } from 'vue'
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
  'cancel-progress',
  'retry-progress',
  'continue-progress',
  'wait-progress',
  'undo',
  'continue-import',
  'finish-import',
])

const weekTypeLabel = { all: '每周', odd: '单周', even: '双周' }

function onTextInput(event) {
  emit('update:text', event.target.value)
  emit('update:error', '')
}

function onFileChange(event) {
  emit('upload-image', event)
}

function coursePeriodText(row) {
  const start = row.data.start
  const end = row.data.end
  return start === end ? start : `${start}至${end}`
}

const showRowError = computed(() => Boolean(props.error) && !(props.progress?.state?.active && props.progress?.state?.visible))
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
          <p class="ocr-hint">支持一次选择多张 PNG/JPG/WebP；长截图会保留小字清晰度，结果逐张追加且不会覆盖已修改内容</p>
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
                      <span>置信度: {{ (row.confidence.score * 100).toFixed(0) }}% (建议确认)</span>
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
            <p v-else-if="row.needsReview">ℹ️ 识别结果建议人工确认</p>
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

@media (max-width: 760px) {
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