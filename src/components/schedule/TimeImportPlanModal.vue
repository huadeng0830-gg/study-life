<script setup>
/**
 * 第三级浮层：导入计划的确认与执行进度。
 *
 * 【为什么进度条在这里而不是在父组件】导入计划是"点确认才开始"的一次性事务，
 * 它的进度只属于这次执行；父组件里那条 OCR 进度条必须与它的**粘性工具栏**
 * 保持前后关系（见 TimeSettingsModal 模板顶部的注释），两条进度各管各的，
 * 放在同一个文件里只会让那条顺序约束变得难以解释。
 *
 * 【为什么 `task` 直接传 `importProgress.state`】进度是模块级单例
 * （composables/timeImportPlan.js），弹窗开着时用户可能切走再切回来；
 * 把状态放在组件里会让"切走再回来"丢掉执行进度。
 */
import Modal from '../Modal.vue'
import TaskProgress from '../TaskProgress.vue'
import {
  canImportItem,
  canReplaceItem,
  closeImportPlan,
  confirmImportPlan,
  createActionLabel,
  editFromPlan,
  importPlan,
  importPlanOpen,
  importProgress,
  importRunning,
  planDiffExpanded,
  setPlanItemAction,
  togglePlanDiff,
} from '../../composables/timeImportPlan.js'
</script>

<template>
  <Modal
    v-if="importPlanOpen"
    :open="importPlanOpen"
    :title="importRunning ? '正在导入' : '本次导入计划'"
    medium
    @close="closeImportPlan"
  >
    <template v-if="!importRunning && importPlan">
      <p class="plan-summary">
        共 {{ importPlan.summary.total }} 组作息 ·
        <b class="ok-text">{{ importPlan.summary.replace }} 组替换</b> ·
        <b class="ok-text">{{ importPlan.summary.create }} 组新建</b> ·
        {{ importPlan.summary.skip }} 组跳过
        <b v-if="importPlan.summary.blocked" class="warning-text">· {{ importPlan.summary.blocked }} 组待处理</b>
      </p>
      <p class="tool-tip">默认按推荐方案执行；替换不会与旧作息合并，而是整体覆盖。</p>
      <div class="plan-items">
        <div
          v-for="item in importPlan.items"
          :key="item.schemeId"
          class="plan-item"
          :class="{ blocked: item.action !== 'skip' && item.blockers.length }"
        >
          <div class="plan-item-head">
            <b class="plan-item-label">{{ item.label }}</b>
            <select class="plan-action" :value="item.action" :aria-label="`${item.label} 的处理方式`" @change="setPlanItemAction(item, $event.target.value)">
              <option v-if="canReplaceItem(item)" value="replace">替换已有</option>
              <option v-if="canImportItem(item)" value="create">{{ createActionLabel(item) }}</option>
              <option value="skip">跳过</option>
            </select>
          </div>
          <template v-if="item.action !== 'skip'">
            <p v-if="item.diff" class="plan-diff-summary">
              原有 {{ item.diff.oldCount }} 节 → 新识别 {{ item.diff.mappedCount }} 节 · 共 {{ item.diff.changedCount }} 项时间变化
              <button
                v-if="item.diff.changedCount"
                class="btn btn-xs btn-ghost"
                @click="togglePlanDiff(item)"
              >{{ planDiffExpanded[item.schemeId] ? '收起变化' : '查看变化' }}</button>
            </p>
            <div v-if="item.diff && planDiffExpanded[item.schemeId]" class="plan-diff-list">
              <div v-for="change in item.diff.changes" :key="'c' + change.index" class="diff-row">
                <span class="diff-label">{{ change.label }}</span>
                <s>{{ change.from }}</s>
                <i>→</i>
                <b>{{ change.to }}</b>
              </div>
              <div v-for="addedRow in item.diff.added" :key="'a' + addedRow.index" class="diff-row">
                <span class="diff-label">{{ addedRow.label }}</span>
                <s>（原为空）</s>
                <i>→</i>
                <b>{{ addedRow.to }}</b>
              </div>
            </div>
            <p v-for="warning in item.warnings" :key="warning" class="plan-warning">⚠ {{ warning }}</p>
            <template v-if="item.blockers.length">
              <p v-for="blocker in item.blockers" :key="blocker" class="plan-blocker">✕ {{ blocker }}</p>
              <button class="btn btn-xs" @click="editFromPlan(item.schemeId)">去处理</button>
            </template>
          </template>
          <p v-else class="plan-skip-note">已跳过，不写入任何数据</p>
        </div>
      </div>
      <div class="plan-foot">
        <button class="btn" @click="closeImportPlan">取消</button>
        <button class="btn btn-primary" :disabled="!importPlan.executable" @click="confirmImportPlan">
          确认并导入（{{ importPlan.summary.replace + importPlan.summary.create }} 组）
        </button>
      </div>
    </template>
    <template v-else>
      <TaskProgress
        :task="importProgress.state"
        :elapsed-seconds="importProgress.elapsedSeconds.value"
        :activity-age-seconds="importProgress.activityAgeSeconds.value"
        :stalled="importProgress.isStalled.value"
        compact
      />
    </template>
  </Modal>
</template>

<style scoped>
.tool-tip { margin: 0; color: var(--ink-faint); font-size: var(--fs-11); line-height: 1.5; }
.btn-xs { flex: 0 0 auto; padding: 4px 8px; font-size: var(--fs-10-5); }
.diff-row { display: flex; align-items: center; gap: 8px; font-size: var(--fs-12); font-variant-numeric: tabular-nums; }
.diff-label { flex: 0 0 76px; overflow: hidden; color: var(--text); white-space: nowrap; text-overflow: ellipsis; }
.diff-row s { color: var(--ink-faint); }
.diff-row i { color: var(--primary); font-style: normal; }
.diff-row b { color: var(--primary); font-weight: var(--fw-700); }
/* ---------- 导入计划（第三级） ---------- */
.plan-summary { margin: 0 0 4px; font-size: var(--fs-13); color: var(--text); }
/* .ok-text / .warning-text 是同一句汇总里的状态对，一起换成令牌
   （写死的 #08785a / #9a6414 在深色卡片上只有 2.91 / 3.18:1）。 */
.plan-summary b.ok-text { color: var(--success); }
.plan-summary b.warning-text { color: var(--warning); }
.plan-items { display: flex; flex-direction: column; gap: 8px; max-height: 46vh;max-height:46dvh; overflow-y: auto; padding-right: 2px; }
.plan-item { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-11); background: var(--card); }
/* 原来写死 #e5b4b4 / #fffafa：深色主题下整个 .plan-item 会变成一块白底，
   而它的兄弟条目用的是 var(--card)，同一个列表里两种底色。改成从 --danger 混出来，
   两个主题都跟着主题走。 */
.plan-item.blocked { border-color: color-mix(in srgb, var(--danger) 30%, var(--card)); background: color-mix(in srgb, var(--danger) 8%, var(--card)); }
.plan-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.plan-item-label { font-size: var(--fs-13); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-action { padding: 5px 8px; font-size: var(--fs-12); border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--card); color: var(--text); }
.plan-diff-summary { margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--ink-soft); font-size: var(--fs-11-5); }
.plan-diff-list { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: var(--radius-8); background: var(--bg-tint); }
.plan-warning { margin: 0; color: var(--warning); font-size: var(--fs-11-5); }
.plan-blocker { margin: 0; color: var(--danger); font-size: var(--fs-11-5); font-weight: var(--fw-700); }
.plan-skip-note { margin: 0; color: var(--ink-faint); font-size: var(--fs-11-5); }
.plan-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
</style>
