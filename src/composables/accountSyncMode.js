import { computed, ref } from 'vue'

/**
 * 「是否通过账号同步」——由用户自己决定。
 *
 * 【为什么这不是一个 sl_* 键】
 * 它是**每台设备各自的**选择，跟"这周上不上课"那种业务数据不是一回事。
 * 更要命的是：如果把它放进同步负载，一台设备关掉同步就会顺着云端
 * 把其它所有设备一起关掉 —— 用户在手机上按一下开关，电脑上默默就不同步了，
 * 而且没有任何地方能解释为什么会这样，所以它刻意不进 sl_* 命名空间，
 * 也就不进入业务备份或账号云端负载。
 *
 * 【为什么默认是 'account'】
 * 保持现状。已经登录的用户**不会**因为这次改动突然停止同步 ——
 * 开关必须是"用户主动关掉才关"，而不是"升级之后默认行为变了"。
 *
 * 【关掉之后会怎样】
 * 只停账号这一条通道：不再上传，也不再拉取，本机记录照常读写。
 * 登录状态不变（不退出账号），本机数据的归属也不变 ——
 * 于是随时可以改回来，改回来之后接着上次的进度同步。
 */
export const ACCOUNT_SYNC_MODE_KEY = 'study_life_account_sync_mode'
export const ACCOUNT_SYNC_MODES = Object.freeze(['account', 'off'])

function readMode() {
  try {
    const saved = localStorage.getItem(ACCOUNT_SYNC_MODE_KEY)
    // 认不出来的值一律回落到 'account'：宁可继续同步，也不要因为一个脏值
    // 让用户以为自己在同步、实际什么也没传。
    return ACCOUNT_SYNC_MODES.includes(saved) ? saved : 'account'
  } catch {
    return 'account'
  }
}

export const accountSyncMode = ref(readMode())
export const accountSyncViaAccount = computed(() => accountSyncMode.value === 'account')

/**
 * 切换通道。
 *
 * 只写本机状态；真正的停/启由 accountSyncLifecycle 监听这个 ref 完成
 * （见那里的 watcher），所以这里刻意不直接调引擎 —— 两处都去停同一个引擎，
 * 迟早会出现"停了两次、第二次把新的一轮也拆了"的竞态。
 *
 * @param {'account'|'off'} mode
 * @returns {'account'|'off'} 实际生效的模式
 */
export function setAccountSyncMode(mode) {
  const next = ACCOUNT_SYNC_MODES.includes(mode) ? mode : 'account'
  if (accountSyncMode.value === next) return next
  accountSyncMode.value = next
  try { localStorage.setItem(ACCOUNT_SYNC_MODE_KEY, next) } catch { /* 隐私模式下退化为仅本次会话 */ }
  return next
}

if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (event.storageArea && event.storageArea !== window.localStorage) return
  if (event.key === ACCOUNT_SYNC_MODE_KEY || event.key === null) {
    accountSyncMode.value = readMode()
  }
})
