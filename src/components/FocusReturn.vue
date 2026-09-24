<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { hasFocusQuery, queryWithoutFocus } from '../composables/focusReturn.js'

/**
 * 聚焦态下的「返回列表」入口（第五十四轮）。
 *
 * 只在 URL 带 `?focus=` / `?section=` 时出现——也就是用户是从别处深链进"某一项"的
 * 时候。此时页面上那个被高亮的项是"深层态"，但路由本身是一级平级、没有父级，
 * 所以返回入口只能由**聚焦参数**驱动，而不是由路由层级驱动（理由见
 * `composables/focusReturn.js` 顶部的层级模型说明）。
 */

const route = useRoute()
const router = useRouter()

const focused = computed(() => hasFocusQuery(route.query))

/**
 * 用 `replace` 而不是 `push`：这条入口的语义是"退出聚焦态"，不是"再进一个页面"。
 * 浏览器返回键本来就负责回到来源页；再压一条历史记录只会让"返回"要按两次。
 * `path` 不变、只删聚焦键，所以这也不是一次路由跳转——页面不会被重建。
 */
function leaveFocus() {
  if (!focused.value) return
  void router.replace({ path: route.path, query: queryWithoutFocus(route.query) })
}
</script>

<template>
  <button v-if="focused" class="btn btn-ghost focus-return" type="button" @click="leaveFocus">← 返回列表</button>
</template>

<style scoped>
/* 只在聚焦态出现的一条返回入口。外观刻意复用既有 .btn / .btn-ghost，
   不新造一套按钮样式；这里只负责它与页面标题之间的间距。 */
.focus-return {
  margin: 0 0 10px;
}
</style>