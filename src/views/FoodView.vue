<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import { todayStr, useStoredRef } from '../composables/store.js'
import { appearance } from '../composables/appearance.js'

const places = useStoredRef('sl_food_places', [])
const history = useStoredRef('sl_food_history', [])
// 筛选偏好本地持久化（新增键，不影响既有数据）
const FILTER_DEFAULTS = { budget: '', maxMinutes: '', sources: [], lastSelectedId: '', skippedIds: [], skippedAt: '' }
const prefs = useStoredRef('sl_food_filters', FILTER_DEFAULTS)

// 「暂时排除」跨刷新保持，但按“今天不想吃”的语义次日自动清零
function prefValue(key) {
  const value = prefs.value?.[key]
  return value === undefined || value === null ? FILTER_DEFAULTS[key] : value
}
function setPref(key, value) {
  prefs.value = { ...FILTER_DEFAULTS, ...prefs.value, [key]: value }
}
if (Array.isArray(prefValue('skippedIds')) && prefValue('skippedIds').length && prefValue('skippedAt') !== todayStr()) {
  setPref('skippedIds', [])
  setPref('skippedAt', '')
}

const showForm = ref(false)
const editingId = ref(null)
const error = ref('')
const picked = ref(null)
const meal = ref(currentMeal())
const form = ref(emptyForm())
const spinDegrees = ref(0)
const spinning = ref(false)
const flashPlace = ref(null)
let spinTimer = 0
let shuffleSeq = 0

// 偏好读写桥：保持模板用 ref 习惯，同时写入持久层
const skippedIds = computed({
  get: () => (Array.isArray(prefValue('skippedIds')) ? prefValue('skippedIds') : []),
  set: (value) => {
    setPref('skippedIds', value)
    setPref('skippedAt', value.length ? todayStr() : '')
  },
})
const budget = computed({
  get: () => String(prefValue('budget') ?? ''),
  set: (value) => setPref('budget', value),
})
const maxMinutes = computed({
  get: () => String(prefValue('maxMinutes') ?? ''),
  set: (value) => setPref('maxMinutes', value),
})
const selectedSources = computed({
  get: () => (Array.isArray(prefValue('sources')) ? prefValue('sources') : []),
  set: (value) => setPref('sources', value),
})
const lastSelectedId = computed({
  get: () => String(prefValue('lastSelectedId') ?? ''),
  set: (value) => setPref('lastSelectedId', value),
})

function restoreSkipped() {
  skippedIds.value = []
}

const MODE_HINTS = {
  cards: '直接随机推荐一个结果',
  wheel: '转一圈增加一点仪式感',
}

const LEGACY_SOURCES = {
  canteen: '学校食堂',
  takeout: '外卖',
  mall: '商场',
  restaurant: '校外餐厅',
  convenience: '便利店',
  homemade: '宿舍简餐',
}

const SOURCE_SUGGESTIONS = ['学校食堂', '外卖', '商场', '校外餐厅', '便利店', '宿舍简餐']
const CUISINE_SUGGESTIONS = ['面食', '米饭', '辣', '清淡', '外卖', '快餐', '轻食', '粉/米线']

const MEALS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  late: '夜宵',
}
const MEAL_KEYS = Object.keys(MEALS)
const WAIT_OPTIONS = [
  { value: '', label: '不限' },
  { value: '5', label: '≤ 5 分钟' },
  { value: '10', label: '≤ 10 分钟' },
  { value: '20', label: '≤ 20 分钟' },
]
const BUDGET_OPTIONS = [
  { value: '', label: '不限' },
  { value: '10', label: '≤ ¥10' },
  { value: '20', label: '≤ ¥20' },
  { value: '30', label: '≤ ¥30' },
]

function currentMeal() {
  const hour = new Date().getHours()
  if (hour < 10) return 'breakfast'
  if (hour < 15) return 'lunch'
  if (hour < 21) return 'dinner'
  return 'late'
}

function emptyForm() {
  return {
    name: '',
    source: '',
    area: '',
    cuisine: '',
    price: '',
    waitMinutes: 10,
    rating: 4,
    meals: ['lunch', 'dinner'],
    note: '',
    active: true,
  }
}

function openAdd() {
  editingId.value = null
  form.value = emptyForm()
  error.value = ''
  showForm.value = true
}

function openEdit(place) {
  editingId.value = place.id
  form.value = {
    name: place.name,
    source: placeSource(place),
    area: place.area ?? '',
    cuisine: place.cuisine ?? '',
    price: place.price ?? '',
    waitMinutes: place.waitMinutes ?? 10,
    rating: place.rating ?? 4,
    meals: [...(place.meals?.length ? place.meals : ['lunch', 'dinner'])],
    note: place.note ?? '',
    active: place.active !== false,
  }
  error.value = ''
  showForm.value = true
}

