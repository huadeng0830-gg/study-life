<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Modal from './Modal.vue'
import EmptyState from './EmptyState.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { useStoredRef } from '../composables/store'
import { isArchived } from '../composables/domain/state.js'
import { useDebouncedRef } from '../composables/useDebouncedRef.js'
import { focusLocation } from '../composables/focusNavigation.js'
import { focusSearchDate, focusSearchMeta, focusSearchTarget, focusSearchTitle, matchesText, pickHits } from '../composables/searchRelevance.js'
import { announce } from '../composables/liveRegion.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const router = useRouter()
const domain = useDomainCommands()
const checklists = useStoredRef('sl_checklists', [])
// 功能 34：专注记录以前根本搜不到。这里刻意用与清单同样的读法（useStoredRef + 默认 []），
// 不引新的存储键、不改 focusTimer 写入的字段语义。
const focusSessions = useStoredRef('sl_focus_sessions', [])

const query = ref('')
const LIMIT_PER_GROUP = 6
// 专注记录是唯一会**无上界**增长的分组（一次专注就是一条），而且它是八组里
// 唯一没有详情页可跳的（落点只是首页专注面板或那条待办）。所以上限更小、排在最后：
// 宁可少给几条，也不要让它把有真实落点的结果挤出可视区。
const LIMIT_FOCUS_GROUP = 4

/**
 * 类型筛选的**唯一**名目表：芯片的文案、分组的文案与图标都从这里取，
 * 所以两者不可能各自漂移。（此前分组名写在每个分支的 push 里，加一个类型要改三处。）
 * 顺序 = 结果分组的展示顺序，`focus` 刻意在最后，理由见 LIMIT_FOCUS_GROUP。
 */
const SEARCH_TYPES = Object.freeze([
  { key: 'all', label: '全部' },
  { key: 'task', label: '待办', icon: '✅' },
  { key: 'event', label: '日程', icon: '🗓️' },
  { key: 'milestone', label: '重要日期', icon: '⏳' },
  { key: 'bill', label: '固定账单', icon: '📒' },
  { key: 'transaction', label: '账本记录', icon: '💳' },
  { key: 'course', label: '课程', icon: '📅' },
  { key: 'checklist', label: '清单', icon: '☑️' },
  { key: 'focus', label: '专注记录', icon: '⏱️' },
])

const typeFilter = ref('all')

function typeOf(key) {
  return SEARCH_TYPES.find((entry) => entry.key === key) ?? SEARCH_TYPES[0]
}

/**
 * 把标题切成「命中 / 未命中」的片段，模板里用 <mark> 包住命中段。
 *
 * 刻意不做 v-html：标题来自用户数据（待办标题、账单名），
 * 里面完全可能有尖括号，拼 HTML 会引入注入面。这里只用 slice 切字符串，
 * 由 Vue 负责转义。
 */
