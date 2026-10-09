<script setup>
import Modal from './Modal.vue'
import { useQuickRecordPanel } from '../composables/useQuickRecordPanel.js'

const props = defineProps({
  open: Boolean,
  initialText: { type: String, default: '' },
  context: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['close', 'saved'])

const {
  input,
  inputEl,
  forcedType,
  drafts,
  expandedId,
  feedback,
  error,
  saving,
  clipboardHint,
  listening,
  voiceSupported,
  panelId,
  courseListId,
  draftStatus,
  validationAttempted,
  lastSaved,
  clipboardLoading,
  actions,
  hasDrafts,
  selectedDrafts,
  examples,
  placeholder,
  draftIssues,
  saveLabel,
  categoryEditorId,
  categoryPickerOffset,
  recentRecords,
  totalExpense,
  totalIncome,
  voiceStatusText,
  courses,
  recordTypeMeta,
  previewTypes,
  catInfo,
  onSmartInput,
  onSmartKeydown,
  chooseAction,
  chooseAuto,
  recentIcon,
  recentTitle,
  reuseRecent,
  changeDraftType,
  onDraftTypeSelect,
  chooseCategory,
  toggleCategoryEditor,
  chooseQuestion,
  categoryLabel,
  categoryOptions,
  confirmCategory,
  onDraftTitleChange,
  syncDraftCourse,
  requestClose,
  saveAll,
  retryAs,
  fieldId,
  issueFor,
  fieldDescription,
  detailsControlId,
  isFinancial,
  setAllSelected,
  removeDraft,
  clearEntry,
  useExample,
  undoLastSaved,
  toggleVoice,
  useClipboard,
  pasteClipboard,
} = useQuickRecordPanel(props, emit)
</script>

<template>
  <Modal :open="open" title="⚡ 快速记录" medium sheet :auto-focus="false" :sheet-detents="[0.82, 0.92]" @close="requestClose">
    <section class="quick-record">
      <fieldset class="entry-fields" :disabled="saving" aria-label="编辑快速记录">
        <div class="compose-heading"><b>想到就记，保存前再确认</b><small>待办 · 日程 · 收支 · 重要日期</small></div>
        <div class="input-wrap">
          <textarea
            ref="inputEl"
            v-model="input"
            :readonly="listening"
            class="smart-input"
            rows="2"
            autocomplete="off"
            inputmode="text"
            aria-label="快速记录内容"
            :placeholder="placeholder"
            :aria-describedby="`quick-input-help-${panelId}`"
            @input="onSmartInput"
            @compositionend="onSmartInput"
            @keydown.enter.exact="onSmartKeydown"
            @keydown.ctrl.enter="onSmartKeydown"
            @keydown.meta.enter="onSmartKeydown"
          />
          <button
            v-if="voiceSupported"
            class="mic"
            :class="{ on: listening }"
            type="button"
            :aria-label="listening ? '停止语音' : '语音输入'"
            @click="toggleVoice"
          >{{ listening ? '⏹' : '🎤' }}</button>
        </div>

        <div class="input-tools">
          <p :id="`quick-input-help-${panelId}`" class="example">一行一项，可混合记录。<span class="desktop-key-hint">Enter 保存 · Shift + Enter 换行</span><span class="mobile-key-hint">回车换行</span></p>
          <button type="button" :disabled="clipboardLoading" @click="pasteClipboard">{{ clipboardLoading ? '读取中…' : '粘贴文字' }}</button>
          <button v-if="input || hasDrafts" type="button" @click="clearEntry">清空</button>
        </div>
        <p v-if="draftStatus" class="draft-status">{{ draftStatus }} · 仅保留在当前标签页</p>

        <div class="action-row" role="group" aria-label="记录方式">
          <button type="button" :class="{ on: !forcedType }" :aria-pressed="!forcedType" @click="chooseAuto">✨ 自动识别</button>
          <button v-for="action in actions" :key="action.type" type="button" :class="{ on: forcedType === action.type }" :aria-pressed="forcedType === action.type" @click="chooseAction(action.type)">{{ action.icon }} {{ action.label }}</button>
        </div>

        <section v-if="!input.trim()" class="example-block" aria-label="记录示例">
          <p>试试这样记 <small>点击示例，修改后保存</small></p>
          <button v-for="text in examples" :key="text" type="button" class="example-entry" @click="useExample(text)"><span>{{ text.replace(/\n/g, ' / ') }}</span><span aria-hidden="true">↗</span></button>
        </section>

        <p v-if="voiceStatusText" class="voice-status">{{ voiceStatusText }}</p>

        <div v-if="clipboardHint && !input" class="clipboard-hint">
          <span>检测到剪贴板内容：“{{ clipboardHint }}”</span><button type="button" @click="useClipboard">智能识别</button>
        </div>

        <section v-if="!input && recentRecords.length" class="recent-block" aria-label="最近记录">
          <div class="recent-head"><span>最近记录</span><small>点击复用，确认后创建新记录</small></div>
          <button v-for="item in recentRecords" :key="`${item.type}-${item.id}`" type="button" class="recent-row" @click="reuseRecent(item)">
            <span class="recent-icon" aria-hidden="true">{{ recentIcon(item.type) }}</span>
            <span class="recent-name">{{ recentTitle(item) }}</span>
            <small>{{ item.detail }}</small>
          </button>
        </section>

        <section v-if="hasDrafts" class="results">
          <div class="results-heading">
            <p class="result-count">识别到 {{ drafts.length }} 项<span v-if="drafts.length > 1"> · 已选 {{ selectedDrafts.length }} 项</span></p>
            <div v-if="drafts.length > 1" class="selection-actions"><button type="button" @click="setAllSelected(true)">全选</button><button type="button" @click="setAllSelected(false)">取消全选</button></div>
          </div>

          <article v-for="(draft, index) in drafts" :key="draft.id" class="record-card" :class="{ uncertain: draft.uncertain || draft.type === 'unknown' || draft.categoryUncertain, excluded: draft.selected === false, invalid: validationAttempted && Object.keys(draftIssues[draft.id] || {}).length }">
            <div class="record-head">
              <div class="record-heading"><input v-if="drafts.length > 1 || draft.selected === false" v-model="draft.selected" type="checkbox" :aria-label="`选择第 ${index + 1} 项记录`" /><b>{{ recordTypeMeta(draft.type).icon }} {{ recordTypeMeta(draft.type).label }}</b><small v-if="draft.selected === false">暂不保存</small></div>
              <div class="record-head-actions">
                <button type="button" :aria-expanded="expandedId === draft.id" :aria-controls="detailsControlId(draft)" @click="expandedId = expandedId === draft.id ? '' : draft.id">{{ expandedId === draft.id ? '收起' : '修改' }}</button>
                <button type="button" :aria-label="`移除第 ${index + 1} 项草稿`" @click="removeDraft(draft)">移除</button>
              </div>
            </div>

            <div :id="fieldId(draft, 'type-choices')" class="type-switch" role="group" aria-label="纠正记录类型" :aria-describedby="fieldDescription(draft, 'type')">
              <span v-if="draft.uncertain" class="human-confidence">看起来像{{ recordTypeMeta(draft.type).label }}，请确认</span>
              <button v-for="type in previewTypes" :key="type" type="button" :class="{ on: draft.type === type }" :aria-pressed="draft.type === type" @click="changeDraftType(draft, type)">{{ recordTypeMeta(type).label }}</button>
            </div>
            <small v-if="issueFor(draft, 'type')" :id="fieldId(draft, 'type-error')" class="field-error">{{ issueFor(draft, 'type') }}</small>

            <!-- 不确定类型时保留原文，要求先选结构化类型再保存。 -->
            <template v-if="draft.type === 'unknown'">
              <p class="unknown-tip">暂时无法判断这条内容的类型，请先选择它要保存为哪种记录。</p>
              <p class="unknown-source">{{ draft.raw }}</p>
              <div class="fallback-actions">
                <button v-for="type in ['todo', 'event', 'expense']" :key="type" type="button" @click="retryAs(draft, type)">{{ recordTypeMeta(type).icon }} 按{{ recordTypeMeta(type).label }}解析</button>
              </div>
            </template>

            <!-- 普通结构化草稿 -->
            <template v-else>
              <input :id="fieldId(draft, 'title')" v-model="draft.title" class="title-edit" aria-label="记录标题" placeholder="输入标题" :aria-invalid="Boolean(issueFor(draft, 'title')) || undefined" :aria-describedby="fieldDescription(draft, 'title')" @input="onDraftTitleChange(draft)" />
              <small v-if="issueFor(draft, 'title')" :id="fieldId(draft, 'title-error')" class="field-error">{{ issueFor(draft, 'title') }}</small>

              <div class="chips">
                <label v-if="isFinancial(draft)" class="amount-chip">¥ <input :id="fieldId(draft, 'amount')" v-model.number="draft.amount" type="number" min="0.01" step="0.01" inputmode="decimal" aria-label="金额" :aria-invalid="Boolean(issueFor(draft, 'amount')) || undefined" :aria-describedby="fieldDescription(draft, 'amount')" /></label>
                <label v-if="draft.course">{{ draft.course }}</label>
                <span v-if="['expense', 'income', 'bill'].includes(draft.type) && categoryLabel(draft.category)" class="category-chip-wrap">
                  <button type="button" class="category-chip" :aria-expanded="categoryEditorId === draft.id" @click="toggleCategoryEditor(draft, $event)">{{ catInfo(draft.category).icon }} {{ categoryLabel(draft.category) }}</button>
                  <span v-if="categoryEditorId === draft.id" class="category-picker" :style="{ '--picker-left': `${categoryPickerOffset}px` }" role="group" aria-label="选择分类">
                    <button v-for="category in categoryOptions(draft).slice(0, 8)" :key="category.key" type="button" :aria-pressed="draft.category === category.key" @click="chooseCategory(draft, category)">{{ category.icon }} {{ category.name }}</button>
                  </span>
                </span>
                <label v-if="draft.dateRange && !draft.date">时间范围：{{ draft.dateRange }}</label>
                <label v-if="draft.date"><input v-model="draft.date" type="date" aria-label="日期" /></label>
                <button v-else type="button" class="add-field" @click="expandedId = draft.id">{{ ['event', 'countdown', 'bill'].includes(draft.type) ? '补充日期' : '添加日期' }}</button>
                <label v-if="draft.time"><input v-model="draft.time" type="time" aria-label="时间" /></label>
                <label v-if="draft.endTime">至 {{ draft.endTime }}</label>
                <label v-if="draft.location">地点：{{ draft.location }}</label>
                <label v-if="draft.reminder">提醒：{{ draft.reminder }}</label>
                <label v-if="draft.priority === 'high'">🔴 重要</label>
                <label v-if="draft.account">{{ draft.account }}</label>
              </div>
              <small v-if="issueFor(draft, 'amount')" :id="fieldId(draft, 'amount-error')" class="field-error">{{ issueFor(draft, 'amount') }}</small>

              <div v-for="question in draft.questions" :key="question.field" class="question">
                <span>⚠ {{ question.label }}</span>
                <button v-for="choice in question.choices" :key="choice" type="button" @click="chooseQuestion(draft, question.field, choice)">{{ choice }}</button>
              </div>

              <div v-if="draft.uncertain && draft.type !== 'unknown'" class="uncertain-tip">
                <span>看起来像{{ recordTypeMeta(draft.type).label }}，可以确认后保存</span>
              </div>

              <div v-if="draft.categoryUncertain && ['expense', 'income', 'bill'].includes(draft.type)" class="category-tip">
                <span>建议分类：{{ categoryLabel(draft.category) }}<template v-if="draft.categoryAmbiguous">（描述包含多个消费内容）</template></span>
                <button type="button" @click="confirmCategory(draft)">确认分类</button><button type="button" @click="expandedId = draft.id">选择其它分类</button>
              </div>

              <div v-if="expandedId === draft.id" :id="fieldId(draft, 'details')" class="details">
                <label>类型<select :id="fieldId(draft, 'type')" :value="draft.type" @change="onDraftTypeSelect(draft, $event)">
                  <option value="todo">待办</option>
                  <option value="homework">作业</option>
                  <option value="event">日程</option>
                  <option value="expense">支出</option>
                  <option value="income">收入</option>
                  <option value="bill">固定账单</option>
                  <option value="countdown">重要日期</option>
                </select></label>
                <label>日期{{ ['todo', 'homework'].includes(draft.type) ? '（可选）' : '' }}<input :id="fieldId(draft, 'date')" v-model="draft.date" type="date" :aria-invalid="Boolean(issueFor(draft, 'date')) || undefined" :aria-describedby="fieldDescription(draft, 'date')" /><small v-if="issueFor(draft, 'date')" :id="fieldId(draft, 'date-error')" class="field-error">{{ issueFor(draft, 'date') }}</small></label>
                <label>{{ draft.type === 'event' ? '开始时间' : '时间（可选）' }}<input :id="fieldId(draft, 'time')" v-model="draft.time" type="time" :aria-invalid="Boolean(issueFor(draft, 'time')) || undefined" :aria-describedby="fieldDescription(draft, 'time')" /><small v-if="issueFor(draft, 'time')" :id="fieldId(draft, 'time-error')" class="field-error">{{ issueFor(draft, 'time') }}</small></label>
                <label v-if="draft.type === 'event'">结束时间（可选）<input :id="fieldId(draft, 'endTime')" v-model="draft.endTime" type="time" :aria-invalid="Boolean(issueFor(draft, 'endTime')) || undefined" :aria-describedby="fieldDescription(draft, 'endTime')" /><small v-if="issueFor(draft, 'endTime')" :id="fieldId(draft, 'endTime-error')" class="field-error">{{ issueFor(draft, 'endTime') }}</small></label>
                <label v-if="!isFinancial(draft)">地点（可选）<input v-model.trim="draft.location" placeholder="例如：教学楼 201" /></label>
                <label v-if="!isFinancial(draft)">课程（可选）<input v-model="draft.course" :list="courseListId" @input="syncDraftCourse(draft)" /></label>
                <label v-if="isFinancial(draft)">分类<select :id="fieldId(draft, 'category')" v-model="draft.category" :aria-invalid="Boolean(issueFor(draft, 'category')) || undefined" :aria-describedby="fieldDescription(draft, 'category')" @change="confirmCategory(draft)"><option v-for="category in categoryOptions(draft)" :key="category.key" :value="category.key">{{ category.icon }} {{ category.name }}</option></select><small v-if="issueFor(draft, 'category')" :id="fieldId(draft, 'category-error')" class="field-error">{{ issueFor(draft, 'category') }}</small></label>
                <label v-if="['expense', 'income', 'bill'].includes(draft.type)">账户<input v-model.trim="draft.account" placeholder="例如：微信 / 现金" /></label>
                <label v-if="['todo', 'homework'].includes(draft.type)">优先级<select v-model="draft.priority"><option value="normal">普通</option><option value="high">重要</option><option value="low">较低</option></select></label>
                <label v-if="draft.type === 'bill'">重复<select :id="fieldId(draft, 'cycle')" v-model="draft.cycle"><option value="weekly">每周</option><option value="monthly">每月</option><option value="quarterly">每季度</option><option value="yearly">每年</option><option value="once">仅一次</option></select><small v-if="issueFor(draft, 'cycle')" class="field-error">{{ issueFor(draft, 'cycle') }}</small></label>
                <label class="note-field">备注（可选）<textarea v-model="draft.note" rows="2" /></label>
              </div>
            </template>
          </article>

          <div v-if="drafts.length > 1 && (totalExpense || totalIncome)" class="batch-total"><span v-if="totalExpense">支出合计 ¥{{ totalExpense.toFixed(2) }}</span><span v-if="totalIncome">收入合计 ¥{{ totalIncome.toFixed(2) }}</span></div>
        </section>
      </fieldset>

        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="footer">
          <div class="save-feedback"><p v-if="feedback" class="success" role="status">{{ feedback }}</p><button v-if="lastSaved.length" type="button" class="undo-save" :disabled="saving" @click="undoLastSaved">撤销刚才保存</button><small v-if="hasDrafts && !feedback">{{ saving ? '正在保存，请稍候…' : `将保存 ${selectedDrafts.length} 项记录` }}</small></div>
          <div v-if="hasDrafts" class="save-actions">
            <button type="button" class="btn btn-primary" :disabled="saving || !selectedDrafts.length || listening || clipboardLoading" :aria-busy="saving || undefined" @click="saveAll(false)">{{ saveLabel }}</button>
            <button type="button" class="btn btn-ghost" :disabled="saving || !selectedDrafts.length || listening || clipboardLoading" :aria-busy="saving || undefined" @click="saveAll(true)">保存并继续</button>
          </div>
        </div>

      <datalist :id="courseListId"><option v-for="course in courses" :key="course.id" :value="course.name" /></datalist>
    </section>
  </Modal>
</template>

<style scoped>
.quick-record{display:flex;flex-direction:column;gap:11px}
.entry-fields{display:flex;flex-direction:column;gap:11px;min-width:0;margin:0;padding:0;border:0}
.entry-fields:disabled{cursor:progress}
.compose-heading{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:6px;color:var(--text);font-size:var(--fs-13)}
.compose-heading small{color:var(--ink-soft);font-size:var(--fs-11)}
.input-wrap{display:flex;align-items:flex-end;gap:7px;padding:6px 5px 6px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-12);background:var(--card)}
.input-wrap:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
.smart-input{flex:1;min-width:0;min-height:58px;max-height:220px;padding:9px 0;border:0;background:transparent;resize:none;line-height:1.5;font:inherit;color:var(--text)}
.mic{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:44px;height:44px;padding:0 12px;border:0;border-radius:var(--radius-10);background:var(--primary-soft);font-size:var(--fs-17);cursor:pointer;touch-action:manipulation}
.mic.on{color:var(--on-danger,#fff);background:var(--danger)}
.example{flex:1;min-width:0;margin:0;color:var(--ink-soft);font-size:var(--fs-11-5);line-height:1.6}
.input-tools{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:-4px}
.input-tools button,.selection-actions button,.undo-save{min-height:30px;padding:4px 7px;border:0;border-radius:var(--radius-6);background:var(--primary-soft);color:var(--primary);font:inherit;font-size:var(--fs-11-5);cursor:pointer}
.desktop-key-hint{display:block}
.mobile-key-hint{display:none}
.draft-status{margin:0;color:var(--ink-soft);font-size:var(--fs-11)}
.example-block{display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--bg-tint)}
.example-block p{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin:0 0 3px;color:var(--text);font-size:var(--fs-12);font-weight:var(--fw-700)}
.example-block small{color:var(--ink-soft);font-size:var(--fs-11);font-weight:var(--fw-500)}
.example-entry{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:36px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-12);text-align:left;cursor:pointer}
.example-entry span:first-child{min-width:0;overflow-wrap:anywhere}
.example-entry span:last-child{flex-shrink:0;color:var(--primary)}
.example-entry:hover{border-color:var(--primary);background:var(--primary-soft)}
.action-row{display:flex;flex-wrap:wrap;gap:7px;padding-bottom:2px}
.action-row button{flex:0 0 auto;min-height:34px;padding:7px 10px;color:var(--ink-soft);border:1px solid var(--border);border-radius:var(--radius-pill);background:var(--card);font-size:var(--fs-12);font-weight:var(--fw-700);touch-action:manipulation}
.action-row button.on{color:var(--primary);border-color:var(--primary);background:var(--primary-soft)}
.voice-status{margin:0;color:var(--primary);font-size:var(--fs-12);font-weight:var(--fw-700)}
.clipboard-hint{display:flex;gap:8px;align-items:center;padding:9px 10px;color:var(--ink-soft);font-size:var(--fs-12);border-radius:var(--radius-9);background:var(--bg)}
.clipboard-hint span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.clipboard-hint button{padding:5px 7px;color:var(--primary);font-weight:var(--fw-800);border:0;border-radius:var(--radius-6);background:var(--primary-soft)}
.recent-block{display:flex;flex-direction:column;gap:0;padding-top:2px}
.recent-head{display:flex;align-items:baseline;gap:8px;padding:0 2px 5px;color:var(--text);font-size:var(--fs-12);font-weight:var(--fw-800)}
.recent-head small{color:var(--ink-faint);font-size:var(--fs-10-5);font-weight:var(--fw-500)}
.recent-row{display:flex;align-items:center;gap:8px;min-height:38px;padding:6px 2px;color:var(--text);text-align:left;border:0;border-top:1px solid var(--border);background:transparent;cursor:pointer}
.recent-row:hover{color:var(--primary)}
.recent-icon{width:22px;text-align:center;font-size:var(--fs-15)}
.recent-name{flex:1;min-width:0;overflow:hidden;font-size:var(--fs-12-5);font-weight:var(--fw-700);text-overflow:ellipsis;white-space:nowrap}
.recent-row small{max-width:40%;overflow:hidden;color:var(--ink-soft);font-size:var(--fs-11);text-overflow:ellipsis;white-space:nowrap}
.results{display:flex;flex-direction:column;gap:8px}
.results-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px}
.selection-actions{display:flex;gap:5px}
.record-heading{display:flex;align-items:center;gap:7px;min-width:0}
.record-heading input{width:17px;height:17px;accent-color:var(--primary)}
.record-heading small{color:var(--ink-soft);font-size:var(--fs-11)}
.record-card.excluded{border-style:dashed;background:var(--card)}
.record-card.invalid{border-color:var(--danger)}
.field-error{display:block;margin:4px 0;color:var(--danger);font-size:var(--fs-11-5);line-height:1.5}
[aria-invalid="true"]{border-color:var(--danger)}
.batch-total{display:flex;flex-wrap:wrap;gap:6px 14px;padding:10px 12px;border-radius:var(--radius-8);background:var(--primary-soft);color:var(--text);font-size:var(--fs-12);font-weight:var(--fw-700)}
.result-count{margin:0;color:var(--ink-soft);font-size:var(--fs-12)}
.record-card{padding:11px;border:1px solid var(--border);border-radius:var(--radius-11);background:var(--bg-tint)}
.record-card.uncertain{border-color:color-mix(in srgb, var(--warning) 40%, var(--border));background:color-mix(in srgb, var(--warning) 10%, var(--card))}
.record-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--fs-12)}
.record-head b{color:var(--primary)}
.record-head-actions{display:inline-flex;align-items:center;gap:6px}
.record-head button{display:inline-flex;align-items:center;justify-content:center;min-width:24px;min-height:24px;padding:2px 6px;color:var(--ink-faint);font-size:var(--fs-11);border:0;background:transparent}
.type-switch{display:flex;align-items:center;gap:5px;overflow-x:auto;margin:8px 0 2px;padding-bottom:2px}
.type-switch button{flex:0 0 auto;min-height:30px;padding:5px 8px;color:var(--ink-soft);font-size:var(--fs-11);border:1px solid var(--border);border-radius:var(--radius-pill);background:var(--card);touch-action:manipulation}
.type-switch button.on{color:var(--primary);font-weight:var(--fw-800);border-color:var(--primary);background:var(--primary-soft)}
.human-confidence{flex:0 0 auto;color:var(--ink-soft);font-size:var(--fs-11)}
.title-edit{width:100%;margin:7px 0 8px;padding:0;color:var(--text);font-size:var(--fs-15);font-weight:var(--fw-750);border:0;border-bottom:1px solid transparent;background:transparent}
.title-edit:focus{border-bottom-color:var(--primary)}
/* 键盘焦点必须保留全站 focus-visible 焦点环：原来的 :focus{outline:0} 特异性
   压过 style.css 的 :focus-visible 规则，键盘用户几乎看不见焦点。 */
