<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import TaskProgress from '../TaskProgress.vue'
import TimeBaseSettings from './TimeBaseSettings.vue'
import RecognitionSchemeDetailModal from './RecognitionSchemeDetailModal.vue'
import TimeGeneratePanel from './TimeGeneratePanel.vue'
import TimeImportPlanModal from './TimeImportPlanModal.vue'
import { useTaskProgress } from '../../composables/taskProgress.js'
import {
  timeConfig,
  campusName,
  seasonName,
  resetTimesToDefault,
} from '../../composables/store/timeConfig.js'
import { useTabKeys } from '../../composables/tabKeys.js'
import { timeImportTab, timeSettingsTab } from '../../composables/modalSections.js'
import { importError, pasteText, settingError, settingsToast, showToast, stopSettingsToast } from '../../composables/timeSettingsShared.js'
import {
  confirmDiscardDraft as runConfirmDiscardDraft,
  draft,
  draftDirty,
  initPlanSelection,
  loadPlanDraft,
  markDirty,
  pendingDraftAction,
  planHasError,
  planSections,
  planCampusId,
  planSeasonId,
  rowError,
  saveDraft,
  discardDraft,
  seasonsForPlanCampus,
  setDraftCloseHandler,
  switchPlan,
  switchSettingsTab,
  tryCloseTimeEditor,
} from '../../composables/timePlanDraft.js'
import {
  applyBatch,
  batchCustom,
  batchDelta,
  batchFrom,
  batchOpen,
  batchPreview,
  batchTo,
  copyFrom,
  copyOpen,
  genPreview,
  importOpen,
  openTimeShift,
  otherPlans,
  toggleCopy,
} from '../../composables/timePlanTools.js'
import {
  continueScheduleResults,
  lastScheduleImage,
  onImportImage,
  parseScheduleText,
  retryScheduleAccurate,
  retryScheduleOCR,
  scheduleOcrProgress,
  schemeDisplayName,
  stopScheduleOcr,
} from '../../composables/scheduleOcrFlow.js'
import {
  activeSchemeForQuick,
  activeSchemeId,
  countTargetModes,
  discardRecognition,
  modesText,
  openSchemeDetail,
  recognitionDraft,
  recognitionTimeText,
  schemeCount,
  schemeReplaceChanged,
  schemeStatusBadge,
  selectedSchemeCount,
  startRecognition,
  toggleSchemeSelected,
} from '../../composables/recognitionSchemes.js'
import {
  lastImportResult,
  openImportPlan,
  undoLastImport,
} from '../../composables/timeImportPlan.js'

const props = defineProps({
  show: { type: Boolean, required: true },
  courseCountByPeriodId: { type: Function, required: true },
})

const emit = defineEmits(['close'])

// 草稿守卫住在 timePlanDraft.js（模块级单例），它拿不到本组件的 emit；
// 关闭动作由父组件在这里注进去，"什么时候该关"仍由守卫决定。
setDraftCloseHandler(() => emit('close'))

/** ConfirmDialog 的 @confirm/@close 必须指向本文件里声明的函数（见 tests/confirmDialogMigration）。 */
function confirmDiscardDraft() {
  runConfirmDiscardDraft()
}

function cancelPendingDraft() {
  pendingDraftAction.value = null
}

// 分区状态存在 composables/modalSections.js 的模块级 ref 里。这个浮层的父级没有 v-if，
// 实例常驻，原本就已经"跨开关保留"；改成模块级 ref 是为了与外观/本地迁移统一语义。
const settingsTab = timeSettingsTab
// 设置分区的键盘模型。select 走 switchSettingsTab：它会先过草稿守卫，
// 被否决时返回 false，useTabKeys 就不会把焦点移到一个并未选中的 tab 上。
const { onKeydown: onSettingsTabKeydown, tabIndexFor: settingsTabIndex } = useTabKeys({
  keys: ['plans', 'base'],
  active: () => settingsTab.value,
  select: (key) => switchSettingsTab(key),
})
const tabHints = {
  plans: '一次只编辑一个「作息季 × 校区」方案。支持导入、复制与批量平移，修改需点击保存才会生效。',
  base: '管理校区、作息季与节次。删除前会检查影响范围；作息季可设置生效日期与适用校区。',
}
const TAB_ICONS = { plans: '⏰ 作息方案', base: '⚙️ 基础设置' }
function tabLabel(tab) {
  return TAB_ICONS[tab] ?? tab
}

