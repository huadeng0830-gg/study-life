<script setup>
import { computed, ref } from 'vue'
import Modal from '../components/Modal.vue'
import { todayStr, useStoredRef } from '../composables/store.js'
import { appearance } from '../composables/appearance.js'

const places = useStoredRef('sl_food_places', [])
const history = useStoredRef('sl_food_history', [])
const showForm = ref(false)
const editingId = ref(null)
const error = ref('')
const picked = ref(null)
const meal = ref(currentMeal())
const budget = ref('')
const maxMinutes = ref('')
const selectedSources = ref([])
const form = ref(emptyForm())
const spinDegrees = ref(0)
const spinning = ref(false)

const LEGACY_SOURCES = {
  canteen: '学校食堂',
  takeout: '外卖',
  mall: '商场',
  restaurant: '校外餐厅',
  convenience: '便利店',
  homemade: '宿舍简餐',
}

const SOURCE_SUGGESTIONS = ['学校食堂', '外卖', '商场', '校外餐厅', '便利店', '宿舍简餐']

const MEALS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  late: '夜宵',
}

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
  if (picked.value?.id === editingId.value) picked.value = null
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

const availableSources = computed(() =>
  [...new Set(places.value.map(placeSource))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
)
const selectedAvailableSources = computed(() =>
  selectedSources.value.filter((source) => availableSources.value.includes(source))
)

const candidates = computed(() =>
  places.value.filter((place) => {
    if (place.active === false) return false
    if (!(place.meals ?? []).includes(meal.value)) return false
    if (selectedAvailableSources.value.length && !selectedAvailableSources.value.includes(placeSource(place))) return false
    if (budget.value !== '' && Number(place.price || 0) > Number(budget.value)) return false
    if (maxMinutes.value !== '' && Number(place.waitMinutes || 0) > Number(maxMinutes.value)) return false
    return true
  })
)

function daysSince(value) {
  if (!value) return 30
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000))
}

