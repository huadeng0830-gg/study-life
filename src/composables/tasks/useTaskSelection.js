/**
 * 待办页的批量选择。
 *
 * 【为什么需要】学期末一次清几十条是真实场景，而这里原来只有「一键整理」——它只补课程和
 * 优先级，不删不完成。于是「把上周剩下的全部归档」只能一条一条点。
 *
 * 【两个容易踩的坑】
 *   1. **选择集必须跟着数据收缩**。完成、归档、删除、以及被搜索/筛选排除掉的待办会离开
 *      当前列表，但它们仍可能在 `selectedIds` 里。若不清，「已选 12 项」会数出看不见的条目，
 *      批量删除会删掉用户根本没看见的东西——这是最危险的一种不一致。
 *      所以这里暴露 `retainVisible()`，视图每次列表变化后调用一次。
 *   2. **齐行任务不能批量**。它们的编辑、删除和状态都归项目工作台，本页对它们只有「查看项目」
 *      一个入口，所以默认不进选择集，免得批量操作把它们改了却改不到地方。
 */
import { computed, ref } from 'vue'

/** @param {{ isSelectable?: (task: object) => boolean }} [options] */
export function useTaskSelection({ isSelectable = () => true } = {}) {
  /** @type {import('vue').Ref<string[]>} */
  const selectedIds = ref([])
  const selected = computed(() => new Set(selectedIds.value))
  const count = computed(() => selectedIds.value.length)

  function isSelected(id) {
    return selected.value.has(id)
  }

  function toggle(id) {
    selectedIds.value = selected.value.has(id) ? selectedIds.value.filter((item) => item !== id) : [...selectedIds.value, id]
  }

  function setOnly(ids) {
    selectedIds.value = [...new Set(ids)]
  }

  function clear() {
    selectedIds.value = []
  }

  /** 把选择集收缩到当前列表里**可选**的那些条目。 */
  function retainVisible(tasks = []) {
    const allowed = new Set(tasks.filter((task) => isSelectable(task)).map((task) => task.id))
    const kept = selectedIds.value.filter((id) => allowed.has(id))
    if (kept.length !== selectedIds.value.length) selectedIds.value = kept
  }

  /** 全选 / 取消全选，按当前列表的可见可选条目算。 */
  function toggleAll(tasks = []) {
    const selectable = tasks.filter((task) => isSelectable(task)).map((task) => task.id)
    const allSelected = selectable.length > 0 && selectable.every((id) => selected.value.has(id))
    selectedIds.value = allSelected ? [] : selectable
  }

  /** 当前列表里已被勾选的那些实体。 */
  function selectedTasks(tasks = []) {
    return tasks.filter((task) => selected.value.has(task.id))
  }

  return { selectedIds, selected, count, isSelected, toggle, setOnly, clear, retainVisible, toggleAll, selectedTasks }
}