/**
 * 浮层内部分区的记忆（第五十四轮）。
 *
 * 【问题】外观设置 5 个分区、本地迁移 2 个、作息设置 2 个 + 导入 2 个，原本都是
 * 组件内的 `const tab = ref(...)`，而且打开时的 watcher 里还显式写了一行
 * `tab.value = '第一个分区'`。外观与本地迁移的父级用 `v-if` 销毁实例，作息设置
 * 的父级没有 `v-if`，于是同一个需求在三个地方有三种实际行为（有的丢失、有的保留），
 * 用户每次打开都要重新点一遍自己刚才所在的分区。
 *
 * 【为什么是模块级 ref，而不是三个候选方案】
 *   1. **不用 `route.query`**：这些是全局浮层，没有自己的路由（外观可以从任意页面
 *      的侧边栏打开）。把浮层内部的分区写进 URL，会把状态糊到每一个页面的地址栏上；
 *      而且 `tab` 这个键已经被账本的三个分区占用（`composables/routeState.js`），
 *      必然语义冲突。账本那套之所以成立，是因为它本身就是路由页面。
 *   2. **不用 `overlayStack.js`**：那个栈的职责是遮罩互斥、滚动锁与焦点陷阱，
 *      关闭后**刻意不留任何东西**（`Modal.vue` 的 removeOverlay）。把"记忆"塞进去
 *      会让"当前打开的浮层"和"上次看过的分区"两件事混在一个数据结构里。
 *   3. **不用存储键**：仓库对"记住 UI 位置"已有先例与明确取向 ——
 *      `composables/viewScrollMemory.js` 是模块级 Map，注释写明了它刻意不占 `sl_*` 键。
 *      分区记忆属于同一类：它是纯 UI 位置，跨刷新记下来的深链价值接近零，
 *      却要为它付一个新增存储键的全套登记成本（同步模块、备份映射、迁移、
 *      应急导出、本地迁移清单）以及一次镜像写入。
 *
 * 【因此确定的语义】关闭再打开 → 回到上次所在的分区；**刷新页面 → 回到默认分区**。
 * 默认值就是"第一个分区"，即改造前的行为，所以未使用过的用户不会看到任何变化。
 *
 * 【为什么删掉了打开时的重置】
 * 持久化的前提就是不再重置。外观设置原来那行 `tab.value = 'theme'` 的注释理由是
 * "避免点击个性化时卡住"（壁纸预览要读 IndexedDB）——这个顾虑仍然成立，但它由
 * `loadPreview()` 只在 `tab === 'wallpaper'` 时才调用来保证：首次打开（默认 theme）
 * 依然不做任何 I/O；只有上次停在壁纸页的用户会在打开时立刻加载预览，而那正是他要看的页面。
 */

import { ref } from 'vue'

/** 外观设置：theme | wallpaper | quotes | layout | swipe */
export const appearanceTab = ref('theme')

/** 本地迁移：send | receive */
export const transferTab = ref('send')

/** 作息设置：plans | base */
export const timeSettingsTab = ref('plans')

/** 作息导入：paste | image */
export const timeImportTab = ref('paste')