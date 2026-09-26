<script setup>
/**
 * 第二级浮层：某一组识别结果的详情编辑。
 *
 * 【为什么它是"纯视图"】总览、详情、导入计划三层读写的都是同一个
 * `recognitionDraft`（见 composables/recognitionSchemes.js 的文件头说明）。
 * 若这里再持有一份自己的状态，"在详情里改了行 → 返回总览 → 再进来还在"就会断掉。
 * 所以本组件只 import 模块级单例，自己不声明任何业务状态。
 *
 * 【为什么"仅导入这一组"要先关自己再开计划】两个都是 Teleport 到 body 的浮层，
 * 靠 DOM 顺序决定谁在上层；先开计划会让计划排在详情前面、被详情盖住
 * （ConfirmDialog 的浮层顺序说明讲的是同一件事）。
 */
import Modal from '../Modal.vue'
import { timeConfig } from '../../composables/store/timeConfig.js'
import { schemeDisplayName, targetPendingReasonText } from '../../composables/scheduleOcrFlow.js'
import {
  activeScheme,
  activeSchemeIssueCount,
  activeSchemeRows,
  addSchemeRow,
  closeSchemeDetail,
  detailFilter,
  detailSeasonOptions,
  onSchemeRowInput,
  pickSchemeCampus,
  pickSchemeSeason,
  removeSchemeRow,
  rowIssuesFor,
  schemeDetailOpen,
  startNewCampus,
  startNewSeason,
  updateSchemeTarget,
} from '../../composables/recognitionSchemes.js'
import { openImportPlan } from '../../composables/timeImportPlan.js'
</script>

<template>
  <Modal
    v-if="schemeDetailOpen && !!activeScheme"
    :open="schemeDetailOpen && !!activeScheme"
    :title="activeScheme ? `编辑识别结果 · ${schemeDisplayName(activeScheme, timeConfig)}` : '编辑识别结果'"
    wide
    @close="closeSchemeDetail"
  >
    <template v-if="activeScheme">
      <div class="detail-target">
        <div class="it-row">
          <span>校区</span>
          <div class="choice-chips">
            <button
              v-for="campus in timeConfig.campuses"
              :key="campus.id"
              :class="{ on: activeScheme.target.campusId === campus.id }"
              @click="pickSchemeCampus(activeScheme, campus.id)"
            >{{ campus.name }}</button>
            <button
              :class="{ on: !activeScheme.target.campusId }"
              title="导入为新校区"
              @click="startNewCampus(activeScheme)"
            >＋ 新校区</button>
          </div>
        </div>
        <div v-if="!activeScheme.target.campusId" class="it-row">
          <span>新校区名</span>
          <input
            class="grow"
            :value="activeScheme.target.newCampusName"
            aria-label="新校区名"
            :placeholder="activeScheme.detectedCampus || '例如：东校区'"
            @input="updateSchemeTarget(activeScheme, { newCampusName: $event.target.value })"
          />
        </div>
        <div class="it-row">
          <span>作息方案</span>
          <div class="choice-chips">
            <button
              v-for="season in detailSeasonOptions"
              :key="season.id"
              :class="{ on: activeScheme.target.seasonId === season.id }"
              @click="pickSchemeSeason(activeScheme, season.id)"
            >{{ season.name }}</button>
            <button
              :class="{ on: !activeScheme.target.seasonId }"
              title="导入为新作息方案"
              @click="startNewSeason(activeScheme)"
            >＋ 新方案</button>
          </div>
        </div>
        <div v-if="!activeScheme.target.seasonId" class="it-row">
          <span>新方案名</span>
          <input
            class="grow"
            :value="activeScheme.target.newSeasonName"
            aria-label="新方案名"
            :placeholder="activeScheme.detectedSeason || '例如：夏季时间'"
            @input="updateSchemeTarget(activeScheme, { newSeasonName: $event.target.value })"
          />
        </div>
        <p v-if="activeScheme.target.mode === 'pending'" class="assignment-message missing">
          ⚠ {{ targetPendingReasonText(activeScheme) }}
        </p>
        <p v-else-if="activeScheme.target.mode === 'replace'" class="assignment-message">
          ✓ 将替换「{{ schemeDisplayName(activeScheme, timeConfig) }}」的现有作息
        </p>
        <p v-else class="assignment-message matched">
          ✓ 将新建「{{ schemeDisplayName(activeScheme, timeConfig) }}」并写入识别结果
        </p>
      </div>

      <div class="seg detail-tabs" role="group" aria-label="作息识别结果筛选">
        <button :aria-pressed="detailFilter === 'all'" :class="{ on: detailFilter === 'all' }" @click="detailFilter = 'all'">全部 {{ activeScheme.rows.length }}</button>
        <button :aria-pressed="detailFilter === 'issues'" :class="{ on: detailFilter === 'issues' }" @click="detailFilter = 'issues'">
          异常 {{ activeSchemeIssueCount }}
        </button>
      </div>

      <div class="detail-rows">
        <div
          v-for="(row, index) in activeSchemeRows"
          :key="row.id"
          class="detail-row"
          :class="{ issue: rowIssuesFor(row).length }"
        >
          <div class="detail-row-main">
            <input v-model="row.label" class="grow" aria-label="节次名称" placeholder="节次名称" @input="onSchemeRowInput(row)" />
            <input v-model="row.start" aria-label="开始时间" type="time" @input="onSchemeRowInput(row)" />
            <i>—</i>
            <input v-model="row.end" aria-label="结束时间" type="time" @input="onSchemeRowInput(row)" />
            <button class="setting-del" aria-label="删除该行" title="删除该行" @click="removeSchemeRow(activeScheme, index)">✕</button>
          </div>
          <div v-if="rowIssuesFor(row).length" class="detail-row-issues">
            <span v-for="issue in rowIssuesFor(row)" :key="issue.message">⚠ {{ issue.message }}</span>
            <button
              v-if="rowIssuesFor(row).every((issue) => !issue.blocking)"
              class="btn btn-xs"
              @click="row.confirmed = true"
            >确认无误</button>
          </div>
        </div>
        <p v-if="!activeSchemeRows.length" class="tool-tip">没有待处理的异常项，可以直接返回总览进行导入。</p>
      </div>
      <button class="btn btn-sm btn-ghost" @click="addSchemeRow(activeScheme)">＋ 加一行</button>
    </template>

    <template #foot>
      <div v-if="activeScheme" class="detail-foot">
        <button class="btn" @click="closeSchemeDetail">返回总览</button>
        <button class="btn btn-primary" @click="closeSchemeDetail(); openImportPlan(activeScheme.id)">仅导入这一组</button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.setting-del {
  flex: 0 0 30px;
  height: 30px;
  color: var(--muted);
  font-size: var(--fs-12);
  border: 1px solid var(--border);
  border-radius: var(--radius-7);
  background: var(--card);
}
.setting-del:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.setting-del:disabled {
  opacity: 0.35;
  cursor: default;
}
.grow { min-width: 0; flex: 1; }
.tool-tip { margin: 0; color: var(--ink-faint); font-size: var(--fs-11); line-height: 1.5; }
.btn-xs { flex: 0 0 auto; padding: 4px 8px; font-size: var(--fs-10-5); }
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
.detail-target { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-11); background: var(--bg-tint); }
/* 三种（命中 / 缺失 / 不适用）提示原本只有一条跟主题走；这里把另外两条也成对迁移：
   底色一起从 --card 混出来，深色下才不是两条白条配亮色字。 */
