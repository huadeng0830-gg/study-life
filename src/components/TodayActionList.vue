<script setup>
import { reminderAction } from '../composables/domain/selectors.js'
import { Button } from './ui/button'
import AppIcon from './AppIcon.vue'

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
        <div><h2>今天最重要</h2><span class="panel-subtitle">先完成眼前的一件事</span></div>
        <Button as-child variant="ghost" class="panel-link"><RouterLink to="/tasks">全部待办</RouterLink></Button>
      </div>
      <div class="action-list">
        <div v-for="item in items" :key="item.key" class="action-row">
          <span class="action-mark" aria-hidden="true"><AppIcon name="tasks" /></span>
          <div class="action-copy"><b>{{ item.title }}</b><span>{{ meta(item) }}</span></div>
          <Button variant="secondary" class="reminder-action whitespace-normal" @click="emit('activate', item)">{{ actionLabel(item) }}</Button>
        </div>
      </div>
    </section>
    <section v-else-if="empty" class="action-panel action-empty" aria-label="现在该做"><div class="panel-head"><h2>今天最重要</h2><Button as-child variant="ghost"><RouterLink to="/tasks">全部待办</RouterLink></Button></div><p class="quiet-empty">没有待处理的紧急事项。给今天留一个小目标吧。</p></section>
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
  padding: 0 0 var(--space-4);
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.panel-head h2 { font-size: var(--type-headline); font-weight: var(--fw-650); }
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
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--fs-13-5);
  text-overflow: ellipsis;
  white-space: normal;
}
.action-copy span { color: var(--ink-soft); font-size: var(--fs-11-5); }
.quiet-empty {
  margin: 0;
  padding: var(--space-2) 0;
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
  .action-panel { padding: 0 0 var(--space-4); }
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
