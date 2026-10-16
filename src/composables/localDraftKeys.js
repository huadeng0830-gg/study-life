/**
 * 本机**草稿类**存储键：写的是用户内容，却既没有 `sl_` 前缀，也不在备份/同步清单里。
 *
 * 【为什么必须单独登记】清空本机数据只按 `sl_` 前缀清（`localDataPurge.js`），
 * 用量统计也只数 `sl_`（`localStorageUsage.js`）。于是这些键：
 *   - 清空之后**仍然残留**在设备上 —— 校园投稿草稿里是正文、金额、联系方式；
 *   - 不进入「本机用量」，用户看到的占用数字偏小。
 *
 * 【为什么不进账号同步】草稿是**单台设备的未完成状态**：把它搬到另一台设备，
 * 只会让那台设备冒出一份半截内容。同类取舍与理由见 `syncKeys.js` 的
 * `BACKUP_ONLY_KEYS` 注释（正在计时的专注、地点到访记录同理）。
 *
 * 由 `tests/localDraftKeys.test.js` 守卫：这里登记的每个前缀都必须真的在源码里
 * 被用作存储键，并且清空与用量两条路径都认它 —— 否则登记表会变成一纸空文。
 */
export const LOCAL_DRAFT_KEY_PREFIXES = Object.freeze([
  'study-life:campus-draft:', // campusLifeDraft.js：校园投稿草稿（含正文）
  'study-life-quick-record-draft:', // quickRecord/draftStorage.js：快速记录草稿
  'study-life-project-submit:', // projects/useProjectDeliverableEditor.js：成果提交草稿
])

/** @param {unknown} key */
export function isLocalDraftKey(key) {
  return typeof key === 'string' && LOCAL_DRAFT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * 这台设备上属于**用户内容**、因而需要被清空与计入用量的键。
 *
 * 刻意不包含 `study-life-data-owner` / `study-life-account-*` 这类**状态标记**：
 * 它们不是用户内容，清掉反而会让应用以为数据从未归属过某个账号。
 *
 * @param {unknown} key
 */
export function isPurgeableLocalKey(key) {
  return typeof key === 'string' && (key.startsWith('sl_') || isLocalDraftKey(key))
}