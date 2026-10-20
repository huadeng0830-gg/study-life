<script setup>
import PageHeader from '../components/PageHeader.vue'
import { usePageToast } from '../composables/usePageToast.js'
import { deepClone } from '../utils/clone.js'
import { defineAsyncComponent, ref, computed, onBeforeUnmount, onDeactivated } from 'vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Calendar } from '../components/ui/calendar'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '../components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { useCourseTemplateCommands } from '../composables/courseTemplates.js'
import { appearance } from '../composables/appearance.js'
import { MAX_WEEK } from '../composables/store'
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
import { appToday } from '../composables/timeContext.js'
import { isArchived } from '../composables/domain/state.js'
import { useScheduleWorkspace } from '../composables/scheduleWorkspace.js'
import { useScheduleDialogMounts } from '../composables/scheduleDialogMounts.js'
import ScheduleGrid from '../components/schedule/ScheduleGrid.vue'
import ScheduleNote from '../components/schedule/ScheduleNote.vue'
import Toast from '../components/Toast.vue'
import { useScheduleOcrImport } from '../composables/scheduleOcrImport.js'
import { DAYS, useScheduleBatchText } from '../composables/scheduleBatchText.js'
import { useScheduleImportReview } from '../composables/scheduleImportReview.js'
import { useScheduleCourseManager } from '../composables/scheduleCourseManager.js'
import { useScheduleCampusSeason } from '../composables/scheduleCampusSeason.js'
import { useScheduleCourseForm } from '../composables/scheduleCourseForm.js'
import { useScheduleFocusRoute } from '../composables/scheduleFocusRoute.js'
import LearningNavigation from '../components/learning/LearningNavigation.vue'
import { buildCourseProgress } from '../composables/courseProgress.js'

// 弹窗在首次打开时挂载并加载，之后保留实例以维持关闭动画与草稿。
const QuickRecordPanel = defineAsyncComponent(() => loadDialog(() => import('../components/QuickRecordPanel.vue')))
const CourseEditorModal = defineAsyncComponent(() => loadDialog(() => import('../components/schedule/CourseEditorModal.vue')))
const CourseManagerModal = defineAsyncComponent(() => loadDialog(() => import('../components/schedule/CourseManagerModal.vue')))
const BatchImportModal = defineAsyncComponent(() => loadDialog(() => import('../components/schedule/BatchImportModal.vue')))
const ImageCropModal = defineAsyncComponent(() => loadDialog(() => import('../components/schedule/ImageCropModal.vue')))
const ImportConflictModal = defineAsyncComponent(() => loadDialog(() => import('../components/schedule/ImportConflictModal.vue')))
const ExceptionsModal = defineAsyncComponent(() => loadDialog(() => import('../components/schedule/ExceptionsModal.vue')))
const SemesterModal = defineAsyncComponent(() => loadDialog(() => import('../components/schedule/SemesterModal.vue')))
const TimeSettingsModal = defineAsyncComponent(() => loadDialog(() => import('../components/schedule/TimeSettingsModal.vue')))
const StudyPlanner = defineAsyncComponent(() => import('../components/learning/StudyPlanner.vue'))

const domain = useDomainCommands()
const { courses, tasks, milestones: countdowns } = domain
const showLearningPlan = ref(false)
const courseProfiles = computed(() => buildCourseProgress({ courses: courses.value, tasks: tasks.value, milestones: countdowns.value }))
const courseProgress = computed(() => Object.fromEntries(courseProfiles.value.map((item) => [String(item.course.id), { pending: item.pendingTasks.length, overdue: item.overdueCount } ])))
const learningPendingCount = computed(() => courseProfiles.value.filter((item) => !item.archived).reduce((sum, item) => sum + item.pendingTasks.length, 0))
const editingProfile = computed(() => courseProfiles.value.find((item) => String(item.course.id) === String(editingId.value)))
const courseTemplateCommands = useCourseTemplateCommands()
const { templates: courseTemplates } = courseTemplateCommands
const { toast, showToast } = usePageToast()

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
const {
  showArchivedCourses, visibleCourses, courseQuery, normalizedCourseQuery, filteredCourses,
  clampViewWeek, viewWeek, mobileView, mobileDay, todayIdx, calendarOpen,
  selectedCalendarDate, calendarMinDate, calendarMaxDate, curWeek, weekMeetings,
  searchOccurrences, searchCourseCount, selectedScheduleDate, weekCourseCount,
  weekTeachingDayCount, weekDateRange, showReturnToday, returnToToday, goWeek,
  goToScheduleDate, formatSearchDate, setMobileView, shiftMobileDay,
} = useScheduleWorkspace({ courses })

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

