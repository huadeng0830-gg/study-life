import { ref } from 'vue'

// 只存在于当前页面生命周期，不写入业务存储，避免一次恢复故障永久锁死应用。
export const localSafeMode = ref(false)

export function enableLocalSafeMode() {
  localSafeMode.value = true
}

export function disableLocalSafeMode() {
  localSafeMode.value = false
}