function highlightParts(text) {
  const source = String(text ?? '')
  // 高亮用的 needle 必须与 groups 用的是同一个值，否则会出现「结果里高亮了
  // 一段并不在查询里的字」。
  const needle = debouncedQuery.value.trim().toLowerCase()
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

/** 一条候选结果。`title` 既是展示文字也是排序/高亮依据，`contents` 是参与匹配的非标题字段。 */
function hit(item) {
  return {
    id: item.id,
    title: String(item.title ?? ''),
    meta: item.meta ?? '',
    archived: Boolean(item.archived),
    to: item.to,
    updatedAt: item.updatedAt ?? '',
    contents: item.contents ?? [],
  }
}

/**
 * 把一个列表收成该分组的候选结果。
 *
 * 命中判定仍然是 `matchesText`（大小写不敏感 includes，与改造前同一条语义），
 * 并且用的是 `hit()` 里那份 `title + contents` —— 匹配与排序/高亮因此天然同源。
 *
 * 先 filter 后 map 是刻意的：候选对象只在命中时才分配，那一轮命中判定是纯字符串
 * 操作。这正是原来那条注释担心的"上千条数据时每敲一个字就是上万次字符串操作"；
 * 反过来（先 map 出全部候选再过滤）会让对象分配量与数据量同阶增长。
 */
function collect(list, text, pick, keep = live) {
  const out = []
  for (const item of list) {
    if (!keep(item)) continue
    const row = pick(item)
    if (!row || !matchesText(text, row.title, ...row.contents)) continue
    out.push(row)
  }
  return out
}

/**
 * 建一个分组。**先排序再截断**（`pickHits` 内部的口径），没有命中就返回 null ——
 * 调用方直接跳过，不产出"空壳分组 + 无结果"那种让人以为是自己搜错了的界面。
 */
function group(key, text, candidates, limit = LIMIT_PER_GROUP) {
  const { items, hitCount } = pickHits(candidates, text, limit)
  if (!items.length) return null
  return { ...typeOf(key), hitCount, items }
}

/**
 * 专注记录的落点。**不为它新建页面**：它没有详情弹窗，也没有任何列表项带
 * `data-focus-id`，凭空造一个页面/弹窗只会给这份数据添一个只有搜索能进的孤儿入口。
 *
 * 于是按"有没有更精确的落点"来选：关联待办还在就跳那条待办（真的能聚焦到它），
 * 否则回首页——专注面板就在那儿。刻意**不挂** `focus` 查询参数：
 * `TodayView` 只消费 `section=event`，挂一个没人读的 `?focus=` 只会让地址栏留垃圾。
 */
// 输入框跟 query（打字即时反馈），真正的 8 路整表扫描只跑在 debouncedQuery 上。
// 原来每敲一个字都要把待办、日程、重要日期、账单、流水、课程与清单条目
// 全扫一遍并 toLowerCase 一轮 —— 数据上千时每秒钟就是两万次字符串操作。
const debouncedQuery = useDebouncedRef(query, 160)

/** 未按类型筛选的全部分组；芯片上的计数取自这里，所以"哪个类型有命中"始终看得见。 */
const allGroups = computed(() => {
  const text = debouncedQuery.value.trim().toLowerCase()
  if (!text) return []
  const out = []
  // 用一次 O(tasks) 建索引，避免每条专注记录都对任务数组重新 some() 扫描。
  const taskIds = new Set(domain.tasks.value.map((task) => String(task?.id ?? '')))

  const tasks = group('task', text, collect(domain.tasks.value, text, (item) => hit({
    id: item.id,
    title: item.title,
    contents: [item.note, item.course],
    updatedAt: item.updatedAt,
    meta: item.course || '',
    archived: isArchived(item),
    to: focusLocation('/tasks', item.id),
  })))
  if (tasks) out.push(tasks)

  const events = group('event', text, collect(domain.events.value, text, (item) => hit({
    id: item.id,
    title: item.title,
    contents: [item.location, item.note, item.courseName],
    updatedAt: item.updatedAt,
    meta: item.date || '',
    archived: isArchived(item),
    to: focusLocation('/', item.id, { section: 'event' }),
  })))
  if (events) out.push(events)

  const milestones = group('milestone', text, collect(domain.milestones.value, text, (item) => hit({
    id: item.id,
    title: item.name,
    contents: [item.location, item.courseName],
    updatedAt: item.updatedAt,
    meta: item.date || '',
    archived: isArchived(item),
    to: focusLocation('/exams', item.id),
  })))
  if (milestones) out.push(milestones)

  const bills = group('bill', text, collect(domain.bills.value, text, (item) => hit({
    id: item.id,
    title: item.name,
    contents: [item.note],
    updatedAt: item.updatedAt,
    meta: item.nextDate || '',
    archived: isArchived(item) || item.active === false,
    to: focusLocation('/bills', item.id, { section: 'bill' }),
  })))
  if (bills) out.push(bills)

  const transactions = group('transaction', text, collect(
    domain.transactions.value,
    text,
    (item) => hit({
      id: item.id,
      title: item.name,
      contents: [item.note],
      updatedAt: item.updatedAt,
      meta: `${item.date || ''}`,
      archived: false,
      to: focusLocation('/bills', item.id),
    }),
    (item) => live(item) && !item.archivedAt,
  ))
  if (transactions) out.push(transactions)

  const courses = group('course', text, collect(
    domain.courses.value,
    text,
    (item) => hit({
      id: item.id,
      title: item.name,
      contents: [item.teacher, item.room],
      updatedAt: item.updatedAt,
      meta: [item.teacher, item.room].filter(Boolean).join(' · ') || '',
      archived: isArchived(item),
      to: { path: '/schedule' },
    }),
    (item) => live(item) && !item.archivedAt,
  ))
  if (courses) out.push(courses)

  const checklistEntries = checklists.value
    .flatMap((list) => (Array.isArray(list?.items) ? list.items.map((item) => ({ list: list.name || '', item })) : []))
  const checklistItems = group('checklist', text, collect(checklistEntries, text, (row) => (row.item ? hit({
    id: row.item.id,
    title: row.item.text || row.item.title,
    contents: [row.item.note],
    // 清单条目没有 updatedAt：取 0 就等于"同级按原顺序"，也就是清单内的书写顺序。
    updatedAt: '',
    meta: row.list,
    archived: row.item.done === true,
    to: { path: '/lists' },
  }) : null), (row) => live(row.item)))
  if (checklistItems) out.push(checklistItems)

  // 功能 34：专注记录。匹配字段刻意只有「标题 + 日期」——
  // courseId / todoId 是 id 不是人话，用户搜"高数"不该命中一条 id 里恰好有这串字符的记录。
  const focus = group('focus', text, collect(focusSessions.value, text, (item) => hit({
    id: item.sessionId || item.id,
    title: focusSearchTitle(item),
    contents: [focusSearchDate(item)],
    updatedAt: item.endedAt || item.startedAt || '',
    meta: focusSearchMeta(item),
    archived: false,
    to: focusSearchTarget(item, taskIds),
  }), (item) => live(item) && Boolean(item.sessionId || item.id)), LIMIT_FOCUS_GROUP)
  if (focus) out.push(focus)

  return out
})

/** 类型筛选只做"整组取舍"，不改动任何分组内部的结果。 */
const groups = computed(() => (
  typeFilter.value === 'all'
    ? allGroups.value
    : allGroups.value.filter((group) => group.key === typeFilter.value)
))

const typeCounts = computed(() => {
  const counts = { all: 0 }
  for (const entry of allGroups.value) {
    counts[entry.key] = entry.hitCount
    counts.all += entry.hitCount
  }
  return counts
})

const total = computed(() => groups.value.reduce((count, entry) => count + entry.items.length, 0))

/** 芯片文案。计数用单个文本表达式而不是 `<b>{{ n }}</b>`：模板换行会被 Vue 收紧掉空白，
 *  那样读屏听到的是"待办3"；写成一段字符串就能拿到"待办 3"。 */
function chipLabel(item) {
  const count = typeCounts.value[item.key] || 0
  return `${item.icon ? `${item.icon} ` : ''}${item.label} ${count}`
}

/** 筛选把结果清空、但"全部"下其实是有命中的 —— 这两句文案必须分开说。 */
const narrowed = computed(() => typeFilter.value !== 'all' && allGroups.value.length > 0)

const summaryText = computed(() => (
  typeFilter.value === 'all'
    ? `找到 ${total.value} 条，点击可跳到对应位置`
    : `在「${typeOf(typeFilter.value).label}」里找到 ${total.value} 条`
))

watch([() => props.open, debouncedQuery, summaryText], ([open, term, summary]) => {
  if (open && String(term || '').trim()) announce(summary, { clearAfter: 5000 })
})

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
    // 输入框上带 `autofocus`，由 Modal 负责聚焦。
    query.value = ''
    // 防抖值也要立刻归位：只清 query 的话，真正驱动分组的那份还要再等 160ms，
    // 于是重开面板的头一瞬是"输入框空着、上一轮的结果还挂着"。
    debouncedQuery.flush('')
    // 类型筛选**刻意不落 sl_***：搜索面板是临时浮层，下次打开回到"全部"才符合直觉。
    // 不像路由视图那样需要跨会话记住"上次我只想看课程"——那种诉求该由视图自己的筛选承担。
    typeFilter.value = 'all'
  }
})
</script>