const { mounted: mountedDialogs, load: loadDialog } = useScheduleDialogMounts({
  editor: () => showForm.value, manager: () => showCourseManager.value,
  batch: () => showBatch.value, crop: () => showImageCropper.value,
  conflict: () => showImportConflict.value, exceptions: () => showExceptions.value,
  semester: () => showSemester.value, time: () => showTimeEditor.value,
})

function stopBackgroundWork() {
  // KeepAlive 离开页面不会卸载组件；此时主动取消 OCR，避免它继续占用新页面的 CPU。
  timeSettingsRef.value?.stopBackgroundWork()
  stopOcr()
}

onDeactivated(stopBackgroundWork)
onBeforeUnmount(stopBackgroundWork)


function saveSemester(value) {
  if (!value) return
  semester.value.start = value
  viewWeek.value = curWeek.value
  showSemester.value = false
}

function semesterPreview() {
  return weekOf(appToday.value)
}


const sortedExceptions = computed(() =>
  scheduleExceptions.value.filter((item) => item?.date).slice().sort((a, b) => a.date.localeCompare(b.date)),
)
const exceptionInitialDate = ref(appToday.value)
const exceptionInitialId = ref('')

function openExceptionManager(date, id = '') {
  repairScheduleExceptionIds()
  exceptionInitialDate.value = typeof date === 'string' ? date : dateForWeekDay(viewWeek.value, mobileDay.value)
  exceptionInitialId.value = id
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
    ...deepClone(course),
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
    <PageHeader class="schedule-heading" title="课程表">
          <Badge v-if="showArchivedCourses" variant="secondary" class="archive-badge">历史课程</Badge>
        <p class="schedule-subtitle" aria-live="polite">
          <strong>{{ viewWeek < 1 ? '开学前' : `第 ${viewWeek} 周` }}</strong>
          <span>{{ weekDateRange }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ weekCourseCount }} 门课程，{{ weekTeachingDayCount }} 个上课日</span>
        </p>
      <template #actions>
      <div class="head-btns">
        <Button variant="outline" size="sm" class="btn btn-ghost" :aria-pressed="showArchivedCourses" @click="showArchivedCourses = !showArchivedCourses">{{ showArchivedCourses ? '返回当前课程' : '历史课程' }}</Button>
        <Button variant="outline" size="sm" class="btn btn-ghost" :aria-expanded="showScheduleSettings" aria-controls="schedule-settings" @click="showScheduleSettings = !showScheduleSettings">{{ showScheduleSettings ? '收起设置' : '课表设置' }}</Button>
      </div>
      </template>
    </PageHeader>

    <LearningNavigation current="schedule" />

    <Card v-if="showScheduleSettings" id="schedule-settings" class="schedule-settings panel" role="region" aria-label="课程表设置">
      <div class="settings-heading">
        <h2>课表设置</h2>
        <p>管理课程、学期时间和课表显示方式</p>
      </div>
      <div class="settings-group">
        <h3>课程</h3>
        <div class="settings-actions">
          <Button variant="outline" size="sm" class="btn btn-ghost" @click="openCourseManager">批量管理</Button>
          <Button variant="outline" size="sm" class="btn btn-ghost" @click="openBatchShift">导入课程表</Button>
        </div>
      </div>
      <div class="settings-group">
        <h3>学期与作息</h3>
        <div class="settings-actions">
          <Button variant="outline" size="sm" class="btn btn-ghost" @click="showSemester = true">学期起始日</Button>
          <Button variant="outline" size="sm" class="btn btn-ghost" @click="openTimeSettings">作息与节次</Button>
        </div>
        <div v-if="showCampusSwitcher" class="settings-choice">
          <span class="seg-label">校区</span>
          <div class="seg" role="group" aria-label="选择校区">
            <button v-for="campus in timeConfig.campuses" :key="campus.id" :class="{ on: settingsSchedule.campusId === campus.id }" :aria-pressed="settingsSchedule.campusId === campus.id" @click="selectScheduleCampus(campus.id)">{{ campus.name }}</button>
          </div>
        </div>
        <div v-if="showSeasonSwitcher" class="settings-choice">
          <span class="seg-label">作息方案</span>
          <div class="seg" role="group" aria-label="选择作息方案">
            <button :class="{ on: timeConfig.autoSeason && currentAutoStatus.available }" :aria-pressed="timeConfig.autoSeason && currentAutoStatus.available" :disabled="!currentAutoStatus.available" :title="currentAutoStatus.available ? '根据当前日期自动选择' : '完善生效日期并解决冲突后可用'" @click="enableAutoSeason">自动</button>
            <button v-for="season in seasonsForCurrentCampus" :key="season.id" :class="{ on: !timeConfig.autoSeason && settingsSchedule.seasonId === season.id }" :aria-pressed="!timeConfig.autoSeason && settingsSchedule.seasonId === season.id" @click="timeConfig.autoSeason = false; timeConfig.currentSeason = season.id">{{ season.name }}</button>
          </div>
        </div>
      </div>
      <div class="settings-group">
        <h3>外观</h3>
        <div class="settings-choice">
          <span class="seg-label">课表样式</span>
          <div class="seg" role="group" aria-label="选择课表样式">
            <button :class="{ on: appearance.scheduleSkin === 'classic' }" :aria-pressed="appearance.scheduleSkin === 'classic'" @click="appearance.scheduleSkin = 'classic'">经典</button>
            <button :class="{ on: appearance.scheduleSkin === 'notebook' }" :aria-pressed="appearance.scheduleSkin === 'notebook'" @click="appearance.scheduleSkin = 'notebook'">笔记</button>
            <button :class="{ on: appearance.scheduleSkin === 'timeline' }" :aria-pressed="appearance.scheduleSkin === 'timeline'" @click="appearance.scheduleSkin = 'timeline'">极简</button>
          </div>
        </div>
      </div>
      <p v-if="autoModeInfo" class="auto-mode-hint" :class="autoModeInfo.mode" role="status">
        <template v-if="autoModeInfo.mode === 'auto'">{{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
        <template v-else-if="autoModeInfo.mode === 'unavailable'">{{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
        <template v-else>{{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
      </p>
    </Card>

    <Card class="schedule-toolbar panel" role="region" aria-label="课程表导航与操作">
      <div class="schedule-toolbar-main">
        <div class="week-navigation">
          <span class="toolbar-label">查看周次</span>
          <div class="week-control" role="group" aria-label="切换周次">
            <Button type="button" variant="outline" size="icon" class="week-step tap-target" aria-label="上一周" :disabled="viewWeek <= 0" @click="goWeek(-1)"><span aria-hidden="true">‹</span></Button>
            <Popover v-model:open="calendarOpen">
              <PopoverTrigger as-child>
                <Button type="button" variant="ghost" class="week-current date-jump-button" aria-label="选择日期并跳转到对应周次">
                  <span class="date-jump-copy">
                    <strong>{{ viewWeek < 1 ? '开学前' : `第 ${viewWeek} 周` }}</strong>
                    <span>{{ weekDateRange }}</span>
                  </span>
                  <svg class="date-jump-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="center" :side-offset="8" class="schedule-date-popover">
                <PopoverHeader class="schedule-date-heading">
                  <PopoverTitle>跳转到日期</PopoverTitle>
                  <PopoverDescription>选择日期后显示所在周次和星期</PopoverDescription>
                </PopoverHeader>
                <Calendar
                  :model-value="selectedCalendarDate"
                  :placeholder="selectedCalendarDate"
                  :default-placeholder="selectedCalendarDate"
                  :min-value="calendarMinDate"
                  :max-value="calendarMaxDate"
                  locale="zh-CN"
                  class="schedule-date-calendar"
                  @update:model-value="goToScheduleDate"
                />
              </PopoverContent>
            </Popover>
            <Button type="button" variant="outline" size="icon" class="week-step tap-target" aria-label="下一周" :disabled="viewWeek >= MAX_WEEK" @click="goWeek(1)"><span aria-hidden="true">›</span></Button>
          </div>
          <Button v-if="showReturnToday" type="button" variant="outline" class="today-button" @click="returnToToday">回到今天</Button>
        </div>

        <div class="schedule-toolbar-actions">
          <div class="seg-group mobile-view-switcher">
            <span class="sr-only">视图</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              class="schedule-view-toggle"
              :model-value="mobileView"
              aria-label="选择课表视图"
              @update:model-value="setMobileView"
            >
              <ToggleGroupItem value="day">单日</ToggleGroupItem>
              <ToggleGroupItem value="week">整周</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Button variant="outline" class="btn btn-ghost" title="放假、调课与补课" @click="openExceptionManager">课程调整</Button>
          <Button class="btn btn-primary add-course-button" @click="openAdd()"><span aria-hidden="true">＋</span>添加课程</Button>
        </div>
      </div>

      <div class="schedule-toolbar-bottom">
        <div class="schedule-search" role="search" aria-label="搜索课程">
          <label class="sr-only" for="schedule-course-search">搜索课程、教师或教室</label>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>
          <input id="schedule-course-search" v-model="courseQuery" type="search" placeholder="搜索课程、教师或教室" autocomplete="off" />
          <button v-if="normalizedCourseQuery" type="button" class="search-clear" aria-label="清除课程搜索" @click="courseQuery = ''">清除</button>
        </div>
        <p class="schedule-summary" aria-live="polite">
          <template v-if="normalizedCourseQuery">全学期找到 <strong>{{ searchCourseCount }}</strong> 门课程 · <strong>{{ searchOccurrences.length }}</strong> 条安排</template>
          <template v-else>该周 <strong>{{ weekCourseCount }}</strong> 门课程 · <strong>{{ weekTeachingDayCount }}</strong> 个上课日</template>
        </p>
      </div>
    </Card>

    <section v-if="normalizedCourseQuery" class="schedule-search-results panel" role="region" aria-label="全学期课程搜索结果">
      <header class="schedule-search-results-head">
        <div>
          <h2>全学期搜索结果</h2>
          <p>点击一条安排，跳转到对应周和日期</p>
        </div>
        <p class="schedule-search-results-count">找到 <strong>{{ searchCourseCount }}</strong> 门课程、<strong>{{ searchOccurrences.length }}</strong> 条安排</p>
      </header>
      <div v-if="searchOccurrences.length" class="schedule-search-results-list">
        <button
          v-for="item in searchOccurrences"
          :key="item.id"
          type="button"
          class="schedule-search-result"
          :aria-current="item.date === selectedScheduleDate ? 'date' : undefined"
          @click="goToScheduleDate(item.date)"
        >
          <span class="schedule-search-result-course">
            <strong>{{ item.course.name || '未命名课程' }}</strong>
            <small>{{ [item.course.teacher, item.course.room].filter(Boolean).join(' · ') || '未填写教师和教室' }}</small>
          </span>
          <span class="schedule-search-result-date">第 {{ item.week }} 周 · {{ DAYS[item.day] }} · {{ formatSearchDate(item.date) }}</span>
          <span class="schedule-search-result-arrow" aria-hidden="true">→</span>
        </button>
      </div>
      <p v-else class="schedule-search-results-empty">没有找到符合条件的课程安排，试试课程名、教师名或教室名。</p>
    </section>

    <p v-if="focusMessage" class="notice-success" role="status">{{ focusMessage }}</p>

    <ScheduleGrid
      :courses="filteredCourses"
      :view-week="viewWeek"
      :max-week="MAX_WEEK"
      :mobile-view="mobileView"
      :mobile-day="mobileDay"
      :current-week="curWeek"
      :current-day-index="todayIdx"
      :focused-course-id="focusedCourseId"
      :appearance="appearance"
      :course-progress="courseProgress"
      :search-query="courseQuery"
      :week-meeting-count="weekMeetings.length"
      :search-result-count="searchOccurrences.length"
      @open-add="openAdd"
      @open-edit="openEdit"
      @mobile-day-change="shiftMobileDay"
      @open-adjustments="openExceptionManager"
      @clear-search="courseQuery = ''"
    />

    <Card v-if="!showArchivedCourses" class="learning-plan-section panel" role="region" aria-label="课表学习联动">
      <button type="button" class="learning-plan-toggle" :aria-expanded="showLearningPlan" aria-controls="schedule-learning-plan" @click="showLearningPlan = !showLearningPlan"><span><b>学习安排</b><small>{{ learningPendingCount ? `${learningPendingCount} 项课程待办，利用课表空档继续推进` : '把课程待办、复习和专注接到课表上' }}</small></span><span>{{ showLearningPlan ? '收起 ↑' : '展开 →' }}</span></button>
      <div v-if="showLearningPlan" id="schedule-learning-plan" class="learning-plan-content"><StudyPlanner /></div>
    </Card>

    <ScheduleNote />

    <CourseEditorModal v-if="mountedDialogs.editor"
      :open="showForm"
      :editing-id="editingId"
      :form="form"
      :courses="courses"
      :time-config="timeConfig"
      :linked-tasks="editingProfile?.pendingTasks.map((row) => row.task) || []"
      :linked-countdowns="editingProfile?.milestones.filter((item) => item.category === '学习' && !isArchived(item)) || []"
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

    <CourseManagerModal v-if="mountedDialogs.manager"
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

    <BatchImportModal v-if="mountedDialogs.batch"
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

    <ImageCropModal v-if="mountedDialogs.crop" :show="showImageCropper" :file="cropImageFile" @close="showImageCropper = false; cropImageFile = null" @confirm="recognizeCroppedImage" />

    <ImportConflictModal v-if="mountedDialogs.conflict"
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

<ExceptionsModal v-if="mountedDialogs.exceptions"
      :show="showExceptions"
      :exceptions="sortedExceptions"
      :days="DAYS"
      :all-courses="visibleCourses"
      :initial-date="exceptionInitialDate"
      :initial-exception-id="exceptionInitialId"
      @close="showExceptions = false"
      @submit="saveException"
      @remove="removeException"
    />

    <SemesterModal v-if="mountedDialogs.semester"
      :show="showSemester"
      :start-date="semester.start"
      :preview-week="semesterPreview()"
      @close="showSemester = false"
      @save="saveSemester"
    />

    <TimeSettingsModal v-if="mountedDialogs.time"
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
.learning-plan-section { padding: 0; }
.learning-plan-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 14px 16px; border: 0; border-radius: var(--radius-12); background: transparent; color: var(--primary); text-align: left; cursor: pointer; font-size: var(--fs-12); }
.learning-plan-toggle > span:first-child { display: grid; gap: 4px; min-width: 0; }
.learning-plan-toggle b { color: var(--text); font-size: var(--fs-14); }
.learning-plan-toggle small { color: var(--ink-soft); font-size: var(--fs-12); line-height: 1.5; }
.learning-plan-toggle > span:last-child { flex-shrink: 0; }
.learning-plan-content { padding: 0 16px 16px; }
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
@media (max-width:760px) {
  .skin-switcher {
  display:none}
.schedule-settings {
  grid-template-columns:1fr;
  gap:11px}
.head {
  flex-direction:row;
  align-items:center;
  gap:8px}
.head-btns {
  flex-wrap:nowrap;
  width:auto;
  max-width:calc(100% - 86px);
  padding-bottom:2px;
  overflow-x:auto}
.head-btns .btn {
  flex:none;
  min-height:44px;
  padding-inline-start:12px;
  padding-inline-end:12px}
.seg-group {
  flex-direction:row;
  align-items:center;
  gap:5px;
  max-width:100%}
.mobile-view-switcher .seg-label { display:none; }
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
  width:auto}
.mobile-view-switcher .seg,.mobile-view-switcher .seg button {
  flex:1}
}

/* 课表页沿用全站颜色、圆角、焦点与动效令牌，并把导航、操作和设置分成清晰的组合区。 */
.schedule-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 2px 0;
}
.archive-badge {
  padding: 4px 9px;
  border-radius: var(--radius-pill);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: var(--fs-11);
  font-weight: var(--fw-700);
}
.schedule-subtitle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  color: var(--muted);
  font-size: var(--fs-13);
  line-height: 1.5;
}
.schedule-subtitle strong { color: var(--text); font-weight: var(--fw-700); }
.head-btns { align-items: center; flex-wrap: wrap; }
.schedule-toolbar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-14);
  background: var(--card);
  box-shadow: var(--shadow-sm);
}
.schedule-toolbar-main,
.schedule-toolbar-actions,
.week-navigation,
.week-control,
.schedule-toolbar-bottom {
  display: flex;
  align-items: center;
}
.schedule-toolbar-main { justify-content: space-between; gap: 18px; }
.week-navigation { flex-wrap: wrap; gap: 10px; min-width: 0; }
.toolbar-label { color: var(--muted); font-size: var(--fs-12); font-weight: var(--fw-600); }
.week-control { gap: 4px; }
.week-step {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--card);
  font-size: var(--fs-22);
  line-height: 1;
  transition: background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
