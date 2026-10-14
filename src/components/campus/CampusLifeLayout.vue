<script setup>
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronDown, MapPin, School } from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { campusGroups, campusNavigation } from './navigation.js'
import { accountOpen, accountUser } from '../../composables/accountAuth.js'
import { socialRequest } from '../../services/social.js'
import './campus-life.css'

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
const userKey = computed(() => accountUser.value?.id || '')
const route = useRoute()
const menuOpen = ref(false)
watch(() => route.path, () => { menuOpen.value = false })
let contextGeneration = 0
onScopeDispose(() => { contextGeneration += 1 })
const profile = ref(null)
const contextError = ref('')
const contextLoaded = ref(false)
// Every campus request is scoped server-side from the profile school, so a missing
// school blocks the whole module; surface that as a setup step instead of a blank list.
const needsSchool = computed(() => Boolean(userKey.value) && contextLoaded.value && !contextError.value && !profile.value?.school)
async function loadContext() {
  const generation = ++contextGeneration
  const userId = userKey.value
  profile.value = null
  contextError.value = ''
  contextLoaded.value = false
  if (!userKey.value) { contextLoaded.value = true; return }
  try {
    const result = await socialRequest('profile_get')
    if (generation === contextGeneration && userKey.value === userId) profile.value = result.profile || null
  } catch (cause) {
    if (generation === contextGeneration && userKey.value === userId) contextError.value = cause?.message || '学校与校区资料暂时无法读取。'
  } finally {
    if (generation === contextGeneration && userKey.value === userId) contextLoaded.value = true
  }
}
watch(userKey, () => { void loadContext() })
onMounted(() => { void loadContext() })
</script>

<template>
  <div class="campus-life-page">
    <header class="campus-life-header">
      <div class="campus-life-heading"><RouterLink class="campus-life-breadcrumb" to="/campus"><School aria-hidden="true" />校园生活</RouterLink><h1>{{ title }}</h1><p v-if="description">{{ description }}</p></div>
      <RouterLink class="campus-life-context" to="/together" aria-label="查看或修改学校与校区"><MapPin aria-hidden="true" /><span><b>{{ profile?.school || '设置我的学校' }}</b><small>{{ profile?.campus || '在个人资料中补充校区' }}</small></span></RouterLink>
    </header>
    <aside class="campus-life-sidebar">
      <button class="campus-life-menu-toggle" type="button" :aria-expanded="menuOpen" aria-controls="campus-life-navigation" @click="menuOpen = !menuOpen"><span>校园导航</span><ChevronDown aria-hidden="true" /></button>
      <nav id="campus-life-navigation" class="campus-life-nav" :class="{ 'is-expanded': menuOpen }" aria-label="校园生活功能">
        <div v-for="group in campusGroups" :key="group" class="campus-life-nav-group"><span class="campus-life-nav-label">{{ group }}</span><RouterLink v-for="item in campusNavigation.filter((entry) => entry.group === group)" :key="item.path" :to="item.path" :class="{ 'is-current': route.path === item.path }" :aria-current="route.path === item.path ? 'page' : undefined"><component :is="item.icon" aria-hidden="true" /><span>{{ item.label }}</span></RouterLink></div>
      </nav>
      <p class="campus-life-sidebar-note">同校分享，共建校园。<br />学校归属由用户自行填写。</p>
    </aside>
    <div class="campus-life-body">
      <Alert v-if="contextError" role="status"><AlertTitle>学校资料暂时无法读取</AlertTitle><AlertDescription>{{ contextError }} <button class="text-button" type="button" @click="loadContext">重新读取</button></AlertDescription></Alert>
      <Alert v-else-if="!userKey" role="status"><AlertTitle>登录，连接你的校园</AlertTitle><AlertDescription>登录并填写学校后，即可查看同校内容。发布草稿可以先在本机填写。<button class="text-button" type="button" @click="accountOpen = true">登录账号</button></AlertDescription></Alert>
      <Alert v-else-if="needsSchool"><AlertTitle>先设置学校，找到同校内容</AlertTitle><AlertDescription>校园生活按学校筛选信息。<RouterLink to="/together">前往个人资料填写</RouterLink></AlertDescription></Alert>
      <slot :profile="profile" />
    </div>
  </div>
</template>