<template>
  <Modal :open="open" title="🔍 全局搜索" medium @close="emit('close')">
    <div class="search-panel">
      <label class="search-input">
        <span class="sr-only">搜索内容</span>
        <input autofocus v-model="query" type="search" placeholder="搜索待办、日程、账单、课程…" />
      </label>

      <!-- 普通按钮 + aria-pressed，不用 tab 语义：这里没有与 tab 一一对应的面板容器，
           套上 tablist/tab 只会宣告一个做不到的契约（还会被 tabPanelSemantics 判为违规）。 -->
      <div class="search-filters" role="group" aria-label="按类型筛选搜索结果">
        <button
          v-for="item in SEARCH_TYPES"
          :key="item.key"
          type="button"
          class="filter-chip"
          :class="{ on: typeFilter === item.key }"
          :aria-pressed="typeFilter === item.key"
          @click="typeFilter = item.key"
        >{{ chipLabel(item) }}</button>
      </div>

      <p v-if="query && total" class="search-summary">{{ summaryText }}</p>

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
        :title="narrowed ? '这个类型下没有匹配结果' : '没有找到相关内容'"
        :description="narrowed ? '换个类型，或把关键词改短一点。' : '试试更短的关键词，或换个说法。'"
      />

      <p v-else class="search-hint">输入关键词，一次性搜索课程、待办、日程、账单、清单和专注记录。</p>
    </div>
  </Modal>