function save() {
  const value = form.value
  if (!value.name.trim()) {
    error.value = '请填写店铺、窗口或菜品名称'
    return
  }
  if (!value.meals.length) {
    error.value = '请至少选择一个适合时段'
    return
  }
  const data = {
    name: value.name.trim(),
    source: value.source.trim() || '未分类',
    area: value.area.trim(),
    cuisine: value.cuisine.trim(),
    price: value.price === '' ? '' : Math.max(0, Number(value.price) || 0),
    waitMinutes: Math.max(0, Number(value.waitMinutes) || 0),
    rating: Math.min(5, Math.max(1, Number(value.rating) || 3)),
    meals: [...value.meals],
    note: value.note.trim(),
    active: value.active,
  }
  if (editingId.value) {
    const target = places.value.find((item) => item.id === editingId.value)
    if (target) Object.assign(target, data)
  } else {
    places.value.push({ id: 'food' + Date.now(), createdAt: new Date().toISOString(), ...data })
  }
  showForm.value = false
}

function remove() {
  places.value = places.value.filter((item) => item.id !== editingId.value)
  skippedIds.value = skippedIds.value.filter((id) => id !== editingId.value)
  if (picked.value?.id === editingId.value) picked.value = null
  if (lastSelectedId.value === editingId.value) lastSelectedId.value = ''
  showForm.value = false
}

function placeSource(place) {
  return place?.source?.trim() || LEGACY_SOURCES[place?.type] || '未分类'
}

function sourceIcon(place) {
  const source = placeSource(place)
  if (/外卖|配送|跑腿/.test(source)) return '🛵'
  if (/食堂|餐厅|饭店|餐馆|窗口/.test(source)) return '🍚'
  if (/商场|广场|商城/.test(source)) return '🏬'
  if (/便利|超市|小卖部/.test(source)) return '🥪'
  if (/宿舍|自制|自己做|简餐/.test(source)) return '🍳'
  return '📍'
}

function toggleSource(source) {
  selectedSources.value = selectedSources.value.includes(source)
    ? selectedSources.value.filter((item) => item !== source)
    : [...selectedSources.value, source]
}

function toggleFormMeal(key) {
  const meals = new Set(form.value.meals)
  if (meals.has(key)) meals.delete(key)
  else meals.add(key)
  form.value = { ...form.value, meals: [...meals] }
}

const availableSources = computed(() =>
  [...new Set(places.value.map(placeSource))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
)
const selectedAvailableSources = computed(() =>
  selectedSources.value.filter((source) => availableSources.value.includes(source))
)

// 候选 = 满足筛选条件，且未被「暂时排除」。
// 设了预算时：未记录价格的候选无法比较，不参与随机（在计数处另行提示）。
const priceIsKnown = (place) => place.price !== '' && place.price !== null && place.price !== undefined

const candidates = computed(() =>
  places.value.filter((place) => {
    if (place.active === false) return false
    if (!(place.meals ?? []).includes(meal.value)) return false
    if (selectedAvailableSources.value.length && !selectedAvailableSources.value.includes(placeSource(place))) return false
    if (maxMinutes.value !== '' && Number(place.waitMinutes || 0) > Number(maxMinutes.value)) return false
    if (skippedIds.value.includes(place.id)) return false
    if (budget.value !== '') {
      if (!priceIsKnown(place)) return false
      if (Number(place.price) > Number(budget.value)) return false
    }
    return true
  })
)

// 因“未记录价格”而被预算挡在随机之外的候选数量
const unpricedHidden = computed(() => {
  if (budget.value === '') return 0
  return places.value.filter((place) => {
    if (priceIsKnown(place)) return false
    if (place.active === false) return false
    if (!(place.meals ?? []).includes(meal.value)) return false
    if (selectedAvailableSources.value.length && !selectedAvailableSources.value.includes(placeSource(place))) return false
    if (maxMinutes.value !== '' && Number(place.waitMinutes || 0) > Number(maxMinutes.value)) return false
    return true
  }).length
})

function resetFilters() {
  budget.value = ''
  maxMinutes.value = ''
  selectedSources.value = []
  skippedIds.value = []
}

// 放宽条件：只清掉最容易筛空的预算与等待限制（保留餐段与来源偏好）
function relaxConditions() {
  budget.value = ''
  maxMinutes.value = ''
  flashPlace.value = null
}

// 兜底动作：无视当前筛选，从全部在用候选里随机挑一个
function pickFromAll() {
  if (spinning.value) return
  const pool = places.value.filter((p) => p.active !== false && p.id !== lastSelectedId.value)
  const finalPool = pool.length ? pool : places.value.filter((p) => p.active !== false)
  if (!finalPool.length) return
  flashPlace.value = null
  commitPick(weightedChoice(finalPool))
}

// 我的候选库：卡片级「暂时不吃」（当天生效）与删除
const isSkipped = (id) => skippedIds.value.includes(id)

function toggleSkipCard(place) {
  if (isSkipped(place.id)) {
    skippedIds.value = skippedIds.value.filter((id) => id !== place.id)
    return
  }
  if (picked.value?.id === place.id) picked.value = null
  skippedIds.value = [...skippedIds.value, place.id]
}

function deletePlaceCard(place) {
  if (!window.confirm(`确定删除候选「${place.name}」吗？`)) return
  places.value = places.value.filter((item) => item.id !== place.id)
  skippedIds.value = skippedIds.value.filter((id) => id !== place.id)
  if (flashPlace.value?.id === place.id) flashPlace.value = null
  if (picked.value?.id === place.id) picked.value = null
  if (lastSelectedId.value === place.id) lastSelectedId.value = ''
}

function toggleSkipCurrent() {
  if (!picked.value) return
  const remaining = places.value.filter(
    (p) => p.active !== false && !skippedIds.value.includes(p.id) && candidates.value.some((c) => c.id === p.id) && p.id !== picked.value.id
  )
  if (!remaining.length) {
    picked.value = null
    return
  }
  skippedIds.value = [...skippedIds.value, picked.value.id]
  pickOne()
}
function daysSince(value) {
  if (!value) return 30
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000))
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function weightedChoice(list) {
  const weighted = list.map((item) => ({
    item,
    weight: Math.max(1, Number(item.rating || 3)) * (1 + Math.min(daysSince(item.lastAteAt), 14) / 7),
  }))
  let cursor = Math.random() * weighted.reduce((sum, entry) => sum + entry.weight, 0)
  return weighted.find(({ weight }) => (cursor -= weight) <= 0)?.item ?? weighted[0].item
}

