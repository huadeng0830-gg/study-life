<script setup>
import { reminderAction } from '../composables/domain/selectors.js'
import { Button } from './ui/button'

defineProps({
  mode: { type: String, required: true },
  items: { type: Array, required: true },
  empty: { type: Boolean, default: false },
  meta: { type: Function, required: true },
})
const emit = defineEmits(['activate'])

function actionLabel(item) {
  const action = reminderAction(item).action
  return action === 'complete' ? '完成' : action === 'pay' ? '记录支付' : '查看'
}
</script>

<template>
  <template v-if="mode === 'actions'">
    <section v-if="items.length" class="action-panel" aria-label="现在该做">
      <div class="panel-head">
        <div><h2>今天最重要</h2><span class="panel-subtitle">今天优先 · 近期事项补充 · 最多 3 项</span></div>
        <Button as-child variant="ghost" class="panel-link"><RouterLink to="/tasks">查看待办 →</RouterLink></Button>
      </div>
      <div class="action-list">
        <div v-for="item in items" :key="item.key" class="action-row">
          <span class="action-mark" aria-hidden="true">○</span>
          <div class="action-copy"><b>{{ item.title }}</b><span>{{ meta(item) }}</span></div>
          <Button variant="secondary" class="reminder-action whitespace-normal" @click="emit('activate', item)">{{ actionLabel(item) }}</Button>
        </div>
      </div>
    </section>
    <p v-else-if="empty" class="quiet-empty">今天暂时没有需要马上处理的事项。</p>
  </template>

  <section v-else-if="items.length" class="action-panel risk-panel" aria-label="需要注意">
    <div class="panel-head"><div><h2>需要注意</h2><span class="panel-subtitle">逾期、临近截止和即将到期</span></div></div>
    <div class="action-list">
      <div v-for="item in items" :key="item.key" class="action-row risk-row">
        <span class="action-mark" aria-hidden="true">⚠</span>
        <div class="action-copy"><b>{{ item.title }}</b><span>{{ meta(item) }}</span></div>
        <Button variant="secondary" class="reminder-action whitespace-normal" @click="emit('activate', item)">{{ actionLabel(item) }}</Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.action-panel {
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--card-radius);
  background: var(--card);
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.panel-head h2 { font-size: var(--fs-15-5); }
.panel-head > div { min-width: 0; }
.panel-link {
  color: var(--primary);
  font-size: var(--fs-12);
  font-weight: var(--fw-700);
  text-decoration: none;
  white-space: nowrap;
}
.panel-link:hover { text-decoration: underline; }
.panel-subtitle {
  display: block;
  margin-top: 3px;
  color: var(--ink-faint);
  font-size: var(--fs-11-5);
  font-weight: var(--fw-500);
}
.risk-panel {
  border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, var(--card));
}
.action-list { display: flex; flex-direction: column; }
.action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  border-top: 1px solid var(--border);
}
.action-row:first-child { border-top: 0; }
.action-mark {
  display: grid;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  place-items: center;
  color: var(--primary);
  font-size: var(--fs-17);
}
.risk-row .action-mark, .risk-row .action-copy span { color: var(--danger); }
.action-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.action-copy b {
  overflow: hidden;
  font-size: var(--fs-13-5);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.action-copy span { color: var(--ink-soft); font-size: var(--fs-11-5); }
.quiet-empty {
  grid-column: 1 / -1;
  justify-self: start;
  width: fit-content;
  max-width: 100%;
  padding: 14px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--card-radius);
  background: var(--bg-tint);
  color: var(--ink-soft);
  font-size: var(--fs-13);
}
.reminder-action {
  flex: none;
  padding: 4px 7px;
  border: 0;
  border-radius: var(--radius-6);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: var(--fs-11);
  font-weight: var(--fw-750);
  text-decoration: none;
}
@media (max-width: 520px) {
  .action-panel { padding: 14px; }
  .action-row { min-height: 52px; }
}
@media (max-width: 900px), (pointer: coarse) and (max-height: 520px) {
  .panel-head { flex-wrap: wrap; align-items: center; }
  .action-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: start; gap: 8px; padding-block: 10px; }
  .action-copy b { white-space: normal; overflow-wrap: anywhere; line-height: 1.5; }
  .action-copy span { overflow-wrap: anywhere; }
  .action-mark { width: 20px; }
  .reminder-action { min-height: 44px; min-width: 44px; padding: 8px; white-space: normal; }
  .panel-link { min-height: 44px; }
}
</style>