.week-step:hover:not(:disabled) { border-color: var(--border-strong); background: var(--bg-tint); }
.week-current { display: grid; min-width: 126px; gap: 2px; padding: 3px 8px; text-align: center; }
.week-current strong { color: var(--text); font-size: var(--fs-14); font-weight: var(--fw-750); }
.week-current span { color: var(--muted); font-size: var(--fs-11); font-variant-numeric: tabular-nums; }
.date-jump-button {
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 42px;
  border: 1px solid transparent;
  border-radius: var(--radius-9);
  background: transparent;
  cursor: pointer;
}
.date-jump-button:hover { background: var(--bg-tint); }
.date-jump-copy { display: grid; gap: 2px; min-width: 0; }
.date-jump-icon { width: 16px; height: 16px; color: var(--primary); }
.schedule-date-heading { padding: 4px 8px 0; }
.schedule-date-heading [data-slot="popover-title"] { color: var(--text); font-size: var(--fs-13); font-weight: var(--fw-700); }
.schedule-date-heading [data-slot="popover-description"] { color: var(--muted); font-size: var(--fs-11); }
.schedule-date-calendar { padding: 6px; }
.schedule-view-toggle {
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--card);
}
.schedule-view-toggle [data-slot="toggle-group-item"] {
  min-height: 36px;
  padding: 6px 12px;
  border: 0;
  border-radius: var(--radius-8);
  color: var(--muted);
}
.schedule-view-toggle [data-state="on"] { background: var(--primary); color: var(--on-primary); }
.schedule-view-toggle [data-state="on"]:hover { background: var(--primary-hover); color: var(--on-primary); }
.today-button {
  min-height: 36px;
  padding: 6px 11px;
  color: var(--primary);
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border));
  border-radius: var(--radius-8);
  background: var(--primary-soft);
  font-size: var(--fs-12);
  font-weight: var(--fw-700);
}
.schedule-toolbar-actions { flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.schedule-toolbar-actions .seg { padding: 3px; }
.schedule-toolbar-actions .seg button { min-height: 36px; padding: 6px 12px; }
.schedule-toolbar-actions .btn { min-height: 40px; padding: 8px 12px; }
.add-course-button { white-space: nowrap; }
.add-course-button span { margin-right: 3px; font-size: var(--fs-18); vertical-align: -1px; }
.schedule-toolbar-bottom {
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.schedule-search {
  display: flex;
  align-items: center;
  gap: 9px;
  width: min(100%, 350px);
  min-height: 42px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-9);
  background: var(--bg-tint);
  transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.schedule-search:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--focus-ring); }