function pickOne() {
  const list = candidates.value.filter((item) => candidates.value.length === 1 || item.id !== picked.value?.id)
  if (!list.length) {
    picked.value = null
    return
  }
  const weighted = list.map((item) => ({
    item,
    weight: Math.max(1, Number(item.rating || 3)) * (1 + Math.min(daysSince(item.lastAteAt), 14) / 7),
  }))
  let cursor = Math.random() * weighted.reduce((sum, item) => sum + item.weight, 0)
  const choice = weighted.find(({ weight }) => (cursor -= weight) <= 0)?.item ?? weighted[0].item
  if (appearance.value.foodPickerMode === 'wheel') {
    spinning.value = true
    spinDegrees.value += 1440 + Math.round(Math.random() * 360)
    window.setTimeout(() => {
      picked.value = choice
      spinning.value = false
    }, 900)
  } else {
    picked.value = choice
  }
}

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
    <div class="head">
      <div>
        <h2>🍽 今天吃什么</h2>
        <p>来源可以自由填写，再按预算与等待时间帮你做决定</p>
      </div>
      <button class="btn btn-primary" @click="openAdd">＋ 添加选择</button>
    </div>

    <section class="chooser">
      <div class="chooser-copy">
        <div class="picker-title-row"><span class="section-code">MEAL PICKER · 本机随机选择</span><div class="picker-modes"><button :class="{ on: appearance.foodPickerMode === 'cards' }" @click="appearance.foodPickerMode = 'cards'">卡片</button><button :class="{ on: appearance.foodPickerMode === 'wheel' }" @click="appearance.foodPickerMode = 'wheel'">转盘</button></div></div>
        <h3>先把范围缩小一点</h3>
        <div class="filters">
          <label>时段
            <select v-model="meal">
              <option v-for="(label, key) in MEALS" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label>预算不超过
            <input v-model="budget" type="number" min="0" placeholder="不限" />
          </label>
          <label>等待不超过
            <span class="unit-input"><input v-model="maxMinutes" type="number" min="0" placeholder="不限" /><b>分钟</b></span>
          </label>
        </div>
        <div v-if="availableSources.length" class="type-pills" aria-label="来源筛选">
          <button
            v-for="source in availableSources"
            :key="source"
            :class="{ on: selectedSources.includes(source) }"
            @click="toggleSource(source)"
          >{{ source }}</button>
        </div>
        <div v-if="appearance.foodPickerMode === 'wheel' && wheelItems.length" class="wheel-box">
          <span class="wheel-pointer">▼</span>
          <div class="food-wheel" :class="{ spinning }" :style="{ background: wheelGradient, transform: `rotate(${spinDegrees}deg)` }">
            <span v-for="(item, index) in wheelItems" :key="item.id" :style="{ transform: `rotate(${index * 360 / wheelItems.length}deg) translateY(-76px) rotate(${-index * 360 / wheelItems.length}deg)` }">{{ item.name.slice(0, 6) }}</span>
          </div>
        </div>
        <button class="pick-button" :disabled="!candidates.length || spinning" @click="pickOne">
          {{ spinning ? '正在选择…' : picked ? '换一个' : appearance.foodPickerMode === 'wheel' ? '转动转盘' : '帮我选一个' }}
        </button>
        <p class="candidate-count">当前有 {{ candidates.length }} 个符合条件的选择</p>
      </div>

      <div class="result-card" :class="{ empty: !picked }">
        <template v-if="picked">
          <span class="result-type">{{ sourceIcon(picked) }} {{ placeSource(picked) }}</span>
          <h3>{{ picked.name }}</h3>
          <p>{{ [picked.area, picked.cuisine].filter(Boolean).join(' · ') || '还没有地点或口味备注' }}</p>
          <div class="result-meta">
            <span>{{ money(picked.price) }}</span>
            <span>约等 {{ picked.waitMinutes ?? 0 }} 分钟</span>
            <span>{{ '★'.repeat(picked.rating ?? 3) }}{{ '☆'.repeat(5 - (picked.rating ?? 3)) }}</span>
          </div>
          <small v-if="picked.note">{{ picked.note }}</small>
          <button class="btn btn-primary" @click="markAte">就吃这个</button>
        </template>
        <template v-else>
          <span class="empty-icon">?</span>
          <h3>{{ candidates.length ? '今天交给一点随机性' : '没有符合条件的选择' }}</h3>
          <p>{{ candidates.length ? '设置范围后点击“帮我选一个”' : '放宽预算、等待时间，或添加新的店铺和菜品' }}</p>
        </template>
      </div>
    </section>

    <div v-if="places.length" class="content-grid">
      <section class="place-section">
        <div class="section-head"><h3>我的选择库</h3><span>{{ places.length }} 项</span></div>
        <div class="place-grid">
          <article v-for="place in places" :key="place.id" class="card place-card" :class="{ inactive: place.active === false }" @click="openEdit(place)">
            <div class="place-icon">{{ sourceIcon(place) }}</div>
            <div class="place-copy">
              <span>{{ placeSource(place) }}<template v-if="place.area"> · {{ place.area }}</template></span>
              <h3>{{ place.name }}</h3>
              <p>{{ place.cuisine || place.note || '暂无补充信息' }}</p>
            </div>
            <div class="place-side"><b>{{ money(place.price) }}</b><span>{{ place.waitMinutes ?? 0 }} 分钟</span></div>
          </article>
        </div>
      </section>
      <aside class="recent card">
        <h3>最近吃过</h3>
        <p v-if="!recent.length" class="muted">选定一次后会在这里留下记录。</p>
        <div v-for="item in recent" :key="item.id" class="recent-row">
          <span>{{ sourceIcon(item) }}</span><b>{{ item.name }}</b><small>{{ item.date.slice(5) }}</small>
        </div>
      </aside>
    </div>

    <div v-else class="card empty-state">
      <span>🥢</span><h3>选择库还是空的</h3>
      <p>先添加几个常吃的地方，来源名称由你自己决定。</p>
      <button class="btn btn-primary" @click="openAdd">添加第一个选择</button>
    </div>

    <Modal :open="showForm" :title="editingId ? '编辑吃饭选择' : '添加吃饭选择'" @close="showForm = false">
      <div class="form">
        <label>店铺、窗口或菜品名称 *</label>
        <input v-model="form.name" placeholder="例如：二食堂麻辣烫、某某外卖店" />
        <div class="form-row">
          <div><label>来源（可自由填写）</label><input v-model="form.source" list="food-source-options" placeholder="例如：校内北门、外卖平台" /><datalist id="food-source-options"><option v-for="source in SOURCE_SUGGESTIONS" :key="source" :value="source"></option></datalist></div>
          <div><label>地点</label><input v-model="form.area" placeholder="例如：二食堂、万达三楼" /></div>
        </div>
        <div class="form-row">
          <div><label>口味或品类</label><input v-model="form.cuisine" placeholder="例如：米饭、川菜" /></div>
          <div><label>人均价格</label><input v-model="form.price" type="number" min="0" /></div>
        </div>
        <div class="form-row">
          <div><label>{{ /外卖|配送|跑腿/.test(form.source) ? '预计送达时间' : '预计等待时间' }}</label><input v-model="form.waitMinutes" type="number" min="0" /></div>
          <div><label>个人评分</label><select v-model="form.rating"><option v-for="n in 5" :key="n" :value="n">{{ n }} 星</option></select></div>
        </div>
        <label>适合时段</label>
        <div class="meal-options"><label v-for="(label, key) in MEALS" :key="key"><input v-model="form.meals" type="checkbox" :value="key" /> {{ label }}</label></div>
        <label>备注</label>
        <textarea v-model="form.note" rows="3" placeholder="例如：高峰期很慢、少辣、满减后更划算"></textarea>
        <label class="active-option"><input v-model="form.active" type="checkbox" /> 参与随机选择</label>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions"><button v-if="editingId" class="btn btn-danger" @click="remove">删除</button><button class="btn btn-primary" @click="save">保存</button></div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.page{display:flex;flex-direction:column;gap:18px}.head{display:flex;align-items:center;justify-content:space-between;gap:16px}.head h2{font-size:22px}.head p{margin-top:5px;color:var(--muted);font-size:13px}.chooser{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:18px;padding:24px;border:1px solid #dfe5f4;border-radius:20px;background:linear-gradient(135deg,#fff 0%,var(--primary-soft) 100%);box-shadow:var(--shadow-md)}.chooser-copy{display:flex;flex-direction:column;align-items:flex-start}.section-code{color:var(--primary);font-size:10px;font-weight:900;letter-spacing:.14em}.chooser h3{margin-top:6px;font-size:20px}.filters{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%;margin-top:18px}.filters label,.form label{display:flex;flex-direction:column;gap:6px;color:var(--muted);font-size:12px}.filters input,.filters select{width:100%;background:#fff}.unit-input{position:relative}.unit-input input{padding-right:46px}.unit-input b{position:absolute;right:10px;top:9px;color:var(--muted);font-size:11px}.type-pills{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.type-pills button{padding:7px 10px;border:1px solid var(--border);border-radius:999px;background:#fff;color:var(--muted);font-size:12px}.type-pills button.on{border-color:var(--primary);background:var(--primary);color:#fff}.pick-button{margin-top:18px;padding:12px 22px;border:none;border-radius:10px;background:#172033;color:#fff;font-weight:800}.pick-button:disabled{opacity:.4}.candidate-count{margin-top:8px;color:var(--muted);font-size:11px}.result-card{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-height:270px;padding:24px;border:1px solid rgba(69,111,232,.18);border-radius:16px;background:#fff;box-shadow:var(--shadow-sm)}.result-card.empty{align-items:center;text-align:center}.result-type{color:var(--primary);font-size:12px;font-weight:800}.result-card h3{font-size:26px}.result-card p{margin-top:7px;color:var(--muted);line-height:1.6}.result-meta{display:flex;flex-wrap:wrap;gap:6px;margin:15px 0}.result-meta span{padding:5px 8px;border-radius:7px;background:var(--bg);font-size:11px}.result-card small{margin-bottom:14px;color:var(--muted);line-height:1.5}.empty-icon{display:grid;place-items:center;width:56px;height:56px;border-radius:18px;background:var(--primary-soft);color:var(--primary);font-size:28px;font-weight:900}.content-grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px}.section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.section-head h3,.recent h3{font-size:15px}.section-head span{color:var(--muted);font-size:12px}.place-grid{display:grid;gap:9px}.place-card{display:flex;align-items:center;gap:12px;padding:15px;cursor:pointer}.place-card.inactive{opacity:.5}.place-icon{display:grid;place-items:center;width:42px;height:42px;flex:0 0 42px;border-radius:12px;background:var(--primary-soft);font-size:20px}.place-copy{flex:1;min-width:0}.place-copy span{color:var(--primary);font-size:10px;font-weight:800}.place-copy h3{margin-top:3px;font-size:15px}.place-copy p{margin-top:3px;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.place-side{display:flex;flex-direction:column;align-items:flex-end;gap:3px}.place-side b{font-size:12px}.place-side span{color:var(--muted);font-size:10px}.recent{align-self:start;padding:17px}.muted{margin-top:12px;color:var(--muted);font-size:12px;line-height:1.5}.recent-row{display:grid;grid-template-columns:22px 1fr auto;gap:6px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);font-size:12px}.recent-row:last-child{border-bottom:none}.recent-row small{color:var(--muted)}.empty-state{padding:52px;text-align:center}.empty-state>span{font-size:34px}.empty-state h3{margin-top:8px}.empty-state p{margin:7px 0 16px;color:var(--muted);font-size:13px}.form{display:flex;flex-direction:column;gap:9px}.form input,.form select,.form textarea{width:100%}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.form-row>div{display:flex;flex-direction:column;gap:6px}.meal-options{display:flex;flex-wrap:wrap;gap:12px;padding:9px 0}.meal-options label,.active-option{display:flex;align-items:center;gap:5px!important;color:var(--text)!important}.error{color:var(--danger);font-size:12px}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.actions .btn-danger{margin-right:auto}
