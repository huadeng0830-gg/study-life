/**
 * 标签页（`role="tablist"` / `role="tab"`）的键盘模型。
 *
 * 【为什么需要它】给一个控件标上 `role="tab"`，就是对外宣告了 ARIA APG 的标签页契约，
 * 而契约的一半是**键盘**：
 *   1. roving tabindex——一组 tab 里**只有当前选中的那个**留在 Tab 序列里，
 *      否则键盘用户要按 5 次 Tab 才能穿过一组标签页；
 *   2. 组内用 ←/→ 在 tab 之间移动，Home/End 直达两端；
 *   3. 移动后焦点跟着走。
 *
 * 第二十七～二十九轮把全站误用/缺失的 tab 语义清理干净了（现在只剩 5 个 tablist，
 * 全是真标签页且都有面板），但**键盘这一半一直缺着**——只有 `role="tab"` 没有键击，
 * 和"只有 `class="on"` 没有 `aria-selected`"是同一类问题：宣告了做不到的事。
 *
 * 【激活方式】采用 APG 的 automatic activation：方向键一移动就切换选中项。
 * 这 5 处面板都很轻（切换成本低），比"先移动焦点、再按回车确认"少一步。
 *
 * 【否决权】`select(key)` 可以返回 `false` 表示这次切换被拒绝（例如
 * `TimeSettingsModal` 有未保存草稿时会先弹确认框）。此时**不移动焦点**——
 * 否则焦点会停在一个并未选中的 tab 上，与 roving tabindex 的状态自相矛盾。
 *
 * @param {object} options
 * @param {string[]|(() => string[])} options.keys 按渲染顺序排列的 tab 键
 * @param {() => string} options.active 当前选中项
 * @param {(key: string) => (boolean|void)} options.select 切换选中项；返回 false 表示被否决
 */
export function useTabKeys({ keys, active, select }) {
  const items = typeof keys === 'function' ? keys : () => keys

  const activeTabIndex = () => {
    const index = items().indexOf(active())
    return index < 0 ? 0 : index
  }

  /** roving tabindex：只有当前选中的 tab 留在 Tab 序列里（其余用方向键到达）。 */
  const tabIndexFor = (key) => (key === active() ? 0 : -1)

  const onKeydown = (event) => {
    const list = items()
    if (list.length === 0) return

    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    let next = null
    if (step !== 0) next = (activeTabIndex() + step + list.length) % list.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = list.length - 1

    // 不是我们负责的键就放行，别吞掉别的快捷键。
    if (next === null) return

    // Home/End 默认会滚动页面、方向键默认会移动插入符，都要拦掉。
    event.preventDefault()

    const key = list[next]
    if (key === active()) return
    if (select(key) === false) return

    // 焦点跟着选中项走：按的是同一个 tablist 里的第 next 个 tab。
    const tabs = event.currentTarget?.querySelectorAll?.('[role="tab"]')
    tabs?.[next]?.focus?.()
  }

  return { onKeydown, tabIndexFor, activeTabIndex }
}