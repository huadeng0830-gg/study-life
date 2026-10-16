<script setup>
import { computed } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import CampusEmptyState from './CampusEmptyState.vue'
import CampusLoadingState from './CampusLoadingState.vue'

/**
 * The one place a campus screen decides what to show before it has content.
 *
 * Before this existed, three different orderings were in use across the campus
 * views, and each had a bug the others did not:
 *
 *  - most views used loading → error → empty → content, but
 *  - 我的举报 put the error *first* and left the `v-for` **outside** the chain,
 *    so the empty state and the list could render at the same time, and
 *  - 校园搜索 gated loading on `loading` rather than `loading && !loaded`, so
 *    re-running a search blanked the results that were already on screen.
 *
 * Deciding the order in one component means a new screen cannot pick a broken
 * ordering, and fixing one fixes all of them.
 *
 * Renders **exactly one** of loading / error / empty / content. The content
 * slot is a fragment, not a wrapper element, so `.campus-life-panel`'s grid
 * sees the same children it saw before.
 */
const props = defineProps({
  /** A read is in flight. */
  loading: { type: Boolean, default: false },
  /** A read has succeeded at least once. Distinguishes "first load" from "refresh". */
  loaded: { type: Boolean, default: false },
  /** Read or action error. Rendered in place of content so it can never sit above a stale list. */
  error: { type: String, default: '' },
  /** Content resolved but there is nothing to show. Only consulted when there is no error. */
  empty: { type: Boolean, default: false },
  loadingText: { type: String, default: '正在读取…' },
  retryLabel: { type: String, default: '重试' },
  emptyTitle: { type: String, default: '这里还没有内容' },
  emptyDescription: { type: String, default: '' },
  emptyAction: { type: String, default: '' },
  emptyTo: { type: String, default: '' },
})
const emit = defineEmits(['retry'])

// First load only. A refresh keeps showing what is already on screen.
const showLoading = computed(() => props.loading && !props.loaded)
// The layout already provides the account action. Retrying a protected read
// cannot help a guest, so keep its unavailable-content state informational.
const loginRequired = computed(() => !accountUser.value?.id && /^请先登录账号/.test(props.error))
const showError = computed(() => Boolean(props.error))
const showEmpty = computed(() => props.empty)
</script>

<template>
  <CampusLoadingState v-if="showLoading">{{ loadingText }}</CampusLoadingState>
  <p v-else-if="loginRequired" class="campus-life-inline-state" role="status">同校内容将在登录后显示。</p>
  <p v-else-if="showError" class="campus-life-inline-state error" role="alert">
    {{ error }}
    <button class="text-button" type="button" :disabled="loading" @click="emit('retry')">{{ retryLabel }}</button>
  </p>
  <CampusEmptyState
    v-else-if="showEmpty"
    :title="emptyTitle"
    :description="emptyDescription"
    :action="emptyAction"
    :to="emptyTo"
  >
    <slot name="empty" />
  </CampusEmptyState>
  <slot v-else />
</template>