function onResetTimes() {
  settingError.value = ''
  resetTimesToDefault()
}


/* ---------- 一键生成作息时间 + 方案编辑器 + 批量/复制工具：
   已拆到 composables/timeGenerate.js / timePlanDraft.js / timePlanTools.js ---------- */

/* ---------- 新建 / 导入作息（图片 OCR + 粘贴文本，统一预览确认） ---------- */
const importTab = timeImportTab // paste | image
const { onKeydown: onImportTabKeydown, tabIndexFor: importTabIndex } = useTabKeys({
  keys: ['paste', 'image'],
  active: () => importTab.value,
  select: (key) => {
    importTab.value = key
  },
})

/**
 * 打开设置时初始化：优先当前生效组合，否则第一个有效组合。
 *
 * 【为什么这个 watcher 单独放在这里，而不跟其它 watch 排在一起】
 * 它必须是 `immediate`：组件以 `v-if` 方式首次挂载时 `props.show` 已经是 true，
 * 普通 watch 不会在首次执行，草稿数组就会是空的，模板里的时间输入框访问
 * `draft[index]` 时直接报错。而 `immediate` 的回调是在 setup 期间**同步**跑的。
 *
 * 【暂时性死区是怎么消失的】改造前 `initPlanSelection()` → `loadPlanDraft()` 会去写
 * `batchOpen` / `copyOpen` / `genPreview` / `importOpen`，它们当时都声明在本行之下，
 * 于是 `props.show` 一开始就是 true 的挂载路径会抛
 * `ReferenceError: Cannot access 'batchOpen' before initialization`，组件连挂载都完不成。
 * 第二、三步把这几个 ref 连同草稿状态一起挪进了 `composables/timePlan*.js`——**模块级**
 * ref 在 import 阶段就已初始化，早于任何组件 setup，所以这条约束现在由模块图本身保证。
 * 但 `immediate` 这一点仍然不可动（理由见上），watcher 也仍应留在初始化语义清楚的位置。
 */
watch(() => props.show, (open) => {
  if (open) initPlanSelection()
}, { immediate: true })

function toggleImport() {
  importOpen.value = !importOpen.value
  batchOpen.value = false
  copyOpen.value = false
  genPreview.value = null
  if (importOpen.value) {
    importError.value = ''
    // 不再把导入方式重置为"粘贴"：与主分区一致，记住上次用的方式（见 modalSections.js）。
    // 原来那行是 `importTab.value = recognitionDraft.value ? importTab.value : 'paste'`，
    // 即"有识别草稿时保留、否则重置"；现在两种情况都保留，语义只增不减。
  }
}

// ---------- OCR 流程 / 解析器懒加载 / 进度：已拆到 composables/scheduleOcrFlow.js ----------

// ---------- 识别暂存层 / 总览与详情 / 导入计划：已拆到 composables/recognitionSchemes.js、composables/timeImportPlan.js ----------


async function runParsePaste() {
  importError.value = ''
  const analysis = await parseScheduleText(pasteText.value)
  if (!analysis.rows.length) {
    importError.value = '没有解析到「节次名称 + 时间段」行，示例：第一节 8:00-8:45'
    return
  }
  const draftValue = await startRecognition(analysis, '粘贴文本')
  showToast(`识别完成 · 共 ${draftValue.schemes.length} 组作息（${modesText(countTargetModes(draftValue))}）`)
}

/* ---------- 轻量 toast（设置弹窗内）：状态与计时器已拆到 composables/timeSettingsShared.js ---------- */

// KeepAlive 离开页面不会卸载组件；主动取消 OCR 避免占用 CPU。
function stopBackgroundWork() {
  stopSettingsToast()
  stopScheduleOcr()
}

onBeforeUnmount(stopBackgroundWork)

defineExpose({ stopBackgroundWork })
</script>

