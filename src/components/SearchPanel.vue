<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Modal from './Modal.vue'
import EmptyState from './EmptyState.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { useStoredRef } from '../composables/store'
import { isArchived } from '../composables/domain/state.js'
import { focusLocation } from '../composables/focusNavigation.js'
import { noteText } from '../composables/notes.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const router = useRouter()
const domain = useDomainCommands()
const checklists = useStoredRef('sl_checklists', [])

const query = ref('')
const LIMIT_PER_GROUP = 6

function matches(text, ...values) {
  return values.some((value) => String(value ?? '').toLowerCase().includes(text))
}

/**
 * 把标题切成「命中 / 未命中」的片段，模板里用 <mark> 包住命中段。
 *
 * 刻意不做 v-html：标题来自用户数据（笔记标题、账单名），
 * 里面完全可能有尖括号，拼 HTML 会引入注入面。这里只用 slice 切字符串，
 * 由 Vue 负责转义。
 */
function highlightParts(text) {
  const source = String(text ?? '')
  const needle = query.value.trim().toLowerCase()
  if (!needle) return [{ text: source, hit: false }]
  const haystack = source.toLowerCase()
  const parts = []
  let cursor = 0
  let index = haystack.indexOf(needle)
  // 上限只是防御性保护：极端输入（大量重复命中）不该拖慢渲染。
  for (let hit = 0; index !== -1 && hit < 40; hit += 1) {
    if (index > cursor) parts.push({ text: source.slice(cursor, index), hit: false })
    parts.push({ text: source.slice(index, index + needle.length), hit: true })
    cursor = index + needle.length
    index = haystack.indexOf(needle, cursor)
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), hit: false })
  return parts.length ? parts : [{ text: source, hit: false }]
}

function live(entity) {
  return entity && !entity.deletedAt && !entity.tombstone
}

function heading(item) {
  return { id: item.id, title: item.title, meta: item.meta, archived: item.archived, to: item.to }
}

const groups = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!text) return []
  const out = []

  const tasks = domain.tasks.value
    .filter((item) => live(item) && matches(text, item.title, item.note, item.course))
  if (tasks.length) {
    out.push({
      key: 'task', label: '待办', icon: '✅',
      items: tasks.slice(0, LIMIT_PER_GROUP).map((item) => heading({
        id: item.id, title: item.title, meta: item.course || '', archived: isArchived(item), to: focusLocation('/tasks', item.id),
      })),
    })
  }

  const events = domain.events.value
    .filter((item) => live(item) && matches(text, item.title, item.location, item.note, item.courseName))
  if (events.length) {
    out.push({
      key: 'event', label: '日程', icon: '🗓️',
      items: events.slice(0, LIMIT_PER_GROUP).map((item) => heading({
        id: item.id, title: item.title, meta: item.date || '', archived: isArchived(item), to: focusLocation('/', item.id, { section: 'event' }),
      })),
    })
  }

  const notes = domain.notes.value
    .filter((item) => live(item) && matches(text, item.title, noteText(item), (item.tags || []).join(' ')))
  if (notes.length) {
    out.push({
      key: 'note', label: '笔记', icon: '📝',
      items: notes.slice(0, LIMIT_PER_GROUP).map((item) => heading({
        id: item.id, title: item.title || noteText(item), meta: '', archived: isArchived(item), to: focusLocation('/notes', item.id),
      })),
    })
  }

  const milestones = domain.milestones.value
    .filter((item) => live(item) && matches(text, item.name, item.location, item.courseName))
  if (milestones.length) {
    out.push({
      key: 'milestone', label: '重要日期', icon: '⏳',
      items: milestones.slice(0, LIMIT_PER_GROUP).map((item) => heading({
        id: item.id, title: item.name, meta: item.date || '', archived: isArchived(item), to: focusLocation('/exams', item.id),
      })),
    })
  }

  const bills = domain.bills.value
    .filter((item) => live(item) && matches(text, item.name, item.note))
  if (bills.length) {
    out.push({
      key: 'bill', label: '固定账单', icon: '📒',
      items: bills.slice(0, LIMIT_PER_GROUP).map((item) => heading({
        id: item.id, title: item.name, meta: item.nextDate || '', archived: isArchived(item) || item.active === false, to: focusLocation('/bills', item.id, { section: 'bill' }),
      })),
    })
  }

  const transactions = domain.transactions.value
    .filter((item) => live(item) && !item.archivedAt && matches(text, item.name, item.note))
  if (transactions.length) {
    out.push({
      key: 'transaction', label: '账本记录', icon: '💳',
      items: transactions.slice(0, LIMIT_PER_GROUP).map((item) => heading({
        id: item.id, title: item.name, meta: `${item.date || ''}`, archived: false, to: focusLocation('/bills', item.id),
      })),
    })
  }

  const courses = domain.courses.value
    .filter((item) => live(item) && !item.archivedAt && matches(text, item.name, item.teacher, item.room))
  if (courses.length) {
    out.push({
      key: 'course', label: '课程', icon: '📅',
      items: courses.slice(0, LIMIT_PER_GROUP).map((item) => heading({
        id: item.id, title: item.name, meta: [item.teacher, item.room].filter(Boolean).join(' · ') || '', archived: isArchived(item), to: { path: '/schedule' },
      })),
    })
  }

  const checklistHits = checklists.value
    .flatMap((list) => (Array.isArray(list.items) ? list.items.map((item) => ({ list: list.name, item })) : []))
    .filter(({ item }) => live(item) && matches(text, item.text || item.title, item.note))
  if (checklistHits.length) {
    out.push({
      key: 'checklist', label: '清单', icon: '☑️',
      items: checklistHits.slice(0, LIMIT_PER_GROUP).map(({ list, item }) => heading({
        id: item.id, title: item.text || item.title, meta: list || '', archived: item.done === true, to: { path: '/lists' },
      })),
    })
  }

  return out
})