function choosePool() {
  let pool = candidates.value
  // 避免连续重复：优先排除上一次选中的（候选 ≥2 时）
  if (pool.length >= 2 && lastSelectedId.value) {
    const filtered = pool.filter((item) => item.id !== lastSelectedId.value)
    if (filtered.length) pool = filtered
  }
  return pool
}

function commitPick(choice) {
  picked.value = choice
  flashPlace.value = null
  lastSelectedId.value = choice.id
}

function pickOne() {
  if (spinning.value || !candidates.value.length) return
  const choice = weightedChoice(choosePool())
  if (appearance.value.foodPickerMode === 'wheel') {
    spinning.value = true
    spinDegrees.value += 1440 + Math.round(Math.random() * 360)
    window.clearTimeout(spinTimer)
    spinTimer = window.setTimeout(() => {
      commitPick(choice)
      spinning.value = false
    }, prefersReducedMotion() ? 300 : 900)
    return
  }
  // 卡片模式：快速切换 → 减速 → 停止，总时长约 1.05s；reduced-motion 时直接出结果
  if (prefersReducedMotion()) {
    commitPick(choice)
    return
  }
  spinning.value = true
  flashPlace.value = choice
  const seq = ++shuffleSeq
  const delays = [80, 80, 100, 120, 150, 190]
  const flashTick = (i) => {
    if (seq !== shuffleSeq) return
    if (i >= delays.length) {
      commitPick(choice)
      spinning.value = false
      return
    }
    const others = candidates.value.filter((item) => item.id !== choice.id)
    if (others.length) {
      flashPlace.value = others[Math.floor(Math.random() * others.length)]
    }
    window.setTimeout(() => flashTick(i + 1), delays[i])
  }
  window.setTimeout(() => flashTick(0), delays[0])
}

onBeforeUnmount(() => {
  shuffleSeq++
  window.clearTimeout(spinTimer)
})

function markAte() {
  if (!picked.value) return
  const target = places.value.find((item) => item.id === picked.value.id)
  if (!target) return
  target.lastAteAt = new Date().toISOString()
  history.value.unshift({
    id: 'meal' + Date.now(),
    placeId: target.id,
    name: target.name,
    source: placeSource(target),
    date: todayStr(),
  })
  history.value = history.value.slice(0, 60)
}

function money(value) {
  return value === '' || value === null || value === undefined ? '价格未记' : `约 ¥${Number(value).toFixed(0)}`
}

// 推荐结果当前展示对象：抽签动画期间快速闪动，结束后落在正式结果上
const displayPlace = computed(() => (spinning.value && flashPlace.value ? flashPlace.value : picked.value))

// 推荐理由：全部基于真实数据动态生成
function recommendReasons(place) {
  if (!place) return []
  const reasons = []
  const rating = Number(place.rating) || 3
  const since = place.lastAteAt ? daysSince(place.lastAteAt) : null
  if (!place.lastAteAt) reasons.push('好久没去的新选择')
  else if (since >= 7) reasons.push(`已经 ${since} 天没吃了`)
  else if (since >= 3) reasons.push('有一阵子没吃了')
  if (rating >= 5) reasons.push('你给过满分评价')
  else if (rating === 4) reasons.push('评分不错')
  if (budget.value !== '' && place.price !== '' && Number(place.price) <= Number(budget.value)) reasons.push('符合你的预算')
  if (maxMinutes.value !== '' && Number(place.waitMinutes || 0) <= Number(maxMinutes.value)) reasons.push('等待时间较短')
  return reasons.slice(0, 2)
}

const resultState = computed(() => {
  if (picked.value || spinning.value) return 'result'
  if (!candidates.value.length) {
    return 'no-pool'
  }
  return 'idle'
})

// 左侧操作区状态提示
const pickStatusNote = computed(() => {
  if (spinning.value) return '正在帮你选…'
  if (!places.value.length) return '还没有候选，先在下方添加几个常吃的选择'
  if (!candidates.value.length) return '当前没有符合条件的候选'
  return ''
})

