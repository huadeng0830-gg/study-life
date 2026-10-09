<script setup>
import { defineAsyncComponent, ref, computed, onBeforeUnmount, onDeactivated, onMounted } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { useCourseTemplateCommands } from '../composables/courseTemplates.js'
import { appearance } from '../composables/appearance.js'
import { useStoredRef, MAX_WEEK } from '../composables/store'
import { timeConfig } from '../composables/store/timeConfig.js'
import {
  semester,
  weekOf,
  scheduleExceptions,
  dateForWeekDay,
  repairScheduleExceptionIds,
  upsertScheduleException,
  removeScheduleException,
} from '../composables/store/schedule.js'
import { appToday, currentDayIndex, currentWeek as appCurrentWeek } from '../composables/timeContext.js'
import { isArchived } from '../composables/domain/state.js'
import QuickRecordPanel from '../components/QuickRecordPanel.vue'
import ScheduleGrid from '../components/schedule/ScheduleGrid.vue'
import Toast from '../components/Toast.vue'
import { useScheduleOcrImport } from '../composables/scheduleOcrImport.js'
import { DAYS, useScheduleBatchText } from '../composables/scheduleBatchText.js'
import { useScheduleImportReview } from '../composables/scheduleImportReview.js'
import { useScheduleCourseManager } from '../composables/scheduleCourseManager.js'
import { useScheduleCampusSeason } from '../composables/scheduleCampusSeason.js'
import { useScheduleCourseForm } from '../composables/scheduleCourseForm.js'
import { useScheduleFocusRoute } from '../composables/scheduleFocusRoute.js'

// 弹窗一律按需加载：仅“查看课程表”不再下载作息设置、批量录入等大体量模块，
// 打开课程表更快，内存占用更小（这些弹窗只有在真正点开时才会加载）。
const CourseEditorModal = defineAsyncComponent(() => import('../components/schedule/CourseEditorModal.vue'))
const CourseManagerModal = defineAsyncComponent(() => import('../components/schedule/CourseManagerModal.vue'))
const BatchImportModal = defineAsyncComponent(() => import('../components/schedule/BatchImportModal.vue'))
const ImageCropModal = defineAsyncComponent(() => import('../components/schedule/ImageCropModal.vue'))
const ImportConflictModal = defineAsyncComponent(() => import('../components/schedule/ImportConflictModal.vue'))
const ExceptionsModal = defineAsyncComponent(() => import('../components/schedule/ExceptionsModal.vue'))
const SemesterModal = defineAsyncComponent(() => import('../components/schedule/SemesterModal.vue'))
const TimeSettingsModal = defineAsyncComponent(() => import('../components/schedule/TimeSettingsModal.vue'))

const domain = useDomainCommands()
const { courses, tasks, milestones: countdowns } = domain
const showArchivedCourses = ref(false)
const visibleCourses = computed(() => showArchivedCourses.value ? courses.value : courses.value.filter((course) => !isArchived(course)))
const courseTemplateCommands = useCourseTemplateCommands()
const { templates: courseTemplates } = courseTemplateCommands
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', undoFn: null, viewFn: null, duration: 3200 })
const scheduleNote = useStoredRef('sl_schedule_note', '')
const scheduleNoteEl = ref(null)

function saveScheduleNote() {
  // 备注内容已通过 useStoredRef 自动保存
}