</template>

<style scoped>
.search-panel { display: flex; flex-direction: column; gap: 12px; }
.search-input input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  font-size: var(--fs-14);
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--bg);
}
/* 类型筛选：十颗芯片在 540px 的 medium 弹窗里会折成两行，手机上三四行。
   刻意用「折行」而不是横向滚动条——横向滚动会把选项藏在看不见的地方，
   而这里每一颗都是等价的入口，没有"主次"可言。 */
.search-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.filter-chip {
  min-height: 36px;
  padding: 0 11px;
  color: var(--ink-soft);
  font-size: var(--fs-12);
  font-weight: var(--fw-700);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg);
  cursor: pointer;
}
.filter-chip.on { color: var(--on-primary, #fff); border-color: var(--primary); background: var(--primary); }
.search-summary { margin: 0; color: var(--muted); font-size: var(--fs-12); }
.search-hint { margin: 6px 0 2px; color: var(--muted); font-size: var(--fs-12-5); }
.search-groups { display: flex; flex-direction: column; gap: 12px; max-height: 60vh;max-height:60dvh; overflow-y: auto; }
.search-group h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; color: var(--ink-soft); font-size: var(--fs-12); }
.group-count { color: var(--muted); font-weight: var(--fw-600); }
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
  border-radius: var(--radius-8);
  background: var(--card);
  cursor: pointer;
}
.search-result:hover { border-color: var(--primary); background: var(--primary-soft); }
.search-result + .search-result { margin-top: 5px; }
.result-title { min-width: 0; overflow: hidden; font-size: var(--fs-13-5); font-weight: var(--fw-700); text-overflow: ellipsis; white-space: nowrap; }
/* 关键词高亮：用 mark 保留语义（读屏会提示"已标记"），
   底色从主色派生，随主题与壁纸取色一起变化。 */
.search-hit { padding: 0 1px; border-radius: var(--radius-3); background: color-mix(in srgb, var(--primary) 20%, transparent); color: inherit; }
.result-meta { flex: 0 0 auto; max-width: 45%; overflow: hidden; color: var(--muted); font-size: var(--fs-11-5); text-overflow: ellipsis; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
</style>
