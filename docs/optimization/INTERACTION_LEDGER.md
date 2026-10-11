# 全局交互专项逐入口待办台账

扫描日期：2026-10-11（Asia/Shanghai）。由 `node scripts/audit/interactions.mjs ../.tmp/interaction-20261011.json --ledger docs/optimization/INTERACTION_LEDGER.md` 生成。

扫描 207 个 Vue 文件、1463 个控件/事件定义，其中静态依赖可达 1457 个。循环按定义计数；包装器内部与调用者各列，数量不等于去重后的功能数。分类 A 重要提交 / B 高频 / C 即时 / D 危险 / E 长任务仅用于安排审查，自动分类须人工复核。

S/U = 已列入源码审计，行为仍待逐项验收。即使现有共享按钮或旧测试通过，也不自动标为完成。本批 GLO02 导航保存与离开、草稿/确认/撤销，以及共享 ActionButton 的具体验证见 STATUS.md 第 0D 节；下表仍保留完整入口供下一轮复核。静态可达包括懒加载和重导出，不证明角色/权限/平台实际显示；未可达文件列为无静态入口，不当作活动消费者。模板动态组件、全局注册、原生平台/权限菜单需结合 INVENTORY.md GLO/API 条目人工审查。

## 活动依赖中的交互（逐项待办）