.schedule-search svg { flex: none; width: 18px; height: 18px; fill: none; stroke: var(--muted); stroke-width: 1.8; stroke-linecap: round; }
.schedule-search input {
  width: 100%;
  min-width: 0;
  padding: 8px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  font-size: var(--fs-13);
}
.schedule-search input:focus { border: 0; box-shadow: none; }
.schedule-search input::placeholder { color: var(--ink-faint); }
.search-clear { flex: none; padding: 4px 5px; color: var(--primary); border: 0; background: transparent; font-size: var(--fs-11); font-weight: var(--fw-700); }
.schedule-summary { color: var(--muted); font-size: var(--fs-12); font-variant-numeric: tabular-nums; }
.schedule-summary strong { color: var(--text); font-weight: var(--fw-700); }
.schedule-search-results {
  display: grid;
  gap: 10px;
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: var(--radius-14);
  background: var(--card);
  box-shadow: var(--shadow-sm);
}
.schedule-search-results-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 14px; }
.schedule-search-results-head h2 { color: var(--text); font-size: var(--fs-13); font-weight: var(--fw-750); }
.schedule-search-results-head > div p,
.schedule-search-results-count { color: var(--muted); font-size: var(--fs-11); }
.schedule-search-results-count strong { color: var(--text); font-weight: var(--fw-700); }
.schedule-search-results-list { display: grid; max-height: min(360px, 48vh); overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-10); }
.schedule-search-result { display: grid; grid-template-columns: minmax(0, 1fr) auto 18px; align-items: center; gap: 12px; min-height: 52px; padding: 8px 11px; color: var(--text); border: 0; border-bottom: 1px solid var(--border); background: var(--card); text-align: left; cursor: pointer; transition: background var(--dur-fast) var(--ease-standard); }
.schedule-search-result:last-child { border-bottom: 0; }
.schedule-search-result:hover,
.schedule-search-result[aria-current="date"] { background: var(--primary-soft); }
.schedule-search-result-course { display: grid; gap: 3px; min-width: 0; }
.schedule-search-result-course strong { overflow: hidden; color: var(--text); font-size: var(--fs-12); text-overflow: ellipsis; white-space: nowrap; }
.schedule-search-result-course small { overflow: hidden; color: var(--muted); font-size: var(--fs-10); text-overflow: ellipsis; white-space: nowrap; }
.schedule-search-result-date { color: var(--ink-soft); font-size: var(--fs-11); white-space: nowrap; }
.schedule-search-result-arrow { color: var(--primary); font-size: var(--fs-16); text-align: right; }
.schedule-search-results-empty { padding: 12px; color: var(--muted); border: 1px dashed var(--border); border-radius: var(--radius-10); font-size: var(--fs-12); }
.schedule-settings {
  grid-template-columns: minmax(0, .8fr) minmax(0, 1.4fr) minmax(0, 1fr);
  align-items: start;
  gap: 16px;
  padding: 16px;
  background: var(--card);
  box-shadow: var(--shadow-sm);
}
.schedule-settings > div { display: flex; flex-direction: column; align-items: flex-start; gap: 9px; }
.settings-heading { grid-column: 1 / -1; padding-bottom: 2px; }
.settings-heading h2 { color: var(--text); font-size: var(--fs-15); font-weight: var(--fw-750); }
.settings-heading p { color: var(--muted); font-size: var(--fs-12); }
.schedule-settings .settings-group h3 { color: var(--ink-soft); font-size: var(--fs-11); font-weight: var(--fw-700); }
.schedule-settings .settings-actions,
.schedule-settings .settings-choice { display: flex; flex-direction: row; align-items: center; flex-wrap: wrap; gap: 7px; }
.schedule-settings .settings-actions .btn { min-height: 38px; padding: 7px 11px; font-size: var(--fs-12); }
.schedule-settings .settings-choice .seg-label { flex: none; font-size: var(--fs-11); }
.schedule-settings .settings-choice .seg button { min-height: 34px; padding: 6px 10px; font-size: var(--fs-12); }
.schedule-settings .auto-mode-hint { grid-column: 1 / -1; margin: 0; padding: 9px 11px; border-radius: var(--radius-8); background: var(--bg-tint); }
.schedule-settings .auto-mode-hint small { color: var(--ink-soft); }