.assignment-message { margin: 0; padding: 8px 10px; border-radius: var(--radius-8); background: color-mix(in srgb, var(--success) 10%, var(--card)); color: var(--success); font-size: var(--fs-11-5); line-height: 1.5; }
.assignment-message.missing { background: color-mix(in srgb, var(--warning) 10%, var(--card)); color: var(--warning); }
.assignment-message.matched { background: #eef4ff; color: #2456b8; }
.detail-tabs { align-self: flex-start; }
.detail-tabs button { padding: 7px 14px; }
.detail-rows { display: flex; flex-direction: column; gap: 6px; max-height: 46vh;max-height:46dvh; overflow-y: auto; padding-right: 2px; }
.detail-row { padding: 4px 6px; border-radius: var(--radius-9); }
/* 异常行的底/边是写死的琥珀浅色，行内的琥珀文字要跟着令牌走，底就必须一起迁移。
   这里刻意只用 6% 而不是 Toast 那套 10%：这一行里还有 var(--muted) 的间隔箭头，
   10% 混合底会让它在浅色掉到 4.34:1（10% 深底同理 4.31:1）；实测 6% 是同时保住
   琥珀文字（浅 5.44 / 深 7.32）与灰箭头（浅 4.58 / 深 4.69）的最大比例。 */
.detail-row.issue { padding: 7px; border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--card)); background: color-mix(in srgb, var(--warning) 6%, var(--card)); }
.detail-row-main { display: grid; grid-template-columns: minmax(0, 1fr) 110px 14px 110px 26px; align-items: center; gap: 6px; }
.detail-row-main i { color: var(--muted); font-style: normal; text-align: center; }
.detail-row-main input[type='time'] { padding: 6px; font-size: var(--fs-12-5); }
.detail-row-issues { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; color: var(--warning); font-size: var(--fs-11); line-height: 1.45; }
.detail-foot { display: flex; justify-content: space-between; gap: 10px; }
.detail-foot .btn-primary { margin-left: auto; }
.it-row { display: grid; grid-template-columns: 54px minmax(0,1fr); align-items: center; gap: 8px; }
.it-row > span { color: var(--ink-faint); font-size: var(--fs-11-5); font-weight: var(--fw-700); }
.choice-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.choice-chips button { padding: 7px 11px; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--card); color: var(--ink-soft); font-size: var(--fs-12); cursor: pointer; }
.choice-chips button.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); font-weight: var(--fw-700); }

@media (max-width: 520px) {
  .it-row { grid-template-columns: 48px minmax(0, 1fr); }
  .detail-row-main { grid-template-columns: minmax(0, 1fr) 92px 12px 92px 24px; gap: 4px; }
}
</style>
