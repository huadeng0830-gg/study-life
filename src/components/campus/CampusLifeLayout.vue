<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import { socialRequest } from '../../services/social.js'
import './campus-life.css'

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
const userKey = computed(() => accountUser.value?.id || '')
const profile = ref(null)
const contextError = ref('')
async function loadContext() {
  profile.value = null
  contextError.value = ''
  if (!userKey.value) return
  try {
    const result = await socialRequest('profile_get')
    if (accountUser.value?.id === userKey.value) profile.value = result.profile || null
  } catch (cause) {
    if (accountUser.value?.id === userKey.value) contextError.value = cause?.message || '学校与校区资料暂时无法读取。'
  }
}
watch(userKey, () => { void loadContext() })
onMounted(() => { void loadContext() })
</script>

<template>
  <div class="campus-life-page">
    <header class="campus-life-header">
      <div><span class="campus-life-eyebrow">校园生活中心</span><h1>{{ title }}</h1><p v-if="description">{{ description }}</p></div>
      <div class="campus-life-context"><span v-if="profile?.school">{{ profile.school }}<template v-if="profile.campus"> · {{ profile.campus }}</template></span><span v-else>请先填写学校与校区</span><small>自填归属 · 非官方认证</small></div>
    </header>
    <nav class="campus-life-nav" aria-label="校园生活功能">
      <RouterLink to="/campus">总览</RouterLink>
      <RouterLink to="/campus/search">全站搜索</RouterLink>
      <RouterLink to="/campus/courses">老师与课程</RouterLink>
      <RouterLink to="/campus/market">二手集市</RouterLink>
      <RouterLink to="/campus/help">校园互助</RouterLink>
      <RouterLink to="/campus/shuttle">校车出行</RouterLink>
      <RouterLink to="/campus/lost-found">失物招领</RouterLink>
      <RouterLink to="/campus/events">活动社团</RouterLink>
      <RouterLink to="/campus/guides">校园指南</RouterLink>
      <RouterLink to="/campus/mine">我的投稿</RouterLink>
      <RouterLink to="/campus/publish">统一发布</RouterLink>
    </nav>
    <p v-if="contextError" class="campus-life-inline-state" role="status">{{ contextError }}</p>
    <slot :profile="profile" />
  </div>
</template>
