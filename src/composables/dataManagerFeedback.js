import { ref } from 'vue'

// 数据备份与恢复反馈分别就近显示，避免错误出现在与操作无关的分区。
export const backupError = ref('')
export const backupMessage = ref('')
export const restoreError = ref('')
