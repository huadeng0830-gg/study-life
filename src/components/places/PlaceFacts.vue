<script setup>
// 「公开资料」这四个字段在发现卡片与我的地点卡片里逐字相同，抽成组件只写一份。
// 样式必须跟着组件走：places.css 是页面级 scoped 样式，够不到子组件的内部元素。
defineProps({ place: { type: /** @type {import('vue').PropType<Record<string, any>>} */ (Object), required: true } })
</script>

<template>
  <dl v-if="place.openingHours || place.serviceInfo || place.publicContact || place.sourceInfo" class="discover-facts">
    <div v-if="place.openingHours"><dt>开放时间</dt><dd>{{ place.openingHours }}</dd></div>
    <div v-if="place.serviceInfo"><dt>服务与价格</dt><dd>{{ place.serviceInfo }}</dd></div>
    <div v-if="place.publicContact"><dt>公开联系方式</dt><dd>{{ place.publicContact }}</dd></div>
    <div v-if="place.sourceInfo"><dt>来源说明</dt><dd>{{ place.sourceInfo }}</dd></div>
  </dl>
</template>

<style scoped>
.discover-facts{display:grid;gap:7px;margin:0}
.discover-facts>div{display:grid;grid-template-columns:74px minmax(0,1fr);gap:9px;font-size:var(--fs-11);line-height:1.5}
.discover-facts dt{color:var(--muted)}
.discover-facts dd{margin:0;color:var(--text);overflow-wrap:anywhere}
</style>