### src/App.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 422 | a | {{ t('skip.toContent') }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 433 | button | 打开全局搜索 | click: openSearch() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 448 | button | 快速记录（Ctrl/Cmd + K） | click: openQuickRecord() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 488 | button | 打开数据管理 | click: openDataManager | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 493 | ActionButton | 导出当前数据 | action: () =&gt; exportCurrentData() | A | 共享按钮 external | S/U；见批次范围 |
| 494 | button | 关闭本机保存提示 | click: dismissPersistenceNotice | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 506 | ActionButton | {{ retryingSync ? '正在重试…' : '重试账号同步' }} | action: () =&gt; retrySyncNow() | E | 共享按钮 external | S/U；见批次范围 |
| 509 | button | 打开数据管理 | click: openDataManager | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 514 | button | 去备份 | click: openDataManager | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 515 | button | 关闭备份提醒 | click: dismissBackupNudge | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 532 | button | 查看 | click: viewQuickRecordEntity | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 533 | button | 撤销 | click: undoQuickRecord | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 548 | button | 重新加载 | click: reloadAfterError | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 549 | button | 忽略此提示 | click: dismissGlobalError | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/AccountPanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 260 | button | 账号概览 | click: activeSection = 'overview' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 261 | button | 账号安全 | click: activeSection = 'security' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 281 | button | 稍后设置，返回账号 | click: leaveRecovery | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 293 | ActionButton | {{ resendSeconds &gt; 0 ? resendSeconds + ' 秒后可重发' : '重新发送验证邮件' }} | action: () =&gt; resend() | A | 共享按钮 external | S/U；见批次范围 |
| 297 | button | 已验证，去登录 | click: changeMode('login') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 298 | button | 更换邮箱 | click: changeMode('register') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 306 | ActionButton | {{ resendSeconds &gt; 0 ? resendSeconds + ' 秒后可重发' : '重新发送重设邮件' }} | action: () =&gt; submit() | A | 共享按钮 external | S/U；见批次范围 |
| 307 | button | 返回登录 | click: changeMode('login') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 307 | button | 更换邮箱 | click: changeMode('recovery') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 318 | button | 登录 | click: changeMode('login') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 319 | button | 注册 | click: changeMode('register') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 321 | form | 邮箱 {{ errors.email }} 密码 忘记密码？ {{ mode === 'register' ? '至少 8 位，建议混合字母、数字和符号。' : '请输入注册时设置的密码。' }} {{ errors.password }} 大写锁定已开启，请注意密码大小写。 再 | submit: submit | A | 声明忙碌态（需验证真源） | S/U；见批次范围 |
| 326 | input | 输入邮箱地址 | input: clearFieldError('email') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 330 | button | 忘记密码？ | click: changeMode('recovery') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 334 | input | 输入密码 | input: clearFieldError('password'); keydown: capsLock = Boolean($event.getModifierState?.('CapsLock')); keyup: capsLock = Boolean($event.getModifierState?.('CapsLock')); blur: capsLock = false | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 341 | input | input passwordVisible ? 'text' : 'password' | input: clearFieldError('confirmation') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 344 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 345 | ActionButton | {{ busy ? '正在处理…' : isEmailFlow && resendSeconds &gt; 0 ? resendSeconds + ' 秒后可发送' : mode === 'register' ? '创建账号' : mode === 'recovery' ? '发送重设 | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 346 | button | 返回登录 | click: changeMode('login') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 347 | ActionButton | {{ resendSeconds &gt; 0 ? resendSeconds + ' 秒后可重发' : '重新发送验证邮件' }} | action: () =&gt; resend() | A | 共享按钮 external | S/U；见批次范围 |

### src/components/ActionButton.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 88 | button | (busy &#124;&#124; phase !== 'idle') && name ? name : ariaLabel | click: activate | C | 声明忙碌态（需验证真源） | S/U；见批次范围 |
| 113 | ActionFeedback | ActionFeedback | retry: retry | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ActionFeedback.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | button | 重试 | click: $emit('retry') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ActionSheet.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 113 | div | {{ title }} {{ description }} {{ action.icon }} {{ action.label }} {{ action.hint }} 没有可执行的操作 {{ cancelLabel }} | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 128 | button | {{ action.icon }} {{ action.label }} {{ action.hint }} | click: choose(action) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 147 | button | {{ cancelLabel }} | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/AppearanceSettings.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 334 | Tabs | {{ item.label }} 个性化设置 {{ activeAppearanceTab.title }} {{ activeAppearanceTab.description }} {{ theme.name }} 自定义主题色 从壁纸自动提取主题色（开启后覆盖上方选择） 流 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 336 | TabsTrigger | {{ item.label }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 347 | button | {{ theme.name }} | click: chooseTheme(key, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 353 | input | input color | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 356 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 359 | select | 流畅优先模式 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 367 | select | 高对比度模式 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 373 | input | input radio | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 377 | button | {{ target.label }} | click: chooseTarget(key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 379 | button | 跟随全站 | click: setPageMode('inherit') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 379 | button | 单独设置 | click: setPageMode('own') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 379 | button | 此页关闭 | click: setPageMode('none') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 380 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 386 | input | input file | change: uploadImage | E | 就地编辑 / 校验 | S/U；见批次范围 |
| 387 | input | input file | change: uploadImage | E | 就地编辑 / 校验 | S/U；见批次范围 |
| 388 | button | {{ busy ? busyStage : (hasOwnImage ? '📷 更换照片' : '📷 上传照片') }} | click: showImageSheet = true | C | 声明忙碌态（需验证真源） | S/U；见批次范围 |
| 391 | button | 删除壁纸 | click: removeImage | D | 声明忙碌态（需验证真源） | S/U；见批次范围 |
| 394 | input | input range | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 395 | input | input range | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 396 | input | input range | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 397 | input | input range | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 398 | select | 居中 顶部 底部 靠左 靠右 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 399 | select | 智能适应（推荐） 始终铺满 始终完整显示 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 404 | button | 🖼 一键恢复全部壁纸 | click: resetAllWallpapers | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 406 | button | 🔄 一键恢复所有个性化 | click: resetAllAppearance | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 410 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 410 | input | 壁纸主题色 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 416 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 417 | textarea | 今天也要漂亮通关。 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 418 | select | 每天轮换 每次打开随机 固定一条 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 418 | select | {{ quote }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 419 | input | 例如：保持好奇，慢慢变强 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 420 | ActionButton | 保存文字 | action: quoteSaves.save | B | 共享按钮 本地反馈 | S/U；见批次范围 |
| 427 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 428 | button | `排序：${homeModuleLabel(module.id)}。可拖动，也可用 Alt 加上下方向键移动` | pointerdown: startModuleDrag(module.id, $event); keydown: onModuleDragKeydown($event, module.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 430 | button | 恢复默认顺序 | click: resetHomeModuleOrder | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 434 | AppearanceSwipeSettings | AppearanceSwipeSettings | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 437 | button | 打开导航编辑器 | click: emit('edit-navigation') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 448 | ActionSheet | 更换壁纸 | select: onImageSheetSelect; close: showImageSheet = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 460 | ConfirmDialog | 删除壁纸 | close: removeImageTarget = null; confirm: confirmRemoveImage | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 470 | ConfirmDialog | 恢复全部壁纸 | close: resetWallpapersTarget = false; confirm: confirmResetAllWallpapers | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 480 | ConfirmDialog | 恢复初始外观 | close: resetAppearanceTarget = false; confirm: confirmResetAllAppearance | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ConfirmDialog.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 45 | button | {{ cancelLabel }} | click: $emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 46 | button | {{ confirmLabel }} | click: $emit('confirm') | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ContextMenu.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 135 | button | {{ item.icon }} {{ item.label }} | click: choose(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/DataManager.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 135 | button | ↓ 备份与导出 | click: jumpToSection('backup') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 136 | button | ↑ 恢复数据 | click: jumpToSection('restore') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 137 | button | ↔ 账号同步 | click: jumpToSection('sync') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 140 | TaskProgress | TaskProgress | cancel: cancelBackup; retry: retryBackup; continue: continueBackupResult; wait: backupProgress.continueWaiting; dismiss: continueBackupResult | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 173 | button | 重新读取恢复点 | click: refreshRestoreCheckpoint | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 180 | button | 恢复到这个恢复点 | click: showCheckpointConfirm = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 196 | ConfirmDialog | 从备份恢复 | close: restoreBackupTarget = null; confirm: confirmRestoreBackup | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 205 | ConfirmDialog | 恢复本机恢复点 | close: showCheckpointConfirm = false; confirm: confirmRestoreCheckpoint | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/DomainCsvImportButton.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 89 | button | ⇧ 导入 CSV | click: openImport | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 94 | input | input file | change: readFile | E | 就地编辑 / 校验 | S/U；见批次范围 |
| 116 | button | 取消 | click: open = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 117 | ActionButton | 导入 {{ preview?.total &#124;&#124; '' }} 条 | click: confirmImport | A | 共享按钮 external | S/U；见批次范围 |

### src/components/EmptyState.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 28 | button | {{ secondaryLabel }} | click: emit('secondary') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 29 | button | {{ primaryLabel }} | click: emit('primary') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/FestiveSettings.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 210 | input | input checkbox | change: commit | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 223 | select | {{ item.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 231 | input | input date | change: setBirthday($event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 242 | input | input date | change: installDateInput = $event.target.value; commit() | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 255 | button | ＋ 添加纪念日 | click: addAnniversary | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 261 | input | `纪念日 ${row.label &#124;&#124; '未命名'} 的日期` | change: setAnniversaryDate(row.id, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 269 | input | '纪念日 ' + (row.label &#124;&#124; '第 ' + (index + 1) + ' 条') + ' 的名称' | input: setAnniversaryLabel(row.id, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 278 | button | `删除纪念日 ${row.label &#124;&#124; ''}` | click: removeAnniversary(row.id) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 287 | button | ＋ 添加农历纪念日 | click: addLunarAnniversary | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 293 | input | 农历纪念日名称 | input: setLunarLabel(row.id, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 302 | select | 农历月份 | change: setLunarMonth(row.id, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 305 | select | 农历日期 | change: setLunarDay(row.id, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 309 | input | input checkbox | change: setLunarLeap(row.id, $event.target.checked) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 316 | button | `删除农历纪念日 ${row.label &#124;&#124; ''}` | click: removeLunarAnniversary(row.id) | D | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/FocusPanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 517 | button | {{ active.pausedAt ? '继续' : '暂停' }} | click: active.pausedAt ? resume() : pause() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 520 | button | 结束 | click: requestEnd | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 529 | button | 记录做到哪里 | click: openTaskWorkSession(savedTodo) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 530 | button | {{ restRemainingSeconds &gt; 0 ? '结束休息' : '返回专注' }} | click: finishRest | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 539 | button | 记录做到哪里 | click: openTaskWorkSession(savedTodo) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 540 | button | 加入待办 | click: addTempTodo | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 542 | button | {{ linkedTodoDone ? '待办已完成' : '标记待办完成' }} | click: markTodoDone | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 545 | button | 再次专注 | click: againFocus | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 549 | button | 5 分钟 | click: startRest(5) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 550 | button | 10 分钟 | click: startRest(10) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 551 | button | 跳过 | click: closeCompletion | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 558 | input | 这次想专注什么 | input: onGoalInput; focus: showRecent = true; blur: scheduleHideRecent | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 569 | button | 取消待办关联 | click: clearTodo | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 570 | button | 从待办选择 | click: showTodoPicker = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 575 | button | {{ item }} | mousedown: ; click: useRecent(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 586 | button | `${mins} 分钟` | click: selectQuick(mins) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 599 | button | 自定义专注时长 | click: openCustomTime | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 602 | button | 开始专注 · {{ selectedMinutes }} 分钟 | click: start | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 607 | TaskWorkSession | TaskWorkSession | close: closeTaskWorkSession; save: saveTaskWorkProgress; update:field: updateWorkSessionField | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 614 | button | {{ task.title }} {{ task.dueDate ? (task.dueDate === getAppToday() ? '今天' : task.dueDate) : '无截止日期' }} | click: selectTodo(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 624 | input | 5～180 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 628 | button | 取消 | click: showCustomTime = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 629 | button | 使用 | click: applyCustomTime | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 639 | button | 放弃记录 | click: discardEarly | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 640 | button | 保存记录 | click: confirmEarlySave | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/FocusReturn.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 32 | button | ← 返回列表 | click: leaveFocus | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/FocusSettings.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 79 | input | 5-180 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 83 | button | 恢复默认 15/25/45/60 | click: draft.quickTimes = [...DEFAULT_FOCUS_SETTINGS.quickTimes] | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 89 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 97 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 98 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 99 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 104 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 105 | ActionButton | 保存设置 | action: save | B | 共享按钮 external | S/U；见批次范围 |

### src/components/HomeProductivityPanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 51 | button | 收起引导 | click: dismissGuide | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 55 | RouterLink | 添加课程 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 56 | RouterLink | 添加第一条待办 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/IcsImportButton.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 68 | input | 选择 ICS 日历文件 | change: readFile | E | 就地编辑 / 校验 | S/U；见批次范围 |
| 77 | ActionButton | {{ busy ? '正在读取…' : '导入 .ics' }} | click: fileInput?.click() | C | 共享按钮 external | S/U；见批次范围 |
| 97 | button | 取消 | click: closePreview | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 98 | button | 导入 {{ preview.events.length }} 条 | click: importEvents | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/MemoryView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 149 | button | {{ item.label }} | click: selectTab(item.key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 153 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 154 | input | input month | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 155 | select | 选择年份 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 159 | ActionButton | 复制 | action: () =&gt; onCopy() | B | 共享按钮 external | S/U；见批次范围 |
| 160 | ActionButton | 分享 | action: () =&gt; onShare() | A | 共享按钮 external | S/U；见批次范围 |

### src/components/Modal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 338 | div | {{ title }} {{ title }} {{ title }} {{ sheetState === 'expand' ? '收起' : '展开' }} ✕ | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 349 | div | div | pointerdown: onSheetPointerDown; pointermove: onSheetPointerMove; pointerup: onSheetPointerEnd; pointercancel: onSheetPointerCancel | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 363 | button | {{ sheetState === 'expand' ? '收起' : '展开' }} | click: toggleSheet | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 370 | button | 关闭弹窗 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/NavigationSettings.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 231 | div | 选择要编辑的导航 | keydown: onModeKeydown | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 232 | button | ▤ 手机导航 | click: changeMode('mobile') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 233 | button | ☷ 电脑侧栏 | click: changeMode('desktop') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 239 | button | 恢复默认 | click: editor.apply({ type: 'defaults' }) | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 244 | button | 载入最新布局 | click: editor.rebase(device) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 244 | button | 保留草稿并覆盖 | click: editor.rebase(device, true) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 255 | button | `调整${item.label}顺序` | pointerdown: startDrag($event, 'mobile', item.id); keydown: onOrderKeydown($event, 'mobile', item.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 257 | button | `将${item.label}上移` | click: reorderMobileItem(index, -1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 257 | button | `将${item.label}下移` | click: reorderMobileItem(index, 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 257 | button | `移除${item.label}` | click: editor.apply({ type: 'mobile:remove', id: item.id }) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 265 | input | `${group.label &#124;&#124; '未命名'}分组名称` | focus: renameBatch = `rename-${++editSequence}`; input: editor.apply({ type: 'desktop:rename-group', id: group.id, label: $event.target.value }, { batch: renameBatch }); blur: renameBatch = null | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 266 | button | `将${group.label}分组上移` | click: editor.apply({ type: 'desktop:move-group', id: group.id, to: groupIndex - 1 }) | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 266 | button | `将${group.label}分组下移` | click: editor.apply({ type: 'desktop:move-group', id: group.id, to: groupIndex + 1 }) | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 266 | button | `移除${group.label}分组` | click: requestRemoveGroup(group) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 270 | button | `调整${item.label}顺序` | pointerdown: startDrag($event, 'desktop', item.id, group.id); keydown: onOrderKeydown($event, 'desktop', item.id, group.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 272 | select | `将${item.label}移动到分组` | change: editor.apply({ type: 'desktop:move-item', id: item.id, groupId: $event.target.value }) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 273 | button | `将${item.label}上移` | click: reorderDesktopItem(group, itemIndex, -1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 273 | button | `将${item.label}下移` | click: reorderDesktopItem(group, itemIndex, 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 273 | button | `取消固定${item.label}` | click: editor.apply({ type: 'desktop:unpin', id: item.id }) | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 278 | form | 新建分组 添加分组 | submit: addGroup | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 278 | input | 例如：我的常用 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 278 | button | 添加分组 | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 284 | NavigationFeaturePicker | NavigationFeaturePicker | pin: pin; open: requestClose | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 294 | button | 撤销上一步 | click: editor.undo() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 294 | button | 重做上一步 | click: editor.redo() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 294 | ActionButton | {{ dirty.mobile && dirty.desktop ? '保存两端修改' : '保存导航' }} | action: saveNavigation | A | 共享按钮 本地反馈 | S/U；见批次范围 |
| 303 | button | 继续编辑 | click: pendingDeparture = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 303 | button | 放弃修改 | click: discardAndLeave | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 303 | ActionButton | 保存并离开 | action: saveAndLeave | B | 共享按钮 external | S/U；见批次范围 |
| 308 | select | 移除分组后页面的目标分组 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 309 | button | 取消 | click: pendingGroupRemoval = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 309 | button | 移动页面并移除分组 | click: removeGroup | D | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/NotFoundView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | router-link | 返回首页 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/NoticePaste.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | NoticeUnderstanding | NoticeUnderstanding | close: emit('close'); commit: emit('commit', $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/NoticeUnderstanding.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 447 | textarea | 粘贴原通知 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 451 | select | 考试安排 作业 / 实验分组表 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 452 | input | input file | change: readOcrImage | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 459 | button | {{ listening ? '停止聆听' : '语音输入' }} | click: toggleVoice | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 462 | button | 返回理解结果 | click: editingSource = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 462 | button | {{ parsed ? '重新解析' : '分析通知' }} | click: analyze | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 471 | button | {{ selectedSegments.length === segments.length ? '取消全选' : '全选' }} | click: toggleAllSegments | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 475 | button | {{ selectedSegmentIds.includes(row.id) ? '✓' : '' }} {{ row.title }} {{ row.parsed.dateText &#124;&#124; row.parsed.dueDate &#124;&#124; '时间未识别' }} {{ row.parse | click: toggleSegment(row.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 480 | select | `第 ${row.index + 1} 条通知的处理方式` | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 483 | summary | 查看完整原文 ▾ | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 483 | button | 编辑原文并重新识别 | click: editingSource = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 489 | button | {{ option.icon }} {{ option.label }} | click: setType(option.value) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 492 | button | 修改 | click: beginActionEdit | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 492 | input | 你需要做什么 | blur: finishActionEdit; keydown: finishActionEdit | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 493 | button | {{ fact.label }} {{ factText(fact) }} ✎ | click: editField(fact.key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 493 | input | fact.label | blur: editingField = ''; keydown: editingField = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 497 | button | {{ selectedItemIds.length === parsed.items.length ? '取消全选' : '全选' }} | click: selectedItemIds = selectedItemIds.length === parsed.items.length ? [] : parsed.items.map((item) =&gt; item.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 497 | button | {{ selectedItemIds.includes(item.id) ? '✓' : '' }} {{ item.title }} {{ item.dateRange &#124;&#124; dateText(item.dueDate) &#124;&#124; '时间未识别' }} {{ item.dueTim | click: toggleItem(item.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 499 | button | {{ showProcessOptions ? '收起其他方式' : '更改处理方式' }} ⌄ | click: showProcessOptions = !showProcessOptions | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 499 | input | input radio | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 501 | input | input radio | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 501 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 503 | summary | 更多信息 {{ showMore ? '收起' : '展开' }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 503 | button | 🔔 提醒： {{ parsed.reminder }} | click: editField('reminder') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 503 | button | 优先级： {{ parsed.priority === 'high' ? '高' : '低' }} | click: editField('priority') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 503 | button | 备注： {{ parsed.note }} | click: editField('note') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 503 | button | ＋ {{ item.label }} | click: editField(item.key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 503 | textarea | textarea | blur: editingField = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 503 | input | input extraFields.find((item) =&gt; item.key === editingField)?.type &#124;&#124; 'text' | blur: editingField = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 504 | summary | 查看原通知 ▾ | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 504 | button | {{ copied ? '已复制' : '复制' }} | click: copyRaw | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 504 | button | 编辑原通知 | click: editingSource = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 504 | button | 重新解析 | click: editingSource = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 508 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 508 | button | {{ actionLabel }} | click: save | B | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/PromptDialog.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 89 | Input | label ? undefined : title | update:model-value: draft = String($event); emit('input', draft); keydown: onEnter | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 108 | Button | {{ cancelLabel }} | click: $emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 109 | Button | {{ confirmLabel }} | click: submit | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/QuickRecordPanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 90 | textarea | 快速记录内容 | input: onSmartInput; compositionend: onSmartInput; keydown: onSmartKeydown; keydown: onSmartKeydown; keydown: onSmartKeydown | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 107 | button | listening ? '停止语音' : '语音输入' | click: toggleVoice | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 119 | button | {{ clipboardLoading ? '读取中…' : '粘贴文字' }} | click: pasteClipboard | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 120 | button | 清空 | click: clearEntry | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 125 | button | ✨ 自动识别 | click: chooseAuto | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 126 | button | {{ action.icon }} {{ action.label }} | click: chooseAction(action.type) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 131 | button | {{ text.replace(/\n/g, ' / ') }} ↗ | click: useExample(text) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 137 | button | 智能识别 | click: useClipboard | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 142 | button | {{ recentIcon(item.type) }} {{ recentTitle(item) }} {{ item.detail }} | click: reuseRecent(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 152 | button | 全选 | click: setAllSelected(true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 152 | button | 取消全选 | click: setAllSelected(false) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 157 | input | `选择第 ${index + 1} 项记录` | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 159 | button | {{ expandedId === draft.id ? '收起' : '修改' }} | click: expandedId = expandedId === draft.id ? '' : draft.id | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 160 | button | `移除第 ${index + 1} 项草稿` | click: removeDraft(draft) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 166 | button | {{ recordTypeMeta(type).label }} | click: changeDraftType(draft, type) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 175 | button | {{ recordTypeMeta(type).icon }} 按 {{ recordTypeMeta(type).label }} 解析 | click: retryAs(draft, type) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 181 | input | 记录标题 | input: onDraftTitleChange(draft) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 185 | input | 金额 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 188 | button | {{ catInfo(draft.category).icon }} {{ categoryLabel(draft.category) }} | click: toggleCategoryEditor(draft, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 190 | button | {{ category.icon }} {{ category.name }} | click: chooseCategory(draft, category) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 194 | input | 日期 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 195 | button | {{ ['event', 'countdown', 'bill'].includes(draft.type) ? '补充日期' : '添加日期' }} | click: expandedId = draft.id | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 196 | input | 时间 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 207 | button | {{ choice }} | click: chooseQuestion(draft, question.field, choice) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 216 | button | 确认分类 | click: confirmCategory(draft) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 216 | button | 选择其它分类 | click: expandedId = draft.id | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 220 | select | 待办 作业 日程 支出 收入 固定账单 重要日期 | change: onDraftTypeSelect(draft, $event) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 229 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 230 | input | input time | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 231 | input | input time | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 232 | input | 例如：教学楼 201 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 233 | input | input | input: syncDraftCourse(draft) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 234 | select | {{ category.icon }} {{ category.name }} | change: confirmCategory(draft) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 235 | input | 例如：微信 / 现金 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 236 | select | 普通 重要 较低 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 237 | select | 每周 每月 每季度 每年 仅一次 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 238 | textarea | textarea | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 249 | button | 撤销刚才保存 | click: undoLastSaved | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 251 | ActionButton | {{ saveLabel }} | action: () =&gt; saveAll(false) | B | 共享按钮 external | S/U；见批次范围 |
| 252 | ActionButton | 保存并继续 | action: () =&gt; saveAll(true) | B | 共享按钮 external | S/U；见批次范围 |

### src/components/QuickRecordSettings.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 25 | select | {{ item.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 26 | input | 例如：微信 / 现金 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 28 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 29 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 30 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |

### src/components/ReleaseNotesBrowser.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 48 | summary | {{ group.version }} {{ group.notes.length }} 项更新 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 53 | button | 关闭 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/RouteFallback.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | button | 重新加载 | click: retry | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/SearchPanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 323 | input | 搜索待办、日程、账单、课程… | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 329 | button | {{ chipLabel(item) }} | click: typeFilter = item.key | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 345 | button | {{ part.text }} {{ part.text }} {{ result.meta }} · {{ result.archived ? '已归档/完成' : group.label }} | click: navigate(result) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/Sidebar.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 418 | button | collapsed ? group.label : undefined | click: toggleNavigationGroup(group.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 420 | router-link | collapsed ? item.label : undefined | pointerenter: warmRoute(item.path); pointerdown: warmRoute(item.path); focus: warmRoute(item.path) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 440 | router-link | item.mobileLabel &#124;&#124; item.label | pointerdown: warmRoute(item.path) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 450 | button | 快速记录 | pointerenter: warmTool('capture'); pointerdown: warmTool('capture'); focus: warmTool('capture'); click: openMobileTool('capture') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 453 | button | ⋯ 更多 | click: showMobileMore = !showMobileMore | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 464 | div | div | click: closeMobileMore(true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 468 | section | 更多功能 | pointerdown: onDrawerPointerDown; pointermove: onDrawerPointerMove; pointerup: onDrawerPointerEnd; pointercancel: onDrawerPointerCancel | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 481 | button | 关闭更多功能 | click: closeMobileMore(true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 485 | router-link | {{ item.icon }} {{ item.label }} | click: closeMobileMore(); pointerdown: warmRoute(item.path) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 488 | button | {{ item.icon }} {{ item.key === 'account' ? accountLabel : item.label }} {{ accountUser ? '已登录' : '未登录' }} | click: openMobileTool(item.key); pointerdown: warmTool(item.key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 496 | button | collapsed ? '展开侧边栏' : '收起侧边栏' | click: collapsed = !collapsed | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 509 | button | `${accountLabel}${accountUser ? '，已登录' : '，未登录'}` | pointerenter: warmTool('account'); focus: warmTool('account'); click: accountOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 513 | button | 🔍 搜索 | pointerenter: warmTool('search'); focus: warmTool('search'); click: showSearch = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 518 | button | 🎨 个性化 | pointerenter: warmTool('appearance'); focus: warmTool('appearance'); click: showAppearance = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 522 | button | 编辑导航 | pointerenter: warmTool('navigation'); focus: warmTool('navigation'); click: openNavigationSettings | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 523 | button | 快速记录 | click: emit('open-quick-record') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 536 | button | 🎉 氛围与纪念日 | pointerenter: warmTool('festive'); focus: warmTool('festive'); click: showFestiveSettings = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 540 | button | 💾 数据管理 | pointerenter: warmTool('data'); focus: warmTool('data'); click: openDataManager | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 544 | button | ⚡ 快速记录设置 | click: showQuickRecordSettings = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 547 | button | ⏱ 专注设置 | pointerenter: warmTool('focus'); focus: warmTool('focus'); click: showFocusSettings = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 550 | button | ↻ 版本与更新 | pointerenter: warmTool('update'); focus: warmTool('update'); click: showVersionUpdate = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 558 | button | `${theme.name}主题` | click: chooseTheme(key, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 580 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/SocialCalendarEvents.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 87 | router-link | 管理邀约 → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 90 | router-link | 打开一起约 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/SwipeActionItem.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 195 | button | action.ariaLabel &#124;&#124; action.label | click: onAction(action) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 207 | button | action.ariaLabel &#124;&#124; action.label | click: onAction(action) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 218 | div | div | pointerdown: onPointerDown; pointermove: onPointerMove; pointerup: onPointerEnd; pointercancel: resetGesture(); click: onClickCapture | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/SwipeActionSelector.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 39 | select | {{ optionIcons[option.id] &#124;&#124; '' }} {{ option.label }} | change: emit('update:modelValue', $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |

### src/components/TaskCenter.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 90 | button | {{ pillLabel }} {{ unseenResultCount }} | click: open = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 119 | ActionButton | 取消 | action: () =&gt; onCancel(task) | E | 共享按钮 external | S/U；见批次范围 |
| 132 | button | 清空 | click: clearTaskResults | D | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/TaskProgress.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 79 | button | 继续等待 | click: $emit('wait') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 80 | button | 取消任务 | click: $emit('cancel') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 81 | button | 重试当前步骤 | click: $emit('retry') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 82 | button | 使用当前结果 | click: $emit('continue') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 83 | button | 收起进度 | click: $emit('dismiss') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/TimeWheelSheet.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 67 | WheelPicker | WheelPicker | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 72 | WheelPicker | WheelPicker | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 81 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 82 | button | 清除时间 | click: clear | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 83 | button | 确定 | click: confirm | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/Toast.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 93 | button | {{ actionLabel }} | click: doAction | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 94 | button | {{ actionLabel }} | click: doAction | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 96 | button | 关闭 | click: hide | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/TodayActionList.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | Button | 查看待办 → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 24 | RouterLink | 查看待办 → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 30 | Button | {{ actionLabel(item) }} | click: emit('activate', item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 43 | Button | {{ actionLabel(item) }} | click: emit('activate', item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/TodayAgenda.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 91 | RouterLink | 查看课表 → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 96 | RouterLink | {{ item.timeLabel }} {{ item.title }} {{ item.meta }} {{ item.kindLabel }} 进行中 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 112 | RouterLink | 查看课表 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 113 | RouterLink | 管理日程 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/UpdateNotes.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 29 | button | 知道了 | click: acknowledge | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/WheelPicker.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 118 | div | label &#124;&#124; '滚轮选择' | scroll: onScroll; keydown: onKeydown | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/account/AccountPasswordForm.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 74 | form | 当前密码 {{ errors.currentPassword }} 新密码 至少 8 位，建议使用较长的密码并混合字母、数字和符号。 {{ errors.password }} 再次输入新密码 {{ errors.confirmation }} 显示密码 {{ error }}  | submit: submit | A | 声明忙碌态（需验证真源） | S/U；见批次范围 |
| 77 | input | input visible ? 'text' : 'password' | input: edit('currentPassword') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 82 | input | input visible ? 'text' : 'password' | input: edit('password') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 88 | input | input visible ? 'text' : 'password' | input: edit('confirmation') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 91 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 93 | ActionButton | {{ submitting ? '正在保存…' : '保存新密码' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 94 | button | {{ resetSeconds &gt; 0 ? resetSeconds + ' 秒后可重发邮件' : '忘记当前密码？通过邮箱重设' }} | click: emit('reset-request') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/account/AccountSessionActions.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 28 | button | 导出备份 | click: emit('backup') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 32 | button | 退出当前设备 | click: scope = 'local' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 33 | button | 退出所有设备 | click: scope = 'global' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 35 | ConfirmDialog | scope === 'global' ? '退出所有设备？' : '退出当前设备？' | close: scope = ''; confirm: confirmSignOut | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/courses/CourseActivityItem.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 14 | RouterLink | {{ row.title }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/courses/CourseTaskItem.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | button | `完成待办：${row.task.title}` | click: emit('complete', row.task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 19 | RouterLink | {{ row.task.title }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 23 | button | {{ row.task.sourceType === 'project-task' ? '打开项目任务 →' : row.task.workCheckpoint &#124;&#124; row.task.status === 'in_progress' ? '继续这项任务 →' : '开始这项任务 | click: emit('work', row.task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/data/AccountSyncPanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 97 | button | 通过账号自动同步 | click: toggleAccountSync | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 105 | ActionButton | {{ busy ? '正在同步…' : accountSyncPreparationError ? '重试账号同步' : '立即同步' }} | action: () =&gt; synchronize() | E | 共享按钮 external | S/U；见批次范围 |
| 111 | input | input radio | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 111 | input | input radio | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 113 | ActionButton | {{ submitting ? '正在确认…' : '确认并继续同步' }} | action: () =&gt; submitChoices() | A | 共享按钮 external | S/U；见批次范围 |
| 116 | button | 注册 / 登录 | click: accountOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/data/AppUpdateSection.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 140 | Button | ui.actionLabel | click: primaryAction | C | 声明忙碌态（需验证真源） | S/U；见批次范围 |
| 148 | Button | 取消下载 | click: cancelDesktopAppUpdate | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 152 | summary | 本次更新内容 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 157 | summary | 动画效果 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 159 | Button | {{ option.label }} | click: performanceMode = option.value | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 167 | summary | 更新来源与诊断 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 177 | Button | 重新检查 | click: checkAgain | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 178 | Button | 复制诊断信息 | click: copyDiagnostic | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 179 | Button | 修复更新缓存 | click: forceRecoverToLatest | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 184 | textarea | 更新诊断信息 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 189 | Button | 查看更新记录 | pointerenter: warmReleaseNotes; focus: warmReleaseNotes; click: notesOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/data/BackupSection.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 12 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 13 | button | {{ exporting ? '正在生成备份…' : '导出完整备份' }} | click: exportBackup | E | 声明忙碌态（需验证真源） | S/U；见批次范围 |

### src/components/data/DataOverview.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | button | 刷新 | click: $emit('refresh') | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 32 | summary | 查看各分区的数据量 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/data/RestorePreview.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | button | 取消选择 | click: clearSelectedBackup | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 18 | button | 全选 | click: selectAll | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 18 | button | 清空选择 | click: restoreSelection = [] | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 20 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 21 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 25 | button | 恢复所选 {{ restoreSelection.length }} 个分区 | click: restoreBackup | E | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/data/RestoreSection.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | input | 选择要恢复的备份文件 | change: selectFile | E | 声明忙碌态（需验证真源） | S/U；见批次范围 |

### src/components/events/EventCalendar.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 48 | button | 上个月 | click: moveMonth(-1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 49 | button | 今天 | click: resetToday | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 50 | button | 下个月 | click: moveMonth(1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 53 | input | input month | change: $emit('month', $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 56 | button | `${formatAppDate(day.date)}，${day.events.length ? `${day.events.length} 条日程` : '没有日程'}` | click: select(day.date); keydown: navigate($event, day.date) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/learning/LearningNavigation.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | summary | 学习功能 · {{ pages.find(page =&gt; page.id === current)?.label }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 21 | Button | {{ page.label }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 22 | RouterLink | {{ page.label }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/learning/StudyPlanner.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 76 | RouterLink | 打开课表 → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 78 | button | 今天 | click: chosenDate = '' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 79 | button | 明天 | click: chosenDate = addAppDays(appToday, 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 80 | input | 学习计划日期 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 85 | button | 撤销 | click: undo | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 93 | RouterLink | {{ item.taskTitle }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 94 | button | `安排${item.taskTitle}到${item.startTime}` | click: addBlock(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 105 | RouterLink | {{ block.task?.title &#124;&#124; block.event.title }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 106 | button | `撤回学习时段：${block.event.title}` | click: removeBlock(block) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 109 | button | {{ expanded ? '收起' : `查看全部 ${plan.blocks.length} 个时段` }} | click: expanded = !expanded | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 117 | RouterLink | {{ item.name }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 118 | button | `开始复习：${item.name}` | click: startReview(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/learning/TaskFocusLink.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | RouterLink | `为${task.title}准备${minutes}分钟专注` | click: $emit('navigate') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/navigation/NavigationFeaturePicker.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 37 | input | 搜索可用功能 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 38 | select | 筛选可用功能 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 40 | select | 添加功能的目标分组 | change: emit('update:targetGroup', $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 48 | button | `打开${item.label}` | click: emit('open', item.path) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 49 | button | `${pinned.has(item.id) ? '已添加' : '添加'}${item.label}` | click: emit('pin', item.id) | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/navigation/NavigationPreview.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | button | {{ collapsed ? '展开文字' : '仅看图标' }} | click: collapsed = !collapsed | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/projects/ProjectDraftRecovery.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | button | {{ busy ? '读取中…' : '查看最新草稿' }} | click: emit('load') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 12 | summary | 最新已保存草稿 · 第 {{ latest.revision }} 版 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 18 | button | 使用最新草稿，丢弃本次修改 | click: emit('resolve', false) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 19 | button | 保留本次修改，继续编辑 | click: emit('resolve', true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/projects/ProjectTaskOverview.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 13 | button | {{ summary.open }} 未完成 | click: emit('filter', { status: 'open', assignee: 'all' }) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 14 | button | {{ summary.mine }} 我的任务 | click: emit('filter', { status: 'open', assignee: 'mine' }) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 15 | button | {{ summary.review }} 待验收 | click: emit('filter', { status: 'review', assignee: 'all' }) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 16 | button | {{ summary.overdue }} 已逾期 | click: emit('filter', { status: 'overdue', assignee: 'all' }) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 17 | button | {{ summary.unassigned }} 待分配 | click: emit('filter', { status: 'open', assignee: 'unassigned' }) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/projects/ProjectTaskWorkProgress.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | a | {{ url }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/BatchImportModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 248 | textarea | 批量录入课程文本 | input: onTextInput; paste: onTextPaste; keydown: ; click:  | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 261 | input | input file | change: onFileChange | E | 就地编辑 / 校验 | S/U；见批次范围 |
| 266 | input | input file | change: onCropFileChange | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 270 | input | input file | change: onExcelFileChange | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 279 | TaskProgress | TaskProgress | cancel: emit('cancel-progress'); retry: emit('retry-progress'); continue: emit('continue-progress'); wait: emit('wait-progress') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 302 | button | 直接修改 | click: startReviewEdit(row) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 306 | input | input | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 307 | select | {{ day }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 308 | select | 第 {{ period.number }} 节 · {{ period.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 309 | select | 第 {{ period.number }} 节 · {{ period.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 310 | select | 第 {{ week }} 周 | change: onStartWeekChange | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 311 | select | 第 {{ week }} 周 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 312 | select | 每周 单周 双周 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 313 | input | input | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 314 | input | input | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 317 | button | 取消 | click: editingSourceIndex = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 318 | button | 保存并重新校验 | click: saveReviewEdit | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 405 | button | 撤销本次导入 | click: emit('undo') | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 406 | button | 继续录入 | click: emit('continue-import') | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 407 | button | 完成并查看课表 | click: emit('finish-import') | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 411 | button | 清空 | click: emit('clear') | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 412 | button | 导入 {{ validCount }} 门课程 | click: emit('import') | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/CourseEditorModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 148 | RouterLink | 查看课程进度 → | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 150 | RouterLink | {{ task.title }} | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 150 | RouterLink | ＋ 课程待办 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 150 | button | 添加作业 | click: emit('add-homework') | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 151 | RouterLink | {{ item.name }} | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 151 | RouterLink | ＋ 记录考试或重要日期 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 155 | input | 例如：高等数学 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 165 | input | 选填 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 168 | input | 例如：教学楼 A201 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 171 | select | 跟随当前校区 {{ campus.name }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 172 | input | 选填 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 176 | select | {{ day }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 177 | select | {{ periodOption(period.id) }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 178 | select | {{ periodOption(period.id) }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 182 | select | 第 {{ week }} 周 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 183 | select | 第 {{ week }} 周 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 184 | select | 每周上 单周上 双周上 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 198 | button | `标记颜色 ${colorName(color)}` | click: draft.color = color | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 200 | button | {{ isArchived(editingCourse) ? '恢复课程' : '归档课程' }} | click: emit('archive', editingCourse) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 200 | button | 删除课程 | click: requestDelete | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 200 | button | 保存 | click: save | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 201 | button | ＋ 在此格添加另一门课 | click: emit('add-another') | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/CourseManagerModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 61 | button | {{ selectedIds.length === courses.length ? '取消全选' : '全选' }} | click: emit('toggle-all') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 62 | button | 创建副本 | click: emit('duplicate') | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 63 | button | 删除选中 | click: emit('delete-selected') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 74 | input | `选择课程 ${course.name}` | change: emit('toggle-course', course.id) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 81 | button | 清空全部课程 | click: emit('clear') | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 86 | input | 学期课表模板名称 | input: emit('update:template-name', $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 86 | button | 保存当前课表 | click: emit('save-template') | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 88 | button | 导入 | click: emit('import-template', template) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 88 | button | 删除模板 | click: emit('delete-template', template) | D | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/ExceptionsModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 385 | form | {{ editingId ? '编辑安排' : '添加安排' }} 正在编辑已有安排 {{ tab.label }} {{ typeHint }} {{ dateFieldLabel }} {{ dateHint }} 结束日期 只停一天时，与开始日期相同 采用哪一周的课表 跟随 | submit: submit | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 387 | div | 安排类型 | keydown: onTypeTabKeydown | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 388 | button | {{ tab.label }} | click: selectType(tab.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 396 | input | input date | input: onDateInput | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 400 | input | input date | input: clearFeedback | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 405 | select | 跟随当天（ {{ weekTextFor(form.date) }} ） 第 {{ week }} 周 | change: clearFeedback | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 412 | select | {{ day }} | change: clearFeedback | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 425 | input | 搜索可选课程 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 427 | button | {{ search.trim() ? '选择搜索结果' : '全选' }} | click: selectVisibleCourses | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 428 | button | 清空选择 | click: clearSelection | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 432 | input | input checkbox | change: toggleCourse(course.id) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 447 | select | `${courseNameOf(slot.courseId)}补课开始节次` | change: setSlotStart(slot, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 454 | select | `${courseNameOf(slot.courseId)}补课结束节次` | change: clearFeedback | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 467 | input | 例如：假期安排、教师调课通知 | input: clearFeedback | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 471 | button | 取消编辑 | click: resetForm | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 472 | button | {{ editingId ? '保存修改' : '添加安排' }} | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 479 | select | 筛选已保存安排 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 483 | button | 撤销删除 | click: undoRemove | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 494 | button | `编辑 ${dateText(item)} 的${typeLabel(item.type)}安排` | click: startEdit(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 495 | button | `删除 ${dateText(item)} 的${typeLabel(item.type)}安排` | click: removeItem(item) | D | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/ImageCropModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 149 | div | 课表裁切区域 | pointerdown: begin; pointermove: move; pointerup: end; pointercancel: end; keydown: onStageKeydown | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 165 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 165 | ActionButton | 裁切并识别 | action: confirm | E | 共享按钮 external | S/U；见批次范围 |

### src/components/schedule/ImportConflictModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 83 | button | 一键替换 {{ summary.conflicts }} 门冲突项 | click: emit('decisions', 'replace') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 84 | button | 全部保留两门 | click: emit('decisions', 'keep') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 85 | button | 全部跳过冲突项 | click: emit('decisions', 'skip') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 95 | select | `${item.course.name} 的处理方式` | change: emit('decision', item.index, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 105 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 106 | button | 确认导入 | click: emit('commit') | A | 声明忙碌态（需验证真源） | S/U；见批次范围 |
| 110 | button | 替换当前整张课表 | click: emit('replace-all') | C | 声明忙碌态（需验证真源） | S/U；见批次范围 |

### src/components/schedule/RecognitionSchemeDetailModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 51 | button | {{ campus.name }} | click: pickSchemeCampus(activeScheme, campus.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 57 | button | 导入为新校区 | click: startNewCampus(activeScheme) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 66 | input | 新校区名 | input: updateSchemeTarget(activeScheme, { newCampusName: $event.target.value }) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 77 | button | {{ season.name }} | click: pickSchemeSeason(activeScheme, season.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 83 | button | 导入为新作息方案 | click: startNewSeason(activeScheme) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 92 | input | 新方案名 | input: updateSchemeTarget(activeScheme, { newSeasonName: $event.target.value }) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 112 | button | 全部 {{ activeScheme.rows.length }} | click: detailFilter = 'all' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 113 | button | 异常 {{ activeSchemeIssueCount }} | click: detailFilter = 'issues' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 126 | input | 节次名称 | input: onSchemeRowInput(row) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 127 | input | 开始时间 | input: onSchemeRowInput(row) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 129 | input | 结束时间 | input: onSchemeRowInput(row) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 130 | button | 删除该行 | click: removeSchemeRow(activeScheme, index) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 134 | button | 确认无误 | click: row.confirmed = true | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 143 | button | ＋ 加一行 | click: addSchemeRow(activeScheme) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 148 | button | 返回总览 | click: closeSchemeDetail | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 149 | button | 仅导入这一组 | click: closeSchemeDetail(); openImportPlan(activeScheme.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/ScheduleGrid.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 268 | Button | 前一天 | click: emit('mobile-day-change', -1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 273 | button | `管理 ${mobileDate} 的课程调整：${exceptionLabel(viewExceptions[mobileDay])}` | click: emit('open-adjustments', mobileDate) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 275 | Button | 后一天 | click: emit('mobile-day-change', 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 289 | Button | 清除搜索 | click: emit('clear-search') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 290 | Button | 添加课程 | click: openAdd(mobileDay, timeConfig.periods[0]?.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 293 | button | {{ courseTimeRange(course) &#124;&#124; coursePeriodText(course) }} {{ course.name }} 补课 {{ course.room &#124;&#124; '未设置地点' }} · {{ course.teacher }} {{ course | click: openEdit(course) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 320 | button | 清除搜索 | click: emit('clear-search') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 333 | button | `管理 ${viewDates[i]} 的课程调整：${exceptionLabel(viewExceptions[i])}` | click: emit('open-adjustments', viewDates[i]) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 344 | div | cellLabel(i, row) | click: onCellClick(i, row); keydown: onCellKeydown($event, i, ri) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 365 | div | {{ c.name }} 补课 · {{ coursePeriodText(c) }} {{ courseProgress[c.id].overdue ? `${courseProgress[c.id].overdue} 项逾期` : `${courseProgress[c.id | keydown: openEdit(c); keydown: openEdit(c); click: openEdit(c) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/ScheduleNote.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | textarea | 课程表备注 | input: resize | C | 就地编辑 / 校验 | S/U；见批次范围 |

### src/components/schedule/SemesterModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 32 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 42 | button | 保存 | click: save | B | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/TimeBaseSettings.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 185 | input | `校区名称：${campus.name}` | change: renameCampus(campus.id, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 190 | button | 删除校区 | click: onRemoveCampus(campus.id) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 199 | input | 新校区名称 | keyup: onAddCampus | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 200 | button | ＋ 添加 | click: onAddCampus | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 214 | input | `作息季名称：${season.name}` | change: renameSeason(season.id, $event.target.value, null) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 220 | input | `作息季生效日期（MM-DD）：${season.name}` | blur: onSeasonDateChange(season, $event.target.value, $event.target) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 228 | button | 删除作息季 | click: onRemoveSeason(season.id) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 241 | button | {{ campus.name }} | click: toggleSeasonCampus(season, campus.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 252 | input | 新作息季名称 | keyup: onAddSeason | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 253 | input | 新作息季生效日期（MM-DD） | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 254 | button | ＋ 添加 | click: onAddSeason | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 265 | input | `节次名称：${period.label}` | change: renamePeriod(period.id, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 273 | button | 删除节次 | click: onRemovePeriod(period.id) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 283 | input | 新节次名称 | keyup: onAddPeriod | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 284 | button | ＋ 添加 | click: onAddPeriod | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 288 | ConfirmDialog | 删除校区 | close: removeCampusTarget = null; confirm: confirmRemoveCampus | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 298 | ConfirmDialog | 删除作息季 | close: removeSeasonTarget = null; confirm: confirmRemoveSeason | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/TimeGeneratePanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 26 | button | ⚡ 快速生成时间（辅助填充） {{ genPreview ? '▴' : '▾' }} | click: toggleGenPreview | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 36 | select | {{ p.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 42 | input | input time | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 47 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 52 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 57 | select | {{ p.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 61 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 66 | select | {{ p.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 70 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 74 | button | {{ genPreview ? '收起预览' : '生成预览' }} | click: toggleGenPreview | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 86 | button | 取消 | click: genPreview = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 87 | button | 填充空白节次 | click: applyGenerate('fill') | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 88 | button | 覆盖当前方案 | click: applyGenerate('all') | D | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/TimeImportPlanModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 68 | button | 返回计划列表 | click: closeImportPlan | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 69 | button | 重试导入 | click: confirmImportPlan | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 90 | select | `${item.label} 的处理方式` | change: setPlanItemAction(item, $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 99 | button | {{ planDiffExpanded[item.schemeId] ? '收起变化' : '查看变化' }} | click: togglePlanDiff(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 122 | button | 去处理 | click: editFromPlan(item.schemeId) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 129 | button | 取消 | click: closeImportPlan | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 130 | button | 确认并导入（ {{ importPlan.summary.replace + importPlan.summary.create }} 组） | click: confirmImportPlan | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/schedule/TimeSettingsModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 233 | div | 设置分区 | keydown: onSettingsTabKeydown | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 240 | button | {{ tabLabel('plans') }} | click: switchSettingsTab('plans') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 250 | button | {{ tabLabel('base') }} | click: switchSettingsTab('base') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 275 | TaskProgress | TaskProgress | cancel: scheduleOcrProgress.cancel; retry: retryScheduleOCR; continue: continueScheduleResults; wait: scheduleOcrProgress.continueWaiting | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 297 | button | {{ campus.name }} | click: switchPlan(planSeasonId, campus.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 308 | button | {{ season.name }} | click: switchPlan(season.id, planCampusId) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 324 | button | ＋ 新建 / 导入 | click: toggleImport | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 325 | button | ⧉ 复制已有方案 | click: toggleCopy | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 326 | button | ± 批量调整 | click: openTimeShift | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 327 | button | ↺ 恢复默认 | click: onResetTimes | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 333 | button | 撤销本次导入 | click: undoLastImport | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 340 | button | {{ plan.seasonName }} · {{ plan.campusName }} | click: copyFrom(plan.season, plan.campus) | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 353 | select | 批量调整起始节次 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 357 | select | 批量调整结束节次 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 360 | select | 批量调整偏移量 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 371 | input | 批量调整自定义分钟数 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 387 | button | 应用 {{ batchPreview.rows.length }} 行 | click: applyBatch | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 398 | div | 作息导入方式 | keydown: onImportTabKeydown | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 399 | button | 📋 粘贴时间表 | click: importTab = 'paste' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 400 | button | 📷 从图片识别 | click: importTab = 'image' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 404 | textarea | 粘贴作息时间 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 411 | ActionButton | 解析预览 | action: () =&gt; runParsePaste() | E | 共享按钮 external | S/U；见批次范围 |
| 418 | input | input file | change: onImportImage | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 421 | button | 使用精准模式重新识别 | click: retryScheduleAccurate | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 430 | button | 放弃识别 | click: discardRecognition | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 446 | input | input checkbox | change: toggleSchemeSelected(scheme) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 448 | div | {{ schemeDisplayName(scheme, timeConfig) }} · {{ scheme.rows.length }} 节 {{ schemeStatusBadge(scheme).icon }} {{ schemeStatusBadge(scheme).t | click: openSchemeDetail(scheme.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 455 | button | 查看 / 编辑 | click: openSchemeDetail(scheme.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 460 | button | 放弃 | click: discardRecognition | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 461 | button | 仅导入当前组 | click: openImportPlan(activeSchemeForQuick.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 462 | button | 导入选中的 {{ selectedSchemeCount }} 组作息 | click: openImportPlan() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 481 | input | `${row.period.label} 开始时间` | input: markDirty | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 488 | input | `${row.period.label} 结束时间` | input: markDirty | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 510 | button | 放弃修改 | click: discardDraft | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 511 | button | 恢复默认时间 | click: onResetTimes | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 512 | ActionButton | {{ draftDirty ? '保存' : '完成' }} | action: saveDraftWithFeedback | B | 共享按钮 本地反馈 | S/U；见批次范围 |
| 529 | ConfirmDialog | 放弃未保存的修改 | close: cancelPendingDraft; confirm: confirmDiscardDraft | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 543 | ConfirmDialog | 恢复默认作息时间 | close: resetTimesTarget = false; confirm: applyResetTimes | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/task-views/TaskBoard.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 112 | div | {{ column.label }} {{ listOf(column.key).length }} 这一列还没有待办 {{ task.title }} {{ courseNameOf(task) }} {{ repeatLabelOf(task) }} {{ dueInfoOf | keydown: onKeydown | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 146 | button | `打开待办「${task.title}」的详情` | click: emit('open', task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 162 | button | `将待办「${task.title}」标记为进行中` | click: setTaskStatus(task, 'in_progress') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 169 | button | `将待办「${task.title}」移回待办` | click: setTaskStatus(task, 'pending') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 176 | button | toggleLabel(task) | click: emit('toggle', task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 185 | TaskRowActions | TaskRowActions | primary: emit('primary', task); select: emit('action', task, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/task-views/TaskCalendar.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 104 | button | 上一个月 | click: emit('shift-month', -1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 108 | button | 下一个月 | click: emit('shift-month', 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 120 | button | cellLabel(cell) | click: emit('select-date', selectedDate === cell.dateKey ? '' : cell.dateKey) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 140 | button | rowLabel(task) | click: emit('open', task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 141 | button | {{ entry.label }} · {{ entry.anchor === 'occupied' ? entry.rangeText : entry.time &#124;&#124; (entry.allDay ? '全天' : '时刻待定') }} {{ entry.completed ?  | click: emit('open', task, entry.stageId) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 143 | button | toggleLabel(task) | click: emit('toggle', task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 150 | TaskRowActions | TaskRowActions | primary: emit('primary', task); select: onAction(task, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskBulkBar.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 33 | button | 全部完成 | click: emit('complete') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 34 | button | 改期 | click: emit('reschedule') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 35 | button | 归档 | click: emit('archive') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 36 | button | 删除 | click: confirmRemove = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 37 | button | 取消选择 | click: emit('clear') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 41 | ConfirmDialog | `删除 ${count} 项待办` | close: confirmRemove = false; confirm: confirmRemove = false; emit('remove') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskBulkRescheduleDialog.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 38 | form | 把选中的 {{ count }} 项待办的截止时间与未完成阶段一起平移。已完成的阶段不会被移动。 {{ preset.label }} 天数 将 {{ direction === 'earlier' ? '提前' : '顺延' }} {{ amount() }} 天 | submit: emit('apply', { direction, days: amount() }) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 41 | button | {{ preset.label }} | click: direction = preset.direction; days = preset.days | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 49 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 56 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 57 | button | 应用改期 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskRescheduleDialog.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 41 | form | 将“ {{ task.title }} ”的截止日期设为 {{ initialDate }} 。阶段安排保持原样，保存前仍会检查时间冲突。 重新安排“ {{ task.title }} ”。先预览并应用改期，再保存生效。 单独调整事项截止时间 新的截止日期 今天 明天 一周后 截 | submit: save | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 46 | summary | 单独调整事项截止时间 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 47 | input | input date | input: changed = true; error = ''; if (!draft.dueDate) draft.dueTime = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 48 | button | 今天 | click: setDate(0) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 48 | button | 明天 | click: setDate(1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 48 | button | 一周后 | click: setDate(7) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 49 | input | input time | input: changed = true; error = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 53 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 53 | button | 保存改期 | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 55 | ConfirmDialog | 改期后的时间冲突 | close: conflictMessage = ''; confirm: conflictMessage = ''; emit('save', draft) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskRowActions.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 43 | button | `${primary.label}：${subject}` | click: emit('primary') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 50 | button | `更多操作：${subject &#124;&#124; '待办'}` | click: open = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 60 | ActionSheet | subject ? `更多操作：${subject}` : '更多操作' | select: choose; close: open = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskStageAction.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | button | {{ lastAction ? '完成事项' : `完成「${stageLabel(stage)}」` }} | click: emit('complete', stage.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 15 | button | 查看 {{ task.timeStages?.length }} 段安排 | click: emit('open') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskTimeEditor.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 116 | button | ＋ {{ modelValue.length ? '添加阶段' : '添加起止时间' }} | click: add | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 119 | button | 撤销删除 | click: undoDelete | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 121 | button | {{ modelValue.length === 1 && !stage.label ? '起止时间' : stageLabel(stage, index) }} {{ stageRangeText(stage) }} {{ expandedId === stage.id ? ' | click: expandedId = expandedId === stage.id ? '' : stage.id | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 125 | input | 例如：准备材料、提交、审核、现场办理 | input: patch(index, { label: valueOf($event) }) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 126 | select | 在这段时间内完成 按时参加或执行 只跟踪时间，等待后续 | change: setPurpose(index, valueOf($event)) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 127 | input | input checkbox | change: setAllDay(index, checkedOf($event)) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 129 | input | input date | input: boundary(index, anchor, 'date', valueOf($event)) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 131 | input | input time | input: boundary(index, anchor, 'time', valueOf($event)) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 132 | button | {{ timeVisible[`${stage.id}:${anchor}`] &#124;&#124; stage[anchor]?.time ? '保留日期，移除时刻' : '＋ 添加具体时刻' }} | click: toggleTime(index, anchor) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 136 | summary | 阶段提醒 {{ stage.reminders?.length ? ` · ${stage.reminders.length} 条` : '（选填）' }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 139 | input | input checkbox | change: reminder(index, reminderIndex, 'enabled', checkedOf($event)) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 140 | select | 开始 结束 | change: reminder(index, reminderIndex, 'anchor', valueOf($event)) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 140 | input | input number | input: reminder(index, reminderIndex, 'minutesBefore', valueOf($event)) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 141 | input | input time | input: reminder(index, reminderIndex, 'dateOnlyTime', valueOf($event)) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 142 | button | 删除这条提醒 | click: deleteReminder(index, reminderIndex) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 144 | button | ＋ 添加提醒 | click: addReminder(index) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 146 | button | {{ stage.completedAt ? '撤销阶段完成' : '记录阶段完成' }} | click: patch(index, { completedAt: stage.completedAt ? null : new Date(nowMs).toISOString() }) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 147 | button | `上移${stageLabel(stage, index)}` | click: move(index, -1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 147 | button | `下移${stageLabel(stage, index)}` | click: move(index, 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 147 | button | 删除这段安排 | click: remove(index) | D | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskTimeShift.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 44 | button | {{ expanded ? '收起改期' : '移动剩余安排…' }} | click: expanded = !expanded | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 45 | button | 撤销改期 | click: undo | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 49 | select | 顺延 提前 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 51 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 52 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 53 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 56 | button | 30 分钟 | click: preset(0, 0, 30) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 56 | button | 2 小时 | click: preset(0, 2, 0) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 56 | button | 1 天 | click: preset(1, 0, 0) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 56 | button | 1 天 2 小时 | click: preset(1, 2, 0) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 58 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 61 | input | `${item.label}的原时刻` | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 68 | button | 应用到草稿 | click: apply | B | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskWorkCheckpointFields.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 23 | summary | 断点续做 记录进度、卡点和下一步 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 25 | textarea | 例如：已经完成数据清洗，正在检查异常值 | input: updateField('checkpointLastStep', $event) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 27 | textarea | 选填，写下目前卡住的地方 | input: updateField('checkpointBlocker', $event) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 29 | textarea | 例如：核对缺失值后导出图表 | input: updateField('checkpointNextStep', $event) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 31 | textarea | https://… | input: updateField('checkpointResources', $event) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 33 | a | {{ url }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/tasks/TaskWorkSession.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 49 | a | {{ url }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 68 | button | {{ startLabel }} | click: emit('start') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 69 | button | {{ busy ? '保存中…' : '保存进度' }} | click: emit('save') | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 70 | button | 关闭 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ui/calendar/Calendar.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 52 | NativeSelect | {{ formatter.custom(toDate(month), { month: 'short' }) }} | change: (e: Event) =&gt; {             placeholder = placeholder.set({               month: Number((e?.target as any)?.value),             })           } | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 74 | NativeSelect | {{ formatter.custom(toDate(year), { year: 'numeric' }) }} | change: (e: Event) =&gt; {             placeholder = placeholder.set({               year: Number((e?.target as any)?.value),             })           } | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 90 | CalendarRoot | {{ formatter.custom(toDate(date), { year: 'numeric' }) }} {{ formatter.custom(toDate(date), { month: 'short' }) }} {{ day }} {{ weekDate.day | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ui/input/Input.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 23 | input | input | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |

### src/components/ui/native-select/NativeSelect.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 37 | select | select | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |

### src/components/ui/select/SelectTrigger.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | SelectTrigger | SelectTrigger | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ui/tabs/TabsTrigger.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | TabsTrigger | TabsTrigger | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ui/toggle-group/ToggleGroupItem.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 28 | ToggleGroupItem | ToggleGroupItem | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/components/ui/toggle/Toggle.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | Toggle | Toggle | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/CourseArchiveView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 187 | RouterLink | ← 全部课程 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 188 | RouterLink | {{ course ? '查看课表' : '管理课程' }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 189 | RouterLink | ＋ 添加课程待办 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 204 | input | 搜索课程、老师或地点 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 206 | button | 在学课程 {{ activeProfiles.length }} | click: scope = 'active' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 207 | button | 待推进 {{ attentionCount }} | click: scope = 'pending' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 208 | button | 已归档 {{ archivedProfiles.length }} | click: scope = 'archived' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 212 | RouterLink | `查看${item.course.name}的课程进度` | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 222 | EmptyState | 先把课程加进来 | primary: router.push('/schedule') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 223 | EmptyState | 没有匹配的课程 | primary: resetFilters | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 224 | EmptyState | 暂时没有待推进的课程 | primary: resetFilters | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 226 | EmptyState | 当前没有在学课程 | primary: scope = 'archived'; secondary: router.push('/schedule') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 233 | select | 切换课程 | change: switchCourse | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 239 | RouterLink | ＋ 添加 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 243 | EmptyState | profile.taskTotal ? '课程待办已处理完' : '先记下这门课要做的事' | primary: router.push(taskLocation) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 248 | RouterLink | {{ row.title }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 249 | RouterLink | 管理重要日期 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 250 | button | {{ nodesExpanded ? '收起节点 ↑' : `展开其余 ${profile.upcoming.length - 4} 个节点 ↓` }} | click: nodesExpanded = !nodesExpanded | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 255 | button | {{ historyOpen ? '收起记录 ↑' : '展开记录 ↓' }} | click: toggleHistory | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 257 | button | {{ filter.label }} | click: activityType = filter.value | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 266 | EmptyState | 这门课程已不存在 | primary: router.push('/course') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 268 | TaskWorkSession | TaskWorkSession | close: closeTaskWorkSession; start: startTaskWork; save: saveTaskWorkProgress; update:field: updateWorkSessionField | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 269 | Toast | Toast toast.type | close: toast.open = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/EventsView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 189 | router-link | 一起约 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 190 | button | 导入日程 | click: importOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 191 | button | ＋ 新建日程 | click: createForScope | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 197 | button | {{ nextEvent.title }} {{ timeRangeOf(nextEvent) }} · {{ nextEvent.location }} → | click: detail = nextEvent | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 201 | button | `${stat.label} ${plan.counts[stat.key]} 条日程` | click: showFilter(stat.key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 208 | button | 清单 | click: viewMode = 'list' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 209 | button | 月历 | click: viewMode = 'calendar' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 211 | input | 搜索标题、地点、课程、日期或备注 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 212 | button | 清除 | click: query = '' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 215 | button | {{ item.label }} {{ plan.counts[item.key] }} | click: filter = item.key | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 218 | button | 当前日程 | click: filter = 'upcoming' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 219 | button | 已归档 | click: filter = 'archived' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 223 | EventCalendar | EventCalendar | month: changeMonth; select: selectedDate = $event | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 227 | button | {{ selectedDate ? '查看整月' : '按日查看' }} | click: selectedDate = selectedDate ? '' : `${month}-01` | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 227 | button | 导出 .ics | click: exportCalendar | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 236 | button | {{ row.event.title }} | click: detail = row.event | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 241 | button | `编辑日程：${row.event.title}` | click: openEdit(row.event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 242 | button | `恢复日程：${row.event.title}` | click: restore(row.event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 243 | button | `归档日程：${row.event.title}` | click: archive(row.event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 244 | button | `删除日程：${row.event.title}` | click: deleteEventTarget = row.event | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 250 | EmptyState | emptyState.title | primary: debouncedQuery.trim() ? query = '' : createForScope() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 251 | button | ＋ 添加 {{ selectedDate ? '当天' : '本月' }} 日程 | click: createForScope | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 255 | form | 日程内容 日期 今天 明天 待安排 开始时间 {{ form.time &#124;&#124; '选择时间' }} 结束时间 {{ form.endTime &#124;&#124; '可选' }} 时长 {{ minutes }} 分钟 清除时间 与 {{ liveConflicts.length }} 条安排时间 | submit: save | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 256 | input | 例如：项目讨论、图书馆自习 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 258 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 259 | button | 今天 | click: form.date = appToday | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 259 | button | 明天 | click: form.date = shiftEventDate(appToday, 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 259 | button | 待安排 | click: form.date = ''; clearTime() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 262 | button | {{ form.time &#124;&#124; '选择时间' }} | click: wheelField = 'time' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 263 | button | {{ form.endTime &#124;&#124; '可选' }} | click: wheelField = 'endTime' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 265 | button | {{ minutes }} 分钟 | click: setDuration(minutes) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 265 | button | 清除时间 | click: clearTime | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 267 | input | 可选，例如：图书馆三楼 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 269 | select | {{ form.courseName ? '保留原课程名称' : '不关联课程' }} {{ form.courseName &#124;&#124; '原关联课程' }} {{ course.name }} {{ course.teacher ? ` · ${course.teacher}` :  | change: selectCourse | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 270 | input | 也可以手动填写 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 273 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 274 | input | input number | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 275 | button | {{ minutes ? `${minutes} 分钟` : '到点' }} | click: form.reminderMinutes = minutes | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 277 | button | {{ notificationBusy ? '正在启用…' : '启用浏览器通知' }} | click: enableNotifications | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 278 | textarea | 议题、要带的东西或其他细节 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 280 | button | 取消 | click: closeForm | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 280 | button | {{ editing ? '保存' : '添加' }} | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 288 | summary | 查看原文 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 289 | button | 编辑日程 | click: editDetail | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 289 | button | 恢复日程 | click: restore(detail) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 289 | button | 复制为新日程 | click: copyEvent(detail) | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 290 | router-link | 查看齐行项目 → | click: detail = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 293 | IcsImportButton | IcsImportButton | import: importEvents | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 293 | DomainCsvImportButton | DomainCsvImportButton | import: importEvents | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 294 | TimeWheelSheet | wheelField === 'endTime' ? '选择结束时间' : '选择开始时间' | close: wheelField = '' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 295 | ConfirmDialog | 删除日程 | close: deleteEventTarget = null; confirm: confirmRemove | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 296 | ConfirmDialog | 时间冲突 | close: saveConflict = null; confirm: confirmConflictSave | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 297 | Toast | Toast toast.type | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ExamsView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 603 | button | {{ showHistory ? '返回当前' : `历史 ${summary.archived &#124;&#124; ''}` }} | click: setHistory | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 605 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 608 | Button | ＋ 添加重要日期 | click: openAdd | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 615 | button | 即将到来 {{ summary.upcoming }} 全部当前日期 | click: selectOverview('all') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 616 | button | 未来 7 天 {{ summary.week }} 含今天 | click: selectOverview('week') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 617 | button | 已置顶 {{ summary.pinned }} 优先关注 | click: selectOverview('pinned') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 618 | button | 已结束 {{ summary.past }} 查看与归档 | click: selectOverview('past') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 623 | Input | 搜索名称、课程、地点或备注 | 原生展开 / 链接 | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 623 | button | 清除重要日期搜索 | click: query = ''; searchQuery.flush('') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 624 | select | 全部日期 未来 7 天 未来 30 天 已置顶 已结束 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 625 | select | 最近日期优先 按名称 最近添加优先 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 628 | button | 全部类型 | click: categoryFilter = 'all' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 628 | button | {{ category }} | click: categoryFilter = category | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 629 | button | 清除筛选 | click: resetFilters | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 635 | Tabs | 列表 月历 {{ item.category ?? '其他' }} 每年重复 置顶 已归档 ··· {{ item.pinned ? '取消置顶' : '置顶' }} 编辑 归档 恢复 删除 {{ item.tile.month }} {{ item.tile.day }} {{ | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 637 | TabsTrigger | 列表 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 638 | TabsTrigger | 月历 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 642 | EmptyState | emptyInfo.title | primary: emptyAction | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 664 | div | {{ item.category ?? '其他' }} 每年重复 置顶 已归档 ··· {{ item.pinned ? '取消置顶' : '置顶' }} 编辑 归档 恢复 删除 {{ item.tile.month }} {{ item.tile.day }} {{ item. | pointerdown: onCardPointerDown(item, $event); pointermove: cardLongPress.onPointerMove; pointerup: cardLongPress.onPointerUp; pointercancel: cardLongPress.onPointerCancel; contextmenu: openContextMenuAt(item, $event); click: onCardClick(item, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 684 | button | `重要日期「${item.name}」的更多操作` | click: toggleMenu(item, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 692 | button | {{ item.pinned ? '取消置顶' : '置顶' }} | click: menuPin(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 693 | button | 编辑 | click: menuEdit(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 694 | button | 归档 | click: menuArchive(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 695 | button | 恢复 | click: domain.restoreMilestone(item.id); closeMenu() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 696 | button | 删除 | click: menuDelete(item) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 707 | button | item.name | pointerdown: ; click: openEdit(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 726 | button | {{ item.review }} · 查看待办 → | click: openReviewTasks(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 736 | button | {{ item.activeReview ? '继续复习 →' : item.review ? '再安排 25 分钟复习' : '安排 25 分钟复习' }} | click: createReviewTask(item, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 749 | Button | 今天 | click: goToCalendarToday | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 752 | Calendar | Calendar | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 771 | Button | `编辑重要日期：${item.name}` | click: openEdit(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 794 | Button | ＋ 添加到这一天 | click: openAddForSelectedCalendarDate | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 803 | form | 名称 * 目标日期 * 具体时间 今天 明天 一周后 类型 {{ category }} 重复 不重复 每年重复 按公历每年重复，卡片显示下一次日期；2 月 29 日在平年按 2 月最后一天显示。 地点 备注 提前提醒（分钟） 0 表示到点提醒，留空使用默认设置。未填时间按 23 | submit: save | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 805 | input | 例如：期末考试、生日或项目截止日 | input: clearFormError('name') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 810 | input | input date | input: clearFormError('date') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 814 | input | input time | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 818 | button | 今天 | click: setFormDate(0) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 818 | button | 明天 | click: setFormDate(1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 818 | button | 一周后 | click: setFormDate(7) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 823 | select | {{ category }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 829 | select | 不重复 每年重复 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 839 | Input | 选填，例如：教学楼 A101 | 原生展开 / 链接 | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 842 | textarea | 准备事项、提醒内容或其他补充 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 845 | input | `默认提前 ${defaultReminder} 分钟` | input: clearFormError('reminder') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 849 | select | 暂不关联 {{ course.name }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 850 | input | input range | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 854 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 861 | button | 删除 | click: remove | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 862 | button | 取消 | click: showForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 863 | button | 保存 | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 868 | ConfirmDialog | 删除重要日期 | close: deleteTarget = null; confirm: confirmDelete | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 876 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 878 | ContextMenu | contextMenuTarget?.name &#124;&#124; '' | select: onContextMenuSelect; close: contextMenu = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/LedgerView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 568 | div | 账本 看清近期花费，处理固定账单，记下刚刚发生的一笔。 分类管理 {{ focusMessage }} 账本 固定账单 回顾 支出分类 收入分类 常用分类 全部分类 隐藏分类 自定义 上下箭头调整完整分类列表和录入时“更多分类”的顺序；常用快捷分类仍优先显示最近使用项。 这里还没 | click: closeSwipe | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 575 | button | 分类管理 | click: openCategoryManager | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 580 | div | 账本分区 | keydown: onLedgerTabKeydown | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 581 | button | 账本 | click: tab = 'ledger' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 582 | button | 固定账单 | click: tab = 'bills' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 583 | button | 回顾 | click: tab = 'review' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 734 | QuickEntryModal | QuickEntryModal | update:open: showQuick = $event; update:editing-id: editingId = $event; update:keep-adding: keepAdding = $event; update:amount-input: amountInput = $event; update:name-input: nameInput = $event; update:cat-input: catInput = $event; update:date-input: dateInput = $event; update:time-input: timeInput = $event; update:note-input: noteInput = $event; update:account-input: accountInput = $event; update:source-input: sourceInput = $event; update:bill-id-input: billIdInput = $event; update:currency-input: currencyInput = $event; update:split-count: splitCount = $event; update:split-mine: splitMine = $event; update:split-mode: splitMode = $event; update:show-all-quick-categories: showAllQuickCategories = $event; update:direction-input: directionInput = $event; update:more-open: moreOpen = $event; update:dup-warn: dupWarn = $event; update:force-dup: forceDup = $event; update:cycle-suggest: cycleSuggest = $event; update:category-input-manually-selected: categoryInputManuallySelected = $event; update:suggested-category-input: suggestedCategoryInput = $event; save: handleQuickSave; close: closeQuickModal; open-quick-record: openQuickRecord; open-bill-form: openBillForm; quick-record-saved: onQuickRecordSaved; select-category: selectQuickCategory; update:show-quick-record: showQuickRecord = $event | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 893 | button | 支出分类 | click: categoryManageScope = 'expense' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 894 | button | 收入分类 | click: categoryManageScope = 'income' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 897 | button | 常用分类 | click: categoryManageTab = 'common' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 898 | button | 全部分类 | click: categoryManageTab = 'all' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 899 | button | 隐藏分类 | click: categoryManageTab = 'hidden' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 900 | button | 自定义 | click: categoryManageTab = 'custom' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 906 | button | `更换${c.name}图标` | click: toggleIconPicker(c) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 922 | button | `${c.name}上移` | click: moveCategory(c, -1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 923 | button | `${c.name}下移` | click: moveCategory(c, 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 925 | button | 重命名 | click: renameCategory(c) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 926 | button | !canHideCategory(c) ? `至少保留一个可用分类，${c.name}暂不能隐藏` : `${c.hidden ? '显示' : '隐藏'}${c.name}` | click: toggleCatHidden(c) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 934 | button | categoryUsageFor(c.key).transactions &gt; 0 ? `${c.name}已有历史交易，不能删除` : `删除${c.name}` | click: requestDeleteCategory(c) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 952 | button | `将${c.name}图标设为${icon}` | click: setCategoryIcon(c, icon) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 965 | input | 新增分类名称 | input: categoryFeedback = null; keydown: addCategory | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 973 | button | 添加 | click: addCategory | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 983 | PromptDialog | 修改分类名称 | input: renameError = ''; close: renameTarget = null; renameError = ''; confirm: applyCategoryRename | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 996 | ConfirmDialog | 删除自定义分类 | close: categoryDeleteTarget = null; confirm: confirmDeleteCategory | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1006 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ListsView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 408 | button | ＋ 新建清单 | click: openCreateList() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 412 | EmptyState | 从一份小清单开始 | primary: openCreateList() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 416 | button | {{ typeInfo(entry.type).icon }} {{ entry.name }} {{ entry.description }} {{ entry.items.length }} 项 · 自由修改 | click: openCreateList(entry.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 427 | input | 搜索清单 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 429 | button | {{ typeInfo(list.type).icon }} {{ list.name }} ✓ {{ listSummary(list).done }} / {{ listSummary(list).count }} 已完成 {{ typeInfo(list.type).lab | click: activeId = list.id | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 435 | select | 选择清单 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 439 | button | 清除搜索 | click: listQuery = '' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 440 | button | ＋ 新建清单 / 使用模板 | click: openCreateList() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 447 | button | 编辑清单 | click: openEditList | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 448 | details | ••• 复制为新清单 重置勾选，再次使用 导出文本 删除清单 | keydown: closeMenuFromKey | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 449 | summary | 更多清单操作 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 451 | button | 复制为新清单 | click: duplicateList | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 452 | button | 重置勾选，再次使用 | click: requestReset | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 453 | button | 导出文本 | click: exportList | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 454 | button | 删除清单 | click: requestAction('list') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 470 | form | 添加 详细添加 批量添加 | submit: addQuickItem | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 471 | input | 快速添加一项 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 472 | button | 添加 | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 473 | button | 详细添加 | click: openAddItem | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 474 | button | 批量添加 | click: openBulkAdd | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 479 | button | {{ entry.label }} {{ entry.count }} | click: filter = entry.key | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 481 | button | {{ bulkMode ? '退出批量' : '批量管理' }} | click: bulkMode ? exitBulkMode() : bulkMode = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 481 | button | 清除已完成 | click: requestClearCompleted | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 484 | input | 搜索当前清单事项 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 485 | select | 按分类筛选 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 486 | select | 清单事项排序 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 488 | button | 清除筛选 | click: clearFilters | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 490 | input | input checkbox | change: selectVisible | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 491 | button | 标记完成 | click: setSelectedDone(true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 491 | button | 恢复未完成 | click: setSelectedDone(false) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 491 | button | 删除 | click: requestAction('items', [...selectedIds]) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 495 | SwipeActionItem | {{ item.done ? '✓' : '' }} {{ checklistItemName(item) }} {{ item.category }} {{ checklistQuantity(item) }} {{ item.unit &#124;&#124; '件' }} · {{ item. | update:open: openSwipeItemId = $event ? item.id : ''; action: handleSwipe($event, item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 497 | input | `选择${checklistItemName(item)}` | change: toggleSelection(item.id) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 498 | button | `将${checklistItemName(item)}标记为${item.done ? '未完成' : '已完成'}` | click: toggleItem(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 499 | button | `编辑${checklistItemName(item)}` | click: openEditItem(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 507 | EmptyState | emptyTitle | primary: emptyAction; secondary: openBulkAdd | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 513 | form | 从空白开始，或选择一份可修改的模板。 ＋ 空白清单 自由记录 {{ typeInfo(entry.type).icon }} {{ entry.name }} {{ entry.items.length }} 项 {{ template.items.map(item =&gt; ite | submit: saveList | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 517 | button | ＋ 空白清单 自由记录 | click: chooseTemplate('') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 518 | button | {{ typeInfo(entry.type).icon }} {{ entry.name }} {{ entry.items.length }} 项 | click: chooseTemplate(entry.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 523 | input | 例如：本周采购 | input: listError = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 525 | select | {{ info.icon }} {{ info.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 526 | input | 留空表示不设置预算 | input: listError = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 529 | button | 取消 | click: showListForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 529 | button | {{ editingListId ? '保存修改' : '创建清单' }} | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 533 | form | {{ formList?.name &#124;&#124; '原清单已被删除' }} 事项名称 * 数量 单位 单价（元） {{ itemSubtotal === null ? '填写单价后自动计算小计；未估价事项不计入预计金额。' : `本项小计 ${money(itemSubtotal)}`  | submit: saveItem | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 536 | input | 例如：洗衣液、带充电器 | input: itemError = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 538 | input | input number | input: itemError = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 539 | input | 件 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 540 | input | 选填 | input: itemError = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 543 | input | 选择或输入分类 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 544 | textarea | 规格、放置位置或其他需要记住的事 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 547 | button | 删除事项 | click: removeEditingItem | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 547 | button | 取消 | click: showItemForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 547 | button | {{ editingItemId ? '保存修改' : '添加事项' }} | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 551 | form | 添加到“ {{ bulkList?.name &#124;&#124; '原清单已被删除' }} ”。每行一项，一次最多 {{ MAX_BATCH_ITEMS }} 项；支持编号、项目符号和 [x] 完成标记。 粘贴或输入事项 跳过已有事项和本次输入中的同名事项 将添加 {{ bulkPreview | submit: saveBulkItems | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 553 | textarea | 身份证 充电器 换洗衣物 | input: bulkError = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 554 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 559 | button | 取消 | click: showBulkForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 559 | button | 添加 {{ bulkPreview.items.length }} 项 | 原生展开 / 链接 | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 561 | ConfirmDialog | confirmTitle | close: confirmTarget = null; confirm: confirmAction | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 562 | Toast | Toast toast.type | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ProjectsView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1089 | ActionButton | 刷新 | action: () =&gt; refresh() | A | 共享按钮 external | S/U；见批次范围 |
| 1090 | button | 新建项目 | click: openCreateProject | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1095 | button | 撤销删除 | click: undoDeleteProject | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1095 | button | 关闭提示 | click: notice = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1109 | button | 登录或注册 | click: accountOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1121 | button | 拒绝 | click: askConfirm({ kind: 'decline-invite', projectId: invite.projectId }) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1122 | ActionButton | 接受 | action: () =&gt; acceptProjectInvite(invite.projectId) | A | 共享按钮 external | S/U；见批次范围 |
| 1127 | button | 查看任务 | click: openProjectSection(assignment, 'tasks', assignment.taskId) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1131 | button | 处理申请 | click: openInboxAdjustment(request) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1135 | button | 查看成果 | click: openInboxReview(review) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1139 | button | 查看讨论 | click: openInboxMeeting(meeting) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1147 | button | showArchived ? '显示进行中项目' : '显示已归档项目' | click: showArchived = !showArchived | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1149 | input | 搜索项目 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1151 | button | {{ ({ course: '📚', competition: '🏁', research: '🔬', software: '💻', event: '🎪', blank: '🧩' })[item.type] &#124;&#124; '🧩' }} {{ item.name }} {{  | click: selectProject(item.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1156 | button | ＋ 新建项目 | click: openCreateProject | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1164 | button | 编辑 | click: openEditProject | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1165 | button | 归档 | click: askConfirm({ kind: 'archive' }) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1166 | button | 删除 | click: askConfirm({ kind: 'delete' }) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1167 | button | 恢复项目 | click: askConfirm({ kind: 'restore', projectId: project.id }) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1184 | button | 任务 | click: activeSection = 'tasks' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1185 | button | 协商 {{ adjustments.filter((item) =&gt; item.status === 'pending').length }} | click: activeSection = 'adjustments' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1186 | button | 成果 {{ deliverables.length }} | click: activeSection = 'deliverables' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1187 | button | 团队时间 | click: activeSection = 'schedule' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1188 | button | 成员 {{ activeMembers.length }} | click: activeSection = 'members' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1189 | button | 动态 | click: activeSection = 'activity' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1195 | button | ＋ 添加任务 | click: openTaskCreate() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1198 | input | 搜索任务 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1199 | select | 任务筛选 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1200 | select | 按负责人筛选 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1201 | select | 按阶段筛选 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1202 | select | 任务排序 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1204 | button | 重置筛选 | click: resetTaskFilters | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1207 | button | ＋ 添加里程碑 | click: openMilestoneForm() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1210 | button | item.status === 'completed' ? `重新打开${item.title}` : `完成${item.title}` | click: toggleMilestone(item, item.status !== 'completed') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1212 | button | 编辑 | click: openMilestoneForm(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1212 | button | 删除 | click: askConfirm({ kind: 'delete-milestone', milestoneId: item.id }) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1218 | button | 查看全部任务 | click: resetTaskFilters(); statusFilter = 'all' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1219 | button | 添加第一个任务 | click: openTaskCreate() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1235 | ActionButton | 拒绝分工 | action: () =&gt; respondTask(task, 'decline') | A | 共享按钮 external | S/U；见批次范围 |
| 1236 | ActionButton | 接受分工 | action: () =&gt; respondTask(task, 'accept') | A | 共享按钮 external | S/U；见批次范围 |
| 1239 | button | 工作台 | click: openProjectTaskWorkbench(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1240 | button | 继续 | click: openProjectTaskWorkbench(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1241 | ActionButton | 提交验收 | action: () =&gt; changeTaskStatus(task, 'review') | A | 共享按钮 external | S/U；见批次范围 |
| 1242 | ActionButton | 完成 | action: () =&gt; changeTaskStatus(task, 'completed') | A | 共享按钮 external | S/U；见批次范围 |
| 1244 | button | 协商调整 | click: openAdjustment(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1245 | button | 编辑 | click: openTaskEdit(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1246 | button | `为“${task.title}”添加子任务` | click: openTaskCreate(task.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1247 | button | `查看“${task.title}”的进展记录` | click: loadTaskEvents(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1256 | ActionButton | 拒绝 | action: () =&gt; respondTask(child, 'decline') | A | 共享按钮 external | S/U；见批次范围 |
| 1257 | ActionButton | 接受 | action: () =&gt; respondTask(child, 'accept') | A | 共享按钮 external | S/U；见批次范围 |
| 1260 | button | 工作台 | click: openProjectTaskWorkbench(child) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1261 | ActionButton | 完成 | action: () =&gt; changeTaskStatus(child, 'completed') | A | 共享按钮 external | S/U；见批次范围 |
| 1263 | button | `编辑子任务 ${child.title}` | click: openTaskEdit(child) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1273 | button | ＋ 发起讨论 | click: openMeetingForm() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1275 | ActionButton | 未来 {{ days }} 天 | action: () =&gt; queryGroupAvailability(days) | E | 共享按钮 external | S/U；见批次范围 |
| 1278 | ActionButton | 重试 | action: () =&gt; queryGroupAvailability() | E | 共享按钮 external | S/U；见批次范围 |
| 1281 | button | 手动发起讨论 | click: openMeetingForm() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1282 | button | {{ formatProjectTime(slot.startsAt) }} – {{ formatProjectTime(slot.endsAt) }} {{ scheduleAvailability.people.map((person) =&gt; person.nickname | click: openMeetingForm(slot) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1291 | button | 采用建议时间 | click: askConfirm({ kind: 'meeting-apply-proposal', meetingId: meeting.id, participantId: person.userId }) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1294 | button | 提出改期 | click: openMeetingProposal(meeting) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1294 | ActionButton | 拒绝 | action: () =&gt; respondMeeting(meeting, 'decline') | A | 共享按钮 external | S/U；见批次范围 |
| 1294 | ActionButton | 接受 | action: () =&gt; respondMeeting(meeting, 'accept') | A | 共享按钮 external | S/U；见批次范围 |
| 1295 | button | 确认并加入日程 | click: askConfirm({ kind: 'meeting-confirm', meetingId: meeting.id }) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1296 | button | 取消邀约 | click: askConfirm({ kind: 'meeting-cancel', meetingId: meeting.id }) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1311 | ActionButton | 拒绝 | action: () =&gt; decideAdjustment(request, 'reject') | A | 共享按钮 external | S/U；见批次范围 |
| 1311 | ActionButton | 通过 | action: () =&gt; decideAdjustment(request, 'approve') | A | 共享按钮 external | S/U；见批次范围 |
| 1312 | ActionButton | 撤回 | action: () =&gt; cancelAdjustment(request) | A | 共享按钮 external | S/U；见批次范围 |
| 1318 | button | ＋ 添加交付项 | click: openDeliverableCreate | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1326 | button | ＋ 添加检查项 | click: openDeliveryCheckForm | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1329 | input | input checkbox | change: saveDeliveryCheck(item, $event.target.checked) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1330 | input | `${item.title}的凭证或说明` | input: deliveryEvidenceEdits.mark(item.id, item.evidence); keydown: saveDeliveryCheck(item, item.checked) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1330 | ActionButton | 保存说明 | action: () =&gt; saveDeliveryCheck(item, item.checked) | B | 共享按钮 external | S/U；见批次范围 |
| 1330 | button | `删除检查项 ${item.title}` | click: askConfirm({ kind: 'delivery-check-delete', checkId: item.id }) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1346 | a | {{ link.title &#124;&#124; link.url }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1347 | button | {{ file.name }} · {{ Math.max(1, Math.round(file.size / 1024)) }} KB | click: openDeliverableFile(file) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1350 | button | 验收 V {{ version.number }} | click: openReview(item, version) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1354 | button | {{ item.versions?.[0]?.reviewStatus === 'returned' ? '修改并重新提交' : item.draft ? '继续编辑草稿' : '提交成果' }} | click: openDeliverableEditor(item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1359 | button | 邀请成员 | click: showInviteForm = true; linkToShare = ''; void loadFriends(); void loadInviteLinks() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1363 | ActionButton | {{ member.role === 'admin' ? '设为成员' : '设为管理员' }} | action: () =&gt; changeMemberRole(member) | A | 共享按钮 external | S/U；见批次范围 |
| 1363 | button | 转交负责人 | click: transferTargetId = member.userId | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1363 | button | `移出成员 ${member.nickname}` | click: askConfirm({ kind: 'remove', targetId: member.userId, targetName: member.nickname }) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1364 | button | 撤回邀请 | click: askConfirm({ kind: 'remove', targetId: member.userId, targetName: member.nickname }) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1367 | button | 退出项目 | click: askConfirm({ kind: 'leave' }) | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1381 | button | 新建项目 | click: openCreateProject | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1387 | form | 项目名称 * 项目类型 {{ item.label }} 项目说明 开始日期 预计结束 {{ projectFormError }} 取消 {{ projectSaveBusy ? '保存中…' : editingProject ? '保存修改' : '创建项目' }} | submit: saveProject | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1389 | input | 例如：数学建模竞赛 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1390 | select | {{ item.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1391 | textarea | 选填，写下目标或背景 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1392 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1392 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1395 | button | 取消 | click: showProjectForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1395 | ActionButton | {{ projectSaveBusy ? '保存中…' : editingProject ? '保存修改' : '创建项目' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1400 | form | 任务标题 * 任务说明 负责人 暂不分配 {{ member.userId === accountUser.id ? '我' : member.nickname }} 截止日期 所属阶段 不关联里程碑 {{ item.title }} 前置任务 没有前置任务 {{ item.ti | submit: saveTask | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1402 | input | 例如：完成需求分析 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1403 | textarea | 选填 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1404 | select | 暂不分配 {{ member.userId === accountUser.id ? '我' : member.nickname }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1404 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1405 | select | 不关联里程碑 {{ item.title }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1406 | select | 没有前置任务 {{ item.title }} {{ item.status === 'completed' ? '（已完成）' : '' }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1408 | select | {{ label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1412 | button | 取消 | click: showTaskForm = false; editingTask = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1412 | ActionButton | {{ taskSaveBusy ? '保存中…' : editingTask ? '保存修改' : '添加任务' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1419 | form | 阶段名称 * 阶段说明 关键日期 取消 {{ planningSaveBusy ? '保存中…' : editingMilestone ? '保存修改' : '添加里程碑' }} | submit: saveMilestone | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1421 | input | 例如：方案评审 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1422 | textarea | 选填 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1423 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1425 | button | 取消 | click: showMilestoneForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1425 | ActionButton | {{ planningSaveBusy ? '保存中…' : editingMilestone ? '保存修改' : '添加里程碑' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1430 | form | 检查内容 * 项目交付必需 取消 {{ planningSaveBusy ? '保存中…' : '添加检查项' }} | submit: saveDeliveryCheckItem | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1432 | input | 例如：确认最终报告包含实验数据 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1433 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1435 | button | 取消 | click: showDeliveryCheckForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1435 | ActionButton | {{ planningSaveBusy ? '保存中…' : '添加检查项' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1440 | form | 时间按你的账号时区（ {{ scheduleTimezone }} ）填写。其他成员会看到本地时区下的时间。 讨论主题 * 讨论说明 {{ meetingProposalTarget ? '建议开始时间' : '开始时间' }} {{ meetingProposalTarget  | submit: saveMeetingForm | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1443 | input | 例如：确定演示方案 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1444 | textarea | 选填，写下议题或会议链接 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1445 | input | input datetime-local | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1446 | input | input datetime-local | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1448 | button | 取消 | click: showMeetingForm = false; meetingProposalTarget = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1448 | ActionButton | {{ actionBusy ? '提交中…' : meetingProposalTarget ? '发送改期建议' : '发送讨论邀请' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1453 | form | {{ adjustmentTask?.title }} · 申请提交后先由相关成员确认，确认前不会改动现有安排。 申请类型 延长截止时间 寻求其他成员协助 调整任务范围 拆分任务 交接任务负责人 无法继续承担 申请的新截止日期 {{ adjustmentDraft.type == | submit: saveAdjustment | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1456 | select | 延长截止时间 寻求其他成员协助 调整任务范围 拆分任务 交接任务负责人 无法继续承担 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1457 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1458 | select | 选择项目成员 {{ member.nickname }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1459 | textarea | 写下希望采用的新范围 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1460 | textarea | 每行一个子任务，最多 8 项 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1461 | textarea | 说明当前遇到的问题和需要怎样的调整 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1463 | button | 取消 | click: showAdjustmentForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1463 | ActionButton | {{ adjustmentSaveBusy ? '提交中…' : '提交申请' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1468 | form | 交付项名称 * 交付要求 关联任务 不关联具体任务 {{ task.title }} 验收人 项目负责人或管理员 {{ member.nickname }} 项目交付必需 正式提交后需要验收 取消 {{ deliverableSaveBusy ? '保存中…' : '添加交付项' | submit: saveDeliverable | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1470 | input | 例如：最终报告 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1471 | textarea | 选填，写下格式、内容或检查要求 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1472 | select | 不关联具体任务 {{ task.title }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1473 | select | 项目负责人或管理员 {{ member.nickname }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1474 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1475 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1477 | button | 取消 | click: showDeliverableForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1477 | ActionButton | {{ deliverableSaveBusy ? '保存中…' : '添加交付项' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1482 | form | 交付要求： {{ activeDeliverable.instructions }} 成果说明 在线链接 ＋ 添加链接 在线文档 代码仓库 指定提交 其他链接 × 成果文件 {{ fileUploadBusy ? '上传中…' : '选择文件' }} 单个文件最大 20 MB，每 | submit: submitDeliverable | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1485 | textarea | 简要说明完成内容、查看方式或注意事项 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1486 | button | ＋ 添加链接 | click: addContentLink | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1487 | select | 链接类型 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1487 | input | 链接名称 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1487 | input | HTTPS 链接 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1487 | button | `删除链接 ${index + 1}` | click: draftContent.links.splice(index, 1) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1489 | input | input file | change: uploadDeliverableFiles | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1490 | button | 移除 | click: draftContent.files.splice(index, 1) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1492 | input | 选填，例如：根据验收意见补充了实验结果 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1498 | button | 关闭 | click: closeDeliverableEditor | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1498 | ActionButton | {{ deliverableEditorBusy ? '保存中…' : '保存草稿' }} | action: () =&gt; saveDeliverableDraft() | B | 共享按钮 external | S/U；见批次范围 |
| 1498 | ActionButton | {{ deliverableEditorBusy ? '提交中…' : '正式提交新版本' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1503 | form | 通过前请逐项确认检查结果；有未通过项时请选择退回修改。 × ＋ 添加检查项 验收意见 * 退回修改 {{ reviewSaveBusy ? '保存中…' : '通过验收' }} | submit: decideReview('approved') | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1506 | input | `检查项 ${index + 1} 通过` | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1506 | input | `检查项 ${index + 1} 名称` | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1506 | button | `删除检查项 ${index + 1}` | click: reviewChecklist.splice(index, 1) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1506 | button | ＋ 添加检查项 | click: addReviewChecklistItem | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1507 | textarea | 说明检查结果，退回时请写清楚修改建议 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1509 | ActionButton | 退回修改 | action: () =&gt; decideReview('returned') | A | 共享按钮 external | S/U；见批次范围 |
| 1509 | ActionButton | {{ reviewSaveBusy ? '保存中…' : '通过验收' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 1515 | select | 选择好友 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1515 | ActionButton | 发送邀请 | action: () =&gt; inviteFriend() | A | 共享按钮 external | S/U；见批次范围 |
| 1516 | ActionButton | {{ linkBusy ? '正在创建…' : '创建并复制邀请链接' }} | action: () =&gt; createInviteLink() | A | 共享按钮 external | S/U；见批次范围 |
| 1516 | input | input | focus: $event.target.select() | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 1516 | ActionButton | 复制 | action: () =&gt; copyInviteLink(linkToShare) | B | 共享按钮 external | S/U；见批次范围 |
| 1516 | ActionButton | 停用 | action: () =&gt; revokeInviteLink(link.id) | D | 共享按钮 external | S/U；见批次范围 |
| 1528 | button | 取消 | click: transferTargetId = '' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1528 | ActionButton | 确认转交 | action: () =&gt; transferOwner() | A | 共享按钮 external | S/U；见批次范围 |
| 1531 | ConfirmDialog | ({ archive: '归档项目', delete: '删除项目', leave: '退出项目', remove: '移出成员', restore: '恢复项目', 'decline-invite': '拒绝项目邀请', 'delete-milestone': '删除里程碑', 'meeting-confirm': '确认小组讨论', 'meeting-cancel': '取消讨论邀约', 'meeting-apply-proposal': '采用改期建议', 'delivery-check-delete': '删除交付检查项' })[confirmAction.kind] &#124;&#124; '确认操作' | close: confirmAction = null; confirm: runConfirmedAction | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ScheduleView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 348 | Button | {{ showArchivedCourses ? '返回当前课程' : '历史课程' }} | click: showArchivedCourses = !showArchivedCourses | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 349 | Button | {{ showScheduleSettings ? '收起设置' : '课表设置' }} | click: showScheduleSettings = !showScheduleSettings | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 363 | Button | 批量管理 | click: openCourseManager | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 364 | Button | 导入课程表 | click: openBatchShift | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 370 | Button | 学期起始日 | click: showSemester = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 371 | Button | 作息与节次 | click: openTimeSettings | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 376 | button | {{ campus.name }} | click: selectScheduleCampus(campus.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 382 | button | currentAutoStatus.available ? '根据当前日期自动选择' : '完善生效日期并解决冲突后可用' | click: enableAutoSeason | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 383 | button | {{ season.name }} | click: timeConfig.autoSeason = false; timeConfig.currentSeason = season.id | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 392 | button | 经典 | click: appearance.scheduleSkin = 'classic' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 393 | button | 笔记 | click: appearance.scheduleSkin = 'notebook' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 394 | button | 极简 | click: appearance.scheduleSkin = 'timeline' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 410 | Button | 上一周 | click: goWeek(-1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 411 | Popover | {{ viewWeek &lt; 1 ? '开学前' : `第 ${viewWeek} 周` }} {{ weekDateRange }} 跳转到日期 选择日期后显示所在周次和星期 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 413 | Button | 选择日期并跳转到对应周次 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 438 | Button | 下一周 | click: goWeek(1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 440 | Button | 回到今天 | click: returnToToday | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 446 | ToggleGroup | 选择课表视图 | update:model-value: setMobileView | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 455 | ToggleGroupItem | 单日 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 456 | ToggleGroupItem | 整周 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 459 | Button | 放假、调课与补课 | click: openExceptionManager | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 460 | Button | ＋ 添加课程 | click: openAdd() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 468 | input | 搜索课程、教师或教室 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 469 | button | 清除课程搜索 | click: courseQuery = '' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 487 | button | {{ item.course.name &#124;&#124; '未命名课程' }} {{ [item.course.teacher, item.course.room].filter(Boolean).join(' · ') &#124;&#124; '未填写教师和教室' }} 第 {{ item.week }}  | click: goToScheduleDate(item.date) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 530 | button | 学习安排 {{ learningPendingCount ? `${learningPendingCount} 项课程待办，利用课表空档继续推进` : '把课程待办、复习和专注接到课表上' }} {{ showLearningPlan ? '收起 ↑' : '展开 →' }} | click: showLearningPlan = !showLearningPlan | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 536 | CourseEditorModal | CourseEditorModal | close: showForm = false; save: saveCourseFromEditor; delete: removeCourseFromEditor; archive: archiveCourseFromEditor; add-another: addAnotherInCell; add-homework: openHomeworkForCourse | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 561 | ConfirmDialog | 删除课程 | close: deleteCourseTarget = null; confirm: confirmDeleteCourse | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 573 | ConfirmDialog | 删除课程 | close: coursesRemovalTarget = null; confirm: confirmCoursesRemoval | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 583 | ConfirmDialog | 导入课表模板 | close: importTemplateTarget = null; confirm: confirmImportCourseTemplate | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 593 | ConfirmDialog | 删除课表模板 | close: deleteTemplateTarget = null; confirm: confirmDeleteCourseTemplate | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 603 | ConfirmDialog | 替换整张课表 | close: replaceAllTarget = null; confirm: confirmWholeScheduleReplacement | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 633 | BatchImportModal | BatchImportModal | close: showBatch = false; update:text: batchText = $event; update:error: batchError = $event; clear: clearBatchInput; replace-row: replaceBatchRow; import: importBatch; upload-image: ocrImage; crop-image: selectCropImage; upload-excel: importExcel; cancel-progress: batchOcrProgress.cancel(); retry-progress: retryBatchOCR; continue-progress: continueBatchResults; wait-progress: batchOcrProgress.continueWaiting(); undo: undoLastCourseImport; continue-import: continueBatchImport; finish-import: finishBatchImport | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 666 | ImageCropModal | ImageCropModal | close: showImageCropper = false; cropImageFile = null; confirm: recognizeCroppedImage | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 668 | ImportConflictModal | ImportConflictModal | close: cancelCourseImportReview; decision: setImportDecision; decisions: applyAllImportDecisions; commit: commitCourseImport(); replace-all: commitWholeScheduleReplacement | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 684 | ExceptionsModal | ExceptionsModal | close: showExceptions = false; submit: saveException; remove: removeException | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 696 | SemesterModal | SemesterModal | close: showSemester = false; save: saveSemester | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 711 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/TasksView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 655 | div | 待办 记下要做的事，按下一步时间管理截止与阶段安排。 {{ showHistory ? '返回当前' : `历史 ${counts.archived &#124;&#124; ''}` }} 更多操作 一键整理 粘贴通知 添加待办 日期概览 今天 {{ workspaceSummary.today  | click: dismissTaskTools | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 662 | Button | {{ showHistory ? '返回当前' : `历史 ${counts.archived &#124;&#124; ''}` }} | click: setHistory | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 663 | details | 更多操作 一键整理 粘贴通知 | keydown: closeTaskTools | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 664 | summary | 更多操作 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 666 | Button | 一键整理 | click: smartOrganize | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 667 | Button | 粘贴通知 | click: openNotice | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 668 | DomainCsvImportButton | DomainCsvImportButton | import: importCsvTasks | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 671 | Button | 快捷键：N | click: openAdd | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 678 | summary | 日期概览 今天 {{ workspaceSummary.today }} · 待确认 {{ workspaceSummary.overdue }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 680 | Button | 今天的安排 {{ workspaceSummary.today }} 阶段或截止时间 | click: selectOverview('today') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 681 | Button | 需要确认 {{ workspaceSummary.overdue }} 逾期或阶段已结束 | click: selectOverview('overdue') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 682 | Button | 未来 7 天 {{ workspaceSummary.week }} 含今天 | click: selectOverview('week') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 683 | Button | 待安排日期 {{ workspaceSummary.unplanned }} 给想法安排时间 | click: selectOverview('unplanned') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 695 | ToggleGroup | 待办视图 | update:model-value: value =&gt; value && setViewMode(value) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 696 | ToggleGroupItem | 列表 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 697 | ToggleGroupItem | 看板 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 698 | ToggleGroupItem | 月历 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 700 | ToggleGroup | 待办筛选 | update:model-value: value =&gt; value && selectFilter(value) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 701 | ToggleGroupItem | 待安排日期 {{ counts.unplanned }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 702 | ToggleGroupItem | 已安排 {{ counts.scheduled }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 703 | ToggleGroupItem | 已完成 {{ counts.done }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 704 | ToggleGroupItem | 全部 {{ counts.all }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 709 | input | 快捷键：/ | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 709 | Button | 清除待办搜索 | click: applyViewState({ q: '' }) | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 710 | Button | 清除筛选 | click: resetWorkspaceFilters | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 712 | select | 已安排 · {{ counts.scheduled }} 待安排日期 · {{ counts.unplanned }} 已完成 · {{ counts.done }} 全部 · {{ counts.all }} | change: selectFilter($event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 714 | summary | 筛选与排序 · 已调整 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 716 | select | 全部优先级 高优先级 普通 低优先级 | change: changeSelect('priority', $event) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 717 | select | 全部日期 今天的安排 逾期或待确认 未来 7 天 待安排日期 | change: changeSelect('period', $event) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 720 | select | {{ s.label }} | change: changeSelect('sort', $event) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 724 | Button | sortDirectionLabel | click: toggleSortDirection | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 731 | Button | {{ mobileSelection ? '结束选择' : '选择待办' }} | click: mobileSelection = !mobileSelection; if (!mobileSelection) selection.clear() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 732 | button | {{ allSelected ? '取消全选' : `全选这 ${selectableVisible.length} 项` }} | click: selection.toggleAll(visibleTasks) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 748 | ConfirmDialog | 完成多项待办 | close: bulkCompletionConfirm = null; confirm: confirmBulkComplete | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 767 | ConfirmDialog | 批量改期有时间冲突 | close: bulkShiftConfirmation = null; confirm: confirmBulkShift | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 779 | EmptyState | emptyInfo.title | primary: emptyAction | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 790 | TaskBoard | TaskBoard | open: openEditTask; toggle: toggleTask; set-status: setTaskStatus; primary: onTaskPrimary; action: onTaskAction | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 806 | TaskCalendar | TaskCalendar | shift-month: shiftMonth; select-date: calendarDate = $event; open: openEditTask; toggle: toggleTask; primary: onTaskPrimary; action: onTaskAction; set-deadline: openRescheduleTo | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 829 | SwipeActionItem | {{ taskStatus(task) === 'completed' ? '✓' : '' }} {{ task.title }} {{ PRIORITIES[task.priority]?.label ?? '普通' }} {{ taskCourseName(task) }} | update:open: setOpenSwipeItem(task.id, $event); action: handleTaskSwipe($event, task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 839 | article | {{ taskStatus(task) === 'completed' ? '✓' : '' }} {{ task.title }} {{ PRIORITIES[task.priority]?.label ?? '普通' }} {{ taskCourseName(task) }} | click: openEditTask(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 847 | button | selection.isSelected(task.id) ? `取消选择待办「${task.title}」` : `选择待办「${task.title}」以批量操作` | click: selection.toggle(task.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 857 | button | taskStatus(task) === 'completed' ? '标记为未完成' : '标记为已完成' | click: toggleDone($event, task.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 870 | button | task.title | click: openEditTask(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 888 | button | 查看关联重要日期 → | click: openRelatedMilestone(task) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 895 | TaskRowActions | TaskRowActions | primary: onTaskPrimary(task); select: onTaskAction(task, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 903 | form | 待办内容 * 所属课程或类别 截止日期 截止时间 今天 明天 一周后 暂不安排 未设置日期的事项会留在“待安排日期”，随时可以补上。 优先级 高优先级 普通 低优先级 备注 时长、重复与提醒 按需设置 预计时长（分钟） 实际用时（分钟） 重复 {{ rule.value ===  | submit: save | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 907 | input | 例如：完成高数第三章作业 | input: clearFormError('title') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 912 | input | 选填，可直接输入 | change: linkCourseFromName | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 921 | input | input date | input: clearFormError('dueDate'); if (!form.dueDate) form.dueTime = '' | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 925 | input | input time | input: clearFormError('dueTime') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 929 | button | 今天 | click: setFormDueDate(0) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 929 | button | 明天 | click: setFormDueDate(1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 929 | button | 一周后 | click: setFormDueDate(7) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 929 | button | 暂不安排 | click: setFormDueDate(null) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 931 | TaskTimeEditor | TaskTimeEditor | change: clearFormError(errorField) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 936 | select | 高优先级 普通 低优先级 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 945 | textarea | 选填，记下要求、地点或准备事项 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 949 | summary | 时长、重复与提醒 按需设置 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 951 | input | 选填 | input: clearFormError('estimateMinutes') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 952 | input | 专注计时会自动累计 | input: clearFormError('actualMinutes') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 955 | select | {{ rule.value === 'none' ? rule.label : `${rule.label}（完成后生成下一期）` }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 957 | input | input date | input: clearFormError('repeatEndDate') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 961 | input | `默认提前 ${defaultTaskReminder} 分钟` | input: clearFormError('reminderMinutes') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 972 | Button | 删除 | click: remove | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 973 | Button | 取消 | click: showForm = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 974 | Button | 保存 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 979 | TaskWorkSession | TaskWorkSession | close: closeTaskWorkSession; start: startTaskWork; save: saveTaskWorkProgress; update:field: updateWorkSessionField | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 982 | NoticePaste | NoticePaste | close: showNotice = false; commit: onNoticeCommit | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 989 | ConfirmDialog | 删除待办 | close: deleteTarget = null; confirm: confirmDelete | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 991 | ConfirmDialog | 时间冲突 | close: saveConflict = null; confirm: confirmConflictSave | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1002 | TaskRescheduleDialog | TaskRescheduleDialog | close: rescheduleTarget = null; save: saveReschedule | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1003 | ConfirmDialog | 完成整个事项 | close: completionTarget = null; confirm: confirmWhole | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 1004 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/TodayView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 370 | Button | ↺ 回放 | click: showMemory = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 391 | Button | {{ nextUp.kind === 'course' ? '查看课程表' : nextUp.kind === 'task' ? '处理待办' : nextUp.kind === 'event' ? '查看日程' : '查看详情' }} → | click: openNext | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 392 | Button | ＋ 新建待办 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 392 | RouterLink | ＋ 新建待办 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 414 | router-link | 查看回顾 → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 420 | button | {{ option.label }} | click: markCourseCheckin(course, option.state) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 427 | router-link | 打开账本 → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 443 | router-link | 去安排 → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 449 | button | `记录心情 ${mood}` | click: chooseMood(mood) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 461 | input | 今日心情备注 | change: updateMoodNote | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 470 | router-link | 管理这条日程 | click: eventDetail = null | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/TogetherView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 626 | ActionButton | 刷新 | action: () =&gt; refreshCurrentTab() | A | 共享按钮 external | S/U；见批次范围 |
| 630 | button | {{ tab.label }} {{ unreadCount &gt; 99 ? '99+' : unreadCount }} | click: activeTab = tab.id | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 641 | button | 打开账号 | click: accountOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 647 | button | 重试 | click: loadProfile() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 653 | form | 昵称 学校（选填） 时区 {{ zone }} 课表已确认完整至 只有覆盖到已确认完整日期的范围才会参与匹配。 本学期结束日期 结束日期之后不再按每周课表推算课程；日程和考试仍会计入占用时间。 可约时间偏好 每天从 到 最短活动时长 90 分钟 2 小时 3 小时 课程前后缓冲  | submit: saveProfile | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 654 | input | 好友看到的称呼 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 655 | input | 可留空 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 657 | select | {{ zone }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 660 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 664 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 670 | input | input time | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 671 | input | input time | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 673 | select | 90 分钟 2 小时 3 小时 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 676 | select | 不额外缓冲 15 分钟 30 分钟 45 分钟 1 小时 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 678 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 681 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 685 | ActionButton | {{ profileSaving ? '正在保存…' : '保存资料与偏好' }} | 原生展开 / 链接 | B | 共享按钮 external | S/U；见批次范围 |
| 691 | button | 资料与偏好 | click: activeTab = 'friends'; profileEditorOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 696 | button | 打开账号设置 | click: accountOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 701 | button | 刷新好友 | click: loadFriends | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 703 | button | 重试 | click: loadFriends | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 705 | button | {{ item.profile?.nickname?.slice(0, 1) &#124;&#124; '友' }} {{ item.profile?.nickname &#124;&#124; '好友' }} {{ item.profile?.school &#124;&#124; '已添加好友' }} {{ selectedFrien | click: selectFriend(item.profile.userId) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 709 | button | 用邮箱添加好友 | click: activeTab = 'friends' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 715 | select | 未来 7 天 未来 14 天 未来 30 天 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 717 | ActionButton | {{ availabilityBusy ? '正在核对双方课表…' : '查找共同时间' }} | action: () =&gt; queryAvailability(availabilityDays) | E | 共享按钮 external | S/U；见批次范围 |
| 719 | ActionButton | 重试 | action: () =&gt; queryAvailability(availabilityDays) | E | 共享按钮 external | S/U；见批次范围 |
| 719 | button | 调整时间偏好 | click: activeTab = 'friends'; profileEditorOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 721 | ActionButton | 扩大到未来 {{ availabilityDays === 7 ? 14 : 30 }} 天 | action: () =&gt; queryAvailability(availabilityDays === 7 ? 14 : 30) | E | 共享按钮 external | S/U；见批次范围 |
| 721 | button | 调整时间偏好 | click: activeTab = 'friends'; profileEditorOpen = true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 727 | button | {{ selectedSlot?.startsAt === slot.startsAt ? '正在编辑邀约' : '选择这个时段' }} | click: chooseSlot(slot) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 733 | form | 邀约给 {{ selectedFriend?.nickname }} 设置具体时间 收起 {{ minutes === 90 ? '90 分钟' : `${minutes / 60} 小时` }} 开始 结束 时间不能超出共同空闲区间。确认时会再次检查双方的课表版本与冲突。 活动 | submit: createInvitation | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 734 | button | 收起 | click: composerOpen = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 736 | button | {{ minutes === 90 ? '90 分钟' : `${minutes / 60} 小时` }} | click: chooseDuration(minutes) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 738 | input | input datetime-local | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 738 | input | input datetime-local | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 741 | select | 一起吃饭 看电影 运动 逛逛 自定义 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 742 | input | activityLabels[inviteType] | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 742 | input | 例如：学校附近 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 742 | input | 补充说明 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 744 | ActionButton | {{ inviteBusy ? '正在核对并发送…' : '确认并发送邀约' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 753 | form | 好友完整邮箱 {{ searchBusy ? '正在精确查找…' : '搜索' }} | submit: searchByEmail | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 753 | input | 输入完整邮箱地址 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 753 | ActionButton | {{ searchBusy ? '正在精确查找…' : '搜索' }} | 原生展开 / 链接 | A | 共享按钮 external | S/U；见批次范围 |
| 756 | button | 找共同时间 | click: selectFriend(foundProfile.userId); activeTab = 'time' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 757 | ActionButton | 接受好友请求 | action: () =&gt; respondFriendRequest(foundIncomingRequest, 'accept') | A | 共享按钮 external | S/U；见批次范围 |
| 759 | ActionButton | {{ actionBusy === `request-${foundProfile.userId}` ? '正在发送…' : '发送好友请求' }} | action: () =&gt; sendFriendRequest() | A | 共享按钮 external | S/U；见批次范围 |
| 765 | button | 刷新好友与请求 | click: loadFriends | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 767 | button | 重试 | click: loadFriends | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 770 | ActionButton | {{ actionBusy === `friend-${request.id}` ? '处理中…' : '接受' }} | action: () =&gt; respondFriendRequest(request, 'accept') | A | 共享按钮 external | S/U；见批次范围 |
| 770 | ActionButton | 拒绝 | action: () =&gt; respondFriendRequest(request, 'reject') | A | 共享按钮 external | S/U；见批次范围 |
| 773 | ActionButton | 撤回 | action: () =&gt; respondFriendRequest(request, 'withdraw') | A | 共享按钮 external | S/U；见批次范围 |
| 775 | button | 找时间 | click: selectFriend(item.profile.userId); activeTab = 'time' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 775 | button | {{ actionBusy === `remove-${item.profile?.userId}` ? '处理中…' : '移除' }} | click: removeFriend(item.profile) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 781 | button | {{ profileEditorOpen ? '收起' : '修改' }} | click: profileEditorOpen = !profileEditorOpen | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 783 | form | 昵称 学校（选填） 时区 {{ zone }} 课表确认完整至 本学期结束日期 每天开始 每天结束 最短活动时长 90 分钟 2 小时 3 小时 课程缓冲 0 分钟 15 分钟 30 分钟 45 分钟 60 分钟 周末也可约 允许使用完整邮箱精确搜索我 不会公开邮箱；关闭时不会泄 | submit: saveProfile | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 784 | input | input | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 784 | input | input | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 785 | select | {{ zone }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 786 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 787 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 788 | input | input time | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 788 | input | input time | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 789 | select | 90 分钟 2 小时 3 小时 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 790 | select | 0 分钟 15 分钟 30 分钟 45 分钟 60 分钟 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 791 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 792 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 793 | ActionButton | {{ profileSaving ? '正在保存…' : '保存设置' }} | 原生展开 / 链接 | B | 共享按钮 external | S/U；见批次范围 |
| 799 | ActionButton | {{ notificationsBusy ? '正在更新…' : `全部标为已读${unreadCount ? `（${unreadCount}）` : ''}` }} | action: () =&gt; markNotificationsRead() | B | 共享按钮 external | S/U；见批次范围 |
| 800 | button | 刷新通知 | click: loadNotifications | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 801 | button | 重试 | click: loadNotifications | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 805 | button | 刷新邀约 | click: loadInvitations | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 806 | button | 重试 | click: loadInvitations | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 809 | button | {{ filter.label }} {{ invitationFilterCounts[filter.id] }} | click: invitationFilter = filter.id | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 821 | ActionButton | {{ actionBusy === `invite-${invite.id}-accept` ? '正在复核…' : '接受邀约' }} | action: () =&gt; runInvitationAction(invite, 'accept') | A | 共享按钮 external | S/U；见批次范围 |
| 821 | ActionButton | 不能参加 | action: () =&gt; runInvitationAction(invite, 'decline') | A | 共享按钮 external | S/U；见批次范围 |
| 821 | button | {{ proposalInviteId === invite.id ? '收起改约' : '提出一个改约' }} | click: openProposalPicker(invite) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 822 | ActionButton | 接受改约 | action: () =&gt; runInvitationAction(invite, 'accept_change') | A | 共享按钮 external | S/U；见批次范围 |
| 822 | ActionButton | 拒绝改约 | action: () =&gt; runInvitationAction(invite, 'reject_change') | A | 共享按钮 external | S/U；见批次范围 |
| 823 | button | 取消邀约 | click: cancelInvitation(invite) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 829 | button | {{ formatTime(option.startsAt) }} – {{ formatClock(option.endsAt) }} · {{ proposalMinMinutes }} 分钟 | click: proposalOptions = [option]; runInvitationAction(invite, 'propose_change') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 830 | button | 扩大到未来 {{ proposalDays === 7 ? 14 : 30 }} 天 | click: expandProposalDays(proposalDays === 7 ? 14 : 30) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 834 | button | 查找共同时间 | click: activeTab = 'time' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 835 | button | 查找共同时间 | click: activeTab = 'time' | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 840 | ConfirmDialog | 移除好友 | close: friendRemovalTarget = null; confirm: confirmRemoveFriend | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 849 | ConfirmDialog | 取消邀约 | close: invitationCancellationTarget = null; confirm: confirmCancelInvitation | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/WeeklyReviewView.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 206 | Button | 回顾上一周 | click: moveReviewWeek(reviewOffset - 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 208 | Button | 回顾下一周 | click: moveReviewWeek(reviewOffset + 1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 210 | Button | 回到本周 | click: moveReviewWeek(0) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 211 | Button | 回到今天 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 211 | router-link | 回到今天 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 260 | form | {{ field.title }} {{ field.description }} {{ reflectionLength[field.key] }} /1000 内容会纳入账号同步与本机备份。 保存本周复盘 | submit: saveReflectionNow | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 265 | textarea | field.title | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 271 | Button | 保存本周复盘 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 285 | router-link | {{ highlightKind(item) }} {{ item.title }} {{ item.timeLabel }} {{ item.date.slice(5) }} {{ item.time }} → | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 295 | Button | 查看待办 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 295 | router-link | 查看待办 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 303 | summary | 学习节奏分析 {{ hasAnalysisSamples ? '完成节奏、逾期、专注与心情' : '积累记录后查看趋势' }} | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 342 | Button | 开始专注 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 342 | router-link | 开始专注 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/BillFormModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | select | 从模板套用 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 17 | button | `删除账单模板「${template.name}」` | click: removeBillTemplate(template.id) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 22 | button | 存为模板 | click: saveBillAsTemplate | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 26 | input | 例如：ChatGPT Plus、话费 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 38 | input | 固定账单金额 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 52 | select | {{ c.label }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 59 | select | 按名称自动识别 {{ category.icon }} {{ category.name }} | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 67 | input | input date | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 77 | select | 当天 1 天 3 天 7 天 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 92 | input | 补充套餐、用途等信息 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 97 | input | 留空则用默认账户 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 102 | select | 固定账单使用的币种 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 109 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 114 | input | input checkbox | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 122 | button | 删除 | click: requestDelete | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 123 | button | 取消 | click: formOpen = false | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 124 | button | 保存 | click: saveBill | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 129 | ConfirmDialog | 删除固定账单 | close: deleteBillTarget = null; confirm: confirmDeleteBill | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/BillsPanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | button | ＋ 添加固定账单 | click: openBillForm() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 30 | EmptyState | 还没有固定账单 | primary: openBillForm() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 53 | div | {{ bill.name }} {{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }} · {{ bill.note }} {{ billAmountText(bill) }} / {{ cycles[bi | click: openBillForm({}, bill.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 61 | button | `编辑固定账单「${bill.name}」` | click: openBillForm({}, bill.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 74 | button | 已支付 | click: markPaid(bill) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 75 | button | 跳过本次 | click: dismissPending(bill); skipOnce(bill) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 85 | div | {{ bill.name }} {{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }} {{ billAmountText(bill) }} / {{ cycles[bill.cycle]?.short ? | click: openBillForm({}, bill.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 93 | button | `编辑固定账单「${bill.name}」` | click: openBillForm({}, bill.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 106 | button | 跳过本次 | click: skipOnce(bill) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 116 | div | {{ bill.name }} 已暂停 · 下次 {{ bill.nextDate }} {{ billAmountText(bill) }} 恢复 | click: openBillForm({}, bill.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 124 | button | `编辑固定账单「${bill.name}」` | click: openBillForm({}, bill.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 137 | button | 恢复 | click: toggleBillActive(bill) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/BudgetSettingsModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 7 | input | `月度预算金额（${baseCurrency}）` | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 13 | button | 清除预算 | click: removeBudget | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 14 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 15 | button | 保存预算 | click: commitBudget | B | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/FxSettingsModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | input | `1 ${row.code} 等于多少 ${baseCurrency}` | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 13 | button | 删除 {{ row.code }} | click: removeRow(row.code) | D | 现有状态（待逐项验证） | S/U；见批次范围 |
| 20 | input | 要添加的币种代码 | 原生输入 / v-model | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 24 | button | 添加到列表 | click: addRow | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 32 | button | 取消 | click: emit('close') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 33 | button | 保存汇率 | click: commit | B | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/LedgerBudgetCard.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 38 | button | {{ props.budget.monthly === null ? '设置预算' : '预算设置' }} | click: emit('open-budget-settings') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 87 | summary | 额度怎么算 | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/LedgerHomePanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 114 | button | 查看全部记录 | click: $emit('show-all-feed-change', true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 129 | button | 汇率设置 | click: $emit('open-fx-settings') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 143 | Button | ＋ 记一笔 | click: $emit('open-quick') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 144 | Button | 导入账单 | click: $emit('open-import') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 152 | div | {{ bill.name }} {{ billAmountText(bill) }} · {{ billDateLabel(bill.nextDate) }} · {{ bill._s.text }} 已支付 ✕ | click: $emit('open-bill-form', {}, bill.id); keydown: $emit('open-bill-form', {}, bill.id); keydown: $emit('open-bill-form', {}, bill.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 166 | button | 已支付 | click: $emit('mark-paid', bill) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 167 | button | 暂时隐藏这条账单提醒 | click: $emit('dismiss-pending', bill) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 177 | button | 管理分类 | click: $emit('open-category-manager') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 180 | button | {{ catInfo(item.cat).icon }} {{ item.name }} {{ moneyRow(item.amount, item.currency &#124;&#124; baseCurrency) }} | click: $emit('use-frequent', item) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 192 | input | 搜索账本记录 | input: e =&gt; $emit('update-q', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 193 | button | 打开账本筛选 | click: $emit('toggle-filters') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 194 | button | 清除搜索与筛选 | click: $emit('clear-filters') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 198 | button | 全部时间 | click: $emit('update-f-range', 'all') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 199 | button | 今天 | click: $emit('update-f-range', 'today') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 200 | button | 本周 | click: $emit('update-f-range', 'week') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 201 | button | 本月 | click: $emit('update-f-range', 'month') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 202 | button | 自定义 | click: $emit('update-f-range', 'custom') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 205 | input | 筛选起始日期 | input: e =&gt; $emit('update-f-from', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 205 | input | 筛选结束日期 | input: e =&gt; $emit('update-f-to', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 208 | select | 筛选分类 | input: e =&gt; $emit('update-f-cat', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 212 | select | 筛选账户 | input: e =&gt; $emit('update-f-account', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 216 | input | 筛选最低金额 | input: e =&gt; $emit('update-f-min', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 217 | input | 筛选最高金额 | input: e =&gt; $emit('update-f-max', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 218 | select | 筛选记录来源 | input: e =&gt; $emit('update-f-kind', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 223 | select | 筛选收支类型 | input: e =&gt; $emit('update-f-direction', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 229 | select | 筛选币种 | change: $emit('update-f-currency', $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 253 | button | CSV | click: $emit('export-filtered-csv') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 254 | button | {{ exporting ? '正在导出…' : '导出结果' }} | click: $emit('export-filtered-xlsx') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 256 | button | 查看全部（ {{ filteredExpenses.length }} ） | click: $emit('show-all-feed-change', true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 257 | button | 收起 | click: $emit('show-all-feed-change', false) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 260 | EmptyState | filtersActive ? '没有符合条件的记录' : '还没有记录' | primary: $emit(filtersActive ? 'clear-filters' : 'open-quick') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 292 | SwipeActionItem | {{ e.category.icon }} {{ e.transaction.name }} {{ feedSecondary(e.transaction, e.category) }} {{ feedAmount(e.transaction) }} | swipe: $emit('transaction-swipe', e.transaction.id, $event); action: $emit('swipe-action', e.transaction.id, $event); update:open: $emit('swipe-open-change', e.transaction.id, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 313 | div | `查看「${e.transaction.name}」的详情` | click: $emit('open-detail', e.transaction.id); keydown: $emit('open-detail', e.transaction.id); keydown: $emit('open-detail', e.transaction.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 339 | button | 查看回顾 | click: $emit('switch-tab', 'review') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 344 | button | `${bar.info.name} 本月 ${moneyRow(bar.value)}，查看这个分类的明细` | click: $emit('open-review-category', bar.key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/MonthlyTrendCard.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 184 | button | {{ range }} 个月 | click: setRange(range) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 187 | button | `查看前 ${trendRange} 个月` | click: shiftPeriod(-1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 189 | button | `查看后 ${trendRange} 个月` | click: shiftPeriod(1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 191 | button | 返回近期 | click: emit('range-end-change', todayMonth) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 209 | button | monthLabel(row) | click: clickMonth($event, row.month); pointerenter: previewPointerMonth($event, row.month); pointerdown: beginMonthGesture($event, row.month); pointermove: moveMonthGesture; pointerup: finishMonthGesture($event, row.month); pointercancel: cancelMonthGesture; focus: previewFocusedMonth($event, row.month); keydown: onMonthKeydown($event, index) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 220 | button | 查看月度回顾 → | click: selectMonth(activeMonth.month) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/QuickEntryModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 202 | button | ⚡ 用一句话记 | click: openQuickRecord | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 205 | input | 金额 | input: e =&gt; { localAmountInput = e.target.value; $emit('update:amountInput', e.target.value) }; keydown: saveExpense(keepAdding) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 222 | button | 支出 | click: setDirection('expense') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 223 | button | 收入 | click: setDirection('income') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 225 | input | 记录名称 | input: e =&gt; { $emit('update:nameInput', e.target.value); onNameInput(e.target.value) }; keydown: saveExpense(keepAdding) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 237 | button | 选择分类 | click: $emit('update:moreOpen', true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 245 | button | 取消 | click: $emit('update:dupWarn', false); $emit('update:nameInput', '') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 246 | button | 仍然记录 | click: $emit('update:forceDup', true); saveExpense(keepAdding) | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 253 | button | 只记录一次 | click: $emit('update:cycleSuggest', null) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 254 | button | 创建固定账单 | click: createBillFromSuggest | A | 现有状态（待逐项验证） | S/U；见批次范围 |
| 258 | button | {{ moreOpen ? '收起' : '更多' }} {{ moreOpen ? '▴' : '▾' }} | click: $emit('update:moreOpen', !moreOpen) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 264 | button | {{ c.icon }} {{ c.name }} | click: selectQuickCategory(c.key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 272 | button | {{ showAllQuickCategories ? '只显示常用' : '全部分类' }} | click: $emit('update:showAllQuickCategories', !showAllQuickCategories) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 276 | input | input date | input: e =&gt; $emit('update:dateInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 277 | input | input time | input: e =&gt; $emit('update:timeInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 278 | input | 可不填，默认账户 | input: e =&gt; $emit('update:accountInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 280 | select | 这笔记录使用的币种 | input: e =&gt; { localCurrencyInput = e.target.value; $emit('update:currencyInput', e.target.value) } | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 285 | input | 备注 | input: e =&gt; $emit('update:noteInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 288 | input | 参与人数 | input: e =&gt; { localSplitCount = e.target.value; $emit('update:splitCount', e.target.value) } | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 289 | input | splitMode === 'custom' ? '我承担的份额' : '我承担的份额（自动计算，只读）' | input: e =&gt; $emit('update:splitMine', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 291 | input | input checkbox | change: $emit('update:splitMode', $event.target.checked ? 'custom' : 'equal') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 297 | ActionButton | {{ editingId ? '保存修改' : keepAdding ? '记下一笔' : '记下' }} | action: () =&gt; saveExpense(keepAdding) | B | 共享按钮 external | S/U；见批次范围 |
| 302 | button | {{ keepAdding ? '完成' : '连续记' }} | click: keepAdding ? closeQuick() : saveExpense(true) | B | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/ReviewPanel.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 80 | button | 上一个月 | click: shiftMonth(-1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 82 | button | 下一个月 | click: shiftMonth(1) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 83 | input | 选择回顾月份 | change: emit('jump-to-month', $event.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 85 | button | 导出 CSV | click: exportLedgerCsv() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 86 | button | {{ exporting ? '正在导出…' : '导出 Excel' }} | click: exportLedgerXlsx() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 89 | button | 导出全部历史账单，不限当前月份 | click: props.exportAllLedgerXlsx() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 125 | button | `花得最多：${catInfo(topCategory.cat).name} ${moneyRow(topCategory.total)}，点开看明细` | click: revealReviewCategory(topCategory.cat) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 134 | button | `最大一笔：${maxSingle.name} ${moneyRow(maxSingleMine)}，查看详情` | click: openDetail(maxSingle.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 168 | button | `${row.info.name} ${moneyRow(row.value)}，${row.count} 笔，占 ${row.pct}%，${expandedCategory === row.key ? '已展开明细' : '点开看明细'}` | click: toggleReviewCategory(row.key) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 185 | button | `查看「${e.name}」的详情` | click: openDetail(e.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 201 | button | 展开其余 {{ hiddenCategoryCount }} 个分类 | click: $emit('update:showAllReviewCats', true) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 202 | button | 只显示前 {{ categoryLimit }} 个 | click: $emit('update:showAllReviewCats', false) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 212 | button | cellLabel(cell) | click: $emit('selected-day-change', selectedDay === cell.day ? null : cell.day) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 232 | div | `查看「${e.name}」的详情` | click: openDetail(e.id); keydown: openDetail(e.id); keydown: openDetail(e.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/TransactionDetailModal.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 90 | input | 修改金额 | input: e =&gt; $emit('update:detailAmountInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 91 | select | 修改分类 | input: e =&gt; $emit('update:detailCategoryInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 92 | input | 修改日期 | input: e =&gt; $emit('update:detailDateInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 93 | select | 修改币种 | input: e =&gt; $emit('update:detailCurrencyInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 96 | input | input checkbox | change: $emit('update:applySameNameCategory', $event.target.checked) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 103 | button | 取消 | click: $emit('cancel-detail-edit') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 104 | button | {{ applySameNameCategory && sameNameCategoryCount ? `保存并更新 ${sameNameCategoryCount} 笔分类` : '保存修改' }} | click: $emit('save-detail-edit') | B | 现有状态（待逐项验证） | S/U；见批次范围 |
| 121 | button | {{ refundOriginal.name }} · {{ refundOriginal.date }} · {{ moneyWithCurrency(refundOriginal.amount, refundOriginal.currency &#124;&#124; baseCurrency) | click: $emit('open-related-record', refundOriginal.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 125 | button | {{ entry.date }} · + {{ moneyWithCurrency(entry.amount, entry.currency &#124;&#124; baseCurrency) }} | click: $emit('open-related-record', entry.id) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 129 | button | {{ action.label }} | click: $emit(action.handler) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 139 | input | 退款金额 | input: e =&gt; $emit('update:refundAmountInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 140 | input | 退款日期 | input: e =&gt; $emit('update:refundDateInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 141 | input | 可选，例如：平台退款到账 | input: e =&gt; $emit('update:refundNoteInput', e.target.value) | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 143 | button | 取消 | click: $emit('close-refund') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 143 | button | 确认退款 | click: $emit('confirm-refund') | A | 现有状态（待逐项验证） | S/U；见批次范围 |

### src/views/ledger-panels/TransactionImportDialog.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 223 | input | 选择微信支付或支付宝 CSV 账单 | change: onFileChange | E | 就地编辑 / 校验 | S/U；见批次范围 |
| 233 | Button | {{ busy ? '正在读取…' : fileName ? '换一个 CSV 文件' : '选择 CSV 文件' }} | click: fileInput?.click() | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 289 | Button | 上一页 | click: page -= 1 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 291 | Button | 下一页 | click: page += 1 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 299 | Checkbox | 选中或取消全部导入记录 | update:checked: setAllSelected | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 316 | Checkbox | `选择${row.name}` | update:checked: row.selected = $event === true | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 323 | Input | 修正记录日期 | update:model-value: row.date = String($event ?? '') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 332 | Input | 修正记录名称 | update:model-value: row.name = String($event ?? '') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 342 | Select | 支出 收入 退款 | update:model-value: setDirection(row, $event) | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 343 | SelectTrigger | `修改${row.name}的收支类型` | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 356 | Select | {{ category.icon }} {{ category.name }} | update:model-value: row.cat = String($event ?? '') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 357 | SelectTrigger | `修改${row.name}的分类` | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 370 | Select | {{ account }} | update:model-value: row.account = String($event ?? '') | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 371 | SelectTrigger | `修改${row.name}的账户` | 原生展开 / 链接 | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 382 | Input | 修正记录金额 | update:model-value: row.amount = String($event ?? '') | C | 就地编辑 / 校验 | S/U；见批次范围 |
| 411 | Button | 取消 | click: close | C | 现有状态（待逐项验证） | S/U；见批次范围 |
| 412 | Button | {{ busy ? '正在导入…' : `导入 ${validSelectedRows.length} 笔` }} | click: confirmImport | A | 现有状态（待逐项验证） | S/U；见批次范围 |

## 未发现静态活动入口（保留核对）

### src/components/ui/dialog/DialogClose.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | DialogClose | DialogClose | 原生展开 / 链接 | C | 现有状态（待逐项验证） | 无静态入口；待核对 |

### src/components/ui/dialog/DialogContent.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 43 | DialogClose | Close | 原生展开 / 链接 | C | 现有状态（待逐项验证） | 无静态入口；待核对 |

### src/components/ui/dialog/DialogFooter.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | DialogClose | Close | 原生展开 / 链接 | C | 现有状态（待逐项验证） | 无静态入口；待核对 |
| 22 | Button | Close | 原生展开 / 链接 | C | 现有状态（待逐项验证） | 无静态入口；待核对 |

### src/components/ui/dialog/DialogScrollContent.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | DialogClose | Close | 原生展开 / 链接 | C | 现有状态（待逐项验证） | 无静态入口；待核对 |

### src/components/ui/dialog/DialogTrigger.vue

| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | DialogTrigger | DialogTrigger | 原生展开 / 链接 | C | 现有状态（待逐项验证） | 无静态入口；待核对 |
