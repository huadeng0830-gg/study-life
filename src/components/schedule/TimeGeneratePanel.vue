<script setup>
/**
 * 「快速生成作息时间」面板：参数 → 预览 → 应用。
 *
 * 【为什么按钮写成 `genPreview = null` 而不是调函数】`genPreview` 是
 * composables/timeGenerate.js 里的模块级 ref：生成预览与"方案编辑器"共处一个面板，
 * 用户在预览和别处工具之间来回切时，预览必须跟着工具的互斥状态一起收起。
 * 这里直接写 ref 赋值与父组件里其它工具的写法保持一致，不额外包一层只做赋值的函数。
 *
 * 【为什么"生成控件始终可见"那条注释必须跟着走】它解释的是一个看起来像 bug 的写法
 * （两个恒真的条件）。搬组件时最容易有人"顺手修正"成 v-if，那样收起预览会连参数一起藏掉。
 */
import { timeConfig } from '../../composables/store/timeConfig.js'
import {
  applyGenerate,
  gen,
  genAfterOptions,
  genStartOptions,
  toggleGenPreview,
} from '../../composables/timeGenerate.js'
import { genPreview } from '../../composables/timePlanTools.js'
</script>

<template>
  <div class="gen-box">
    <button type="button" class="gen-title as-btn" @click="toggleGenPreview">
      ⚡ 快速生成时间（辅助填充）<i>{{ genPreview ? '▴' : '▾' }}</i>
    </button>
    <!-- 生成控件始终可见：这里曾是 `v-show="genPreview !== null || true"` + `v-if="1"`，
         两个条件都恒真，等于没写——而且比没写更糟，因为它看起来像在门控
         （预览部分由下面独立的 `v-if="genPreview"` 负责）。别再把条件加回来。 -->
    <div class="gen-body">
      <div class="gen-grid">
        <label class="gen-item">
          <span>从</span>
          <select v-model="gen.startId">
            <option v-for="p in genStartOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
          <span>开始</span>
        </label>
        <label class="gen-item">
          <input v-model="gen.startTime" type="time" />
          <span>上课</span>
        </label>
        <label class="gen-item">
          <span>每节</span>
          <input v-model.number="gen.duration" type="number" min="20" max="90" class="num" />
          <span>分钟</span>
        </label>
        <label class="gen-item">
          <span>节间休息</span>
          <input v-model.number="gen.breakMin" type="number" min="0" max="60" class="num" />
          <span>分钟</span>
        </label>
        <label class="gen-item">
          <span>午休：第</span>
          <select v-model.number="gen.lunchAfterIdx" class="num">
            <option v-for="(p, i) in genAfterOptions" :key="p.id" :value="i" :disabled="i >= timeConfig.periods.length - 1">{{ p.label }}</option>
          </select>
          <span>后</span>
          <input v-model.number="gen.lunchMin" type="number" min="0" max="300" class="num" />
          <span>分钟（0=不休）</span>
        </label>
        <label class="gen-item">
          <span>晚休：第</span>
          <select v-model.number="gen.dinnerAfterIdx" class="num">
            <option v-for="(p, i) in genAfterOptions" :key="p.id" :value="i" :disabled="i >= timeConfig.periods.length - 1">{{ p.label }}</option>
          </select>
          <span>后</span>
          <input v-model.number="gen.dinnerMin" type="number" min="0" max="300" class="num" />
          <span>分钟（0=不休）</span>
        </label>
      </div>
      <button class="btn btn-sm btn-ghost" @click="toggleGenPreview">{{ genPreview ? '收起预览' : '生成预览' }}</button>

      <!-- 生成预览：取消 / 填充空白 / 覆盖 -->
      <div v-if="genPreview" class="diff-list">
        <p class="tool-tip">预览：从「{{ timeConfig.periods[genPreview.rows[0]?.index ?? 0]?.label }}」起共 {{ genPreview.rows.length }} 节。生成只是辅助填充，生成后仍可逐节修改。</p>
        <div v-for="row in genPreview.rows" :key="row.index" class="diff-row">
          <span class="diff-label">{{ row.label }}</span>
          <s>{{ row.from }}</s>
          <i>→</i>
          <b>{{ row.to }}</b>
        </div>
        <div class="gen-apply-row">
          <button class="btn btn-sm" @click="genPreview = null">取消</button>
          <button class="btn btn-sm" @click="applyGenerate('fill')">填充空白节次</button>
          <button class="btn btn-sm btn-primary" @click="applyGenerate('all')">覆盖当前方案</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-tip { margin: 0; color: var(--ink-faint); font-size: var(--fs-11); line-height: 1.5; }
.diff-list { display: flex; flex-direction: column; gap: 5px; max-height: 240px; overflow-y: auto; }
.diff-row { display: flex; align-items: center; gap: 8px; font-size: var(--fs-12); font-variant-numeric: tabular-nums; }
.diff-label { flex: 0 0 76px; overflow: hidden; color: var(--text); white-space: nowrap; text-overflow: ellipsis; }
.diff-row s { color: var(--ink-faint); }
.diff-row i { color: var(--primary); font-style: normal; }
.diff-row b { color: var(--primary); font-weight: var(--fw-700); }
.gen-apply-row { display: flex; gap: 8px; flex-wrap: wrap; }
.gen-box {
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  padding: 12px 14px;
  background: var(--bg-tint);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gen-title {
  font-size: var(--fs-13);
  font-weight: var(--fw-700);
  color: var(--primary);
}
.gen-title.as-btn { width: 100%; text-align: left; background: none; border: none; cursor: pointer; font-size: var(--fs-13); font-weight: var(--fw-750); color: var(--text); padding: 0; display: flex; justify-content: space-between; align-items: center; }
.gen-title.as-btn:hover { color: var(--primary); }
.gen-title.as-btn i { font-style: normal; color: var(--ink-faint); font-size: var(--fs-11); }
.gen-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.gen-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-12);
  color: var(--muted);
}
.gen-item input,
.gen-item select {
  padding: 5px 7px;
  font-size: var(--fs-12);
  border-radius: var(--radius-6);
}
.gen-item .num {
  width: 62px;
}
.gen-item input[type='time'] {
  width: 96px;
}
</style>
