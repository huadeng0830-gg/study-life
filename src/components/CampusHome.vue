<script setup>
import { BookOpen, ChevronRight, MapPin, Search, Utensils, Heart } from '@lucide/vue'
import { campusPlaceServices } from './campus/navigation.js'
import { Button } from './ui/button'
const placeServices = campusPlaceServices()
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
      <div><h2>在校园里，找到所需。</h2><p>从一间自习室、一趟校车，到同学间的一个小忙。</p></div>
      <Button variant="outline" type="button" @click="emit('add')"><MapPin data-icon="inline-start" />添加地点</Button>
    </div>
    <section class="campus-home-community" aria-label="参与校园共建">
      <div><span class="campus-home-community-mark" aria-hidden="true">✳</span><div><b>一起让校园信息更好用</b><small>查看公开建议的处理进度，或提交你想改进的地方。</small></div></div>
      <RouterLink to="/campus/feedback">反馈与建议<ChevronRight aria-hidden="true" /></RouterLink>
    </section>
    <form class="place-search campus-home-search" role="search" aria-label="搜索校园地点" @submit.prevent="emit('search', 'all')">
      <Search aria-hidden="true" /><label class="sr-only" for="campus-home-search">搜索校园地点</label><input id="campus-home-search" :value="searchQuery" type="search" placeholder="搜索教学楼、食堂、自习室…" @input="emit('update:searchQuery', $event.target.value)" /><button class="btn btn-primary" type="submit">找地点</button>
    </form>
    <div class="campus-home-shortcuts" aria-label="地点快捷入口">
      <button type="button" @click="emit('search', 'all')"><MapPin aria-hidden="true" /><b>找地点</b><small>浏览同校目录</small></button>
      <button type="button" @click="emit('search', 'study')"><BookOpen aria-hidden="true" /><b>学习空间</b><small>图书馆与自习室</small></button>
      <button type="button" @click="emit('search', 'food')"><Utensils aria-hidden="true" /><b>吃点什么</b><small>食堂与餐饮</small></button>
      <button type="button" @click="emit('mine')"><Heart aria-hidden="true" /><b>我的地点</b><small>{{ myPlaceCount }} 条本机记录</small></button>
    </div>
    <section class="campus-home-service-section" aria-labelledby="campus-home-services-title">
      <div class="campus-home-section-heading"><div><h3 id="campus-home-services-title">校园常用</h3><p>学习、出行和生活，从这里开始。</p></div><RouterLink to="/campus/search">全站搜索<ChevronRight aria-hidden="true" /></RouterLink></div>
      <nav class="campus-home-services" aria-label="校园生活服务"><RouterLink v-for="item in placeServices" :key="item.path" :to="item.path"><span class="campus-home-service-icon"><component :is="item.icon" aria-hidden="true" /></span><span><b>{{ item.label }}</b><small>{{ item.detail }}</small></span><ChevronRight class="campus-home-service-arrow" aria-hidden="true" /></RouterLink></nav>
      <div class="campus-home-personal-links"><RouterLink to="/campus/mine">查看我的投稿</RouterLink><RouterLink to="/campus/publish">发布校园信息<ChevronRight aria-hidden="true" /></RouterLink></div>
    </section>
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