.picker-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%}.picker-modes{display:flex;padding:3px;border-radius:8px;background:#fff}.picker-modes button{padding:5px 9px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:10px}.picker-modes button.on{background:var(--primary);color:#fff}.wheel-box{position:relative;display:grid;place-items:center;align-self:center;width:210px;height:210px;margin-top:16px}.wheel-pointer{position:absolute;z-index:3;top:-4px;color:#172033;font-size:22px}.food-wheel{position:relative;width:190px;height:190px;border:7px solid #fff;border-radius:50%;box-shadow:0 8px 22px rgba(22,32,51,.2);transition:transform .9s cubic-bezier(.16,.84,.32,1)}.food-wheel::after{content:'';position:absolute;inset:75px;border:5px solid #fff;border-radius:50%;background:#172033}.food-wheel>span{position:absolute;z-index:2;top:84px;left:50%;width:66px;margin-left:-33px;color:#fff;font-size:9px;font-weight:800;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.5)}
@media(max-width:850px){.chooser,.content-grid{grid-template-columns:1fr}.result-card{min-height:220px}.recent{width:100%}}@media(max-width:600px){.head{align-items:flex-start;flex-direction:column}.head .btn{width:100%}.chooser{padding:16px}.filters{grid-template-columns:1fr}.form-row{grid-template-columns:1fr}.result-card{padding:18px}.place-card{align-items:flex-start;flex-wrap:wrap}.place-side{width:100%;align-items:flex-start;margin-left:54px}}
</style>