.title-edit:focus:not(:focus-visible){outline:0}
 .unknown-tip,.uncertain-tip,.category-tip{margin:6px 0;padding:7px 8px;color:var(--warning);font-size:var(--fs-11-5);border-radius:var(--radius-7);background:var(--card);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
 .category-tip span{flex:1;min-width:0}
 .category-tip button{padding:4px 7px;color:var(--text);border:1px solid color-mix(in srgb, var(--warning) 40%, var(--border));border-radius:var(--radius-6);background:var(--bg-tint);font-size:var(--fs-11)}
.unknown-source{margin:0;padding:8px 10px;color:var(--ink-soft);font-size:var(--fs-12);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:var(--radius-7);background:var(--card)}
.uncertain-tip button,.fallback-actions button{padding:4px 7px;color:var(--text);border:1px solid color-mix(in srgb, var(--warning) 40%, var(--border));border-radius:var(--radius-6);background:var(--bg-tint);font-size:var(--fs-11)}
.fallback-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}
.chips{display:flex;gap:5px;flex-wrap:wrap}
.chips label{display:flex;align-items:center;gap:2px;min-height:28px;padding:3px 7px;color:var(--ink-soft);font-size:var(--fs-11);border-radius:var(--radius-6);background:var(--card)}
.chips input{width:92px;padding:0;border:0;background:transparent;font:inherit}
.chips input[type="date"]{width:107px}
.chips input[type="time"]{width:62px}
.chips .add-field{min-height:28px;padding:3px 8px;color:var(--primary);font:inherit;font-size:var(--fs-11);border:1px dashed var(--border-strong);border-radius:var(--radius-6);background:var(--card);cursor:pointer}
.category-chip-wrap{position:relative;display:inline-flex}
.category-chip{min-height:28px;padding:3px 8px;color:var(--ink-soft);font-size:var(--fs-11);border:0;border-radius:var(--radius-6);background:var(--card);cursor:pointer}
.category-chip:hover{color:var(--primary)}
.category-picker{position:absolute;top:calc(100% + 5px);left:var(--picker-left,0px);z-index:3;display:flex;flex-wrap:wrap;gap:5px;width:min(300px, calc(100vw - 40px));max-width:calc(100vw - 40px);padding:8px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);box-shadow:var(--shadow-md)}
.category-picker button{min-height:32px;padding:5px 7px;color:var(--ink-soft);font-size:var(--fs-11);border:1px solid var(--border);border-radius:var(--radius-6);background:var(--bg);cursor:pointer}
.category-picker button:hover,.category-picker button[aria-pressed="true"]{color:var(--primary);border-color:var(--primary);background:var(--primary-soft)}
.question{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:8px;color:var(--warning);font-size:var(--fs-11-5)}
.question button{padding:4px 7px;color:var(--text);border:1px solid color-mix(in srgb, var(--warning) 40%, var(--border));border-radius:var(--radius-6);background:var(--bg-tint)}
.details{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
.details label{display:flex;flex-direction:column;gap:4px;color:var(--ink-soft);font-size:var(--fs-11)}
.details textarea,.details input,.details select{width:100%;padding:6px 7px;font-size:var(--fs-12)}
.details .note-field{grid-column:1/-1}
.footer{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:42px;padding:8px 0 4px;background:var(--card)}
.save-feedback{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-width:0}
.save-feedback small{color:var(--ink-soft);font-size:var(--fs-11-5)}
.success{margin:0;color:var(--success);font-size:var(--fs-12)}
.error{margin:0;color:var(--danger);font-size:var(--fs-12)}
.save-actions{display:flex;gap:8px;margin-left:auto}
.save-actions .btn{min-width:88px}
@media(max-width:900px){
.category-chip,.category-picker button{min-width:44px;min-height:44px}
}
@media(max-width:520px){
.action-row{flex-wrap:nowrap;overflow-x:auto}
.compose-heading{flex-direction:column;gap:3px}
.desktop-key-hint{display:none}
.mobile-key-hint{display:inline}
.example-entry,.input-tools button,.selection-actions button,.undo-save,.chips .add-field{min-height:44px}
.details{grid-template-columns:1fr}
.details .note-field{grid-column:auto}
.footer{position:sticky;bottom:0;flex-wrap:wrap;background:var(--card);padding:8px 0 4px}
.save-feedback{width:100%}
.save-actions{width:100%}
.save-actions .btn-primary{flex:1}
.save-actions .btn-ghost{min-width:92px}
.action-row button,.type-switch button,.record-head button,.category-chip,.category-picker button,.question button,.fallback-actions button,.clipboard-hint button{min-height:44px}
.record-head button,.category-chip{padding-inline:10px}
}
</style>
