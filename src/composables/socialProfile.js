import { computed, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { campusErrorMessage } from './campusContentModel.js'
import { useCampusRequest } from './campusRequest.js'
import { socialRequest } from '../services/social.js'

/**
 * 账号公开资料（昵称、学校、校区、时区、可约偏好）。
 *
 * 【为什么值得抽出来】`profile_get` 之前有四处各自读取：校园生活布局、
 * 一起约、社交日历和我的账号资料。四份代码有四套错误文案，其中一份会把
 * 边缘函数的英文原文直接摆到界面上（没有兜底），另一份则连失败都看不出来。
 * 学校和校区同时决定校园内容的可见范围 —— 读错了，用户会以为"学校没内容"。
 *
 * `loadProfile` 只负责取回和归一化；把它渲染成什么样子由调用方决定。
 */
export function useSocialProfile() {
  const profile = ref(/** @type {any} */ (null))
  const loading = ref(false)
  const error = ref('')
  const loaded = ref(false)
  const request = useCampusRequest()
  const signedIn = computed(() => Boolean(accountUser.value?.id))
  const school = computed(() => profile.value?.school || '')
  const campus = computed(() => profile.value?.campus || '')
  const nickname = computed(() => profile.value?.nickname || '')

  async function loadProfile() {
    const revision = request.begin()
    // 未登录时清空：把上一个账号的学校留在页面上比显示「设置我的学校」更糟。
    if (!signedIn.value) { profile.value = null; loading.value = false; loaded.value = true; error.value = ''; return null }
    loading.value = true
    error.value = ''
    try {
      const result = (await socialRequest('profile_get')).profile || null
      if (!request.live(revision)) return null
      profile.value = result
      return result
    } catch (cause) {
      if (request.live(revision)) error.value = campusErrorMessage(cause, '学校与校区资料暂时无法读取。')
      return null
    } finally {
      if (request.live(revision)) { loading.value = false; loaded.value = true }
    }
  }

  watch(() => accountUser.value?.id, () => { void loadProfile() }, { immediate: true })

  return { profile, loading, error, loaded, signedIn, school, campus, nickname, loadProfile }
}