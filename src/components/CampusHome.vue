<script setup>
defineProps({
  places: { type: Array, default: () => [] },
  myPlaceCount: { type: Number, default: 0 },
  searchQuery: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  loaded: { type: Boolean, default: false },
  placeTypeLabel: { type: Function, required: true },
  ratingSummary: { type: Function, required: true },
})
const emit = defineEmits(['update:searchQuery', 'search', 'mine', 'add', 'visit', 'retry'])
</script>

<template>
  <section class="campus-home">
    <div class="campus-home-intro">
      <div><span class="campus-home-eyebrow">校园生活</span><h2>先找到你要去的地方</h2><p>查找同校地点和服务，也可以把你熟悉的地方补充进校园目录。</p></div>
      <button class="btn btn-primary" type="button" @click="emit('add')">添加地点</button>
    </div>
    <form class="place-search campus-home-search" role="search" aria-label="搜索校园地点" @submit.prevent="emit('search', 'all')">
      <span aria-hidden="true">⌕</span><label class="sr-only" for="campus-home-search">搜索校园地点</label><input id="campus-home-search" :value="searchQuery" type="search" placeholder="搜教学楼、食堂、服务、校区" @input="emit('update:searchQuery', $event.target.value)" /><button class="btn btn-primary" type="submit">搜索</button>
    </form>
    <div class="campus-home-shortcuts" aria-label="地点快捷入口">
      <button type="button" @click="emit('search', 'all')"><span aria-hidden="true">⌕</span><b>找地点</b><small>浏览同校目录</small></button>
      <button type="button" @click="emit('search', 'study')"><span aria-hidden="true">▤</span><b>学习空间</b><small>图书馆与自习室</small></button>
      <button type="button" @click="emit('search', 'food')"><span aria-hidden="true">◉</span><b>吃点什么</b><small>食堂与餐饮</small></button>
      <button type="button" @click="emit('mine')"><span aria-hidden="true">♡</span><b>我的地点</b><small>{{ myPlaceCount }} 条本机记录</small></button>
    </div>
    <nav class="campus-home-services" aria-label="校园生活服务">
      <RouterLink to="/campus/search">全站搜索</RouterLink><RouterLink to="/campus/courses">老师与课程</RouterLink><RouterLink to="/campus/market">二手集市</RouterLink><RouterLink to="/campus/help">校园互助</RouterLink><RouterLink to="/campus/shuttle">校车出行</RouterLink><RouterLink to="/campus/lost-found">失物招领</RouterLink><RouterLink to="/campus/events">活动社团</RouterLink><RouterLink to="/campus/guides">校园指南</RouterLink><RouterLink to="/campus/mine">我的投稿</RouterLink><RouterLink to="/campus/publish">统一发布</RouterLink>
    </nav>
    <section class="campus-home-recent" aria-labelledby="campus-home-recent-title">
      <div class="place-results-heading"><div><h3 id="campus-home-recent-title">最近更新的地点</h3><p>按资料更新时间展示；评分数量较少时仅供参考。</p></div><button class="btn btn-ghost" type="button" @click="emit('search', 'all')">查看全部</button></div>
      <div v-if="loading && !loaded" class="place-loading" role="status">正在读取校内地点…</div>
      <div v-else-if="places.length" class="campus-home-place-list">
        <article v-for="place in places" :key="place.id" class="campus-home-place">
          <div><span class="type-tag">{{ placeTypeLabel(place) }}</span><h4>{{ place.name }}</h4><p>{{ [place.campus, place.area].filter(Boolean).join(' · ') || '位置待补充' }}</p></div>
          <div><b>{{ ratingSummary(place) }}</b><button class="btn btn-ghost" type="button" @click="emit('visit', place)">记一次到访</button></div>
        </article>
      </div>
      <div v-else-if="!loading && loaded" class="place-empty"><h3>校内目录还没有地点</h3><p>添加一条真实地点资料，经审核后就能帮助同校同学找到它。</p><button class="btn btn-primary" type="button" @click="emit('add')">添加第一条地点</button></div>
      <div v-else class="place-empty"><h3>校内地点暂时无法读取</h3><p>网络或学校资料暂不可用；重试后仍无法读取时，请检查账号学校信息。</p><button class="btn btn-ghost" type="button" :disabled="loading" @click="emit('retry')">重试</button></div>
    </section>
  </section>
</template>