// 主按钮可用性：当前筛选池为空即禁用（库为空 / 条件筛不出），由次级动作兜底
const poolEmpty = computed(() => !places.value.length || !candidates.value.length)

const recent = computed(() => history.value.slice(0, 5))
const wheelItems = computed(() => candidates.value.slice(0, 10))
const wheelGradient = computed(() => {
  const count = Math.max(1, wheelItems.value.length)
  const colors = ['#456fe8', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#06b6d4', '#84cc16']
  return `conic-gradient(${Array.from({ length: count }, (_, index) => `${colors[index % colors.length]} ${index / count * 100}% ${(index + 1) / count * 100}%`).join(',')})`
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">今天吃什么</h1>
        <p class="page-desc">选择困难救急器，用偏好和等待时间帮你决定。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" @click="openAdd">＋ 添加候选</button>
      </div>
    </header>

    <section class="food-layout">
      <div class="filter-card card">
        <div class="picker-title-row">
          <span class="section-code">MEAL PICKER</span>
          <div class="picker-modes" role="group" aria-label="选择方式">
            <button
              :class="{ on: appearance.foodPickerMode === 'cards' }"
              :title="MODE_HINTS.cards"
              @click="appearance.foodPickerMode = 'cards'"
            >卡片</button>
            <button
              :class="{ on: appearance.foodPickerMode === 'wheel' }"
              :title="MODE_HINTS.wheel"
              @click="appearance.foodPickerMode = 'wheel'"
            >转盘</button>
          </div>
        </div>
        <h3>帮我把范围缩小一点</h3>

        <div class="filter-groups">
          <div class="filter-group">
            <span class="filter-label">餐型</span>
            <div class="chip-row">
              <button
                v-for="key in MEAL_KEYS"
                :key="key"
                class="chip"
                :class="{ on: meal === key }"
                @click="meal = key"
              >{{ MEALS[key] }}</button>
            </div>
          </div>

          <div class="filter-group">
            <span class="filter-label">距离 / 等待</span>
            <div class="chip-row">
              <button
                v-for="option in WAIT_OPTIONS"
                :key="option.label"
                class="chip"
                :class="{ on: String(maxMinutes) === option.value }"
                @click="maxMinutes = option.value"
              >{{ option.label }}</button>
            </div>
          </div>

          <div class="filter-group">
            <span class="filter-label">预算</span>
            <div class="chip-row">
              <button
                v-for="option in BUDGET_OPTIONS"
                :key="option.label"
                class="chip"
                :class="{ on: String(budget) === option.value }"
                @click="budget = option.value"
              >{{ option.label }}</button>
            </div>
          </div>

          <div v-if="availableSources.length" class="filter-group">
            <span class="filter-label">来源（可多选）</span>
            <div class="chip-row">
              <button
                v-for="source in availableSources"
                :key="source"
                class="chip"
                :class="{ on: selectedSources.includes(source) }"
                @click="toggleSource(source)"
              >{{ source }}</button>
            </div>
          </div>
        </div>

        <!-- 筛选区结束：与操作区之间强制留出 ≥24px -->
        <div class="pick-zone">
          <div v-if="appearance.foodPickerMode === 'wheel' && wheelItems.length" class="wheel-box">
            <span class="wheel-pointer">▼</span>
            <div class="food-wheel" :class="{ spinning }" :style="{ background: wheelGradient, transform: `rotate(${spinDegrees}deg)` }">
              <span v-for="(item, index) in wheelItems" :key="item.id" :style="{ transform: `rotate(${index * 360 / wheelItems.length}deg) translateY(-76px) rotate(${-index * 360 / wheelItems.length}deg)` }">{{ item.name.slice(0, 6) }}</span>
            </div>
          </div>

          <p v-if="pickStatusNote" class="zone-status" :class="{ warn: !places.length || !candidates.length }">{{ pickStatusNote }}</p>

          <button class="pick-button" :disabled="poolEmpty || spinning" @click="pickOne">
            {{ spinning ? '正在帮你选…' : '🎲 帮我选一个' }}
          </button>

          <!-- 条件筛不出时给出的两个次级动作 -->
          <div v-if="!candidates.length && places.some((pl) => pl.active !== false)" class="alt-actions">
            <button class="btn btn-ghost" :disabled="spinning" title="清空预算与等待限制，回到放宽后的范围" @click="relaxConditions">放宽条件</button>
            <button class="btn btn-ghost" :disabled="spinning" title="无视当前筛选，从全部在用候选里随机挑一个" @click="pickFromAll">随机挑一个（忽略条件）</button>
          </div>

          <p class="candidate-count">
            <template v-if="spinning">正在从 {{ candidates.length }} 个候选里挑选…</template>
            <template v-else>
              <span>符合条件 {{ candidates.length }} 个<template v-if="unpricedHidden"> · 另有 {{ unpricedHidden }} 个未记价格未参与</template></span>
              <button v-if="skippedIds.length" class="restore-link" @click="restoreSkipped">已暂时不吃 {{ skippedIds.length }} 个 · 恢复</button>
            </template>
          </p>
        </div>
      </div>

      <!-- 今天推荐：只负责展示当前推荐结果，不承担候选管理 -->
      <div class="result-zone card" :class="{ 'is-light': resultState !== 'result' }">
        <span class="reco-flag">今天推荐</span>

        <!-- 有推荐（含抽签动画中的闪动） -->
        <template v-if="displayPlace">
          <span class="result-icon" :class="{ rolling: spinning }">{{ sourceIcon(displayPlace) }}</span>
          <h2 :class="{ rolling: spinning }">{{ displayPlace.name }}</h2>
          <p class="reco-pricing">{{ money(displayPlace.price) }} · {{ displayPlace.waitMinutes ?? 0 }} 分钟</p>
          <p class="reco-tags">{{ [placeSource(displayPlace), displayPlace.area, displayPlace.cuisine, MEALS[meal]].filter(Boolean).join(' · ') }}</p>
          <div class="result-meta">
            <span class="stars">{{ '★'.repeat(displayPlace.rating ?? 3) }}{{ '☆'.repeat(5 - (displayPlace.rating ?? 3)) }}</span>
          </div>
          <ul v-if="!spinning && recommendReasons(picked).length" class="reason-list">
            <li v-for="reason in recommendReasons(picked)" :key="reason">✓ {{ reason }}</li>
          </ul>
          <small v-if="!spinning && picked?.note">{{ picked.note }}</small>
          <div class="result-actions">
            <button class="btn btn-primary" :disabled="spinning" @click="markAte">就吃这个</button>
            <button class="btn btn-ghost" :disabled="spinning" @click="pickOne">换一个</button>
          </div>
          <button
            v-if="!spinning && candidates.length > 1"
            class="skip-btn"
            title="今天不再推荐它（明天自动恢复）"
            @click="toggleSkipCurrent"
          >暂时不想吃这个</button>
        </template>

        <!-- 还没有选择：轻量引导 -->
        <template v-else-if="resultState === 'idle'">
          <span class="result-icon dim">🎲</span>
          <h2>还没有推荐</h2>
          <p class="light-note">设好左侧条件，点一下「🎲 帮我选一个」，我来替你决定。</p>
        </template>

        <!-- 条件筛不出 / 无候选：轻量空状态（完整空态只保留在下方候选库） -->
        <template v-else>
          <span class="result-icon dim">🍽️</span>
          <h2>{{ places.length ? '没有符合条件的选择' : '还没有可以推荐的食物' }}</h2>
          <p class="light-note">
            {{ places.length ? '放宽左侧条件，或从下方候选库补充几个平时会吃的选择。' : '先添加几个平时会吃的选择吧。' }}
          </p>
          <div v-if="places.length" class="alt-actions center">
            <button class="btn btn-ghost" @click="relaxConditions">放宽条件</button>
            <button class="btn btn-ghost" @click="pickFromAll">随机挑一个（忽略条件）</button>
          </div>
          <button v-else class="btn btn-ghost add-inline" @click="openAdd">＋ 添加候选</button>
        </template>
      </div>
    </section>

    <!-- 我的候选库：唯一的候选管理区域 -->
    <section class="library-section">
      <div class="section-head">
        <div>
          <h3>我的候选库</h3>
          <p class="section-sub">把平时经常吃的东西放进来，以后不知道吃什么时直接随机。</p>
        </div>
        <div class="section-side">
          <button class="btn btn-ghost btn-sm" @click="openAdd">＋ 添加候选</button>
          <span>{{ places.length }} 项</span>
        </div>
      </div>

      <EmptyState
        v-if="!places.length"
        class="card empty-box"
        icon="🍽️"
        title="还没有候选"
        description="添加几个你平时会吃的地方，之后就可以一键帮你决定。"
        primary-label="+ 添加第一个候选"
        @primary="openAdd"
      />

      <div v-else class="place-grid">
        <article
          v-for="place in places"
          :key="place.id"
          class="card place-card"
          :class="{ inactive: place.active === false, skipped: isSkipped(place.id) }"
          @click="openEdit(place)"
        >
          <div class="card-top">
            <div class="place-icon">{{ sourceIcon(place) }}</div>
            <div class="place-copy">
              <h3>{{ place.name }}<i v-if="isSkipped(place.id)" class="skip-tag">今天不吃</i></h3>
              <p class="place-tags">{{ [money(place.price), (place.waitMinutes ?? 0) + ' 分钟'].join(' · ') }}</p>
              <p class="place-cuisine">{{ [placeSource(place), place.area, place.cuisine].filter(Boolean).join(' · ') || '—' }}</p>
            </div>
          </div>
          <footer class="card-foot">
            <button class="foot-btn" title="编辑这条候选" @click.stop="openEdit(place)">编辑</button>
            <button
              class="foot-btn skip"
              :class="{ on: isSkipped(place.id) }"
              :title="isSkipped(place.id) ? '恢复参与今天的随机推荐' : '今天不再推荐它（明天自动恢复）'"
              @click.stop="toggleSkipCard(place)"
            >{{ isSkipped(place.id) ? '恢复推荐' : '暂时不吃' }}</button>
            <button class="foot-btn danger" title="删除这条候选" @click.stop="deletePlaceCard(place)">删除</button>
          </footer>
        </article>
      </div>

      <div v-if="recent.length" class="recent-strip">
        <span class="rs-label">最近吃过</span>
        <div class="rs-items">
          <span v-for="item in recent" :key="item.id" class="rs-pill">{{ item.name }}<small>{{ item.date.slice(5) }}</small></span>
        </div>
      </div>
    </section>

    <Modal :open="showForm" :title="editingId ? '编辑吃饭选择' : '添加吃饭选择'" @close="showForm = false">
      <div class="form">
        <label>店铺、窗口或菜品名称 *</label>
        <input v-model="form.name" placeholder="例如：二食堂麻辣烫、某某外卖店" />
        <div class="form-row">
          <div><label>分类（可自由填写）</label><input v-model="form.source" list="food-source-options" placeholder="例如：食堂、外卖、商场" /><datalist id="food-source-options"><option v-for="source in SOURCE_SUGGESTIONS" :key="source" :value="source"></option></datalist></div>
          <div><label>地点</label><input v-model="form.area" placeholder="选填，例如：二食堂、万达三楼" /></div>
        </div>
        <div class="form-row">
          <div><label>预计价格</label><input v-model="form.price" type="number" min="0" placeholder="人均 ¥" /></div>
          <div><label>{{ /外卖|配送|跑腿/.test(form.source) ? '预计送达时间' : '预计等待时间' }}</label><input v-model="form.waitMinutes" type="number" min="0" placeholder="分钟" /></div>
        </div>
        <div class="form-row">
          <div><label>标签 / 口味</label><input v-model="form.cuisine" list="food-cuisine-options" placeholder="例如：面食、辣、外卖" /><datalist id="food-cuisine-options"><option v-for="tag in CUISINE_SUGGESTIONS" :key="tag" :value="tag"></option></datalist></div>
          <div><label>个人评分</label><select v-model="form.rating"><option v-for="n in 5" :key="n" :value="n">{{ n }} 星</option></select></div>
        </div>
        <label>适合时段</label>
        <div class="chip-row meal-chips">
          <button
            v-for="(label, key) in MEALS"
            :key="key"
            type="button"
            class="chip"
            :class="{ on: form.meals.includes(key) }"
            @click="toggleFormMeal(key)"
          >{{ label }}</button>
        </div>
        <label>备注</label>
        <textarea v-model="form.note" rows="2" placeholder="选填，例如：高峰期很慢、少辣、满减后更划算"></textarea>
        <label class="active-option"><input v-model="form.active" type="checkbox" /> 参与随机选择</label>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions"><button v-if="editingId" class="btn btn-danger" @click="remove">删除</button><button class="btn btn-primary" @click="save">保存</button></div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--space-md, 16px); }

/* ============ 布局骨架：左 40% 筛选 / 右 60% 推荐 ============ */
.food-layout {
  display: grid;
  grid-template-columns: minmax(300px, 40fr) minmax(0, 60fr);
  gap: var(--space-md, 16px);
  align-items: stretch;
}

/* ============ 左侧：三段式（标题 / 快速筛选 / 独立操作区） ============ */
.filter-card { display: flex; flex-direction: column; align-items: stretch; padding: 20px; }
.picker-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-code { color: var(--primary); font-size: 10px; font-weight: 900; letter-spacing: .14em; }
.picker-modes { display: inline-flex; gap: 3px; padding: 3px; border-radius: 8px; background: #eef1f7; }
.picker-modes button { padding: 4px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--ink-soft); font-size: 11px; font-weight: 600; transition: background .14s, color .14s; cursor: pointer; }
.picker-modes button:hover { color: var(--text); background: rgba(255,255,255,.85); }
.picker-modes button.on { background: #fff; color: var(--primary); font-weight: 700; box-shadow: 0 1px 3px rgba(22,34,64,.14); }
.filter-card h3 { margin-top: 6px; margin-bottom: 2px; font-size: 17px; letter-spacing: -0.01em; }

/* 快速筛选组：统一组间距与标签 */
.filter-groups { display: flex; flex-direction: column; gap: 16px; margin-top: 14px; }
.filter-label { color: var(--ink-faint); font-size: 11px; font-weight: 800; letter-spacing: .04em; }
.filter-group { display: flex; flex-direction: column; gap: 8px; }

/* 统一 chip 规格：同高、同圆角、同 padding，不忽大忽小 */
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  color: var(--ink-soft);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: #fff;
  transition: border-color .14s, background .14s, color .14s, box-shadow .14s;
}
.chip:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.chip.on {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.meal-chips .chip { height: 32px; padding: 0 13px; font-size: 12.5px; background: #f4f6fa; border-color: transparent; }
.meal-chips .chip:hover { background: #fff; }

.wheel-box { position: relative; display: grid; place-items: center; width: 200px; height: 200px; margin: 18px auto 0; }
.wheel-pointer { position: absolute; z-index: 3; top: -4px; color: #172033; font-size: 22px; }
.food-wheel { position: relative; width: 184px; height: 184px; border: 7px solid #fff; border-radius: 50%; box-shadow: 0 8px 22px rgba(22,32,51,.2); transition: transform .9s cubic-bezier(.16,.84,.32,1); }
.food-wheel::after { content: ''; position: absolute; inset: 72px; border: 5px solid #fff; border-radius: 50%; background: #172033; }
.food-wheel > span { position: absolute; z-index: 2; top: 82px; left: 50%; width: 66px; margin-left: -33px; color: #fff; font-size: 9px; font-weight: 800; text-align: center; text-shadow: 0 1px 3px rgba(0,0,0,.5); }

/* ---- 独立操作区：与筛选区之间 ≥24px ---- */
.pick-zone {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px dashed var(--border);
}
.zone-status { color: var(--ink-soft); font-size: 12px; text-align: center; }
.zone-status.warn { color: #b86b16; }
.pick-button {
  width: 100%;
  height: 46px;
  margin-top: 12px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(120deg, var(--brand-grad-a), var(--brand-grad-b));
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: .02em;
  box-shadow: 0 6px 18px rgba(69, 111, 232, 0.28);
  transition: transform .15s, box-shadow .15s, filter .15s;
}
.pick-button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
.pick-button:active:not(:disabled) { transform: scale(0.98); }
.pick-button:disabled { opacity: .45; cursor: not-allowed; }
.alt-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.alt-actions.center { justify-content: center; margin-top: 14px; }
.alt-actions .btn-ghost { flex: 1; }
.candidate-count { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 12px 0 0; color: var(--ink-faint); font-size: 11.5px; }
.restore-link { padding: 0; color: var(--primary); font-size: 11px; font-weight: 700; border: none; background: none; cursor: pointer; }
.restore-link:hover { text-decoration: underline; }

/* ============ 右侧：今天推荐 ============ */
.result-zone {
  position: relative;
  display: flex;
  min-height: 380px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 30px 26px 26px;
  text-align: center;
  background:
    radial-gradient(circle at 50% 0%, rgba(69, 111, 232, 0.06), transparent 60%),
    #fff;
  border-color: var(--border-strong);
}
.result-zone.is-light { min-height: 300px; }
.reco-flag {
  position: absolute;
  top: 16px;
  left: 18px;
  padding: 4px 10px;
  color: var(--primary);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: .08em;
  border-radius: 999px;
  background: var(--primary-soft);
}
.result-icon {
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  margin: 10px 0 8px;
  font-size: 44px;
  border-radius: 26px;
  background: linear-gradient(140deg, var(--primary-soft), #fff);
  box-shadow: inset 0 0 0 1px rgba(69,111,232,.18), 0 10px 24px rgba(45,64,110,.08);
}
.result-icon.dim { filter: grayscale(.25); opacity: .9; }
.result-icon.rolling { animation: result-pulse .5s ease-in-out infinite alternate; }
@keyframes result-pulse { to { transform: scale(1.05); } }
.result-zone h2 {
  overflow: hidden;
  max-width: 100%;
  margin: 0;
  font-size: clamp(24px, 3vw, 32px);
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
h2.rolling { filter: blur(0.4px); opacity: .82; }
.reco-pricing { margin-top: 10px; color: var(--text); font-size: 15px; font-weight: 750; font-variant-numeric: tabular-nums; }
.reco-tags { margin-top: 5px; color: var(--ink-faint); font-size: 12px; }
.result-meta { display: flex; gap: 7px; margin-top: 10px; }
.result-meta .stars { padding: 5px 10px; color: #f59e0b; font-size: 12px; letter-spacing: .1em; border: 1px solid #f3e3bd; border-radius: 999px; background: #fff8ea; }
.reason-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 5px 16px; margin: 12px 0 0; padding: 0; list-style: none; }
.reason-list li { color: var(--ink-soft); font-size: 12px; }
.result-zone > small { margin-top: 10px; max-width: 380px; color: var(--ink-faint); font-size: 11.5px; line-height: 1.55; }
.light-note { max-width: 340px; margin-top: 6px; color: var(--ink-faint); font-size: 12.5px; line-height: 1.6; }
.result-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 18px; }
.result-actions .btn-primary { padding-inline: 24px; }
.result-actions .btn:active:not(:disabled) { transform: scale(0.98); }
.skip-btn { margin-top: 4px; padding: 0 4px; color: var(--ink-faint); font-size: 12px; border: none; background: none; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; transition: color .15s; }
.skip-btn:hover:not(:disabled) { color: var(--danger); }
.add-inline { margin-top: 14px; }

/* ============ 下方：我的候选库 ============ */
.library-section { display: flex; flex-direction: column; gap: 12px; }
.section-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; }
.section-head h3 { font-size: 16px; }
.section-sub { margin-top: 3px; color: var(--ink-faint); font-size: 11.5px; }
.section-side { display: flex; align-items: center; gap: 10px; }
.section-side span { color: var(--ink-faint); font-size: 11.5px; }
.btn-sm { padding: 7px 13px; font-size: 12.5px; }
.place-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); gap: 12px; }
.place-card { display: flex; flex-direction: column; gap: 10px; padding: 13px 14px 10px; cursor: pointer; transition: transform .15s, border-color .15s, box-shadow .15s; }
.place-card:hover { transform: translateY(-2px); border-color: var(--border-strong); box-shadow: var(--shadow-md); }
.place-card:active { transform: scale(0.99); }
.place-card.inactive { opacity: .5; }
.place-card.skipped { background: #fafbfd; }
.place-card.skipped .place-copy h3 { color: var(--ink-faint); }
.card-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
.place-icon { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 40px; border-radius: 12px; background: var(--primary-soft); font-size: 19px; }
.place-copy { flex: 1; min-width: 0; text-align: left; }
.place-copy h3 { margin: 0; overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.skip-tag { margin-left: 7px; padding: 2px 6px; color: #b86b16; font-size: 9.5px; font-style: normal; font-weight: 700; border-radius: 5px; background: #fff5df; vertical-align: 1px; }
.place-tags { margin-top: 3px; color: var(--text); font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }
.place-cuisine { margin-top: 2px; overflow: hidden; color: var(--ink-faint); font-size: 11px; white-space: nowrap; text-overflow: ellipsis; }
.card-foot { display: flex; gap: 4px; padding-top: 9px; border-top: 1px solid var(--border); }
.foot-btn { flex: 1; padding: 7px 6px; color: var(--ink-soft); font-size: 12px; font-weight: 600; border: none; border-radius: 8px; background: transparent; cursor: pointer; transition: background .14s, color .14s; }
.foot-btn:hover { color: var(--primary); background: var(--primary-soft); }
.foot-btn.skip.on { color: #b86b16; background: #fff5df; }
.foot-btn.danger:hover { color: var(--danger); background: #feecec; }

/* 最近吃过：收成一条横向胶囊带 */
.recent-strip { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 12px; background: #fff; }
.rs-label { flex: 0 0 auto; color: var(--ink-faint); font-size: 11px; font-weight: 800; letter-spacing: .04em; }
.rs-items { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.rs-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; color: var(--ink-soft); font-size: 11.5px; border-radius: 999px; background: var(--bg-tint); }
.rs-pill small { color: var(--ink-faint); font-size: 10px; font-variant-numeric: tabular-nums; }
.empty-box { width: 100%; margin: 0; }

/* ============ 弹窗表单 ============ */
.form { display: flex; flex-direction: column; gap: 9px; }
.form label { display: block; margin-top: 6px; color: var(--ink-soft); font-size: 12.5px; }
.form input, .form select, .form textarea { width: 100%; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.form-row > div { display: flex; flex-direction: column; gap: 6px; }
.active-option { display: flex !important; flex-direction: row; align-items: center; gap: 5px !important; color: var(--text) !important; }
.error { color: var(--danger); font-size: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.actions .btn-danger { margin-right: auto; }

/* ============ 平板与手机（< 900 起变单列，< 768 起手机化，< 480 再收紧） ============ */
@media (max-width: 900px) {
  .food-layout { grid-template-columns: 1fr; }
  .result-zone { min-height: 280px; }
}

@media (max-width: 768px) {
  .page { gap: 14px; }
  .filter-card { padding: 16px; }
  .filter-groups { gap: 14px; margin-top: 12px; }

  /* chip：40px 点击面积、间距 ≥8px、允许换行 */
  .chip { height: 40px; padding: 0 15px; font-size: 13px; }
  .chip-row { gap: 8px; }
  .meal-chips .chip { height: 38px; padding: 0 14px; }

  /* 操作区：与预算等组之间保持 ≥24px，主按钮全宽 48px */
  .pick-zone { margin-top: 24px; padding-top: 16px; }
  .pick-button { height: 48px; margin-top: 12px; font-size: 15.5px; }

  /* 推荐卡：纵向堆叠，按钮全宽保证点击面积 */
  .result-zone { padding: 24px 18px 22px; }
  .result-zone h2 { white-space: normal; }
  .result-actions { flex-direction: column; width: 100%; }
  .result-actions .btn { width: 100%; height: 46px; display: inline-flex; align-items: center; justify-content: center; }
  .skip-btn { padding: 8px; }

  /* 候选卡与操作按钮 */
  .section-head { align-items: flex-start; flex-direction: column; gap: 8px; }
  .section-side { width: 100%; justify-content: space-between; }
  .place-grid { grid-template-columns: 1fr; }
  .card-foot .foot-btn { padding: 9px 6px; }
  .recent-strip { flex-direction: column; align-items: flex-start; gap: 8px; }
}

@media (max-width: 600px) {
  .page-head { align-items: flex-start; flex-direction: column; }
  .page-actions { width: 100%; }
  .page-actions .btn { white-space: nowrap; }
}

@media (max-width: 480px) {
  .filter-card { padding: 14px; }
  .chip { padding: 0 13px; font-size: 12.5px; }
  .pick-button { font-size: 15px; }
  .result-zone { padding: 20px 14px 18px; }
  .result-icon { width: 72px; height: 72px; font-size: 38px; }
  .place-card { padding: 12px 12px 8px; }
  .alt-actions { flex-direction: column; }
  .alt-actions .btn-ghost { width: 100%; }
}
</style>