function resizeScheduleNote() {
  const element = scheduleNoteEl.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(Math.max(element.scrollHeight, 38), 180)}px`
}

onMounted(resizeScheduleNote)

function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}

/* ---- ConfirmDialog：字面量与绑定目标必须与 <ConfirmDialog> 同文件 ----
   tests/confirmDialogMigration.test.js 会对每一处 @confirm / @close 逐个对账，
   所以下面这几个 ref 与五个 confirmXxx 函数都留在这里，不随业务块拆出去。 */
const deleteCourseTarget = ref(null)
// 批量删除 / 清空课表的确认目标（为什么快照必须发生在弹确认之前，见 useScheduleCourseManager）。
const coursesRemovalTarget = ref(null) // { ids: string[], message, confirmLabel, doneMessage }
// 模板导入 / 模板删除的确认由子 Modal（CourseManagerModal）的 emit 驱动，确认框会叠成
// 第三层浮层；叠加顺序、Escape 只关最上层、取消后的焦点归还都由 Modal.vue 现有的
// isTopOverlay + 焦点还原机制负责，这里不需要额外处理。
const importTemplateTarget = ref(null)
const deleteTemplateTarget = ref(null)
// 整张替换的快照目标；为什么 draft 要一起存进来，见 useScheduleImportReview 的 commitWholeScheduleReplacement。
const replaceAllTarget = ref(null) // { draft, message }

const showScheduleSettings = ref(false)
const timeSettingsRef = ref(null)
const showSemester = ref(false)
const showExceptions = ref(false)
const clampViewWeek = (week) => Math.min(Math.max(week, 0), MAX_WEEK)
const viewWeek = ref(clampViewWeek(appCurrentWeek.value))
const mobileView = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches ? 'day' : 'week')
const mobileDay = ref(currentDayIndex.value)
const todayIdx = currentDayIndex

/* ---- 业务块拆分：状态与函数都在各自的 composable 里，这里只做依赖注入 ---- */
const campusSeason = useScheduleCampusSeason({ courses, courseTemplates })
const {
  showTimeEditor, settingsSchedule, seasonsForCurrentCampus, showCampusSwitcher,
  showSeasonSwitcher, currentAutoStatus, autoModeInfo, selectScheduleCampus,
  enableAutoSeason, openTimeSettings, courseCountByPeriodId,
} = campusSeason

const courseManager = useScheduleCourseManager({
  domain, courses, courseTemplateCommands, coursesRemovalTarget, importTemplateTarget, deleteTemplateTarget,
})
const {
  showCourseManager, selectedCourseIds, templateName, managerMessage, managerError,
  openCourseManager, toggleCourseSelection, toggleAllCourses, deleteSelectedCourses, clearCurrentSchedule,
  duplicateSelectedCourses, saveCourseTemplate, importCourseTemplate, deleteCourseTemplate,
} = courseManager

// 课程表单与批量录入都只在用户点击时才调用 beginCourseImport，而导入审阅要等它们的
// 缓冲（batchError / showForm / managerMessage）就绪后才实例化。用惰性委托把这处
// 循环依赖推迟到调用时刻，实例化顺序就不会互相卡住。
let importReviewApi = null
const lazyBeginCourseImport = (...args) => importReviewApi.beginCourseImport(...args)

const courseForm = useScheduleCourseForm({
  courses, domain, countdowns, settingsSchedule,
  beginCourseImport: lazyBeginCourseImport, deleteCourseTarget, managerMessage,
})
const {
  form, showForm, editingId, quickHomeworkCourse, openAdd, openEdit, addAnotherInCell,
  saveCourseFromEditor, removeCourseFromEditor, archiveCourseFromEditor, linkedStudyProgress,
  openHomeworkForCourse, closeHomeworkRecord, onHomeworkSaved,
} = courseForm

const batchTextApi = useScheduleBatchText({ courses, beginCourseImport: lazyBeginCourseImport })
const {
  showBatch, batchText, batchError, ocrSummary, message, batchRows, validBatchCount, invalidBatchCount,
  needsReviewCount, batchPeriodOptions, openBatchShift, rememberCourseReviews, clearBatchInput,
  replaceBatchRow, importBatch, continueBatchImport, finishBatchImport, loadBatchParser, getBatchParserApi,
} = batchTextApi

const importReview = useScheduleImportReview({
  courses, domain, batchError, message, clearBatchInput, showForm, managerMessage, replaceAllTarget, showToast,
})
importReviewApi = importReview
const {
  showImportConflict, importDraft, importCommitBusy, lastImportUndo, importSummary, actionableImportItems,
  beginCourseImport, setImportDecision, cancelCourseImportReview, applyAllImportDecisions,
  commitWholeScheduleReplacement, commitCourseImport, undoLastCourseImport,
} = importReview

const focusRoute = useScheduleFocusRoute({ courses, clampViewWeek, viewWeek, mobileDay, showArchivedCourses })
const { focusedCourseId, focusMessage } = focusRoute

const ocrImport = useScheduleOcrImport({
  courses, batchText, batchError, ocrSummary, rememberCourseReviews, loadBatchParser, getBatchParserApi,
})
const {
  showImageCropper, cropImageFile, batchOcrProgress, stopOcr, ocrImage, selectCropImage,
  importExcel, recognizeCroppedImage, retryBatchOCR, continueBatchResults,
} = ocrImport

function stopBackgroundWork() {
  // KeepAlive 离开页面不会卸载组件；此时主动取消 OCR，避免它继续占用新页面的 CPU。
  timeSettingsRef.value?.stopBackgroundWork()
  stopOcr()
}

onDeactivated(stopBackgroundWork)
onBeforeUnmount(stopBackgroundWork)

const curWeek = computed(() => clampViewWeek(appCurrentWeek.value))

function goWeek(delta) {
  const next = viewWeek.value + delta
  if (next >= 0 && next <= MAX_WEEK) viewWeek.value = next
}

function saveSemester(value) {
  if (!value) return
  semester.value.start = value
  viewWeek.value = curWeek.value
  showSemester.value = false
}

function semesterPreview() {
  return weekOf(appToday.value)
}

function shiftMobileDay(delta) {
  const next = mobileDay.value + delta
  if (next >= 0 && next <= 6) mobileDay.value = next
}

const sortedExceptions = computed(() =>
  scheduleExceptions.value.filter((item) => item?.date).slice().sort((a, b) => a.date.localeCompare(b.date)),
)
const exceptionInitialDate = ref(appToday.value)

function openExceptionManager(date) {
  repairScheduleExceptionIds()
  exceptionInitialDate.value = typeof date === 'string' ? date : dateForWeekDay(viewWeek.value, mobileDay.value)
  showExceptions.value = true
}

function saveException(payload) {
  if (!upsertScheduleException(payload)) showToast('课程调整未保存，请检查日期和课程选择', { type: 'error' })
}

function removeException(id) {
  removeScheduleException(id)
}

function confirmCoursesRemoval() {
  const target = coursesRemovalTarget.value
  coursesRemovalTarget.value = null
  if (!target) return
  // 默认只解除课程关联，保留历史任务、考试、日程与备注。
  for (const id of target.ids) domain.deleteCourse(id)
  selectedCourseIds.value = []
  managerMessage.value = target.doneMessage
}

function confirmImportCourseTemplate() {
  const target = importTemplateTarget.value
  importTemplateTarget.value = null
  if (!target) return
  const stamp = Date.now()
  const copies = target.courses.map((course, index) => ({
    ...JSON.parse(JSON.stringify(course)),
    id: `c${stamp}_tpl_${index}`,
  }))
  beginCourseImport(copies, { source: 'template' })
}

function confirmDeleteCourseTemplate() {
  const target = deleteTemplateTarget.value
  deleteTemplateTarget.value = null
  if (!target) return
  courseTemplateCommands.deleteTemplate(target.id)
}

function confirmWholeScheduleReplacement() {
  const target = replaceAllTarget.value
  replaceAllTarget.value = null
  if (!target) return
  void commitCourseImport('replace-all', target.draft)
}

function confirmDeleteCourse() {
  const course = deleteCourseTarget.value
  if (!course) return
  domain.deleteCourse(course.id)
  deleteCourseTarget.value = null
}
</script>

<template>
  <div class="page schedule-page">
    <div class="head">
      <h1 class="page-title">课程表</h1>
      <div class="head-btns">
        <button class="btn btn-ghost" :aria-expanded="showArchivedCourses" @click="showArchivedCourses = !showArchivedCourses">{{ showArchivedCourses ? '返回当前课程' : '历史课程' }}</button>
        <button class="btn btn-ghost" :aria-expanded="showScheduleSettings" @click="showScheduleSettings = !showScheduleSettings">{{ showScheduleSettings ? '收起设置' : '更多设置' }}</button>
      </div>
    </div>

    <section v-if="showScheduleSettings" class="schedule-settings" aria-label="课程表设置">
      <div><h2>课程</h2><button class="btn btn-ghost" @click="openCourseManager">☷ 批量管理</button><button class="btn btn-ghost" @click="openBatchShift">⇩ 导入课程表</button></div>
      <div><h2>时间与日期</h2><button class="btn btn-ghost" @click="showSemester = true">📅 学期</button><button class="btn btn-ghost" @click="openTimeSettings">🕐 作息与节次</button></div>
      <div><h2>显示</h2><button class="btn btn-ghost" @click="mobileView = mobileView === 'day' ? 'week' : 'day'">{{ mobileView === 'day' ? '切换整周视图' : '切换单日视图' }}</button></div>
    </section>

    <div class="toolbar">
      <div class="seg-group skin-switcher">
        <span class="seg-label">皮肤</span>
        <div class="seg">
          <button :class="{ on: appearance.scheduleSkin === 'classic' }" @click="appearance.scheduleSkin = 'classic'">经典</button>
          <button :class="{ on: appearance.scheduleSkin === 'notebook' }" @click="appearance.scheduleSkin = 'notebook'">笔记</button>
          <button :class="{ on: appearance.scheduleSkin === 'timeline' }" @click="appearance.scheduleSkin = 'timeline'">极简</button>
        </div>
      </div>
      <div v-if="showCampusSwitcher" class="seg-group schedule-campus">
        <span class="seg-label">校区</span>
        <div class="seg">
          <button
            v-for="campus in timeConfig.campuses"
            :key="campus.id"
            :class="{ on: settingsSchedule.campusId === campus.id }"
            @click="selectScheduleCampus(campus.id)"
          >
            {{ campus.name }}
          </button>
        </div>
      </div>
      <div v-if="showSeasonSwitcher" class="seg-group schedule-season">
        <span class="seg-label">作息</span>
        <div class="seg">
          <button
            :class="{ on: timeConfig.autoSeason && currentAutoStatus.available }"
            :disabled="!currentAutoStatus.available"
            :title="currentAutoStatus.available ? '根据当前日期自动选择' : '完善生效日期并解决冲突后可用'"
            @click="enableAutoSeason"
          >
            自动
          </button>
          <button
            v-for="season in seasonsForCurrentCampus"
            :key="season.id"
            :class="{ on: !timeConfig.autoSeason && settingsSchedule.seasonId === season.id }"
            @click="timeConfig.autoSeason = false; timeConfig.currentSeason = season.id"
          >
            {{ season.name }}
          </button>
        </div>
      </div>
      <div class="seg-group">
        <span class="seg-label">周次</span>
        <!-- 翻周按钮内部只有「‹」「›」，读屏会把它念成符号，方向信息完全丢失，所以用
             aria-label 说清是上一周还是下一周；符号本身保持可见，不需要 aria-hidden。
             .seg button 的命中区在手机上偏小，一并标记 tap-target 由粗指针样式放大。 -->
        <div class="seg">
          <button class="tap-target" aria-label="上一周" :disabled="viewWeek <= 0" @click="goWeek(-1)">‹</button>
          <!-- 周次本身不是一个动作，只是把「现在在第几周」显示在两个翻周按钮中间。
               它原来写成一个 button 元素，于是变成一个按下去什么都不会发生的 Tab
               停靠点，读屏也会念「第 5 周 按钮」暗示可以点。这里改成非交互的 span：
               它不该出现在 Tab 顺序里，也不该被当成控件。 -->
          <span class="wn" :class="{ thisweek: viewWeek === curWeek }" aria-live="polite">
            {{ viewWeek < 1 ? '开学前' : `第 ${viewWeek} 周` }}
          </span>
          <button class="tap-target" aria-label="下一周" :disabled="viewWeek >= MAX_WEEK" @click="goWeek(1)">›</button>
        </div>
        <button v-if="viewWeek !== curWeek" class="btn btn-ghost" @click="viewWeek = curWeek">
          回到本周
        </button>
      </div>

      <div class="seg-group mobile-view-switcher">
        <span class="seg-label">视图</span>
        <div class="seg">
          <button :class="{ on: mobileView === 'day' }" @click="mobileView = 'day'">单日</button>
          <button :class="{ on: mobileView === 'week' }" @click="mobileView = 'week'">整周</button>
        </div>
      </div>

      <!-- 自动/手动作息模式提示（仅在多作息季时出现） -->
      <p v-if="autoModeInfo" class="auto-mode-hint" :class="autoModeInfo.mode">
        <template v-if="autoModeInfo.mode === 'auto'">⏱ {{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
        <template v-else-if="autoModeInfo.mode === 'unavailable'">⚠ {{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
        <template v-else>✋ {{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
      </p>

      <div class="add-actions">
        <button class="btn btn-ghost" title="放假、调课与补课" @click="openExceptionManager">🗓 课程调整</button>
        <button class="btn btn-primary" @click="openAdd()">＋ 添加课程</button>
      </div>
    </div>

    <p v-if="focusMessage" class="notice-success" role="status">{{ focusMessage }}</p>

    <ScheduleGrid
      :courses="visibleCourses"
      :view-week="viewWeek"
      :mobile-view="mobileView"
      :mobile-day="mobileDay"
      :current-week="curWeek"
      :current-day-index="todayIdx"
      :focused-course-id="focusedCourseId"
      :appearance="appearance"
      @open-add="openAdd"
      @open-edit="openEdit"
      @mobile-day-change="shiftMobileDay"
      @open-adjustments="openExceptionManager"
    />

    <div class="schedule-note">
      <textarea
        ref="scheduleNoteEl"
        v-model="scheduleNote"
        rows="1"
        aria-label="课程表备注"
        placeholder="📝 课程表备注..."
        class="schedule-note-input"
        @input="resizeScheduleNote"
        @blur="saveScheduleNote"
      ></textarea>
    </div>

    <CourseEditorModal
      :open="showForm"
      :editing-id="editingId"
      :form="form"
      :courses="courses"
      :time-config="timeConfig"
      :linked-tasks="editingId ? tasks.filter((task) => task.courseId === editingId) : []"
      :linked-countdowns="editingId ? countdowns.filter((item) => item.category === '学习' && item.courseId === editingId) : []"
      :linked-review-progress="editingId ? linkedStudyProgress(editingId) : null"
      @close="showForm = false"
      @save="saveCourseFromEditor"
      @delete="removeCourseFromEditor"
      @archive="archiveCourseFromEditor"
      @add-another="addAnotherInCell"
      @add-homework="openHomeworkForCourse"
    />

    <QuickRecordPanel
      v-if="quickHomeworkCourse"
      :open="Boolean(quickHomeworkCourse)"
      :context="{ preferredType: 'homework', courseId: quickHomeworkCourse.id, courseName: quickHomeworkCourse.name }"
      @saved="onHomeworkSaved"
      @close="closeHomeworkRecord"
    />

    <ConfirmDialog
      :open="Boolean(deleteCourseTarget)"
      title="删除课程"
      :message="`确定删除课程“${deleteCourseTarget?.name || ''}”吗？关联待办和重要日期会保留，但将不再关联此课程。`"
      confirm-label="删除课程"
      @close="deleteCourseTarget = null"
      @confirm="confirmDeleteCourse"
    />

    <!-- 下面四个都由子 Modal（课程管理器 / 导入冲突审阅）的 emit 驱动，会叠在那一层之上，
         所以一律 v-if 随目标挂载：锚点在打开这一刻才创建，才排得到浮层栈顶端
         （见 ConfirmDialog 顶部的浮层顺序说明）。 -->
    <ConfirmDialog
      v-if="coursesRemovalTarget"
      :open="Boolean(coursesRemovalTarget)"
      title="删除课程"
      :message="coursesRemovalTarget?.message || ''"
      :confirm-label="coursesRemovalTarget?.confirmLabel || '删除'"
      @close="coursesRemovalTarget = null"
      @confirm="confirmCoursesRemoval"
    />

    <ConfirmDialog
      v-if="importTemplateTarget"
      :open="Boolean(importTemplateTarget)"
      title="导入课表模板"
      :message="importTemplateTarget?.message || ''"
      confirm-label="导入"
      @close="importTemplateTarget = null"
      @confirm="confirmImportCourseTemplate"
    />

    <ConfirmDialog
      v-if="deleteTemplateTarget"
      :open="Boolean(deleteTemplateTarget)"
      title="删除课表模板"
      :message="`确定删除课表模板“${deleteTemplateTarget?.name || ''}”吗？`"
      confirm-label="删除模板"
      @close="deleteTemplateTarget = null"
      @confirm="confirmDeleteCourseTemplate"
    />

    <ConfirmDialog
      v-if="replaceAllTarget"
      :open="Boolean(replaceAllTarget)"
      title="替换整张课表"
      :message="replaceAllTarget?.message || ''"
      confirm-label="确认替换"
      @close="replaceAllTarget = null"
      @confirm="confirmWholeScheduleReplacement"
    />

    <CourseManagerModal
      :open="showCourseManager"
      :courses="visibleCourses"
      :templates="courseTemplates"
      :selected-ids="selectedCourseIds"
      :template-name="templateName"
      :message="managerMessage"
      :error="managerError"
      @close="showCourseManager = false"
      @toggle-all="toggleAllCourses"
      @toggle-course="toggleCourseSelection"
      @duplicate="duplicateSelectedCourses"
      @delete-selected="deleteSelectedCourses"
      @clear="clearCurrentSchedule"
      @update:template-name="templateName = $event; managerError = ''"
      @save-template="saveCourseTemplate"
      @import-template="importCourseTemplate"
      @delete-template="deleteCourseTemplate"
    />

    <BatchImportModal
      :show="showBatch"
      :text="batchText"
      :rows="batchRows"
      :valid-count="validBatchCount"
      :invalid-count="invalidBatchCount"
      :review-count="needsReviewCount"
      :days="DAYS"
      :periods="batchPeriodOptions"
      :max-week="MAX_WEEK"
      :progress="batchOcrProgress"
      :summary="ocrSummary"
      :message="message"
      :error="batchError"
      :can-undo="Boolean(lastImportUndo)"
      @close="showBatch = false"
      @update:text="batchText = $event"
      @update:error="batchError = $event"
      @clear="clearBatchInput"
      @replace-row="replaceBatchRow"
      @import="importBatch"
      @upload-image="ocrImage"
      @crop-image="selectCropImage"
      @upload-excel="importExcel"
      @cancel-progress="batchOcrProgress.cancel()"
      @retry-progress="retryBatchOCR"
      @continue-progress="continueBatchResults"
      @wait-progress="batchOcrProgress.continueWaiting()"
      @undo="undoLastCourseImport"
      @continue-import="continueBatchImport"
      @finish-import="finishBatchImport"
    />

    <ImageCropModal :show="showImageCropper" :file="cropImageFile" @close="showImageCropper = false; cropImageFile = null" @confirm="recognizeCroppedImage" />

    <ImportConflictModal
      :show="showImportConflict"
      :draft="importDraft"
      :summary="importSummary"
      :actionable="actionableImportItems"
      :days="DAYS"
      :periods="timeConfig.periods"
      :busy="importCommitBusy"
      :error="batchError"
      @close="cancelCourseImportReview"
      @decision="setImportDecision"
      @decisions="applyAllImportDecisions"
      @commit="commitCourseImport()"
      @replace-all="commitWholeScheduleReplacement"
    />

<ExceptionsModal
      :show="showExceptions"
      :exceptions="sortedExceptions"
      :days="DAYS"
      :all-courses="visibleCourses"
      :initial-date="exceptionInitialDate"
      @close="showExceptions = false"
      @submit="saveException"
      @remove="removeException"
    />

    <SemesterModal
      :show="showSemester"
      :start-date="semester.start"
      :preview-week="semesterPreview()"
      @close="showSemester = false"
      @save="saveSemester"
    />

    <TimeSettingsModal
      ref="timeSettingsRef"
      :show="showTimeEditor"
      :course-count-by-period-id="courseCountByPeriodId"
      @close="showTimeEditor = false"
    />

    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" :view-fn="toast.viewFn" :duration="toast.duration" @action="() => {}" @close="toast.open = false" />
  </div>
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
.timetable {
  grid-template-columns:84px repeat(7,minmax(96px,1fr));
  gap:5px;
  min-width:820px;
  display:grid}
.course.conflict {
  outline:2px dashed var(--danger);
  outline-offset:-2px}

/* `.skin-*` 是 ScheduleGrid 动态拼出来的类（` :class="`skin-${appearance.scheduleSkin}`" `），
   不是死类。第三十七轮的死类清理正是把这类动态前缀当成了没人用，误删了 6 个文件约 259 条规则；
   这一族规则是在用构建产物恢复时一并搬进来的，**别在没有比对 ScheduleGrid 的定义之前删它们**。
   另外本文件里 `.skin-notebook` 一族出现了两次、声明逐字相同（记在 §4 第 23 条待清理）。 */
.skin-notebook {
  background:linear-gradient(90deg,#0000 58px,#da5e5e38 59px,#0000 60px),repeating-linear-gradient(#fffdf7 0 31px,#dce7ef 32px);
  border-color:#ddcfab;
  box-shadow:0 10px 28px #6c532317}
/* 「聚焦态」反馈条：模板用了 .notice-success，但这条类只在**别的组件**的 scoped 块里定义过
   （TasksView / EventsView / WeeklyReviewView），scoped 样式不会跨组件生效，
   于是这里渲染成默认段落（正文黑字 + 默认外边距），与全站绿色成功提示不一致。
   注意：LedgerView.vue 也用了同一个类、同样是**本地没有定义**，两处一起补齐。 */
.notice-success {
  margin:12px 0 0;
  color:var(--success);
  font-size:var(--fs-12)}
.page {
  flex-direction:column;
  gap:16px;
  display:flex}
.head {
  justify-content:space-between;
  align-items:center;
  display:flex}
.head h2 {
  font-size:var(--fs-22)}
.head-btns {
  gap:10px;
  display:flex}
.schedule-settings {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-12);
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:12px;
  padding:14px;
  display:grid}
.schedule-settings>div {
  flex-wrap:wrap;
  align-items:center;
  gap:7px;
  min-width:0;
  display:flex}
.schedule-settings h2 {
  width:100%;
  color:var(--ink-faint);
  letter-spacing:.04em;
  font-size:var(--fs-11)}
.schedule-settings .btn {
  padding:7px 10px;
  font-size:var(--fs-12)}
.toolbar {
  flex-wrap:wrap;
  align-items:center;
  gap:16px;
  display:flex}
.seg-group {
  align-items:center;
  gap:8px;
  min-width:0;
  display:flex}
.seg-label {
  color:var(--muted);
  font-size:var(--fs-13)}
.seg {
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius-10);
  max-width:100%;
  padding:3px;
  display:flex;
  overflow-x:auto}
.seg button {
  color:var(--muted);
  background:0 0;
  border:none;
  border-radius:var(--radius-8);
  flex:none;
  padding:7px 14px;
  font-size:var(--fs-14)}
.seg button:disabled {
  opacity:.35;
  cursor:default}
.seg button.on {
  background:var(--primary);
  color:var(--on-primary,#fff);
  font-weight:var(--fw-600)}
.seg .wn {
  min-width:84px;
  color:var(--text);
  border-radius:var(--radius-8);
  flex:none;
  place-items:center;
  padding:7px 14px;
  font-size:var(--fs-14);
  font-weight:var(--fw-700);
  display:grid}
.seg .wn.thisweek {
  color:var(--primary)}
.add-actions {
  gap:8px;
  min-width:0;
  margin-left:auto;
  display:flex}
.exception-tag.makeup {
  color:var(--primary);
  background:var(--primary-soft)}
/* 这一条**必须**排在上一条之后，位置别再挪。两者特异性相同（都是 0,2,0）、都设 background，
   所以顺序直接决定"笔记本皮肤下悬停或今天是格用哪个底色"。第五十一轮做同值规则去重时，
   后出现的那份 `.skin-notebook` 一族被删掉，顺序因此翻转；这里把这一条移回它最后一次出现的
   位置，恢复去重前的级联结果。改位置前先看 tests/cssRules.test.js 里的顺序判据。 */

.auto-mode-hint {
  color:var(--ink-soft);
  flex-wrap:wrap;
  align-items:baseline;
  gap:10px;
  margin:-6px 0 0;
  font-size:var(--fs-12);
  line-height:1.5;
  display:flex}
.auto-mode-hint small {
  color:var(--ink-faint);
  font-size:var(--fs-11)}
.auto-mode-hint.auto small:before {
  content:"·";
  margin:0 6px}
.auto-mode-hint.unavailable {
  color:var(--warning)}
.mobile-view-switcher {
  display:flex}
@media (min-width:901px) {
  .schedule-page>.toolbar {
  border:1px solid var(--border);
  background:var(--card);
  border-radius:var(--radius-12);
  gap:12px;
  padding:12px 14px}
.schedule-page>.toolbar .seg-group {
  gap:7px}
.schedule-page>.toolbar .seg button {
  padding:7px 11px}
}
@media (max-width:760px) {
  .skin-switcher,.schedule-campus,.schedule-season {
  display:none}
.schedule-settings {
  grid-template-columns:1fr;
  gap:11px}
.head {
  flex-direction:column;
  align-items:flex-start;
  gap:12px}
.head-btns {
  flex-wrap:nowrap;
  width:100%;
  padding-bottom:2px;
  overflow-x:auto}
.head-btns .btn {
  flex:none;
  min-height:44px;
  padding-inline-start:12px;
  padding-inline-end:12px}
.toolbar {
  align-items:flex-start;
  gap:12px}
.seg-group {
  flex-direction:column;
  align-items:flex-start;
  gap:5px;
  max-width:100%}
.toolbar .seg {
  max-width:calc(100vw - 40px)}
.add-actions {
  width:100%;
  margin-left:0}
.add-actions .btn {
  text-overflow:ellipsis;
  white-space:nowrap;
  flex:1;
  min-width:0;
  overflow:hidden}
.manager-head,.clear-row {
  flex-direction:column;
  align-items:flex-start}
.manager-actions,.manager-actions .btn,.clear-row .btn {
  width:100%}

.mobile-view-switcher {
  display:flex}
}
@media (max-width:520px) {
  .head h2 {
  font-size:var(--fs-20)}

.mobile-view-switcher {
  width:100%}
.mobile-view-switcher .seg,.mobile-view-switcher .seg button {
  flex:1}
}

.schedule-note {
  margin-top:8px}
.schedule-note-input {
  border:1px solid var(--border);
  background:var(--card);
  width:100%;
  min-height:38px;
  max-height:180px;
  color:var(--text);
  resize:vertical;
  -webkit-overflow-scrolling:touch;
  touch-action:pan-y;
  transition:border-color var(--dur-base) var(--ease-standard), box-shadow var(--dur-base) var(--ease-standard);
  border-radius:var(--radius-10);
  padding:10px 14px;
  font-size:var(--fs-14);
  line-height:1.55;
  overflow-y:auto}
/* 不再写 outline:none：scoped 类选择器的特异性会压过全局 :focus-visible 焦点环。
   鼠标点击的默认 UA 环由全局 input:focus 样式（style.css 已统一处理）。 */
.schedule-note-input:focus {
  border-color:var(--primary);
  box-shadow:0 0 0 3px var(--primary-soft)}
.schedule-note-input::placeholder {
  color:var(--muted)}

</style>
