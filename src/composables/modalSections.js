/** Transient section selection for settings panels; it resets after a page refresh. */

import { ref } from 'vue'

/** 外观设置：theme | wallpaper | quotes | layout | swipe */
export const appearanceTab = ref('theme')

/** 作息设置：plans | base */
export const timeSettingsTab = ref('plans')

/** 作息导入：paste | image */
export const timeImportTab = ref('paste')