const total = computed(() => groups.value.reduce((count, group) => count + group.items.length, 0))

function navigate(result) {
  emit('close')
  router.push(result.to)
}

watch(() => props.open, (open) => {
  if (open) {
    // 每次打开都从空查询开始。
    //
    // 聚焦**不再**在这里手动做：原来这里是 `nextTick(() => inputEl.focus())`，
    // 而 Modal 打开时也会自动聚焦（优先 `[autofocus]` 元素，否则第一个可聚焦元素）。
    // 两套机制抢同一个焦点，实测赢的是 Modal 的关闭按钮——
    // 于是"按 / 打开搜索、直接打字"根本不成立。现在只留一处：
    // 输入框上带 `autofocus`（与 NotesView 的正文框同一写法），交给 Modal 聚焦。
    query.value = ''
  }
})
</script>

<template>
  <Modal :open="open" title="🔍 全局搜索" medium @close="emit('close')">
    <div class="search-panel">
      <label class="search-input">
        <span class="sr-only">搜索内容</span>
        <input autofocus v-model="query" type="search" placeholder="搜索待办、日程、笔记、账单、课程…" />
      </label>

      <p v-if="query && total" class="search-summary" role="status">找到 {{ total }} 条，点击可跳到对应位置</p>

      <div v-if="groups.length" class="search-groups">
        <section v-for="group in groups" :key="group.key" class="search-group">
          <h4>{{ group.icon }} {{ group.label }} <span class="group-count">{{ group.items.length }}</span></h4>
          <button v-for="result in group.items" :key="result.id" type="button" class="search-result" @click="navigate(result)">
            <span class="result-title"><template v-for="(part, partIndex) in highlightParts(result.title)" :key="partIndex"><mark v-if="part.hit" class="search-hit">{{ part.text }}</mark><span v-else>{{ part.text }}</span></template></span>
            <span class="result-meta">
              <template v-if="result.meta">{{ result.meta }} · </template>
              {{ result.archived ? '已归档/完成' : group.label }}
            </span>
          </button>
        </section>
      </div>

      <EmptyState :level="2"
        v-else-if="query"
        icon="🔍"
        title="没有找到相关内容"
        description="试试更短的关键词，或换个说法。"
      />

      <p v-else class="search-hint">输入关键词，一次性搜索课程、待办、日程、笔记、账单和清单。</p>
    </div>
  </Modal>
</template>

<style scoped>
.search-panel { display: flex; flex-direction: column; gap: 12px; }
.search-input input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}
.search-summary { margin: 0; color: var(--muted); font-size: 12px; }
.search-hint { margin: 6px 0 2px; color: var(--muted); font-size: 12.5px; }
.search-groups { display: flex; flex-direction: column; gap: 12px; max-height: 60vh;max-height:60dvh; overflow-y: auto; }
.search-group h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; color: var(--ink-soft); font-size: 12px; }
.group-count { color: var(--muted); font-weight: 600; }
.search-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  text-align: left;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  cursor: pointer;
}
.search-result:hover { border-color: var(--primary); background: var(--primary-soft); }
.search-result + .search-result { margin-top: 5px; }
.result-title { min-width: 0; overflow: hidden; font-size: 13.5px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
/* 关键词高亮：用 mark 保留语义（读屏会提示"已标记"），
   底色从主色派生，随主题与壁纸取色一起变化。 */
.search-hit { padding: 0 1px; border-radius: 3px; background: color-mix(in srgb, var(--primary) 20%, transparent); color: inherit; }
.result-meta { flex: 0 0 auto; max-width: 45%; overflow: hidden; color: var(--muted); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
</style>