@media (max-width: 900px) {
  .schedule-settings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .schedule-settings .settings-heading,
  .schedule-settings .auto-mode-hint { grid-column: 1 / -1; }
  .schedule-toolbar-main { align-items: flex-start; }
  .schedule-toolbar-actions { gap: 6px; }
}

@media (max-width: 760px) {
  .schedule-heading { flex-direction: column; align-items: stretch; gap: 10px; }
  .head-btns { width: 100%; max-width: none; flex-wrap: wrap; padding: 0; overflow: visible; }
  .schedule-toolbar-main { flex-direction: column; gap: 12px; }
  .week-navigation { width: 100%; justify-content: space-between; }
  .schedule-toolbar-actions { width: 100%; justify-content: flex-start; }
  .schedule-toolbar-actions .mobile-view-switcher { margin-right: auto; }
  .schedule-toolbar-bottom { align-items: stretch; }
  .schedule-search { width: 100%; }
  .schedule-summary { width: 100%; }
  .schedule-search-result { grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; }
  .schedule-search-result-date { grid-column: 1; grid-row: 2; }
  .schedule-search-result-arrow { grid-column: 2; grid-row: 1 / span 2; }
  .schedule-settings { grid-template-columns: 1fr; gap: 12px; }
  .schedule-settings .settings-heading,
  .schedule-settings .auto-mode-hint { grid-column: auto; }
}

@media (max-width: 520px) {
  .schedule-toolbar { padding: 12px; }
  .schedule-toolbar-main { gap: 10px; }
  .toolbar-label { display: none; }
  .week-navigation { gap: 6px; }
  .week-control { flex: 1; justify-content: center; }
  .week-current { min-width: 104px; }
  .week-step { width: 38px; height: 38px; }
  .schedule-toolbar-actions { gap: 6px; }
  .schedule-toolbar-actions .btn { padding-inline: 9px; }
  .schedule-toolbar-actions .add-course-button { flex: 1; }
  .schedule-summary { font-size: var(--fs-11); }
  .schedule-subtitle { gap: 5px; font-size: var(--fs-12); }
}

</style>