<template>
  <Modal v-if="show" :open="show" title="🕐 作息与时间设置" @close="tryCloseTimeEditor">
    <div class="settings">
      <!-- 同页另两个 tablist（AppearanceSettings 的「个性化设置分区」、LocalTransfer 的
           「二维码迁移方式」）都带 aria-label，只有这里漏了；tablist 没有名称时读屏
           只念「标签页列表」，说不出这是在切什么分区。 -->
      <div class="tab-bar" role="tablist" aria-label="设置分区" @keydown="onSettingsTabKeydown">
        <!-- 这里原本是 v-for="(hint, tab) in tabHints"，id 只能动态生成。
             改成两个显式按钮是为了让 id 变成**静态**的：两个面板要用
             aria-labelledby 指回各自的 tab，而静态悬空引用守卫只认静态 id——
             动态 id 会让这条引用在守卫眼里"找不到该 id"，关系就失去校验。
             代价是多了两行重复标记；分区是固定的两个（作息方案 / 基础设置），
             提示文字仍由 tabHints 提供。 -->
        <button
          id="time-settings-tab-plans"
          type="button"
          :tabindex="settingsTabIndex('plans')"
          class="tab-btn"
          role="tab"
          :aria-selected="settingsTab === 'plans'"
          :class="{ on: settingsTab === 'plans' }"
          @click="switchSettingsTab('plans')"
        >{{ tabLabel('plans') }}</button>
        <button
          id="time-settings-tab-base"
          type="button"
          :tabindex="settingsTabIndex('base')"
          class="tab-btn"
          role="tab"
          :aria-selected="settingsTab === 'base'"
          :class="{ on: settingsTab === 'base' }"
          @click="switchSettingsTab('base')"
        >{{ tabLabel('base') }}</button>
      </div>
      <p class="settings-hint">{{ tabHints[settingsTab] }}</p>
      <p v-if="settingError" class="error" role="alert">{{ settingError }}</p>
      <Transition name="toast">
        <p v-if="settingsToast" class="settings-toast">✓ {{ settingsToast }}</p>
      </Transition>

      <!-- OCR 进度与导入错误刻意放在**标签区之外**，与上面的 settingError 同级。
           原因：这两块原来住在 `v-show="settingsTab === 'plans'"` 的作息方案区里，
           而 OCR 要跑好几秒，用户几乎一定会切到别的标签页等。一旦切走，这个区就是
           display:none——里面的元素**根本不在无障碍树里**，于是进度看不到、
           失败与「图片质量提示」也听不到（role="alert" 在 display:none 子树里不会播报）。
           提到区外之后两个问题一起消失：切到任何标签页都能继续看到进度、听到结果。 -->
      <TaskProgress
        :task="scheduleOcrProgress.state"
        :elapsed-seconds="scheduleOcrProgress.elapsedSeconds.value"
        :activity-age-seconds="scheduleOcrProgress.activityAgeSeconds.value"
        :stalled="scheduleOcrProgress.isStalled.value"
        compact
        @cancel="scheduleOcrProgress.cancel"
        @retry="retryScheduleOCR"
        @continue="continueScheduleResults"
        @wait="scheduleOcrProgress.continueWaiting"
      />

      <p v-if="importError && !(scheduleOcrProgress.state.active && scheduleOcrProgress.state.visible)" class="error" role="alert">{{ importError }}</p>

      <!-- ============ 作息方案 ============ -->
      <section v-show="settingsTab === 'plans'" id="time-settings-panel-plans" role="tabpanel" aria-labelledby="time-settings-tab-plans" class="setting-section plan-section">
        <!-- 方案选择器：按复杂度自动简化 -->
        <div v-if="timeConfig.campuses.length > 1 || seasonsForPlanCampus.length > 1" class="plan-picker">
          <div v-if="timeConfig.campuses.length > 1" class="plan-picker-row">
            <span class="pp-label">校区</span>
            <div class="seg">
              <button
                v-for="campus in timeConfig.campuses"
                :key="campus.id"
                :class="{ on: planCampusId === campus.id }"
                @click="switchPlan(planSeasonId, campus.id)"
              >{{ campus.name }}</button>
            </div>
          </div>
          <div v-if="seasonsForPlanCampus.length > 1" class="plan-picker-row">
            <span class="pp-label">作息季</span>
            <div class="seg">
              <button
                v-for="season in seasonsForPlanCampus"
                :key="season.id"
                :class="{ on: planSeasonId === season.id }"
                @click="switchPlan(season.id, planCampusId)"
              >{{ season.name }}</button>
            </div>
          </div>
        </div>

        <!-- 方案标题 + 工具条 -->
        <div class="plan-head">
          <b class="plan-title">{{ seasonName(planSeasonId) }} · {{ campusName(planCampusId) }}</b>
          <span v-if="draftDirty" class="dirty-dot">● 有未保存修改</span>
        </div>
        <div class="plan-tools">
          <button class="btn btn-sm btn-ghost" @click="toggleImport">＋ 新建 / 导入</button>
          <button v-if="otherPlans.length" class="btn btn-sm" @click="toggleCopy">⧉ 复制已有方案</button>
          <button class="btn btn-sm" @click="openTimeShift">± 批量调整</button>
          <button class="btn btn-sm" @click="onResetTimes">↺ 恢复默认</button>
        </div>

        <!-- 导入结果横幅（独立于导入面板，导入后仍可撤销） -->
        <div v-if="lastImportResult" class="import-result-banner">
          <span>✓ 已成功导入 {{ lastImportResult.count }} 组作息（{{ lastImportResult.replace }} 替换 / {{ lastImportResult.create }} 新建）</span>
          <button class="btn btn-xs" @click="undoLastImport">撤销本次导入</button>
        </div>

        <!-- 复制方案面板 -->
        <div v-if="copyOpen" class="tool-panel">
          <div class="tool-panel-title">从哪个方案复制？（复制后两套方案互相独立）</div>
          <div class="copy-list">
            <button
              v-for="plan in otherPlans"
              :key="plan.season + plan.campus"
              class="copy-item"
              @click="copyFrom(plan.season, plan.campus)"
            >{{ plan.seasonName }} · {{ plan.campusName }}</button>
          </div>
        </div>

        <!-- 批量调整面板（先预览） -->
        <div v-if="batchOpen" class="tool-panel">
          <div class="tool-panel-title">批量调整时间（先预览，确认后应用到草稿）</div>
          <div class="batch-controls">
            <select v-model.number="batchFrom" aria-label="批量调整起始节次">
              <option v-for="(p, i) in timeConfig.periods" :key="p.id" :value="i">{{ p.label }}</option>
            </select>
            <i>至</i>
            <select v-model.number="batchTo" aria-label="批量调整结束节次">
              <option v-for="(p, i) in timeConfig.periods" :key="p.id" :value="i">{{ p.label }}</option>
            </select>
            <select v-model.number="batchDelta" aria-label="批量调整偏移量">
              <option :value="-30">−30 分钟</option>
              <option :value="-15">−15 分钟</option>
              <option :value="-10">−10 分钟</option>
              <option :value="-5">−5 分钟</option>
              <option :value="5">+5 分钟</option>
              <option :value="10">+10 分钟</option>
              <option :value="15">+15 分钟</option>
              <option :value="30">+30 分钟</option>
              <option :value="0">自定义</option>
            </select>
            <input
              v-if="batchDelta === 0"
              v-model="batchCustom"
              class="num"
              type="number"
              aria-label="批量调整自定义分钟数"
              placeholder="±分钟"
            />
          </div>
          <div v-if="batchPreview" class="diff-list">
            <div v-for="row in batchPreview.rows" :key="row.index" class="diff-row">
              <span class="diff-label">{{ row.label }}</span>
              <s>{{ row.from }}</s>
              <i>→</i>
              <b>{{ row.to }}</b>
            </div>
            <button class="btn btn-primary btn-sm apply-btn" @click="applyBatch">应用 {{ batchPreview.rows.length }} 行</button>
          </div>
          <p v-else class="tool-tip">选择范围与调整幅度后自动预览。</p>
        </div>

        <!-- 快速生成（保留，改为预览制） -->
        <TimeGeneratePanel />

        <!-- 新建 / 导入 -->
        <div v-if="importOpen" class="tool-panel import-panel">
          <div class="tool-panel-title">新建 / 导入作息</div>
          <div class="seg import-tabs" role="tablist" aria-label="作息导入方式" @keydown="onImportTabKeydown">
            <button id="time-import-tab-paste" role="tab" :tabindex="importTabIndex('paste')" :aria-selected="importTab === 'paste'" :class="{ on: importTab === 'paste' }" @click="importTab = 'paste'">📋 粘贴时间表</button>
            <button id="time-import-tab-image" role="tab" :tabindex="importTabIndex('image')" :aria-selected="importTab === 'image'" :class="{ on: importTab === 'image' }" @click="importTab = 'image'">📷 从图片识别</button>
          </div>

          <div v-if="importTab === 'paste'" role="tabpanel" aria-labelledby="time-import-tab-paste">
            <textarea
              v-model="pasteText"
              class="paste-area"
              rows="6"
              aria-label="粘贴作息时间"
              placeholder="粘贴学校官网或通知里的作息时间，每行一条：&#10;第一节 8:00-8:45&#10;第二节 8:55-9:40&#10;夏季时间 / 南校区 等标题会被自动识别"
            />
            <button class="btn btn-sm btn-ghost" @click="runParsePaste">解析预览</button>
          </div>

          <div v-else class="image-import" role="tabpanel" aria-labelledby="time-import-tab-image">
            <label class="file-button" for="schedule-import-image" :class="{ busy: scheduleOcrProgress.state.status === 'running' }">
              <span v-if="scheduleOcrProgress.state.status === 'running'">🔄 {{ scheduleOcrProgress.state.latestActivity }}</span>
              <span v-else>📷 上传学校官方作息表图片</span>
              <input id="schedule-import-image" type="file" accept="image/*" :disabled="scheduleOcrProgress.state.status === 'running'" @change="onImportImage" />
            </label>
            <p class="tool-tip">识别结果先进入暂存区，确认导入计划前不会修改正式作息。</p>
            <button v-if="lastScheduleImage && importError" class="btn btn-sm btn-ghost accurate-retry" @click="retryScheduleAccurate">
              使用精准模式重新识别
            </button>
          </div>

          <!-- 第一级：识别结果总览（多组作息、自动匹配、批量导入） -->
          <div v-if="recognitionDraft" class="recognition-overview">
            <div class="overview-head">
              <div class="tool-panel-title">识别结果总览 · 共发现 {{ schemeCount }} 组作息</div>
              <button class="btn btn-xs btn-ghost" @click="discardRecognition">放弃识别</button>
            </div>
            <p v-if="recognitionDraft.sourceName" class="detected-title">
              来源：{{ recognitionDraft.sourceName }}
              <template v-if="!recognitionDraft.sourceName.includes('粘贴')">
                · {{ recognitionTimeText(recognitionDraft.createdAt) }}
              </template>
            </p>
            <div class="scheme-cards">
              <div
                v-for="scheme in recognitionDraft.schemes"
                :key="scheme.id"
                class="scheme-card"
                :class="{ off: !scheme.selected, active: scheme.id === activeSchemeId }"
              >
                <label class="scheme-check" :title="scheme.selected ? '取消勾选' : '勾选后参与批量导入'">
                  <input type="checkbox" :checked="scheme.selected" @change="toggleSchemeSelected(scheme)" />
                </label>
                <div class="scheme-card-main" @click="openSchemeDetail(scheme.id)">
                  <div class="scheme-card-title">{{ schemeDisplayName(scheme, timeConfig) }} · {{ scheme.rows.length }}节</div>
                  <div class="scheme-card-status" :class="schemeStatusBadge(scheme).cls">
                    {{ schemeStatusBadge(scheme).icon }} {{ schemeStatusBadge(scheme).text }}
                    <span v-if="scheme.target.mode === 'replace' && schemeReplaceChanged(scheme)">（{{ schemeReplaceChanged(scheme) }} 项时间变化）</span>
                  </div>
                </div>
                <button class="btn btn-xs" @click.stop="openSchemeDetail(scheme.id)">查看 / 编辑</button>
              </div>
            </div>

            <div class="import-foot overview-foot">
              <button class="btn btn-sm btn-ghost" @click="discardRecognition">放弃</button>
              <button class="btn btn-sm" :disabled="!activeSchemeForQuick" @click="openImportPlan(activeSchemeForQuick.id)">仅导入当前组</button>
              <button class="btn btn-sm btn-primary" :disabled="!selectedSchemeCount" @click="openImportPlan()">
                导入选中的 {{ selectedSchemeCount }} 组作息
              </button>
            </div>
          </div>
        </div>

        <!-- 时间编辑列表：上午/下午/晚上 自动分组 -->
        <div class="plan-list">
          <div v-for="section in planSections" :key="section.key" class="plan-section-group">
            <div class="section-label">{{ section.label }}</div>
            <div
              v-for="row in section.rows"
              :key="row.period.id"
              class="plan-row"
              :class="{ 'has-error': rowError(row.index) }"
            >
              <span class="plan-row-label">{{ row.period.label }}</span>
              <div class="plan-row-times">
                <input
                  type="time"
                  v-model="draft[row.index].start"
                  :aria-label="`${row.period.label} 开始时间`"
                  @input="markDirty"
                />
                <i>—</i>
                <input
                  type="time"
                  v-model="draft[row.index].end"
                  :aria-label="`${row.period.label} 结束时间`"
                  @input="markDirty"
                />
              </div>
              <span v-if="rowError(row.index)" class="plan-row-error">{{ rowError(row.index) }}</span>
            </div>
          </div>
          <p v-if="planHasError" class="plan-error-tip">存在时间问题，保存前请先修正。</p>
        </div>
      </section>

      <!-- ============ 基础设置 ============ -->
      <div v-if="settingsTab === 'base'" id="time-settings-panel-base" role="tabpanel" aria-labelledby="time-settings-tab-base" class="settings-panel">
        <TimeBaseSettings :course-count-by-period-id="courseCountByPeriodId" />
      </div>

      <!-- 底部操作栏：草稿模式 -->
      <div class="draft-bar" :class="{ sticky: draftDirty }">
        <span v-if="draftDirty" class="dirty-dot">● 有未保存修改</span>
        <button v-if="draftDirty" class="btn" @click="discardDraft">放弃修改</button>
        <button v-else class="btn btn-ghost" @click="onResetTimes">恢复默认时间</button>
        <button v-if="draftDirty" class="btn btn-primary" :disabled="planHasError" @click="saveDraft">保存</button>
        <button v-else class="btn btn-primary" @click="tryCloseTimeEditor">完成</button>
      </div>
    </div>
  </Modal>

  <!-- 第二级：某一组识别结果的详细编辑（大弹窗，底部固定操作栏） -->
  <RecognitionSchemeDetailModal />

  <!-- 第三级：导入计划确认 / 执行进度 -->
  <TimeImportPlanModal />

  <!-- 确认框与上面两个 Modal 平级：ConfirmDialog 自己 Teleport 到 body，
       所以始终叠在最上层，Escape 只会关掉它（Modal.vue 的 isTopOverlay 机制）。 -->
  <!-- 这个确认框叠在本组件自己的设置弹窗（`<Modal v-if="show">`）之上，
       所以一律 v-if 随目标挂载：本组件在 `show` 还是 false 时就已挂载，若那时就建好
       Teleport 锚点，后打开的设置弹窗会排到它后面并把它盖住
       （见 ConfirmDialog 顶部的浮层顺序说明）。 -->
  <ConfirmDialog
    v-if="pendingDraftAction"
    :open="Boolean(pendingDraftAction)"
    title="放弃未保存的修改"
    message="当前方案有未保存的修改，确定放弃这些修改吗？"
    confirm-label="放弃修改"
    cancel-label="继续编辑"
    @close="cancelPendingDraft"
    @confirm="confirmDiscardDraft"
  />
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
/* base 面板的包裹层必须复制 .settings 的纵向排布与间距：
   原来三个 section 是 .settings 的直接子元素，靠它的 gap 分隔；
   换成包裹层后若不复制，间距会从 18px 变成 0。 */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.settings-hint {
  padding: 10px 12px;
  color: var(--muted);
  font-size: var(--fs-12);
  line-height: 1.6;
  border-radius: var(--radius-8);
  background: var(--bg);
}
.setting-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tab-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 8px 14px;
  font-size: var(--fs-13);
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-9);
  background: var(--card);
}
.tab-btn.on {
  color: var(--on-primary, #fff);
  font-weight: var(--fw-700);
  border-color: var(--primary);
  background: var(--primary);
}
.error {
  color: var(--danger);
  font-size: var(--fs-13);
}
.muted-tip {
  font-size: var(--fs-13);
  color: var(--muted);
  line-height: 1.6;
  background: var(--bg);
  border-radius: var(--radius-8);
  padding: 10px 12px;
}
.settings-toast {
  position: sticky;
  top: 0;
  z-index: 3;
  margin: 0;
  padding: 7px 12px;
  /* 自动保存提示是「绿字 + 写死浅绿底」成对写法，只改字会让深色主题下的 #e7f8f1
     白条配上亮绿字（约 1.7:1），所以底一起从 --card 混出来。改前浅/深都是 4.49:1
     （本身就差一点不到 AA），改后浅 4.88、深 6.72:1。 */
  color: var(--success);
  font-size: var(--fs-12);
  border-radius: var(--radius-8);
  background: color-mix(in srgb, var(--success) 10%, var(--card));
}
.toast-enter-active, .toast-leave-active { transition: opacity var(--dur-base) var(--ease-standard); }
.toast-enter-from, .toast-leave-to { opacity: 0; }

/* ---------- 作息方案编辑器 ---------- */
.plan-picker { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-11); background: var(--bg-tint); }
.plan-picker-row { display: flex; align-items: center; gap: 10px; }
.plan-picker-row .seg { flex-wrap: wrap; overflow-x: visible; }
.pp-label { flex: 0 0 44px; color: var(--ink-faint); font-size: var(--fs-11-5); font-weight: var(--fw-700); }
.plan-head { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.plan-title { font-size: var(--fs-15); font-weight: var(--fw-800); }
/* 「有未保存改动」的小圆点是琥珀语义，落在 var(--card) 上：
   写死的 #b86b16 在深色卡片上只有 3.36:1。 */
.dirty-dot { color: var(--warning); font-size: var(--fs-11-5); font-weight: var(--fw-700); }
.plan-tools { display: flex; flex-wrap: wrap; gap: 7px; }
.plan-tools .btn-sm { padding: 6px 11px; font-size: var(--fs-12); }
.tool-panel {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-11);
  background: var(--bg-tint);
}
.tool-panel-title { color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-700); }
.tool-tip { margin: 0; color: var(--ink-faint); font-size: var(--fs-11); line-height: 1.5; }
.copy-list { display: flex; flex-wrap: wrap; gap: 7px; }
.copy-item { padding: 7px 12px; font-size: var(--fs-12-5); border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--card); cursor: pointer; transition: border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
.copy-item:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.batch-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.batch-controls select, .batch-controls input { width: auto; min-width: 0; }
.batch-controls i { color: var(--ink-faint); font-size: var(--fs-11); }
.diff-list { display: flex; flex-direction: column; gap: 5px; max-height: 240px; overflow-y: auto; }
.diff-row { display: flex; align-items: center; gap: 8px; font-size: var(--fs-12); font-variant-numeric: tabular-nums; }
.diff-label { flex: 0 0 76px; overflow: hidden; color: var(--text); white-space: nowrap; text-overflow: ellipsis; }
.diff-row s { color: var(--ink-faint); }
.diff-row i { color: var(--primary); font-style: normal; }
.diff-row b { color: var(--primary); font-weight: var(--fw-700); }
.apply-btn { align-self: flex-start; }
.paste-area { width: 100%; resize: vertical; font-family: inherit; line-height: 1.55; }
.image-import { display: flex; flex-direction: column; gap: 8px; }
.import-tabs { align-self: flex-start; }
.file-button {
  display: inline-flex;
  align-items: center;
  padding: 9px 14px;
  border-radius: var(--radius-8);
  background: var(--primary);
  color: var(--on-primary, #fff);
  font-size: var(--fs-12);
  font-weight: var(--fw-700);
  cursor: pointer;
}
.file-button input { display: none; }
.file-button.busy {
  pointer-events: none;
  opacity: 0.7;
}
.seg {
  display: flex;
  max-width: 100%;
  overflow-x: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  padding: 3px;
}
.seg button {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  padding: 7px 14px;
  border-radius: var(--radius-8);
  font-size: var(--fs-14);
  color: var(--muted);
}
.seg button:disabled {
  opacity: 0.35;
  cursor: default;
}
.seg button.on {
  background: var(--primary);
  color: var(--on-primary, #fff);
  font-weight: var(--fw-600);
}
/* 导入结果横幅：绿字 + 写死浅绿底成对写法，底一起从 --card 混出来。 */
.import-result-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 11px;
  border-radius: var(--radius-9);
  background: color-mix(in srgb, var(--success) 10%, var(--card));
  color: var(--success);
  font-size: var(--fs-12);
  font-weight: var(--fw-700);
}
.btn-xs { flex: 0 0 auto; padding: 4px 8px; font-size: var(--fs-10-5); }

/* ---------- 识别结果总览（第一级） ---------- */
.recognition-overview { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
.overview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.scheme-cards { display: flex; flex-direction: column; gap: 7px; }
.scheme-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-11);
  background: var(--card);
  transition: opacity var(--dur-fast) var(--ease-standard);
}
.scheme-card.off { opacity: .55; }
.scheme-card.active { border-color: var(--primary); }
.scheme-check { display: flex; align-items: center; }
.scheme-check input { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
.scheme-card-main { min-width: 0; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.scheme-card-title { font-size: var(--fs-13); font-weight: var(--fw-750); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scheme-card-status { font-size: var(--fs-11-5); line-height: 1.4; }
/* .ok / .warn 是同一组状态色（都在 .scheme-card 的 var(--card) 上），一起换成令牌：
   写死的 #08785a / #9a6414 在深色卡片上分别只有 2.91 / 3.18:1。 */
.scheme-card-status.ok { color: var(--success); }
.scheme-card-status.warn { color: var(--warning); }
.detected-title { margin: 2px 0 0; color: var(--ink-faint); font-size: var(--fs-11); }
.import-foot { display: flex; justify-content: space-between; gap: 8px; }
.overview-foot { align-items: center; }
.overview-foot .btn-primary { margin-left: auto; }

/* 时间行：上午/下午/晚上分组 */
.plan-list { display: flex; flex-direction: column; gap: 14px; }
.section-label { color: var(--ink-faint); font-size: var(--fs-11); font-weight: var(--fw-800); letter-spacing: .06em; margin-bottom: 6px; }
.plan-section-group { display: flex; flex-direction: column; gap: 6px; }
.plan-row {
  display: grid;
  grid-template-columns: minmax(88px, 132px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-10);
}
.plan-row:nth-child(odd) { background: var(--bg-tint); }
.plan-row.has-error { background: #fff7f0; box-shadow: inset 2px 0 0 var(--danger); }
.plan-row-label { overflow: hidden; font-size: var(--fs-13); font-weight: var(--fw-600); white-space: nowrap; text-overflow: ellipsis; }
.plan-row-times { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.plan-row-times input[type='time'] { width: 104px; padding: 6px 7px; font-size: var(--fs-13); border-radius: var(--radius-8); }
.plan-row-times i { color: var(--muted); font-style: normal; }
.plan-row-error { color: var(--danger); font-size: var(--fs-11); }
.plan-error-tip { margin: 4px 0 0; color: var(--danger); font-size: var(--fs-11-5); }

/* 草稿操作栏 */
.draft-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
.draft-bar.sticky {
  position: sticky;
  bottom: 0;
  z-index: 3;
  margin-top: 18px;
  padding: 10px 2px 4px;
  /* 淡出终点必须跟着主题走：写死 #fff 会在深色主题下铺出一条白条。
   起点保持显式「白色全透明」，避免个别引擎在 transparent 上做非预乘插值时
   插出灰带。 */
background: linear-gradient(180deg, rgba(255, 255, 255, 0), var(--card) 34%);
}

/* 季适用校区 chips */

@media (max-width: 520px) {
  .scheme-card { grid-template-columns: auto minmax(0, 1fr); }
  .scheme-card > .btn-xs { grid-column: 1 / -1; justify-self: end; }
  .overview-foot { flex-wrap: wrap; }
}
</style>