<style scoped>
.campus-home{display:grid;gap:18px;padding:clamp(16px,3vw,28px);border:1px solid var(--border);border-radius:var(--radius-14);background:var(--card)}.campus-home-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:14px}.campus-home-intro h2{margin:5px 0;font-size:clamp(22px,3vw,30px);letter-spacing:-.025em}.campus-home-intro p{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.6}.campus-home-search{min-height:54px}.campus-home-search .btn{flex:none}.campus-home-shortcuts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.campus-home-shortcuts button{display:grid;justify-items:start;gap:4px;min-height:102px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg);color:var(--text);text-align:left;font:inherit}.campus-home-shortcuts button>span{color:var(--primary);font-size:20px;line-height:1}.campus-home-shortcuts button b{font-size:var(--fs-12)}.campus-home-shortcuts button small{color:var(--muted);font-size:var(--fs-10)}.campus-home-shortcuts button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.campus-home-recent{display:grid;gap:10px}.campus-home-recent .place-results-heading{align-items:center}.campus-home-recent .place-results-heading p{margin:4px 0 0;color:var(--muted);font-size:var(--fs-10)}.campus-home-place-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.campus-home-place{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg)}.campus-home-place h4{margin:7px 0 3px;font-size:var(--fs-13);overflow-wrap:anywhere}.campus-home-place p{margin:0;color:var(--muted);font-size:var(--fs-10)}.campus-home-place>div:last-child{display:grid;justify-items:end;gap:6px;text-align:right}.campus-home-place>div:last-child b{color:var(--primary);font-size:var(--fs-10);font-weight:550}.campus-home-place .btn{padding:0 8px;font-size:var(--fs-10)}
.campus-home-community{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border:1px solid color-mix(in srgb,var(--success) 30%,var(--border));border-radius:var(--radius-12);background:color-mix(in srgb,var(--success) 5%,var(--card))}.campus-home-community>div{display:flex;align-items:center;gap:11px;min-width:0}.campus-home-community-mark{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:var(--radius-9);background:color-mix(in srgb,var(--success) 12%,var(--card));color:var(--success);font-size:20px}.campus-home-community>div>div{display:grid;gap:3px}.campus-home-community b{font-size:var(--fs-12)}.campus-home-community small{color:var(--muted);font-size:var(--fs-11);line-height:1.6}.campus-home-community>a{display:flex;align-items:center;gap:3px;flex:none;color:var(--success);font-size:var(--fs-12);font-weight:var(--fw-650);text-decoration:none}.campus-home-community>a svg{width:15px;height:15px}
.campus-home-services{display:flex;flex-wrap:wrap;gap:8px}.campus-home-services a{padding:8px 11px;border:1px solid var(--border);border-radius:999px;background:var(--bg);color:var(--text);font-size:var(--fs-11);text-decoration:none}.campus-home-services a:hover,.campus-home-services a:focus-visible{border-color:var(--primary);color:var(--primary)}
@media(max-width:760px){.campus-home-shortcuts{grid-template-columns:repeat(2,minmax(0,1fr))}.campus-home-place-list{grid-template-columns:1fr}}
@media(max-width:520px){.campus-home-intro{align-items:flex-start;flex-direction:column}.campus-home-intro .btn{width:100%}.campus-home-community{align-items:flex-start;flex-direction:column}.campus-home-community>a{min-height:40px}.campus-home-search{flex-wrap:wrap;padding:6px}.campus-home-search input{min-width:50%}}

