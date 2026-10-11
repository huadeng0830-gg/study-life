/**
 * 把待办页的列表状态（筛选 / 排序 / 方向 / 搜索 / 优先级 / 日期范围 / 归档开关）
 * 接到路由 query 上。
 *
 * 【为什么不是「query 当唯一数据源」】纯 computed 读 `route.query` 的写法会让每一次筛选点击
 * 都得等 `router.replace` 走完才反映到列表上。vue-router 的导航是异步的（要过导航守卫），
 * 于是点「需要确认」之后会有一帧的延迟——在真实页面上是列表闪一下才收窄，
 * 在挂载测试里就是「点完立刻断言」直接读到旧值。本地状态必须**同步**可见。
 *
 * 【所以是「本地为准 + 镜像进地址栏」】
 *   1. 所有写操作先同步更新本地 `state`（界面立刻响应），再把同样的值 replace 进地址栏；
 *   2. 地址栏被**外部**改动时（前进 / 后退 / 手改 / 别人发来的链接）再回灌本地。
 * 连续操作在尚未完成的 query 上继续合并。只在导航待完成期间识别自己的回声；导航结束后
 * 同一个地址也可能来自前进/后退，必须正常恢复。世代编号防止旧请求的结果覆盖新操作。
 *
 * 【为什么筛选还要一个 filterTouched】页面上有个智能默认：「已安排」为空但「待安排日期」
 * 不为空时，列表自动落到后者，免得打开页面是一片空白。这条默认只该在**用户从没选过**时生效。
 * 把状态写进 URL 之后，「用户选过」这件事本身就体现在 `?f=` 上——所以刷新后地址栏里的
 * 显式选择一定赢过智能默认，这正是把状态放进 URL 要解决的问题；反过来，没有 `?f=` 的
 * 干净地址仍然享受智能默认，地址栏也不会因此多出参数。
 */
import { onScopeDispose, ref, watch } from 'vue'
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router'
import { useDebouncedRef } from '../useDebouncedRef.js'
import { hasExplicitFilter, readTaskListState, toggledSortDir, writeTaskListState } from './taskViewQuery.js'

/** query 的稳定序列化：键排序，让「同一份状态」在任何键序下都得到同一个串。 */
function serializeQuery(query) {
  const entries = Object.entries(query || {}).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return JSON.stringify(entries)
}

/**
 * @param {{ searchDelay?: number }} [options]
 */
export function useTaskViewQuery(options = {}) {
  const route = useRoute()
  const router = useRouter()

  /** 当前生效的列表状态。界面一律读它，不读 route.query。 */
  const state = ref(readTaskListState(route.query))
  /** 用户显式选过筛选（或地址栏本来就带着 `?f=`）。智能默认在它为真时让位。 */
  const filterTouched = ref(hasExplicitFilter(route.query))
  const navigationError = ref('')
  let pendingQuery = null
  let writeGeneration = 0
  let disposed = false
  const pendingWrites = new Map()

  /** 绑在输入框上的搜索词（每键都动）。 */
  const queryInput = ref(state.value.q)
  /** 防抖后真正驱动筛选的那个 ref。 */
  const searchQuery = useDebouncedRef(queryInput, options.searchDelay ?? 160)

  function restore(query) {
    state.value = readTaskListState(query)
    filterTouched.value = hasExplicitFilter(query)
    queryInput.value = state.value.q
    searchQuery.flush(state.value.q)
  }

  function settle(generation, failed) {
    if (disposed || generation !== writeGeneration) return
    pendingQuery = null
    if (failed) {
      restore(route.query)
      navigationError.value = '筛选状态未能保存到地址，已恢复原状态，请重新选择。'
    }
  }

  /**
   * 所有状态变更的唯一入口。
   *
   * `also` 让同一次替换顺带改掉别的 query 键（深链高亮要连带退出看板 / 月历时用得上）：
   * 值给 `null` 表示删键。一次交互只产生一次 `replace`，拆成两次会在前进/后退里
   * 多出一条用户根本没做过的中间记录。
   *
   * 补丁里带 `q` 时输入框一起同步：清空筛选、切换归档这些场合搜索词是被**整体替换**的，
   * 只走防抖那条路会让输入框和列表在 160ms 内显示的是两份不同的词。
   */
  function apply(patch = null, { touchFilter = false, also = null } = {}) {
    const changes = patch && typeof patch === 'object' ? patch : {}
    if (touchFilter) filterTouched.value = true
    if (Object.prototype.hasOwnProperty.call(changes, 'q')) {
      queryInput.value = String(changes.q ?? '')
      searchQuery.flush(queryInput.value)
    }
    const query = writeTaskListState(pendingQuery || route.query, changes)
    if (also) {
      for (const [key, value] of Object.entries(also)) {
        if (value == null) delete query[key]
        else query[key] = value
      }
    }
    state.value = readTaskListState(query)
    navigationError.value = ''
    pendingQuery = query
    const generation = ++writeGeneration
    pendingWrites.set(generation, { path: route.path, query: serializeQuery(query) })
    return router.replace({ query }).then(
      (failure) => settle(generation, Boolean(failure) && !isNavigationFailure(failure, NavigationFailureType.duplicated)),
      () => settle(generation, true),
    ).finally(() => pendingWrites.delete(generation))
  }

  function toggleSortDirection() {
    apply({ dir: toggledSortDir(state.value) })
  }

  // 防抖后的搜索词回写地址栏：输入框已经同步跟手了，这里只负责让刷新和分享链接带上它。
  watch(searchQuery, (value) => {
    if (value !== state.value.q) apply({ q: value })
  })

  // 地址栏被外部改动：回灌本地。收到自己的回声就跳过。
  watch(() => [route.path, route.query], ([path, query]) => {
    const signature = serializeQuery(query)
    // 同步监听只需忽略最新写入；旧目标也可能是用户此刻后退到的真实历史地址。
    const latestWrite = pendingWrites.get(writeGeneration)
    if (latestWrite?.path === path && latestWrite.query === signature) return
    writeGeneration += 1
    pendingQuery = null
    pendingWrites.clear()
    navigationError.value = ''
    restore(query)
  }, { deep: true, flush: 'sync' })

  onScopeDispose(() => {
    disposed = true
    writeGeneration += 1
    pendingQuery = null
    pendingWrites.clear()
  })

  return { state, filterTouched, apply, queryInput, searchQuery, toggleSortDirection, navigationError }
}