/* Campus entry: service directory, with distinct place and community sections. */
.campus-home{gap:28px;background:var(--card)}.campus-home-intro h2{margin:0 0 10px;font-size:clamp(24px,3vw,34px);font-weight:var(--fw-750);line-height:1.4}.campus-home-intro p{font-size:var(--fs-13);max-width:58ch}.campus-home-search>svg{width:20px;height:20px;flex-shrink:0;color:var(--muted)}.campus-home-shortcuts button{gap:8px;min-height:110px;background:var(--bg-tint);border-color:transparent;padding:18px;transition:border-color var(--dur-fast) var(--ease-standard)}.campus-home-shortcuts button>svg{width:22px;height:22px;color:var(--primary);stroke-width:1.7}.campus-home-shortcuts button:hover{border-color:var(--primary)}.campus-home-shortcuts button b{font-size:var(--fs-14)}.campus-home-shortcuts button small{font-size:var(--fs-12)}
.campus-home-service-section{display:grid;gap:18px;padding-top:24px;border-top:1px solid var(--border)}.campus-home-section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-home-section-heading h3{margin:0;font-size:var(--fs-18)}.campus-home-section-heading p{margin:5px 0 0;color:var(--muted);font-size:var(--fs-12)}.campus-home-section-heading>a,.campus-home-personal-links a{display:inline-flex;align-items:center;gap:4px;color:var(--primary);font-size:var(--fs-12);text-decoration:none}.campus-home-section-heading>a>svg,.campus-home-personal-links svg{width:15px;height:15px}.campus-home-services{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.campus-home-services a{display:flex;align-items:center;gap:12px;min-width:0;min-height:88px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card);color:var(--text);text-decoration:none}.campus-home-services a>span:nth-child(2){display:grid;gap:6px;min-width:0}.campus-home-services a b{font-size:var(--fs-14);font-weight:var(--fw-650)}.campus-home-services a small{font-size:var(--fs-11);line-height:1.6;color:var(--muted)}.campus-home-service-icon{display:grid;place-items:center;flex-shrink:0;width:36px;height:36px;border-radius:var(--radius-9);background:var(--primary-soft);color:var(--primary)}.campus-home-service-icon svg{width:20px;height:20px;stroke-width:1.7}.campus-home-service-arrow{width:15px;height:15px;margin-left:auto;flex-shrink:0;color:var(--muted)}.campus-home-personal-links{display:flex;justify-content:flex-end;gap:20px;flex-wrap:wrap;padding-top:4px}.campus-home-recent{gap:16px;padding-top:24px;border-top:1px solid var(--border)}.campus-home-recent .place-results-heading h3{font-size:var(--fs-18)}.campus-home-recent .place-results-heading p{font-size:var(--fs-12)}.campus-home-place{padding:16px;background:var(--card)}.campus-home-place p,.campus-home-place>div:last-child b{font-size:var(--fs-12)}.campus-home :is(a,button):focus-visible{outline:2px solid var(--primary);outline-offset:3px}
@media(max-width:900px){.campus-home-services{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.campus-home{gap:22px}.campus-home-intro{gap:14px}.campus-home-intro [data-slot=button]{width:100%;min-height:44px}.campus-home-shortcuts{gap:8px}.campus-home-shortcuts button{padding:14px;min-height:106px}.campus-home-services{grid-template-columns:minmax(0,1fr)}.campus-home-services a{min-height:76px;padding:14px}.campus-home-services a small{font-size:var(--fs-12)}.campus-home-service-section,.campus-home-recent{padding-top:20px}.campus-home-section-heading>a{white-space:nowrap}.campus-home-personal-links{justify-content:space-between}.campus-home-personal-links a{min-height:44px}.campus-home-search input{font-size:16px}}

.campus-home-search{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--bg);min-width:0}.campus-home-search input{flex:1;width:0;min-width:0;min-height:40px;padding:4px;border:0;outline:none;background:transparent;color:var(--text);font:inherit;font-size:var(--fs-14)}.campus-home-search:focus-within{outline:2px solid var(--primary);outline-offset:3px}.campus-home-search .btn{min-height:40px}.campus-home-recent .place-results-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.campus-home-recent .place-results-heading h3{margin:0}.campus-home .place-empty{display:grid;justify-items:center;gap:12px;padding:28px 16px;border:1px dashed var(--border);border-radius:var(--radius-12);background:var(--bg-tint);text-align:center}.campus-home .place-empty h3{margin:0;font-size:var(--fs-16)}.campus-home .place-empty p{max-width:56ch;margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.campus-home .type-tag{display:inline-flex;padding:3px 8px;border-radius:var(--radius-6);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-11)}.campus-home .place-loading{padding:30px;color:var(--muted);font-size:var(--fs-13);text-align:center}
@media(max-width:520px){.campus-home-search{flex-wrap:nowrap}.campus-home-search input{min-width:0;font-size:16px}.campus-home-recent .place-results-heading{align-items:flex-start}.campus-home-recent .place-results-heading .btn{flex-shrink:0}.campus-home .btn{min-height:44px}}
</style>
