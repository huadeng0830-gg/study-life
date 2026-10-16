# V5 全量表单、隐藏字段与浮层源码索引

扫描当前 151 个业务 Vue 模板，识别 624 个原生/自定义输入定义、52 个 form 定义和 106 个基础浮层调用。循环按源码定义计数，不代表运行实例数量。

候选 A/B/C/D/E 仅来自 UI 标记与控件形状，用于排查，不是最终业务规则。JS/服务端校验可能更严格；尚未人工追踪的字段必须保持待验。阶段状态、真实规则、问题与验证记录见 V5_STATUS.md。

## src/components/AccountPanel.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0001 | 381 / input | 邮箱 | email | A候选 | — | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0002 | 389 / input | 密码 | password | B候选 | mode !== 'recovery' | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0003 | 396 / input | 再次输入密码 | confirmation | B候选 | mode === 'register' | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0004 | 399 / input | 显示密码 | passwordVisible | E候选 | mode !== 'recovery' | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/AppearanceSettings.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0005 | 353 / input | 自定义主题色 | customThemeColor | E候选 | themeKey === 'custom' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0006 | 356 / input | 从壁纸自动提取主题色（开启后覆盖上方选择） | autoWallpaperColor | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0007 | 359 / select | 流畅优先模式 | performanceMode | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0008 | 367 / select | 高对比度模式 | highContrastMode | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0009 | 373 / input | appearance.scheduleSkin | appearance.scheduleSkin | E候选 | skin in [{id:'classic',name:'经典表格',icon:'▦'},{id:'notebook',name:'校园笔记',icon:'📒'},{id:'timeline',name:'极简时间轴',icon:'⌁'}] | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0010 | 380 / input | 启用全站默认壁纸 | targetConfig.enabled | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0011 | 386 / input | input | — | C候选 | ownMode | change: uploadImage | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0012 | 387 / input | input | — | C候选 | ownMode | change: uploadImage | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0013 | 394 / input | 模糊 px | targetConfig.blur | E候选 | ownMode | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0014 | 395 / input | 亮度 % | targetConfig.brightness | E候选 | ownMode | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0015 | 396 / input | 遮罩 % | targetConfig.overlay | E候选 | ownMode | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0016 | 397 / input | 透明度 % | targetConfig.opacity | E候选 | ownMode | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0017 | 398 / select | 显示位置 | targetConfig.position | E候选 | ownMode | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0018 | 399 / select | 图片适应 | targetConfig.fit | E候选 | ownMode | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0019 | 410 / input | 使用壁纸自动取色 | autoWallpaperColor | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0020 | 410 / input | 壁纸主题色 | wallpaperAccent | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0021 | 416 / input | 在“今天”页显示个性化文字 | appearance.showQuote | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0022 | 417 / textarea | 励志语（每行一条，最多 50 条） | quoteDraft | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0023 | 418 / select | 显示方式 | appearance.quoteMode | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0024 | 418 / select | 固定显示 | appearance.fixedQuoteIndex | E候选 | appearance.quoteMode === 'fixed' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0025 | 419 / input | 个人签名 | appearance.signature | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0026 | 427 / input | module.visible | module.visible | E候选 | module in appearance.homeModules | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0027 | 434 / AppearanceSwipeSettings | appearance.swipeActions | appearance.swipeActions | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/CampusHome.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0028 | 29 / input | 搜索校园地点 | — | C候选 | — | emit('search', 'all') | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/DomainCsvImportButton.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0029 | 94 / input | input | — | C候选 | importAvailable | change: readFile | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/FestiveSettings.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0030 | 210 / input | 启用节日氛围 首页的祝福语与彩带 / 雪花 / 灯笼装饰 | enabled | E候选 | — | change: commit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0031 | 223 / select | 祝福语语言 | narrativeLang | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0032 | 231 / input | 我的生日（月-日） | — | C候选 | — | change: setBirthday($event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0033 | 242 / input | 开始使用日期 | — | C候选 | — | change: installDateInput = $event.target.value; commit() | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0034 | 261 / input | `纪念日 ${row.label &#124;&#124; '未命名'} 的日期` | — | C候选 | (row, index) in anniversaries | change: setAnniversaryDate(row.id, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0035 | 269 / input | '纪念日 ' + (row.label &#124;&#124; '第 ' + (index + 1) + ' 条') + ' 的名称' | — | C候选 | (row, index) in anniversaries | input: setAnniversaryLabel(row.id, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0036 | 293 / input | 农历纪念日名称 | row.label | C候选 | row in lunarAnniversaries | input: setLunarLabel(row.id, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0037 | 302 / select | 农历月份 | — | E候选 | row in lunarAnniversaries | change: setLunarMonth(row.id, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0038 | 305 / select | 农历日期 | — | E候选 | row in lunarAnniversaries | change: setLunarDay(row.id, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0039 | 309 / input | 闰月 | — | E候选 | row in lunarAnniversaries | change: setLunarLeap(row.id, $event.target.checked) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/FocusPanel.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0040 | 558 / input | 这次想专注什么 | — | D候选 | — | input: onGoalInput; focus: showRecent = true; blur: scheduleHideRecent | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0041 | 624 / input | 专注时长（分钟） | customMinutes | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/FocusSettings.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0042 | 79 / input | 快捷 分钟 | draft.quickTimes[index] | C候选 | (_, index) in 4 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0043 | 89 / input | 每组轮数 轮 | draft.pomodoroRounds | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0044 | 97 / input | 声音 专注结束时播放提示音 | draft.soundEnabled | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0045 | 98 / input | 震动 支持的移动设备会震动提醒 | draft.vibrationEnabled | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0046 | 99 / input | 系统通知 需要浏览器通知权限；未授权时自动跳过 | draft.systemNotificationEnabled | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/IcsImportButton.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0047 | 68 / input | 选择 ICS 日历文件 | — | C候选 | — | change: readFile | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/MemoryView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0048 | 153 / input | day | day | C候选 | tab === 'day' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0049 | 154 / input | month | month | C候选 | tab === 'month' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0050 | 155 / select | 选择年份 | year | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/NavigationSettings.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0051 | 265 / input | `${group.label &#124;&#124; '未命名'}分组名称` | — | C候选 | (group, groupIndex) in desktopGroups | focus: renameBatch = `rename-${++editSequence}`; input: editor.apply({ type: 'desktop:rename-group', id: group.id, label: $event.target.value }, { batch: renameBatch }); blur: renameBatch = null | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0052 | 272 / select | `将${item.label}移动到分组` | — | E候选 | (group, groupIndex) in desktopGroups && (item, itemIndex) in group.items | change: editor.apply({ type: 'desktop:move-item', id: item.id, groupId: $event.target.value }) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0053 | 278 / input | 新建分组 | newGroupLabel | C候选 | — | addGroup | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0054 | 284 / NavigationFeaturePicker | targetGroup | targetGroup | C候选 | — | pin: pin; open: requestClose | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0055 | 308 / select | 移除分组后页面的目标分组 | removalTarget | E候选 | pendingGroupRemoval | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/NoticeUnderstanding.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0056 | 536 / textarea | 粘贴原通知 | source | C候选 | !parsed &#124;&#124; editingSource | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0057 | 537 / input | 来源（可选） | sourceName | C候选 | !parsed &#124;&#124; editingSource | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0058 | 541 / select | 截图类型 | ocrKind | E候选 | !parsed &#124;&#124; editingSource | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0059 | 542 / input | input | — | C候选 | !parsed &#124;&#124; editingSource | change: readOcrImage | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0060 | 570 / select | `第 ${row.index + 1} 条通知的处理方式` | segmentProcess[row.id] | E候选 | multiMode && row in segments | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0061 | 582 / input | 你需要做什么 | parsed.actionText | C候选 | parsed && understanding && !multiMode && editingAction | blur: finishActionEdit; keydown: finishActionEdit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0062 | 583 / input | fact.label | parsed[fact.key] | C候选 | parsed && understanding && !multiMode && understanding.facts.length && fact in understanding.facts | blur: editingField = ''; keydown: editingField = '' | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0063 | 589 / input | processKey | processKey | E候选 | parsed && understanding && !multiMode && showProcessOptions && option in processOptions | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0064 | 594 / select | 选择需要调整的课程 | selectedScheduleCourseId | E候选 | parsed && understanding && !multiMode && parsed.scheduleProposal | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0065 | 602 / input | 调整日期 | parsed.scheduleProposal.date | C候选 | parsed && understanding && !multiMode && parsed.scheduleProposal | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0066 | 603 / input | 原上课日 | parsed.scheduleProposal.sourceDate | C候选 | parsed && understanding && !multiMode && parsed.scheduleProposal && parsed.scheduleProposal.sourceDate | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0067 | 604 / input | 开始节次 | parsed.scheduleProposal.periodStart | C候选 | parsed && understanding && !multiMode && parsed.scheduleProposal | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0068 | 605 / input | 结束节次 | parsed.scheduleProposal.periodEnd | C候选 | parsed && understanding && !multiMode && parsed.scheduleProposal | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0069 | 606 / input | 地点 | parsed.scheduleProposal.location | C候选 | parsed && understanding && !multiMode && parsed.scheduleProposal | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0070 | 613 / input | 替换这些安排 | scheduleConflictChoice | E候选 | parsed && understanding && !multiMode && parsed.scheduleProposal && scheduleConflicts.length | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0071 | 614 / input | 与这些安排并存 | scheduleConflictChoice | E候选 | parsed && understanding && !multiMode && parsed.scheduleProposal && scheduleConflicts.length | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0072 | 619 / input | 相似度 % | selectedId | E候选 | parsed && understanding && !multiMode && matches.length && item in matches | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0073 | 619 / input | 更新选中的原待办 | useExisting | E候选 | parsed && understanding && !multiMode && matches.length | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0074 | 621 / textarea | parsed[editingField] | parsed[editingField] | C候选 | parsed && understanding && !multiMode && editingField && extraFields.some((item) =&gt; item.key === editingField) && editingField === 'note'；更多信息，open=showMore | blur: editingField = '' | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0075 | 621 / input | parsed[editingField] | parsed[editingField] | C候选 | parsed && understanding && !multiMode && editingField && extraFields.some((item) =&gt; item.key === editingField)；更多信息，open=showMore | blur: editingField = '' | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/PromptDialog.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0076 | 89 / Input | label ? undefined : title | — | C候选 | — | update:model-value: draft = String($event); emit('input', draft); keydown: onEnter | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/QuickRecordPanel.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0077 | 103 / textarea | 快速记录内容 | input | D候选 | mode === 'record' | input: onSmartInput; compositionstart: onCompositionStart; compositionend: onCompositionEnd; keydown: onSmartKeydown; keydown: onSmartKeydown; keydown: onSmartKeydown | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0078 | 179 / input | `选择第 ${index + 1} 项记录` | draft.selected | E候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && drafts.length &gt; 1 &#124;&#124; draft.selected === false | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0079 | 203 / input | 记录标题 | draft.title | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts | input: onDraftTitleChange(draft) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0080 | 207 / input | 金额 | draft.amount | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && isFinancial(draft) | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0081 | 208 / select | `关联地点：${draft.title &#124;&#124; draft.raw}` | draft.placeId | E候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && draft.type === 'expense' && places.some((place) =&gt; !place.archivedAt) | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0082 | 209 / select | 值不值 | draft.placeValue | E候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && draft.type === 'expense' && draft.placeId | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0083 | 218 / input | draft.type === 'externalExam' ? (draft.registerDeadline ? '报名截止日期' : '考试日期') : '日期' | draft.date | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && draft.date | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0084 | 220 / input | 时间 | draft.time | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && draft.time | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0085 | 244 / select | 类型 | — | E候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id | change: onDraftTypeSelect(draft, $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0086 | 254 / input | draft.date | draft.date | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0087 | 255 / input | draft.time | draft.time | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0088 | 256 / input | 结束时间（可选） | draft.endTime | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id && draft.type === 'event' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0089 | 257 / input | 地点（可选） | draft.location | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id && !isFinancial(draft) | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0090 | 258 / input | 课程（可选） | draft.course | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id && !isFinancial(draft) | input: syncDraftCourse(draft) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0091 | 259 / select | 分类 | draft.category | E候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id && isFinancial(draft) | change: confirmCategory(draft) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0092 | 260 / input | 账户 | draft.account | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id && ['expense', 'income', 'bill'].includes(draft.type) | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0093 | 261 / select | 优先级 | draft.priority | E候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id && ['todo', 'homework'].includes(draft.type) | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0094 | 262 / select | 重复 | draft.cycle | E候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id && draft.type === 'bill' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0095 | 263 / textarea | 备注（可选） | draft.note | C候选 | mode === 'record' && hasDrafts && (draft, index) in drafts && expandedId === draft.id | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/QuickRecordSettings.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0096 | 26 / input | 提示剪贴板内容 打开快速记录时仅提示可识别文本，不会自动创建记录。 | settings.clipboardHint | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0097 | 30 / select | 日期与时间 今天页、提醒和快速记录使用同一时区计算。 | timezone | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0098 | 31 / input | 默认账户 未在记录中说明账户时，普通记账和快速记录都使用此值。 | defaultAccount | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0099 | 36 / input | 待办提醒（分钟） | taskReminder | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0100 | 37 / input | 日程提醒（分钟） | eventReminder | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0101 | 38 / input | 节点提醒（分钟） | milestoneReminder | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/SearchPanel.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0102 | 323 / input | 搜索内容 | query | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/Sidebar.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0103 | 601 / Toast | toast.open | toast.open | C候选 | — | action: () =&gt; {}; close: toast.open = false | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/StudyQuestionMode.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0104 | 60 / textarea | 你想查什么？ | question | C候选 | — | keydown: ask(); keydown: ask() | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/SwipeActionSelector.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0105 | 39 / select | select | — | E候选 | — | change: emit('update:modelValue', $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/TimeWheelSheet.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0106 | 77 / WheelPicker | hour | hour | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0107 | 82 / WheelPicker | minute | minute | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/account/AccountCommunitySettings.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0108 | 117 / input | 昵称 | draft.nickname | B候选 | section === 'profile' | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0109 | 118 / input | 学校 | draft.school | C候选 | section === 'profile' | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0110 | 119 / input | 当前校区 | draft.campus | C候选 | section === 'profile' | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0111 | 120 / select | 时区 | draft.timezone | E候选 | section === 'profile' | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0112 | 122 / input | draft.availabilityPreferences.weekdays | draft.availabilityPreferences.weekdays | E候选 | section === 'profile' && (label, day) in INVITATION_WEEKDAYS；可约偏好（选填），open=默认折叠 | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0113 | 122 / input | 每天开始 | draft.availabilityPreferences.startTime | C候选 | section === 'profile'；可约偏好（选填），open=默认折叠 | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0114 | 122 / input | 每天结束 | draft.availabilityPreferences.endTime | C候选 | section === 'profile'；可约偏好（选填），open=默认折叠 | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0115 | 122 / select | 最短时长 | draft.availabilityPreferences.minimumMinutes | E候选 | section === 'profile'；可约偏好（选填），open=默认折叠 | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0116 | 122 / select | 课程前后缓冲 | draft.availabilityPreferences.classBufferMinutes | E候选 | section === 'profile'；可约偏好（选填），open=默认折叠 | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0117 | 123 / input | 允许好友使用完整邮箱精确搜索我 默认关闭，邮箱不会公开展示；关闭搜索时也不会泄露账号是否存在。 | draft.emailDiscoverable | E候选 | section === 'profile' | saveProfile | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/account/AccountPasswordForm.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0118 | 77 / input | 当前密码 | currentPassword | B候选 | !recovery | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0119 | 82 / input | 新密码 | password | A候选 | — | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0120 | 88 / input | 再次输入新密码 | confirmation | A候选 | — | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0121 | 91 / input | 显示密码 | visible | E候选 | — | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/campus/CampusCommunityAdmin.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0122 | 167 / input | 月份 | currentMonth | C候选 | mode === 'audits' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0123 | 176 / input | 授权学校 | formFor(row.id).school | C候选 | mode === 'applications' && row in rows && row.status === 'pending' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0124 | 176 / input | 授权校区 | formFor(row.id).campus | C候选 | mode === 'applications' && row in rows && row.status === 'pending' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0125 | 176 / textarea | 审批依据或补充材料要求 | formFor(row.id).reason | C候选 | mode === 'applications' && row in rows && row.status === 'pending' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0126 | 186 / textarea | 复核依据 | formFor(row.id).reason | C候选 | mode === 'audits' && row in rows | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0127 | 187 / input | 错判时重新放回待审核队列 | formFor(row.id).reopen | E候选 | mode === 'audits' && row in rows && !['report','help_dispute'].includes(row.event?.target_type) | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0128 | 197 / select | 公开状态 | formFor(row.id).status | E候选 | row in rows | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0129 | 197 / select | 公开方式 | formFor(row.id).visibility | E候选 | row in rows | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0130 | 197 / textarea | 管理员公开回复 | formFor(row.id).reply | C候选 | row in rows | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0131 | 197 / textarea | 暂不采纳说明 | formFor(row.id).publicReason | C候选 | row in rows | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0132 | 197 / input | 解决奖励（0–20） 本条已发放 个贡献豆，不会重复发放。 奖励只在状态为“已解决”时发放一次。 | formFor(row.id).reward | C候选 | row in rows | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0133 | 198 / input | 站内私信内容 | formFor(row.id).message | C候选 | row in rows；与提交人站内联系，open=默认折叠 | sendMessage(row) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/campus/CampusContentActions.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0134 | 87 / select | 原因 | reportReason | E候选 | reportOpen | submitReport | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0135 | 88 / textarea | 补充说明 | reportDetail | C候选 | reportOpen | submitReport | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/campus/CampusDirectoryFilter.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0136 | 22 / Input | label | — | C候选 | — | update:model-value: emit('update:query', String($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0137 | 23 / NativeSelect | 筛选分类 | — | E候选 | options.length | update:model-value: emit('update:category', String($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/campus/CampusPrivateChat.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0138 | 144 / textarea | 消息内容 | draft | A候选 | — | send | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/campus/CampusReviewItem.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0139 | 57 / textarea | 说明核查事实、来源和处理依据；审核结论需要留档 | reason | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/campus/CampusReviewerManager.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0140 | 93 / Input | 查找已注册账号 | search | A候选 | — | findAccounts | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0141 | 96 / NativeSelect | 授权账号 | selected | E候选 | candidates.length | save(true) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0142 | 97 / Input | 学校 | school | B候选 | candidates.length | save(true) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0143 | 98 / Input | 校区 | campus | C候选 | candidates.length | save(true) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0144 | 99 / Input | 操作原因 | reason | B候选 | candidates.length | save(true) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0145 | 107 / Input | 撤销原因 | reason | C候选 | revokeTarget | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/data/AccountSyncPanel.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0146 | 126 / input | 保留本机 | choices[accountConflictKey(conflict)] | E候选 | accountUser && accountSyncConflicts.length && (conflict, index) in accountSyncConflicts | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0147 | 126 / input | 使用云端 | choices[accountConflictKey(conflict)] | E候选 | accountUser && accountSyncConflicts.length && (conflict, index) in accountSyncConflicts | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/data/AppUpdateSection.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0148 | 215 / input | 自动检查更新 启动、联网或重新打开应用时检查，最多每 10 分钟一次。 | — | E候选 | 更新偏好，open=默认折叠 | change: changePreference('autoCheck', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0149 | 219 / input | 在导航中显示新版本提醒 仅显示轻量标记，不会自动刷新正在使用的页面。 | — | E候选 | 更新偏好，open=默认折叠 | change: changePreference('showReminder', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0150 | 260 / textarea | 更新诊断信息 | — | D候选 | 更新来源与诊断，open=默认折叠 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/data/BackupSection.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0151 | 38 / input | 同时包含壁纸图片 换设备时可一起恢复；图片较多时，文件会更大。 | includeWallpapers | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/data/RestorePreview.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0152 | 20 / input | 备份： 本机： 备份中的 为空，恢复后会清空对应记录。 | restoreSelection | E候选 | summary && row in rows | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0153 | 21 / input | 壁纸图片 备份中有 张图片，将替换本机壁纸。 | restoreSelection | E候选 | summary && summary.wallpapers | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/data/RestoreSection.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0154 | 15 / input | 选择要恢复的备份文件 | — | C候选 | — | change: selectFile | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/events/EventCalendar.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0155 | 53 / input | 跳转月份 | — | C候选 | — | change: $emit('month', $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/learning/StudyPlanner.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0156 | 80 / input | 学习计划日期 | chosenDate | C候选 | visible | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/navigation/NavigationFeaturePicker.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0157 | 37 / input | 搜索可用功能 | query | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0158 | 38 / select | 筛选可用功能 | filter | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0159 | 40 / select | 添加功能的目标分组 | — | E候选 | mode === 'desktop' | change: emit('update:targetGroup', $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/BatchImportModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0160 | 248 / textarea | 批量录入课程文本 | — | C候选 | show | input: onTextInput; paste: onTextPaste; keydown: ; click:  | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0161 | 261 / input | 🔄 📷 上传图片识别 | — | C候选 | show | change: onFileChange | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0162 | 266 / input | ✂️ 先框选再识别（单张） | — | C候选 | show | change: onCropFileChange | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0163 | 270 / input | 📊 上传 Excel 自动识别 | — | C候选 | show | change: onExcelFileChange | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0164 | 306 / input | 课程名称 | reviewDraft.name | C候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0165 | 307 / select | 星期 | reviewDraft.day | E候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0166 | 308 / select | 开始节次 | reviewDraft.start | E候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0167 | 309 / select | 结束节次 | reviewDraft.end | E候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0168 | 310 / select | 开始周 | reviewDraft.startWeek | E候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | change: onStartWeekChange | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0169 | 311 / select | 结束周 | reviewDraft.endWeek | E候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0170 | 312 / select | 单双周 | reviewDraft.weekType | E候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0171 | 313 / input | 地点 | reviewDraft.room | C候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0172 | 314 / input | 教师 | reviewDraft.teacher | C候选 | show && reviewRows.length && row in reviewRows && editingSourceIndex === row.sourceIndex | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/CourseEditorModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0173 | 160 / input | 课程名称 * | draft.name | A候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0174 | 170 / input | 任课老师 | draft.teacher | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0175 | 173 / input | 上课地点 | draft.room | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0176 | 176 / select | 校区 | draft.campusId | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0177 | 177 / input | 提前出发（分钟） | draft.travelMinutes | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0178 | 181 / select | 星期 | draft.day | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0179 | 182 / select | 开始 | draft.start | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0180 | 183 / select | 结束 | draft.end | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0181 | 187 / select | 开始周 | draft.startWeek | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0182 | 188 / select | 结束周 | draft.endWeek | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0183 | 189 / select | 上课周类型 | draft.weekType | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/CourseManagerModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0184 | 74 / input | `选择课程 ${course.name}` | — | E候选 | courses.length && course in courses | change: emit('toggle-course', course.id) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0185 | 86 / input | 学期课表模板名称 | — | C候选 | — | input: emit('update:template-name', $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/ExceptionsModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0186 | 396 / input | form.date | form.date | C候选 | show | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0187 | 400 / input | 结束日期 只停一天时，与开始日期相同 | form.endDate | C候选 | show && form.type === 'off' | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0188 | 405 / select | 采用哪一周的课表 单双周按此周次计算 | form.sourceWeek | E候选 | show && form.type === 'makeup' | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0189 | 412 / select | 采用星期几的课表 保留课程原节次 | form.sourceDay | E候选 | show && form.type === 'makeup' | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0190 | 425 / input | 搜索可选课程 | search | C候选 | show && isSessionType && selectableCourses.length &gt; 6 | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0191 | 432 / input | input | — | E候选 | show && isSessionType && course in filteredCourses | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0192 | 447 / select | `${courseNameOf(slot.courseId)}补课开始节次` | — | E候选 | show && form.type === 'session_makeup' && form.courseSlots.length && slot in form.courseSlots | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0193 | 454 / select | `${courseNameOf(slot.courseId)}补课结束节次` | slot.end | E候选 | show && form.type === 'session_makeup' && form.courseSlots.length && slot in form.courseSlots | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0194 | 467 / input | 备注（可选） | form.note | C候选 | show | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0195 | 479 / select | 筛选已保存安排 | listFilter | E候选 | show | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/ImportConflictModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0196 | 95 / select | `${item.course.name} 的处理方式` | — | E候选 | show && draft && item in actionable | change: emit('decision', item.index, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/RecognitionSchemeDetailModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0197 | 66 / input | 新校区名 | — | C候选 | schemeDetailOpen && !!activeScheme && activeScheme && !activeScheme.target.campusId | input: updateSchemeTarget(activeScheme, { newCampusName: $event.target.value }) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0198 | 92 / input | 新方案名 | — | C候选 | schemeDetailOpen && !!activeScheme && activeScheme && !activeScheme.target.seasonId | input: updateSchemeTarget(activeScheme, { newSeasonName: $event.target.value }) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0199 | 126 / input | 节次名称 | row.label | C候选 | schemeDetailOpen && !!activeScheme && activeScheme && (row, index) in activeSchemeRows | input: onSchemeRowInput(row) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0200 | 127 / input | 开始时间 | row.start | C候选 | schemeDetailOpen && !!activeScheme && activeScheme && (row, index) in activeSchemeRows | input: onSchemeRowInput(row) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0201 | 129 / input | 结束时间 | row.end | C候选 | schemeDetailOpen && !!activeScheme && activeScheme && (row, index) in activeSchemeRows | input: onSchemeRowInput(row) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/ScheduleNote.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0202 | 17 / textarea | 课程表备注 | note | C候选 | — | input: resize | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/SemesterModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0203 | 32 / input | 本学期第一周的周一日期 * | value | B候选 | show | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/TimeBaseSettings.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0204 | 185 / input | `校区名称：${campus.name}` | — | C候选 | campus in timeConfig.campuses | change: renameCampus(campus.id, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0205 | 199 / input | 新校区名称 | newCampusName | C候选 | — | keyup: onAddCampus | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0206 | 214 / input | `作息季名称：${season.name}` | — | C候选 | season in timeConfig.seasons | change: renameSeason(season.id, $event.target.value, null) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0207 | 220 / input | `作息季生效日期（MM-DD）：${season.name}` | — | C候选 | season in timeConfig.seasons | blur: onSeasonDateChange(season, $event.target.value, $event.target) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0208 | 252 / input | 新作息季名称 | newSeasonName | C候选 | — | keyup: onAddSeason | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0209 | 253 / input | 新作息季生效日期（MM-DD） | newSeasonDate | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0210 | 265 / input | `节次名称：${period.label}` | — | C候选 | period in timeConfig.periods | change: renamePeriod(period.id, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0211 | 283 / input | 新节次名称 | newPeriodLabel | C候选 | — | keyup: onAddPeriod | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/TimeGeneratePanel.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0212 | 36 / select | 从 开始 | gen.startId | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0213 | 42 / input | 上课 | gen.startTime | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0214 | 47 / input | 每节 分钟 | gen.duration | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0215 | 52 / input | 节间休息 分钟 | gen.breakMin | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0216 | 57 / select | 午休：第 后 分钟（0=不休） | gen.lunchAfterIdx | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0217 | 61 / input | 午休：第 后 分钟（0=不休） | gen.lunchMin | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0218 | 66 / select | 晚休：第 后 分钟（0=不休） | gen.dinnerAfterIdx | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0219 | 70 / input | 晚休：第 后 分钟（0=不休） | gen.dinnerMin | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/TimeImportPlanModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0220 | 90 / select | `${item.label} 的处理方式` | — | E候选 | importPlanOpen && !importRunning && importPlan && item in importPlan.items | change: setPlanItemAction(item, $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/schedule/TimeSettingsModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0221 | 353 / select | 批量调整起始节次 | batchFrom | E候选 | show && settingsTab === 'plans' && batchOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0222 | 357 / select | 批量调整结束节次 | batchTo | E候选 | show && settingsTab === 'plans' && batchOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0223 | 360 / select | 批量调整偏移量 | batchDelta | E候选 | show && settingsTab === 'plans' && batchOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0224 | 371 / input | 批量调整自定义分钟数 | batchCustom | C候选 | show && settingsTab === 'plans' && batchOpen && batchDelta === 0 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0225 | 404 / textarea | 粘贴作息时间 | pasteText | C候选 | show && settingsTab === 'plans' && importOpen && importTab === 'paste' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0226 | 418 / input | 🔄 📷 上传学校官方作息表图片 | — | C候选 | show && settingsTab === 'plans' && importOpen | change: onImportImage | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0227 | 446 / input | input | — | E候选 | show && settingsTab === 'plans' && importOpen && recognitionDraft && scheme in recognitionDraft.schemes | change: toggleSchemeSelected(scheme) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0228 | 481 / input | `${row.period.label} 开始时间` | draft[row.index].start | C候选 | show && settingsTab === 'plans' && section in planSections && row in section.rows | input: markDirty | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0229 | 488 / input | `${row.period.label} 结束时间` | draft[row.index].end | C候选 | show && settingsTab === 'plans' && section in planSections && row in section.rows | input: markDirty | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/tasks/TaskBulkRescheduleDialog.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0230 | 49 / input | 天数 | days | C候选 | — | emit('apply', { direction, days: amount() }) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/tasks/TaskRescheduleDialog.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0231 | 47 / input | 新的截止日期 | draft.dueDate | C候选 | 单独调整事项截止时间，open=Boolean(initialDate) &#124;&#124; !task.timeStages?.length | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0232 | 49 / input | 截止时间（选填） | draft.dueTime | C候选 | 单独调整事项截止时间，open=Boolean(initialDate) &#124;&#124; !task.timeStages?.length | save | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/tasks/TaskTimeEditor.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0233 | 125 / input | 阶段名称（选填） | — | C候选 | (stage, index) in modelValue && expandedId === stage.id && modelValue.length &gt; 1 &#124;&#124; stage.label | input: patch(index, { label: valueOf($event) }) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0234 | 126 / select | 这段时间用来… | — | E候选 | (stage, index) in modelValue && expandedId === stage.id | change: setPurpose(index, valueOf($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0235 | 127 / input | 全天占用安排 | — | E候选 | (stage, index) in modelValue && expandedId === stage.id && stage.kind === 'scheduled' | change: setAllDay(index, checkedOf($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0236 | 129 / input | 日期（可待定） | — | C候选 | (stage, index) in modelValue && expandedId === stage.id && anchor in (['start', 'end']) | input: boundary(index, anchor, 'date', valueOf($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0237 | 131 / input | 时刻 | — | C候选 | (stage, index) in modelValue && expandedId === stage.id && anchor in (['start', 'end']) && !stage.allDay && timeVisible[`${stage.id}:${anchor}`] &#124;&#124; stage[anchor]?.time | input: boundary(index, anchor, 'time', valueOf($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0238 | 139 / input | 启用此提醒 | — | E候选 | (stage, index) in modelValue && expandedId === stage.id && (item, reminderIndex) in stage.reminders &#124;&#124; []；阶段提醒，open=默认折叠 | change: reminder(index, reminderIndex, 'enabled', checkedOf($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0239 | 140 / select | 提醒端点 | — | E候选 | (stage, index) in modelValue && expandedId === stage.id && (item, reminderIndex) in stage.reminders &#124;&#124; []；阶段提醒，open=默认折叠 | change: reminder(index, reminderIndex, 'anchor', valueOf($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0240 | 140 / input | 提前（分钟） | — | C候选 | (stage, index) in modelValue && expandedId === stage.id && (item, reminderIndex) in stage.reminders &#124;&#124; []；阶段提醒，open=默认折叠 | input: reminder(index, reminderIndex, 'minutesBefore', valueOf($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0241 | 141 / input | 日期提醒时刻 | — | C候选 | (stage, index) in modelValue && expandedId === stage.id && (item, reminderIndex) in stage.reminders &#124;&#124; [] && !stage[item.anchor]?.time；阶段提醒，open=默认折叠 | input: reminder(index, reminderIndex, 'dateOnlyTime', valueOf($event)) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/tasks/TaskTimeShift.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0242 | 49 / select | 移动方向 | duration.direction | E候选 | expanded | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0243 | 51 / input | 天 | duration.days | C候选 | expanded | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0244 | 52 / input | 小时 | duration.hours | C候选 | expanded | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0245 | 53 / input | 分钟 | duration.minutes | C候选 | expanded | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0246 | 58 / input | 同时移动事项截止时间 | includeDeadline | E候选 | expanded && task.dueDate | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0247 | 61 / input | `${item.label}的原时刻` | dateOnlyTimes[item.key] | C候选 | expanded && preview.dateOnlyBoundaries.length && item in preview.dateOnlyBoundaries | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/components/tasks/TaskWorkCheckpointFields.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0248 | 25 / textarea | 上次做到 | — | D候选 | 断点续做 记录进度、卡点和下一步，open=alwaysOpen &#124;&#124; Boolean(editing && (form.checkpointLastStep &#124;&#124; form.checkpointBlocker &#124;&#124; form.checkpointNextStep &#124;&#124; form.checkpointResources)) | input: updateField('checkpointLastStep', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0249 | 27 / textarea | 遇到的问题 | — | D候选 | 断点续做 记录进度、卡点和下一步，open=alwaysOpen &#124;&#124; Boolean(editing && (form.checkpointLastStep &#124;&#124; form.checkpointBlocker &#124;&#124; form.checkpointNextStep &#124;&#124; form.checkpointResources)) | input: updateField('checkpointBlocker', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0250 | 29 / textarea | 下一步 | — | D候选 | 断点续做 记录进度、卡点和下一步，open=alwaysOpen &#124;&#124; Boolean(editing && (form.checkpointLastStep &#124;&#124; form.checkpointBlocker &#124;&#124; form.checkpointNextStep &#124;&#124; form.checkpointResources)) | input: updateField('checkpointNextStep', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0251 | 31 / textarea | 资料链接（每行一条） | — | D候选 | 断点续做 记录进度、卡点和下一步，open=alwaysOpen &#124;&#124; Boolean(editing && (form.checkpointLastStep &#124;&#124; form.checkpointBlocker &#124;&#124; form.checkpointNextStep &#124;&#124; form.checkpointResources)) | input: updateField('checkpointResources', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/AdminCenterView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0252 | 506 / input | 待办超过多少天算陈旧 | healthThresholdDraft.staleTaskDays | C候选 | 体检阈值设置，open=默认折叠 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0253 | 509 / input | 通知超过多少天算未处理 | healthThresholdDraft.unhandledNoticeDays | C候选 | 体检阈值设置，open=默认折叠 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0254 | 512 / input | 收支金额上限（元） | healthThresholdDraft.maxTransactionAmount | C候选 | 体检阈值设置，open=默认折叠 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0255 | 536 / select | `为记录 ${sample.id} 重新关联课程` | healthCourseSelections[sample.id] | E候选 | issue in dataHealthItems && sample in issue.samples && issue.fix === 'reassign-or-archive' && (issue.kind.startsWith('orphan-task') &#124;&#124; issue.kind.startsWith('orphan-event'))；条，open=默认折叠 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0256 | 544 / select | `为记录 ${sample.id} 选择目标分类` | healthCategorySelections[sample.id] | E候选 | issue in dataHealthItems && sample in issue.samples && issue.fix === 'merge-category-or-archive'；条，open=默认折叠 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0257 | 653 / textarea | 管理中心诊断信息 | — | D候选 | 复制诊断信息，open=默认折叠 | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0258 | 663 / Toast | toast.open | toast.open | C候选 | — | close: toast.open = false | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/CourseArchiveView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0259 | 204 / input | 搜索课程、老师或地点 | search | C候选 | !courseId | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0260 | 233 / select | 切换课程 | — | E候选 | profile && course | change: switchCourse | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0261 | 269 / Toast | toast.open | toast.open | C候选 | — | close: toast.open = false | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/EventsView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0262 | 211 / input | 搜索日程 | query | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0263 | 256 / input | 日程内容 | form.title | C候选 | formOpen | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0264 | 258 / input | 日期 | form.date | C候选 | formOpen | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0265 | 267 / input | 地点 | form.location | C候选 | formOpen | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0266 | 269 / select | 关联课程 | form.courseId | E候选 | formOpen | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0267 | 270 / input | 课程名称 | form.courseName | D候选 | formOpen | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0268 | 273 / input | 提醒我 | form.reminderEnabled | E候选 | formOpen | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0269 | 274 / input | 提前 分钟 | form.reminderMinutes | C候选 | formOpen && form.reminderEnabled | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0270 | 278 / textarea | 备注 | form.note | C候选 | formOpen | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0271 | 294 / TimeWheelSheet | wheelValue | wheelValue | C候选 | — | close: wheelField = '' | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0272 | 297 / Toast | toast.open | toast.open | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ExamsView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0273 | 521 / input | 显示已结束 | showPast | E候选 | !showHistory | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0274 | 540 / Input | 搜索重要日期 | query | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0275 | 541 / select | 范围 | periodFilter | E候选 | !showHistory | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0276 | 542 / select | 排序 | sortKey | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0277 | 654 / input | `确认携带${entry.name}` | — | E候选 | isMilestoneCard(item) && item.kind === 'externalExam' && (entry, index) in item.requiredItems &#124;&#124; [] | change: toggleRequiredItem(item, index) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0278 | 690 / Calendar | selectedCalendarDate | selectedCalendarDate | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0279 | 743 / input | 名称 * | form.name | B候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0280 | 748 / input | 目标日期 * | form.date | B候选 | showForm && form.category !== '校外考试' | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0281 | 750 / input | 考试日期 | form.examDate | C候选 | showForm && form.category === '校外考试' | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0282 | 754 / select | 类型 | form.category | E候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0283 | 764 / input | 报名开始（选填） | form.registerStart | C候选 | showForm && form.category === '校外考试' | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0284 | 765 / input | 报名截止 | form.registerDeadline | C候选 | showForm && form.category === '校外考试' | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0285 | 772 / Input | 考点 / 考场 | form.venue | C候选 | showForm && form.category === '校外考试'；考场与用品（选填），open=Boolean(editingId) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0286 | 773 / Input | 校区 | form.campus | C候选 | showForm && form.category === '校外考试'；考场与用品（选填），open=Boolean(editingId) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0287 | 776 / Input | 座位号 | form.seatNo | C候选 | showForm && form.category === '校外考试'；考场与用品（选填），open=Boolean(editingId) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0288 | 777 / Input | 准考证号 | form.admissionNo | C候选 | showForm && form.category === '校外考试'；考场与用品（选填），open=Boolean(editingId) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0289 | 782 / input | `用品 ${index + 1} 名称` | entry.name | C候选 | showForm && form.category === '校外考试' && (entry, index) in form.requiredItems；考场与用品（选填），open=Boolean(editingId) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0290 | 783 / input | `${entry.name}数量` | entry.quantity | C候选 | showForm && form.category === '校外考试' && (entry, index) in form.requiredItems；考场与用品（选填），open=Boolean(editingId) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0291 | 784 / input | `${entry.name}单位` | entry.unit | C候选 | showForm && form.category === '校外考试' && (entry, index) in form.requiredItems；考场与用品（选填），open=Boolean(editingId) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0292 | 787 / Input | 新增考试用品 | newRequiredItemName | C候选 | showForm && form.category === '校外考试'；考场与用品（选填），open=Boolean(editingId) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0293 | 800 / input | （选填） | form.time | C候选 | showForm && form.category !== '校外考试'；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0294 | 801 / input | （选填） | form.examTime | C候选 | showForm；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0295 | 805 / select | 重复 | form.repeat | E候选 | showForm && form.category !== '校外考试'；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0296 | 815 / Input | 地点 | form.location | C候选 | showForm && form.category !== '校外考试'；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0297 | 818 / textarea | 备注 | form.note | C候选 | showForm；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0298 | 821 / input | 提前提醒（分钟） | form.reminderMinutes | C候选 | showForm；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0299 | 825 / select | 关联课程 | form.courseId | E候选 | showForm && form.category === '学习'；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0300 | 826 / input | 复习完成度 % | form.reviewProgress | E候选 | showForm && form.category === '学习'；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0301 | 830 / input | 在列表顶部显示 | form.pinned | E候选 | showForm；时间、提醒与更多信息（选填），open=Boolean(editingId) &#124;&#124; ['time', 'examTime', 'reminder'].includes(errorField) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0302 | 855 / Toast | toast.open | toast.open | C候选 | — | action: () =&gt; {}; close: toast.open = false | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/LedgerView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0303 | 965 / input | 新增分类名称 | newCatName | C候选 | showCatManage | input: categoryFeedback = null; keydown: addCategory | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0304 | 1006 / Toast | toast.open | toast.open | C候选 | — | action: () =&gt; {}; close: toast.open = false | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ListsView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0305 | 534 / input | 搜索清单 | listQuery | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0306 | 542 / select | 选择清单 | activeId | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0307 | 582 / input | 快速添加一项 | quickName | C候选 | activeList | addQuickItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0308 | 595 / input | 搜索当前清单事项 | query | C候选 | activeList | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0309 | 596 / select | 按分类筛选 | category | E候选 | activeList | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0310 | 597 / select | 清单事项排序 | sort | E候选 | activeList | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0311 | 601 / input | 全选当前结果 | — | E候选 | activeList && bulkMode | change: selectVisible | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0312 | 608 / input | `选择${checklistItemName(item)}` | — | E候选 | activeList && visibleItems.length && bulkMode | change: toggleSelection(item.id) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0313 | 637 / input | 清单名称 * | listName | B候选 | showListForm | saveList | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0314 | 639 / select | 清单类型 | listType | E候选 | showListForm | saveList | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0315 | 642 / input | 成员名单 | dutyMembersInput | C候选 | showListForm && isDutyForm | saveList | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0316 | 649 / select | 排班星期 | dutyWeekday | E候选 | showListForm && isDutyForm | saveList | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0317 | 650 / input | 每周生成下一期 | dutyRepeatEnabled | E候选 | showListForm && isDutyForm | saveList | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0318 | 652 / input | 本学期起始日期 | dutySemesterStartDate | C候选 | showListForm && isDutyForm | saveList | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0319 | 655 / input | 购物预算（元，选填） | listBudget | C候选 | showListForm && listType === 'shopping' | saveList | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0320 | 665 / input | 事项名称 * | itemForm.name | B候选 | showItemForm | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0321 | 667 / input | 值日日期 | itemForm.dueDate | C候选 | showItemForm && formList?.dutyEnabled | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0322 | 668 / input | 负责同学 | itemForm.assignedTo | C候选 | showItemForm && formList?.dutyEnabled | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0323 | 669 / input | 代班同学 | itemForm.substitutedBy | C候选 | showItemForm && formList?.dutyEnabled | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0324 | 672 / input | 数量 | itemForm.quantity | C候选 | showItemForm | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0325 | 673 / input | 单位 | itemForm.unit | C候选 | showItemForm | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0326 | 674 / input | 单价（元） | itemForm.price | C候选 | showItemForm && formList?.type === 'shopping' | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0327 | 677 / input | 分类 | itemForm.category | C候选 | showItemForm | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0328 | 678 / textarea | 备注 | itemForm.note | C候选 | showItemForm | saveItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0329 | 687 / textarea | 粘贴或输入事项 | bulkText | C候选 | showBulkForm | saveBulkItems | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0330 | 688 / input | 跳过已有事项和本次输入中的同名事项 | skipDuplicates | E候选 | showBulkForm | saveBulkItems | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0331 | 696 / Toast | toast.open | toast.open | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/NoticesView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0332 | 127 / input | 来源（可选） | sourceInput | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0333 | 128 / textarea | 通知原文 | rawInput | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0334 | 144 / select | 状态 | statusFilter | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0335 | 145 / select | 来源 | sourceFilter | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0336 | 146 / select | 主题 | topicFilter | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0337 | 154 / select | 关联地点 | offerDraft.placeId | B候选 | item in visible && offerNoticeId === item.id | saveOfferLink(item) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0338 | 155 / input | 优惠名称 | offerDraft.title | B候选 | item in visible && offerNoticeId === item.id | saveOfferLink(item) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0339 | 156 / input | 核销实付（元） | offerDraft.price | B候选 | item in visible && offerNoticeId === item.id | saveOfferLink(item) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0340 | 156 / input | 原价（可选） | offerDraft.originalPrice | C候选 | item in visible && offerNoticeId === item.id | saveOfferLink(item) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0341 | 156 / input | 有效期（可选） | offerDraft.expiresAt | C候选 | item in visible && offerNoticeId === item.id | saveOfferLink(item) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0342 | 157 / input | 说明（最多 50 字） | offerDraft.note | C候选 | item in visible && offerNoticeId === item.id | saveOfferLink(item) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/PlacesView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0343 | 635 / input | ⌕ 搜索校园地点 清除 | searchQuery | C候选 | section === 'discover' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0344 | 640 / select | 细分类 | selectedType | E候选 | section === 'discover' && selectedCategory !== 'all' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0345 | 664 / select | 问题类型 | reportReason | E候选 | section === 'discover' && filteredPlaces.length && place in filteredPlaces && reportTarget?.id === place.id | submitReport | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0346 | 664 / input | 补充说明（最多 50 字） | reportDetail | C候选 | section === 'discover' && filteredPlaces.length && place in filteredPlaces && reportTarget?.id === place.id | submitReport | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0347 | 676 / input | 地点名称 | placeForm.name | B候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0348 | 677 / select | 地点类别 | — | E候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0349 | 678 / input | 校区 | placeForm.campus | C候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0350 | 679 / input | 区域 | placeForm.area | C候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0351 | 680 / input | 相对位置 | placeForm.placeHint | C候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0352 | 681 / input | 开放时间（选填） | placeForm.openingHours | C候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0353 | 685 / input | 到访日期 | placeForm.visitedAt | B候选 | showPlaceForm && section === 'mine' && placeSaveMode === 'visited' && !editingPlaceId | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0354 | 686 / input | 本次消费（选填） ¥ | placeForm.price | C候选 | showPlaceForm && section === 'mine' && placeSaveMode === 'visited' && !editingPlaceId | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0355 | 687 / select | 关联账本记录（选填） | placeForm.transactionId | E候选 | showPlaceForm && section === 'mine' && placeSaveMode === 'visited' && !editingPlaceId | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0356 | 690 / select | 综合体验（1–5 分，可选） | placeForm.scores.rating | E候选 | showPlaceForm && section === 'mine' && placeSaveMode === 'visited' &#124;&#124; (editingPlaceId && visitsForPlace(editingPlaceId).length) | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0357 | 692 / input | placeForm.scores[field.key] | placeForm.scores[field.key] | C候选 | showPlaceForm && section === 'mine' && placeSaveMode === 'visited' &#124;&#124; (editingPlaceId && visitsForPlace(editingPlaceId).length) && field in scoreFields && field.type === 'number' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0358 | 693 / select | placeForm.scores[field.key] | placeForm.scores[field.key] | E候选 | showPlaceForm && section === 'mine' && placeSaveMode === 'visited' &#124;&#124; (editingPlaceId && visitsForPlace(editingPlaceId).length) && field in scoreFields && field.type === 'boolean' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0359 | 694 / select | placeForm.scores[field.key] | placeForm.scores[field.key] | E候选 | showPlaceForm && section === 'mine' && placeSaveMode === 'visited' &#124;&#124; (editingPlaceId && visitsForPlace(editingPlaceId).length) && field in scoreFields | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0360 | 696 / select | 值不值 | placeForm.scores.value | E候选 | showPlaceForm && section === 'mine' && placeSaveMode === 'visited' &#124;&#124; (editingPlaceId && visitsForPlace(editingPlaceId).length) | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0361 | 698 / textarea | 地点简介（提交审核后可能公开） | placeForm.description | C候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0362 | 699 / textarea | 服务、菜单或价格（选填） | placeForm.serviceInfo | C候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0363 | 700 / input | 公开业务联系方式（选填） | placeForm.publicContact | C候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0364 | 701 / input | 信息来源说明（ ） | placeForm.sourceInfo | B候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0365 | 702 / textarea | 私人备注（最多 50 字，仅本机） | placeForm.note | C候选 | showPlaceForm && section === 'mine' | savePlace | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0366 | 710 / input | ⌕ 搜索我的地点 清除 | searchQuery | C候选 | section === 'mine' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0367 | 716 / select | 细分类 | selectedType | E候选 | section === 'mine' && selectedCategory !== 'all' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0368 | 748 / select | 好友 | selectedInviteFriendId | E候选 | section === 'invites' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0369 | 752 / input | · · | selectedInvitePlaceIds | E候选 | section === 'invites' && place in scoredPlacesForInvite | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0370 | 755 / input | 我确认把上面选中的地点副本上传并发送给这位好友。 | inviteConsent | E候选 | section === 'invites' && selectedInvitePlaces.length | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0371 | 780 / select | 地点 | offerPlaceId | B候选 | section === 'offers' && offerFormOpen | saveOffer | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0372 | 780 / input | 优惠名称 | offerForm.title | B候选 | section === 'offers' && offerFormOpen | saveOffer | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0373 | 780 / input | 核销实付（元） | offerForm.price | B候选 | section === 'offers' && offerFormOpen | saveOffer | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0374 | 780 / input | 原价（可选） | offerForm.originalPrice | C候选 | section === 'offers' && offerFormOpen | saveOffer | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0375 | 780 / input | 有效期（可选） | offerForm.expiresAt | C候选 | section === 'offers' && offerFormOpen | saveOffer | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0376 | 780 / input | 说明（最多 50 字） | offerForm.note | C候选 | section === 'offers' && offerFormOpen | saveOffer | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0377 | 787 / input | 到访日期 | visitForm.visitedAt | B候选 | showVisitForm | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0378 | 787 / input | 消费金额（可选） | visitForm.price | C候选 | showVisitForm | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0379 | 787 / select | 关联收支（可选） | visitForm.transactionId | E候选 | showVisitForm | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0380 | 788 / select | 综合体验（1–5 分，可选） | visitForm.scores.rating | E候选 | showVisitForm | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0381 | 788 / input | visitForm.scores[field.key] | visitForm.scores[field.key] | C候选 | showVisitForm && field in visitScoreFields && field.type === 'number' | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0382 | 788 / select | select | — | E候选 | showVisitForm && field in visitScoreFields && field.type === 'boolean' | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0383 | 788 / select | visitForm.scores[field.key] | visitForm.scores[field.key] | E候选 | showVisitForm && field in visitScoreFields | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0384 | 788 / select | 值不值 | visitForm.scores.value | E候选 | showVisitForm | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0385 | 789 / textarea | 私人到访备注（最多 50 字，仅本机） | visitForm.note | C候选 | showVisitForm | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0386 | 790 / input | 另写一条校内公开短评 默认关闭；公开内容将和评分一起显示给同校学生。 | visitForm.shareReview | E候选 | showVisitForm | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0387 | 791 / textarea | 公开短评（最多 50 字） | visitForm.publicNote | C候选 | showVisitForm && visitForm.shareReview | saveVisit | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/PlatformAdminView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0388 | 433 / textarea | 拒绝原因（拒绝时必填，发布者可修改后重提） / 500 | reviewReasons[place.id] | B候选 | access === 'owner' && place in pendingPlaces | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0389 | 461 / input | 按登录邮箱搜索 | query | C候选 | access === 'owner' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0390 | 518 / textarea | 处理原因（写入审计记录） / 500 | changeReason | B候选 | changeDialog | confirmStatusChange | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ProjectsView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0391 | 1149 / input | 搜索项目 | projectSearch | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0392 | 1198 / input | 搜索任务 | taskSearch | C候选 | project && activeSection === 'tasks' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0393 | 1199 / select | 任务筛选 | statusFilter | E候选 | project && activeSection === 'tasks' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0394 | 1200 / select | 按负责人筛选 | assigneeFilter | E候选 | project && activeSection === 'tasks' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0395 | 1201 / select | 按阶段筛选 | milestoneFilter | E候选 | project && activeSection === 'tasks' && milestones.length | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0396 | 1202 / select | 任务排序 | taskSort | E候选 | project && activeSection === 'tasks' | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0397 | 1329 / input | · 已确认 | — | E候选 | project && activeSection === 'deliverables' && deliveryChecks.length &#124;&#124; isManager && item in deliveryChecks | change: saveDeliveryCheck(item, $event.target.checked) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0398 | 1330 / input | `${item.title}的凭证或说明` | item.evidence | C候选 | project && activeSection === 'deliverables' && deliveryChecks.length &#124;&#124; isManager && item in deliveryChecks && project.status === 'active' | input: deliveryEvidenceEdits.mark(item.id, item.evidence); keydown: saveDeliveryCheck(item, item.checked) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0399 | 1389 / input | 项目名称 * | projectDraft.name | B候选 | showProjectForm | saveProject | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0400 | 1390 / select | 项目类型 | projectDraft.type | E候选 | showProjectForm | saveProject | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0401 | 1391 / textarea | 项目说明 | projectDraft.description | C候选 | showProjectForm | saveProject | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0402 | 1392 / input | 开始日期 | projectDraft.startsOn | C候选 | showProjectForm | saveProject | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0403 | 1392 / input | 预计结束 | projectDraft.targetEndOn | C候选 | showProjectForm | saveProject | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0404 | 1402 / input | 任务标题 * | taskDraft.title | B候选 | showTaskForm | saveTask | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0405 | 1403 / textarea | 任务说明 | taskDraft.description | C候选 | showTaskForm | saveTask | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0406 | 1404 / select | 负责人 | taskDraft.assigneeId | E候选 | showTaskForm | saveTask | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0407 | 1404 / input | 截止日期 | taskDraft.dueOn | C候选 | showTaskForm | saveTask | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0408 | 1405 / select | 所属阶段 | taskDraft.milestoneId | E候选 | showTaskForm && milestones.length | saveTask | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0409 | 1406 / select | 前置任务 | taskDraft.dependsOnTaskId | E候选 | showTaskForm | saveTask | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0410 | 1408 / select | 优先级 | taskDraft.priority | E候选 | showTaskForm | saveTask | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0411 | 1421 / input | 阶段名称 * | milestoneDraft.title | B候选 | showMilestoneForm | saveMilestone | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0412 | 1422 / textarea | 阶段说明 | milestoneDraft.description | C候选 | showMilestoneForm | saveMilestone | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0413 | 1423 / input | 关键日期 | milestoneDraft.dueOn | C候选 | showMilestoneForm | saveMilestone | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0414 | 1432 / input | 检查内容 * | deliveryCheckDraft.title | B候选 | showDeliveryCheckForm | saveDeliveryCheckItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0415 | 1433 / input | 项目交付必需 | deliveryCheckDraft.required | E候选 | showDeliveryCheckForm | saveDeliveryCheckItem | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0416 | 1443 / input | 讨论主题 * | meetingDraft.title | B候选 | showMeetingForm && !meetingProposalTarget | saveMeetingForm | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0417 | 1444 / textarea | 讨论说明 | meetingDraft.note | C候选 | showMeetingForm && !meetingProposalTarget | saveMeetingForm | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0418 | 1445 / input | meetingDraft.startsLocal | meetingDraft.startsLocal | B候选 | showMeetingForm | saveMeetingForm | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0419 | 1446 / input | meetingDraft.endsLocal | meetingDraft.endsLocal | B候选 | showMeetingForm | saveMeetingForm | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0420 | 1456 / select | 申请类型 | adjustmentDraft.type | E候选 | showAdjustmentForm | saveAdjustment | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0421 | 1457 / input | 申请的新截止日期 | adjustmentDraft.dueOn | B候选 | showAdjustmentForm && adjustmentDraft.type === 'deadline_extension' | saveAdjustment | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0422 | 1458 / select | adjustmentDraft.targetId | adjustmentDraft.targetId | B候选 | showAdjustmentForm && ['help', 'handover'].includes(adjustmentDraft.type) | saveAdjustment | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0423 | 1459 / textarea | 调整后的任务说明 | adjustmentDraft.description | C候选 | showAdjustmentForm && adjustmentDraft.type === 'scope_change' | saveAdjustment | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0424 | 1460 / textarea | 拆分后的子任务 | adjustmentDraft.subtasks | C候选 | showAdjustmentForm && adjustmentDraft.type === 'split' | saveAdjustment | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0425 | 1461 / textarea | 申请原因 * | adjustmentDraft.reason | B候选 | showAdjustmentForm | saveAdjustment | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0426 | 1470 / input | 交付项名称 * | deliverableDraft.title | B候选 | showDeliverableForm | saveDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0427 | 1471 / textarea | 交付要求 | deliverableDraft.instructions | C候选 | showDeliverableForm | saveDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0428 | 1472 / select | 关联任务 | deliverableDraft.taskId | E候选 | showDeliverableForm | saveDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0429 | 1473 / select | 验收人 | deliverableDraft.reviewerId | E候选 | showDeliverableForm | saveDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0430 | 1474 / input | 项目交付必需 | deliverableDraft.required | E候选 | showDeliverableForm | saveDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0431 | 1475 / input | 正式提交后需要验收 | deliverableDraft.reviewRequired | E候选 | showDeliverableForm | saveDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0432 | 1485 / textarea | 成果说明 | draftContent.summary | C候选 | showDeliverableEditor | submitDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0433 | 1487 / select | 链接类型 | link.type | E候选 | showDeliverableEditor && (link, index) in draftContent.links | submitDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0434 | 1487 / input | 链接名称 | link.title | C候选 | showDeliverableEditor && (link, index) in draftContent.links | submitDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0435 | 1487 / input | HTTPS 链接 | link.url | C候选 | showDeliverableEditor && (link, index) in draftContent.links | submitDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0436 | 1489 / input | input | — | C候选 | showDeliverableEditor | submitDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0437 | 1492 / input | 本次修改说明 | changeNote | C候选 | showDeliverableEditor | submitDeliverable | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0438 | 1506 / input | `检查项 ${index + 1} 通过` | item.passed | E候选 | reviewTarget && (item, index) in reviewChecklist | decideReview('approved') | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0439 | 1506 / input | `检查项 ${index + 1} 名称` | item.item | C候选 | reviewTarget && (item, index) in reviewChecklist | decideReview('approved') | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0440 | 1507 / textarea | 验收意见 * | reviewFeedback | B候选 | reviewTarget | decideReview('approved') | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0441 | 1515 / select | 选择好友 | selectedFriendId | E候选 | showInviteForm | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0442 | 1516 / input | 本次邀请链接 | — | D候选 | showInviteForm && linkToShare | focus: $event.target.select() | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ScheduleView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0443 | 330 / Popover | calendarOpen | calendarOpen | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0444 | 345 / Calendar | selectedCalendarDate | — | E候选 | — | update:model-value: goToScheduleDate | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0445 | 387 / input | 搜索课程、教师或教室 | courseQuery | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0446 | 630 / Toast | toast.open | toast.open | C候选 | — | action: () =&gt; {}; close: toast.open = false | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/TasksView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0447 | 762 / input | 搜索待办 | queryInput | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0448 | 765 / select | 状态 | — | E候选 | viewMode === 'list' && !showHistory | change: selectFilter($event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0449 | 769 / select | 优先级 | — | E候选 | 筛选与排序 · 已调整，open=默认折叠 | change: changeSelect('priority', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0450 | 770 / select | 范围 | — | E候选 | !showHistory；筛选与排序 · 已调整，open=默认折叠 | change: changeSelect('period', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0451 | 773 / select | 排序 | — | E候选 | 筛选与排序 · 已调整，open=默认折叠 | change: changeSelect('sort', $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0452 | 960 / input | 待办内容 * | form.title | B候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0453 | 965 / input | 所属课程或类别 | form.course | C候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0454 | 974 / input | 截止日期 | form.dueDate | C候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0455 | 978 / input | 截止时间 | form.dueTime | C候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0456 | 984 / TaskTimeEditor | form.timeStages | form.timeStages | C候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0457 | 989 / select | 优先级 | form.priority | E候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0458 | 998 / textarea | 备注 | form.note | C候选 | showForm | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0459 | 1004 / input | 预计时长（分钟） | form.estimateMinutes | C候选 | showForm；时长、重复与提醒 按需设置，open=Boolean((editingId && (form.repeat !== 'none' &#124;&#124; form.estimateMinutes &#124;&#124; form.actualMinutes)) &#124;&#124; ['estimateMinutes', 'actualMinutes', 'reminderMinutes', 'repeatEndDate'].includes(errorField)) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0460 | 1005 / input | 实际用时（分钟） | form.actualMinutes | C候选 | showForm；时长、重复与提醒 按需设置，open=Boolean((editingId && (form.repeat !== 'none' &#124;&#124; form.estimateMinutes &#124;&#124; form.actualMinutes)) &#124;&#124; ['estimateMinutes', 'actualMinutes', 'reminderMinutes', 'repeatEndDate'].includes(errorField)) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0461 | 1008 / select | 重复 | form.repeat | E候选 | showForm；时长、重复与提醒 按需设置，open=Boolean((editingId && (form.repeat !== 'none' &#124;&#124; form.estimateMinutes &#124;&#124; form.actualMinutes)) &#124;&#124; ['estimateMinutes', 'actualMinutes', 'reminderMinutes', 'repeatEndDate'].includes(errorField)) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0462 | 1010 / input | 重复结束日期 | form.repeatEndDate | C候选 | showForm && form.repeat !== 'none'；时长、重复与提醒 按需设置，open=Boolean((editingId && (form.repeat !== 'none' &#124;&#124; form.estimateMinutes &#124;&#124; form.actualMinutes)) &#124;&#124; ['estimateMinutes', 'actualMinutes', 'reminderMinutes', 'repeatEndDate'].includes(errorField)) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0463 | 1014 / input | 提前提醒（分钟） | form.reminderMinutes | C候选 | showForm；时长、重复与提醒 按需设置，open=Boolean((editingId && (form.repeat !== 'none' &#124;&#124; form.estimateMinutes &#124;&#124; form.actualMinutes)) &#124;&#124; ['estimateMinutes', 'actualMinutes', 'reminderMinutes', 'repeatEndDate'].includes(errorField)) | save | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0464 | 1057 / Toast | toast.open | toast.open | C候选 | — | action: () =&gt; {}; close: toast.open = false | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/TodayView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0465 | 462 / input | 今日心情备注 | moodNote | C候选 | entryReady | change: updateMoodNote | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/TogetherView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0466 | 633 / select | 搜索范围 | availabilityDays | E候选 | activeTab === 'time' && hasProfile | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0467 | 656 / input | 开始 | inviteStartInput | B候选 | activeTab === 'time' && hasProfile && composerOpen && selectedSlot | createInvitation | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0468 | 656 / input | 结束 | inviteEndInput | B候选 | activeTab === 'time' && hasProfile && composerOpen && selectedSlot | createInvitation | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0469 | 659 / select | 活动 | inviteType | E候选 | activeTab === 'time' && hasProfile && composerOpen && selectedSlot | createInvitation | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0470 | 660 / input | 标题 | inviteTitle | B候选 | activeTab === 'time' && hasProfile && composerOpen && selectedSlot | createInvitation | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0471 | 660 / input | 地点（选填） | inviteLocation | C候选 | activeTab === 'time' && hasProfile && composerOpen && selectedSlot | createInvitation | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0472 | 660 / input | 备注（选填） | inviteNote | C候选 | activeTab === 'time' && hasProfile && composerOpen && selectedSlot | createInvitation | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0473 | 671 / input | 好友完整邮箱 | searchEmail | B候选 | activeTab === 'friends' && hasProfile | searchByEmail | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/WeeklyReviewView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0474 | 299 / textarea | field.title | reflectionDraft[field.key] | C候选 | field in reflectionFields | saveReflectionNow | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusCoursesView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0475 | 95 / select | formFor(assignment.id)[field.key] | formFor(assignment.id)[field.key] | E候选 | page.data.value?.assignments?.length && assignment in page.data.value.assignments && field in [{key:'clarity',label:'讲授清晰度'},{key:'organization',label:'教学组织'},{key:'learning',label:'学习收获'},{key:'workload',label:'作业负担感受'},{key:'assessment',label:'考核信息透明度'}] | submitReview(assignment) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0476 | 95 / textarea | 客观课程体验 | formFor(assignment.id).note | C候选 | page.data.value?.assignments?.length && assignment in page.data.value.assignments | submitReview(assignment) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusFeedbackView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0477 | 212 / select | 建议分类 | draft.category | E候选 | — | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0478 | 213 / input | 标题 | draft.title | A候选 | — | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0479 | 214 / textarea | 具体建议 | draft.body | A候选 | — | submit | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0480 | 221 / textarea | 补充材料 | applicantResponse | C候选 | hasVerifiedEmail && application?.status === 'pending' && application.owner_note | replyToApplication | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0481 | 223 / textarea | 申请理由 | reviewerReason | C候选 | hasVerifiedEmail && applicationOpen && (!application &#124;&#124; ['declined','withdrawn'].includes(application.status)) | applyReviewer | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0482 | 247 / input | 站内私信内容 | privateDrafts[item.id] | C候选 | accountUser && mineOpen && item in mine；站内联系，open=默认折叠 | sendPrivateMessage(item) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusGovernanceView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0483 | 81 / NativeSelect | 内容分类 | type | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusGuidesView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0484 | 29 / CampusDirectoryFilter | 搜索标题、正文或分类 | query | C候选 | page.data.value | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusHelpView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0485 | 118 / CampusDirectoryFilter | 搜索任务或交接区域 | query | C候选 | page.data.value | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0486 | 138 / textarea | 申请说明（请勿写手机号或地址） | applyNote | C候选 | task in visible && applyId === task.id | apply(task) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0487 | 151 / textarea | 说明遇到的问题 | disputeReason | B候选 | page.data.value?.mine?.length && task in page.data.value.mine && disputeId === task.id | transition(task, 'disputed', disputeReason) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0488 | 153 / textarea | 说明遇到的问题 | disputeReason | B候选 | page.data.value?.activeTasks?.length && task in page.data.value.activeTasks && disputeId === task.id | transition(task, 'disputed', disputeReason) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusLostFoundView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0489 | 90 / CampusDirectoryFilter | 搜索物品名称、特征或地点 | query | C候选 | page.data.value | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0490 | 110 / textarea | 填写未公开的核验特征（至少 10 个字，仅发布者可见） | privateEvidence | B候选 | item in visible && claimTarget === item.id | submitClaim(item) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusMarketplaceView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0491 | 160 / CampusDirectoryFilter | 搜索物品、描述或交易地点 | query | C候选 | page.data.value | reset: productCategory = '' | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0492 | 160 / select | 物品分类 | productCategory | E候选 | page.data.value | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0493 | 160 / select | 排序 | sort | E候选 | page.data.value | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0494 | 181 / textarea | 给发布者留言（不要填写私人联系方式） | contactNote | C候选 | listing in visible && contactId === listing.id | sendInterest(listing) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusPublishView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0495 | 178 / input | kind | kind | E候选 | !editing && item in options.filter((entry) =&gt; primaryKinds.includes(entry.id)) | change: kindChanged | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0496 | 179 / input | kind | kind | E候选 | !editing && item in options.filter((entry) =&gt; !primaryKinds.includes(entry.id))；补充课程与出行资料，open=!primaryKinds.includes(kind) | change: kindChanged | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0497 | 192 / input | 教师姓名 | form.name | B候选 | kind === 'teacher' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0498 | 192 / input | 院系 | form.department | C候选 | kind === 'teacher' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0499 | 193 / input | 研究方向（选填） | form.researchDirections | C候选 | kind === 'teacher' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0500 | 193 / textarea | 官方公开简介 | form.officialIntro | C候选 | kind === 'teacher' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0501 | 194 / input | 官方公开资料 HTTPS 链接 | form.sourceUrl | B候选 | kind === 'teacher' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0502 | 198 / input | 课程名称 | form.name | B候选 | kind === 'course' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0503 | 198 / input | 院系 | form.department | C候选 | kind === 'course' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0504 | 199 / textarea | 课程公开说明 | form.description | C候选 | kind === 'course' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0505 | 199 / input | 资料来源 HTTPS 链接（可选） | form.sourceUrl | C候选 | kind === 'course' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0506 | 203 / select | 课程 | form.courseId | B候选 | kind === 'assignment' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0507 | 204 / select | 教师 | form.teacherId | B候选 | kind === 'assignment' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0508 | 205 / input | 学期 | form.term | B候选 | kind === 'assignment' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0509 | 205 / input | 授课安排来源 HTTPS 链接 | form.sourceUrl | C候选 | kind === 'assignment' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0510 | 208 / select | 发布方式 | form.listingType | E候选 | kind === 'market' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0511 | 209 / select | 分类 | form.category | E候选 | kind === 'market' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0512 | 210 / input | 标题 | form.title | B候选 | kind === 'market' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0513 | 210 / input | 价格（元，可留空求购） | form.price | C候选 | kind === 'market' && form.listingType !== 'free' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0514 | 211 / input | 新旧程度 | form.condition | C候选 | kind === 'market' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0515 | 211 / input | 安全交易区域 | form.meetupArea | C候选 | kind === 'market' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0516 | 212 / textarea | 物品说明与瑕疵 | form.description | C候选 | kind === 'market' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0517 | 216 / select | 互助类型 | form.taskType | E候选 | kind === 'help' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0518 | 217 / input | 任务标题 | form.title | B候选 | kind === 'help' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0519 | 217 / input | 取件 / 起始区域 | form.pickupArea | C候选 | kind === 'help' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0520 | 217 / input | 送达区域 | form.deliveryArea | C候选 | kind === 'help' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0521 | 218 / input | 最晚完成时间 | form.deadline | C候选 | kind === 'help' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0522 | 218 / textarea | 任务说明 | form.description | C候选 | kind === 'help' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0523 | 222 / input | 线路名称 | form.name | B候选 | kind === 'shuttle' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0524 | 222 / input | 公开时刻表来源 HTTPS 链接 | form.sourceUrl | B候选 | kind === 'shuttle' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0525 | 223 / input | 生效日期 | form.effectiveFrom | C候选 | kind === 'shuttle' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0526 | 223 / input | 失效日期 | form.effectiveTo | C候选 | kind === 'shuttle' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0527 | 224 / textarea | 经停站（每行：outbound 或 inbound &#124; 站点名） | form.stopsText | B候选 | kind === 'shuttle' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0528 | 225 / textarea | 计划班次（每行：方向 &#124; weekday / weekend / holiday &#124; HH:mm &#124; 上车站点） | form.departuresText | B候选 | kind === 'shuttle' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0529 | 229 / select | 线路 | form.routeId | B候选 | kind === 'shuttle_correction' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0530 | 230 / textarea | 纠错内容 | form.detail | B候选 | kind === 'shuttle_correction' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0531 | 231 / input | 来源 HTTPS 链接（选填） | form.sourceUrl | C候选 | kind === 'shuttle_correction' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0532 | 234 / select | 线路 | form.routeId | B候选 | kind === 'shuttle_exception' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0533 | 235 / input | 适用日期 | form.serviceDate | B候选 | kind === 'shuttle_exception' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0534 | 236 / select | 类型 | form.exceptionType | E候选 | kind === 'shuttle_exception' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0535 | 237 / select | 方向 | form.direction | E候选 | kind === 'shuttle_exception' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0536 | 238 / input | 发车时间 | form.departureTime | B候选 | kind === 'shuttle_exception' && form.exceptionType !== 'suspended' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0537 | 239 / input | 说明 | form.note | C候选 | kind === 'shuttle_exception' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0538 | 240 / input | 官方来源 HTTPS 链接 | form.sourceUrl | B候选 | kind === 'shuttle_exception' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0539 | 243 / select | 类型 | form.mode | E候选 | kind === 'lost' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0540 | 243 / select | 物品分类 | form.category | E候选 | kind === 'lost' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0541 | 244 / input | 物品名称（不要写完整卡号） | form.title | B候选 | kind === 'lost' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0542 | 244 / input | 大致地点 | form.approximateLocation | C候选 | kind === 'lost' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0543 | 244 / input | 发生日期 | form.occurredAt | C候选 | kind === 'lost' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0544 | 245 / textarea | 公开描述（隐藏可用于认领核验的特征） | form.description | C候选 | kind === 'lost' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0545 | 249 / input | 活动名称 | form.title | B候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0546 | 249 / input | 组织方（不代表官方认证） | form.organizer | C候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0547 | 249 / input | 开始时间 | form.startsAt | B候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0548 | 249 / input | 结束时间 | form.endsAt | B候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0549 | 250 / input | 活动地点 | form.location | C候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0550 | 250 / input | 名额（可留空） | form.capacity | C候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0551 | 250 / input | 报名链接 HTTPS | form.signupUrl | C候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0552 | 250 / input | 活动来源 HTTPS | form.sourceUrl | C候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0553 | 251 / textarea | 活动说明 | form.description | C候选 | kind === 'event' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0554 | 254 / input | 指南标题 | form.title | B候选 | kind === 'guide' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0555 | 254 / select | 分类 | form.category | E候选 | kind === 'guide' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0556 | 255 / select | 信息类型 | form.sourceType | E候选 | kind === 'guide' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0557 | 255 / input | 有效期 | form.expiresOn | C候选 | kind === 'guide' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0558 | 255 / textarea | 正文 | form.body | B候选 | kind === 'guide' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0559 | 256 / input | 来源链接 HTTPS | form.sourceUrl | B候选 | kind === 'guide' | publish | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusSearchView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0560 | 40 / input | 搜索校园内容 | query | C候选 | — | search | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0561 | 41 / select | 搜索范围 | category | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/campus/CampusShuttleView.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0562 | 120 / input | 出行日期 | selectedDate | C候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0563 | 121 / select | 运行日历 | serviceDay | E候选 | — | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0564 | 153 / textarea | 纠错内容 | correction.detail | B候选 | route in routes && correctionRoute === route.id | submitCorrection(route) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0565 | 153 / input | 来源 HTTPS 链接 | correction.sourceUrl | C候选 | route in routes && correctionRoute === route.id | submitCorrection(route) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0566 | 154 / input | 适用日期 | exception.serviceDate | B候选 | route in routes && exceptionRoute === route.id | submitException(route) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0567 | 154 / select | 类型 | exception.exceptionType | E候选 | route in routes && exceptionRoute === route.id | submitException(route) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0568 | 154 / select | 方向 | exception.direction | E候选 | route in routes && exceptionRoute === route.id | submitException(route) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0569 | 154 / input | 发车时间 | exception.departureTime | B候选 | route in routes && exceptionRoute === route.id && exception.exceptionType !== 'suspended' | submitException(route) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0570 | 154 / input | 说明 | exception.note | C候选 | route in routes && exceptionRoute === route.id | submitException(route) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0571 | 154 / input | 官方来源 HTTPS 链接 | exception.sourceUrl | B候选 | route in routes && exceptionRoute === route.id | submitException(route) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ledger-panels/BillFormModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0572 | 8 / select | 从模板套用 | billTemplateId | E候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0573 | 26 / input | 账单名称 必填 | billForm.name | B候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0574 | 38 / input | 固定账单金额 | billForm.amount | C候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0575 | 52 / select | 重复周期 | billForm.cycle | E候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0576 | 59 / select | 支付分类 支付后生成交易时使用 | billForm.category | E候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0577 | 67 / input | 下次支付日期 | billForm.nextDate | C候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0578 | 77 / select | 提前提醒 | billForm.remindDays | E候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0579 | 92 / input | 备注 选填 | billForm.note | C候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0580 | 97 / input | 账户 选填 | billForm.account | C候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0581 | 102 / select | 固定账单使用的币种 | billForm.currency | E候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0582 | 109 / input | 自动续费 到期后自动推进到下一周期 | billForm.autoRenew | E候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0583 | 114 / input | 使用中 关闭后暂停提醒 | billForm.active | E候选 | formOpen | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ledger-panels/BudgetSettingsModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0584 | 7 / input | `月度预算金额（${baseCurrency}）` | budgetInput | C候选 | open | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ledger-panels/FxSettingsModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0585 | 9 / input | `1 ${row.code} 等于多少 ${baseCurrency}` | row.rate | C候选 | open && row in draft | — | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0586 | 20 / input | 要添加的币种代码 | newCode | C候选 | open | — | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ledger-panels/LedgerHomePanel.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0587 | 192 / input | 搜索账本记录 | — | C候选 | — | input: e =&gt; $emit('update-q', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0588 | 205 / input | 筛选起始日期 | — | C候选 | showFilters && fRange === 'custom' | input: e =&gt; $emit('update-f-from', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0589 | 205 / input | 筛选结束日期 | — | C候选 | showFilters && fRange === 'custom' | input: e =&gt; $emit('update-f-to', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0590 | 208 / select | 筛选分类 | — | E候选 | showFilters | input: e =&gt; $emit('update-f-cat', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0591 | 212 / select | 筛选账户 | — | E候选 | showFilters | input: e =&gt; $emit('update-f-account', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0592 | 216 / input | 筛选最低金额 | — | C候选 | showFilters | input: e =&gt; $emit('update-f-min', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0593 | 217 / input | 筛选最高金额 | — | C候选 | showFilters | input: e =&gt; $emit('update-f-max', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0594 | 218 / select | 筛选记录来源 | — | E候选 | showFilters | input: e =&gt; $emit('update-f-kind', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0595 | 223 / select | 筛选收支类型 | — | E候选 | showFilters | input: e =&gt; $emit('update-f-direction', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0596 | 229 / select | 筛选币种 | — | E候选 | showFilters | change: $emit('update-f-currency', $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ledger-panels/QuickEntryModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0597 | 205 / input | 金额 | — | C候选 | — | input: e =&gt; { localAmountInput = e.target.value; $emit('update:amountInput', e.target.value) }; keydown: saveExpense(keepAdding) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0598 | 225 / input | 记录名称 | — | C候选 | — | input: e =&gt; { $emit('update:nameInput', e.target.value); onNameInput(e.target.value) }; keydown: saveExpense(keepAdding) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0599 | 276 / input | 日期 | — | C候选 | moreOpen | input: e =&gt; $emit('update:dateInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0600 | 277 / input | 时间（选填） | — | C候选 | moreOpen | input: e =&gt; $emit('update:timeInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0601 | 278 / input | 账户 | — | C候选 | moreOpen | input: e =&gt; $emit('update:accountInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0602 | 280 / select | 这笔记录使用的币种 | — | E候选 | moreOpen | input: e =&gt; { localCurrencyInput = e.target.value; $emit('update:currencyInput', e.target.value) } | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0603 | 285 / input | 备注 | — | C候选 | moreOpen | input: e =&gt; $emit('update:noteInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0604 | 288 / input | 参与人数 | — | C候选 | moreOpen && directionInput === 'expense' | input: e =&gt; { localSplitCount = e.target.value; $emit('update:splitCount', e.target.value) } | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0605 | 289 / input | splitMode === 'custom' ? '我承担的份额' : '我承担的份额（自动计算，只读）' | — | D候选 | moreOpen && directionInput === 'expense' | input: e =&gt; $emit('update:splitMine', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0606 | 291 / input | 自定义我承担的金额 | — | E候选 | moreOpen && directionInput === 'expense' && Number(splitCount) &gt; 1 | change: $emit('update:splitMode', $event.target.checked ? 'custom' : 'equal') | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ledger-panels/ReviewPanel.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0607 | 83 / input | 选择回顾月份 | — | C候选 | — | change: emit('jump-to-month', $event.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ledger-panels/TransactionDetailModal.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0608 | 90 / input | 修改金额 | — | C候选 | detailExpense && detailEdit | input: e =&gt; $emit('update:detailAmountInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0609 | 91 / select | 修改分类 | — | E候选 | detailExpense && detailEdit | input: e =&gt; $emit('update:detailCategoryInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0610 | 92 / input | 修改日期 | — | C候选 | detailExpense && detailEdit | input: e =&gt; $emit('update:detailDateInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0611 | 93 / select | 修改币种 | — | E候选 | detailExpense && detailEdit | input: e =&gt; $emit('update:detailCurrencyInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0612 | 96 / input | 同时把另外 笔同名 改为「 」 只匹配相同名称和收支方向的历史记录；只改分类，不改金额、日期等信息。 | — | E候选 | detailExpense && detailEdit && sameNameCategoryCount | change: $emit('update:applySameNameCategory', $event.target.checked) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0613 | 139 / input | 退款金额 | — | C候选 | showRefund | input: e =&gt; $emit('update:refundAmountInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0614 | 140 / input | 退款日期 | — | C候选 | showRefund | input: e =&gt; $emit('update:refundDateInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0615 | 141 / input | 备注 | — | C候选 | showRefund | input: e =&gt; $emit('update:refundNoteInput', e.target.value) | 源码已列入；业务必要性/保存/隐藏分支待验 |

## src/views/ledger-panels/TransactionImportDialog.vue

| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIELD-0616 | 223 / input | 选择微信支付或支付宝 CSV 账单 | — | C候选 | open | change: onFileChange | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0617 | 299 / Checkbox | 选中或取消全部导入记录 | — | E候选 | open && parsed && rows.length | update:checked: setAllSelected | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0618 | 316 / Checkbox | `选择${row.name}` | — | E候选 | open && parsed && rows.length && row in visibleRows | update:checked: row.selected = $event === true | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0619 | 323 / Input | 修正记录日期 | — | C候选 | open && parsed && rows.length && row in visibleRows | update:model-value: row.date = String($event ?? '') | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0620 | 332 / Input | 修正记录名称 | — | C候选 | open && parsed && rows.length && row in visibleRows | update:model-value: row.name = String($event ?? '') | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0621 | 342 / Select | Select | — | E候选 | open && parsed && rows.length && row in visibleRows | update:model-value: setDirection(row, $event) | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0622 | 356 / Select | Select | — | E候选 | open && parsed && rows.length && row in visibleRows | update:model-value: row.cat = String($event ?? '') | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0623 | 370 / Select | Select | — | E候选 | open && parsed && rows.length && row in visibleRows | update:model-value: row.account = String($event ?? '') | 源码已列入；业务必要性/保存/隐藏分支待验 |
| FIELD-0624 | 382 / Input | 修正记录金额 | — | C候选 | open && parsed && rows.length && row in visibleRows | update:model-value: row.amount = String($event ?? '') | 源码已列入；业务必要性/保存/隐藏分支待验 |

## 表单与浮层提交/关闭入口

| ID | 文件:行 | 类型/标题 | 事件 | 条件 |
| --- | --- | --- | --- | --- |
| FORM-1 | src/components/AccountPanel.vue:376 | form | submit: submit | — |
| FORM-2 | src/components/CampusHome.vue:28 | form | submit: emit('search', 'all') | — |
| FORM-3 | src/components/NavigationSettings.vue:278 | form | submit: addGroup | — |
| FORM-4 | src/components/account/AccountCommunitySettings.vue:116 | form | submit: saveProfile | section === 'profile' |
| FORM-5 | src/components/account/AccountPasswordForm.vue:74 | form | submit: submit | — |
| FORM-6 | src/components/campus/CampusCommunityAdmin.vue:198 | form | submit: sendMessage(row) | row in rows |
| FORM-7 | src/components/campus/CampusContentActions.vue:85 | form | submit: submitReport | reportOpen |
| FORM-8 | src/components/campus/CampusPrivateChat.vue:144 | form | submit: send | — |
| FORM-9 | src/components/campus/CampusReviewerManager.vue:93 | form | submit: findAccounts | — |
| FORM-10 | src/components/campus/CampusReviewerManager.vue:94 | form | submit: save(true) | candidates.length |
| FORM-11 | src/components/schedule/ExceptionsModal.vue:385 | form | submit: submit | show |
| FORM-12 | src/components/tasks/TaskBulkRescheduleDialog.vue:38 | form | submit: emit('apply', { direction, days: amount() }) | — |
| FORM-13 | src/components/tasks/TaskRescheduleDialog.vue:41 | form | submit: save | — |
| FORM-14 | src/views/EventsView.vue:255 | form | submit: save | formOpen |
| FORM-15 | src/views/ExamsView.vue:741 | form | submit: save | showForm |
| FORM-16 | src/views/ListsView.vue:581 | form | submit: addQuickItem | activeList |
| FORM-17 | src/views/ListsView.vue:627 | form | submit: saveList | showListForm |
| FORM-18 | src/views/ListsView.vue:662 | form | submit: saveItem | showItemForm |
| FORM-19 | src/views/ListsView.vue:685 | form | submit: saveBulkItems | showBulkForm |
| FORM-20 | src/views/NoticesView.vue:152 | form | submit: saveOfferLink(item) | item in visible && offerNoticeId === item.id |
| FORM-21 | src/views/PlacesView.vue:664 | form | submit: submitReport | section === 'discover' && filteredPlaces.length && place in filteredPlaces && reportTarget?.id === place.id |
| FORM-22 | src/views/PlacesView.vue:674 | form | submit: savePlace | showPlaceForm && section === 'mine' |
| FORM-23 | src/views/PlacesView.vue:780 | form | submit: saveOffer | section === 'offers' && offerFormOpen |
| FORM-24 | src/views/PlacesView.vue:785 | form | submit: saveVisit | showVisitForm |
| FORM-25 | src/views/PlatformAdminView.vue:514 | form | submit: confirmStatusChange | changeDialog |
| FORM-26 | src/views/ProjectsView.vue:1387 | form | submit: saveProject | showProjectForm |
| FORM-27 | src/views/ProjectsView.vue:1400 | form | submit: saveTask | showTaskForm |
| FORM-28 | src/views/ProjectsView.vue:1419 | form | submit: saveMilestone | showMilestoneForm |
| FORM-29 | src/views/ProjectsView.vue:1430 | form | submit: saveDeliveryCheckItem | showDeliveryCheckForm |
| FORM-30 | src/views/ProjectsView.vue:1440 | form | submit: saveMeetingForm | showMeetingForm |
| FORM-31 | src/views/ProjectsView.vue:1453 | form | submit: saveAdjustment | showAdjustmentForm |
| FORM-32 | src/views/ProjectsView.vue:1468 | form | submit: saveDeliverable | showDeliverableForm |
| FORM-33 | src/views/ProjectsView.vue:1482 | form | submit: submitDeliverable | showDeliverableEditor |
| FORM-34 | src/views/ProjectsView.vue:1503 | form | submit: decideReview('approved') | reviewTarget |
| FORM-35 | src/views/TasksView.vue:956 | form | submit: save | showForm |
| FORM-36 | src/views/TogetherView.vue:651 | form | submit: createInvitation | activeTab === 'time' && hasProfile && composerOpen && selectedSlot |
| FORM-37 | src/views/TogetherView.vue:671 | form | submit: searchByEmail | activeTab === 'friends' && hasProfile |
| FORM-38 | src/views/WeeklyReviewView.vue:294 | form | submit: saveReflectionNow | — |
| FORM-39 | src/views/campus/CampusCoursesView.vue:95 | form | submit: submitReview(assignment) | page.data.value?.assignments?.length && assignment in page.data.value.assignments |
| FORM-40 | src/views/campus/CampusFeedbackView.vue:211 | form | submit: submit | — |
| FORM-41 | src/views/campus/CampusFeedbackView.vue:221 | form | submit: replyToApplication | hasVerifiedEmail && application?.status === 'pending' && application.owner_note |
| FORM-42 | src/views/campus/CampusFeedbackView.vue:223 | form | submit: applyReviewer | hasVerifiedEmail && applicationOpen && (!application &#124;&#124; ['declined','withdrawn'].includes(application.status)) |
| FORM-43 | src/views/campus/CampusFeedbackView.vue:247 | form | submit: sendPrivateMessage(item) | accountUser && mineOpen && item in mine |
| FORM-44 | src/views/campus/CampusHelpView.vue:138 | form | submit: apply(task) | task in visible && applyId === task.id |
| FORM-45 | src/views/campus/CampusHelpView.vue:151 | form | submit: transition(task, 'disputed', disputeReason) | page.data.value?.mine?.length && task in page.data.value.mine && disputeId === task.id |
| FORM-46 | src/views/campus/CampusHelpView.vue:153 | form | submit: transition(task, 'disputed', disputeReason) | page.data.value?.activeTasks?.length && task in page.data.value.activeTasks && disputeId === task.id |
| FORM-47 | src/views/campus/CampusLostFoundView.vue:110 | form | submit: submitClaim(item) | item in visible && claimTarget === item.id |
| FORM-48 | src/views/campus/CampusMarketplaceView.vue:181 | form | submit: sendInterest(listing) | listing in visible && contactId === listing.id |
| FORM-49 | src/views/campus/CampusPublishView.vue:188 | form | submit: publish | — |
| FORM-50 | src/views/campus/CampusSearchView.vue:40 | form | submit: search | — |
| FORM-51 | src/views/campus/CampusShuttleView.vue:153 | form | submit: submitCorrection(route) | route in routes && correctionRoute === route.id |
| FORM-52 | src/views/campus/CampusShuttleView.vue:154 | form | submit: submitException(route) | route in routes && exceptionRoute === route.id |
| OVERLAY-1 | src/components/AccountPanel.vue:288 | 我的账号 | close: close | — |
| OVERLAY-2 | src/components/AppearanceSettings.vue:333 | 🎨 个性化外观 | close: emit('close') | — |
| OVERLAY-3 | src/components/AppearanceSettings.vue:460 | 删除壁纸 | close: removeImageTarget = null; confirm: confirmRemoveImage | removeImageTarget |
| OVERLAY-4 | src/components/AppearanceSettings.vue:470 | 恢复全部壁纸 | close: resetWallpapersTarget = false; confirm: confirmResetAllWallpapers | resetWallpapersTarget |
| OVERLAY-5 | src/components/AppearanceSettings.vue:480 | 恢复初始外观 | close: resetAppearanceTarget = false; confirm: confirmResetAllAppearance | resetAppearanceTarget |
| OVERLAY-6 | src/components/ConfirmDialog.vue:41 | title | close: $emit('close') | — |
| OVERLAY-7 | src/components/DataManager.vue:129 | 数据管理 | close: closeDataManager | — |
| OVERLAY-8 | src/components/DataManager.vue:200 | 从备份恢复 | close: restoreBackupTarget = null; confirm: confirmRestoreBackup | restoreBackupTarget |
| OVERLAY-9 | src/components/DataManager.vue:209 | 跨账号数据导入 | close: crossAccountImportTarget = null; confirm: confirmCrossAccountImport | crossAccountImportTarget |
| OVERLAY-10 | src/components/DataManager.vue:218 | 恢复本机恢复点 | close: showCheckpointConfirm = false; confirm: confirmRestoreCheckpoint | showCheckpointConfirm && restoreCheckpoint |
| OVERLAY-11 | src/components/DomainCsvImportButton.vue:90 | copy.title | close: open = false | importAvailable |
| OVERLAY-12 | src/components/FestiveSettings.vue:207 | 节日与纪念日设置 | close: emit('close') | — |
| OVERLAY-13 | src/components/FocusPanel.vue:611 | 从待办选择 | close: showTodoPicker = false | — |
| OVERLAY-14 | src/components/FocusPanel.vue:621 | 自定义专注时间 | close: showCustomTime = false | — |
| OVERLAY-15 | src/components/FocusPanel.vue:634 | 提前结束 | close: showEarly = false | — |
| OVERLAY-16 | src/components/FocusSettings.vue:71 | ⏱ 专注设置 | close: emit('close') | — |
| OVERLAY-17 | src/components/IcsImportButton.vue:82 | 预览日历导入 | close: closePreview | — |
| OVERLAY-18 | src/components/MemoryView.vue:145 | 📖 回放 | close: emit('close') | — |
| OVERLAY-19 | src/components/NavigationSettings.vue:229 | 编辑导航 | close: requestClose() | — |
| OVERLAY-20 | src/components/NavigationSettings.vue:300 | 保存导航修改？ | close: !saving && (pendingDeparture = null) | pendingDeparture |
| OVERLAY-21 | src/components/NavigationSettings.vue:306 | 移除分组 | close: pendingGroupRemoval = null | pendingGroupRemoval |
| OVERLAY-22 | src/components/NoticeUnderstanding.vue:530 | 📋 通知理解 | close: emit('close') | — |
| OVERLAY-23 | src/components/PromptDialog.vue:85 | title | close: $emit('close') | — |
| OVERLAY-24 | src/components/QuickRecordPanel.vue:94 | ⚡ 快速记录 | close: requestClose | — |
| OVERLAY-25 | src/components/QuickRecordSettings.vue:22 | `⚡ ${SETTINGS_NAVIGATION_LABEL}` | close: emit('close') | — |
| OVERLAY-26 | src/components/ReleaseNotesBrowser.vue:59 | 更新说明 | close: emit('close') | — |
| OVERLAY-27 | src/components/SearchPanel.vue:319 | 🔍 全局搜索 | close: emit('close') | — |
| OVERLAY-28 | src/components/TaskCenter.vue:102 | 后台任务 | close: open = false | — |
| OVERLAY-29 | src/components/TimeWheelSheet.vue:72 | title | close: emit('close') | — |
| OVERLAY-30 | src/components/UpdateNotes.vue:15 | ✨ 已更新 | close: acknowledge | — |
| OVERLAY-31 | src/components/VersionUpdateModal.vue:10 | 版本与更新 | close: emit('close') | — |
| OVERLAY-32 | src/components/account/AccountSessionActions.vue:35 | scope === 'global' ? '退出所有设备？' : '退出当前设备？' | close: scope = ''; confirm: confirmSignOut | scope |
| OVERLAY-33 | src/components/campus/CampusConfirmDialog.vue:17 | request.title | close: $emit('close'); confirm: $emit('confirm') | request |
| OVERLAY-34 | src/components/campus/CampusReviewItem.vue:64 | 下架被举报内容 | close: !busy && (confirmRemove = false) | confirmRemove |
| OVERLAY-35 | src/components/campus/CampusReviewerManager.vue:107 | 撤销审核权限 | close: !saving && (revokeTarget = null) | revokeTarget |
| OVERLAY-36 | src/components/data/PurgeSection.vue:43 | 清空这台设备上的全部本机数据？ | close: confirming = false; confirm: purge.purgeLocalData() | confirming |
| OVERLAY-37 | src/components/schedule/BatchImportModal.vue:230 | 批量录入课程 | close: emit('close') | show |
| OVERLAY-38 | src/components/schedule/CourseEditorModal.vue:149 | editingId ? '编辑课程' : '添加课程' | close: emit('close') | — |
| OVERLAY-39 | src/components/schedule/CourseManagerModal.vue:55 | 课程批量管理 | close: emit('close') | — |
| OVERLAY-40 | src/components/schedule/ExceptionsModal.vue:382 | 🗓 课程调整 | close: emit('close') | show |
| OVERLAY-41 | src/components/schedule/ImageCropModal.vue:146 | 框选课表区域 | close: emit('close') | — |
| OVERLAY-42 | src/components/schedule/ImportConflictModal.vue:76 | 课程导入冲突处理 | close: emit('close') | show |
| OVERLAY-43 | src/components/schedule/RecognitionSchemeDetailModal.vue:39 | activeScheme ? `编辑识别结果 · ${schemeDisplayName(activeScheme, timeConfig)}` : '编辑识别结果' | close: closeSchemeDetail | schemeDetailOpen && !!activeScheme |
| OVERLAY-44 | src/components/schedule/SemesterModal.vue:29 | 📅 学期设置 | close: emit('close') | show |
| OVERLAY-45 | src/components/schedule/TimeBaseSettings.vue:288 | 删除校区 | close: removeCampusTarget = null; confirm: confirmRemoveCampus | removeCampusTarget |
| OVERLAY-46 | src/components/schedule/TimeBaseSettings.vue:298 | 删除作息季 | close: removeSeasonTarget = null; confirm: confirmRemoveSeason | removeSeasonTarget |
| OVERLAY-47 | src/components/schedule/TimeImportPlanModal.vue:46 | modalTitle | close: closeImportPlan | importPlanOpen |
| OVERLAY-48 | src/components/schedule/TimeSettingsModal.vue:230 | 🕐 作息与时间设置 | close: tryCloseTimeEditor | show |
| OVERLAY-49 | src/components/schedule/TimeSettingsModal.vue:529 | 放弃未保存的修改 | close: cancelPendingDraft; confirm: confirmDiscardDraft | pendingDraftAction |
| OVERLAY-50 | src/components/schedule/TimeSettingsModal.vue:543 | 恢复默认作息时间 | close: resetTimesTarget = false; confirm: applyResetTimes | resetTimesTarget |
| OVERLAY-51 | src/components/tasks/TaskBulkBar.vue:41 | `删除 ${count} 项待办` | close: confirmRemove = false; confirm: confirmRemove = false; emit('remove') | — |
| OVERLAY-52 | src/components/tasks/TaskBulkRescheduleDialog.vue:37 | 批量改期 | close: emit('close') | — |
| OVERLAY-53 | src/components/tasks/TaskRescheduleDialog.vue:40 | 重新安排时间 | close: emit('close') | — |
| OVERLAY-54 | src/components/tasks/TaskRescheduleDialog.vue:55 | 改期后的时间冲突 | close: conflictMessage = ''; confirm: conflictMessage = ''; emit('save', draft) | conflictMessage |
| OVERLAY-55 | src/components/tasks/TaskWorkSession.vue:38 | task ? `${task.title} · 工作进度` : '任务工作进度' | close: emit('close') | — |
| OVERLAY-56 | src/views/AdminCenterView.vue:662 | 确认处理本机记录 | close: healthFixTarget = null; confirm: confirmHealthFix | healthFixTarget |
| OVERLAY-57 | src/views/EventsView.vue:254 | editing ? '编辑日程' : '新建日程' | close: closeForm | formOpen |
| OVERLAY-58 | src/views/EventsView.vue:283 | 日程详情 | close: detail = null | detail |
| OVERLAY-59 | src/views/EventsView.vue:293 | 导入日程 | close: importOpen = false | importOpen |
| OVERLAY-60 | src/views/EventsView.vue:295 | 删除日程 | close: deleteEventTarget = null; confirm: confirmRemove | deleteEventTarget |
| OVERLAY-61 | src/views/EventsView.vue:296 | 时间冲突 | close: saveConflict = null; confirm: confirmConflictSave | saveConflict |
| OVERLAY-62 | src/views/ExamsView.vue:740 | editingId ? '编辑重要日期' : '添加重要日期' | close: showForm = false | showForm |
| OVERLAY-63 | src/views/ExamsView.vue:847 | 删除重要日期 | close: deleteTarget = null; confirm: confirmDelete | — |
| OVERLAY-64 | src/views/LedgerView.vue:890 | 分类管理 | close: showCatManage = false | showCatManage |
| OVERLAY-65 | src/views/LedgerView.vue:996 | 删除自定义分类 | close: categoryDeleteTarget = null; confirm: confirmDeleteCategory | categoryDeleteTarget |
| OVERLAY-66 | src/views/ListsView.vue:626 | editingListId ? '编辑清单' : '新建清单' | close: showListForm = false | showListForm |
| OVERLAY-67 | src/views/ListsView.vue:661 | editingItemId ? '编辑事项' : '添加事项' | close: showItemForm = false | showItemForm |
| OVERLAY-68 | src/views/ListsView.vue:684 | 批量添加事项 | close: showBulkForm = false | showBulkForm |
| OVERLAY-69 | src/views/ListsView.vue:695 | confirmTitle | close: confirmTarget = null; confirm: confirmAction | confirmTarget |
| OVERLAY-70 | src/views/PlatformAdminView.vue:506 | placeReviewConfirmation.decision === 'approved' ? '审核并发布地点' : '拒绝地点资料' | close: placeReviewConfirmation = null; confirm: confirmPlaceReview | access === 'owner' && placeReviewConfirmation |
| OVERLAY-71 | src/views/ProjectsView.vue:1386 | projectFormTitle | close: showProjectForm = false | showProjectForm |
| OVERLAY-72 | src/views/ProjectsView.vue:1399 | editingTask ? '编辑任务' : taskDraft.parentTaskId ? '添加子任务' : '添加任务' | close: showTaskForm = false; editingTask = false | showTaskForm |
| OVERLAY-73 | src/views/ProjectsView.vue:1418 | editingMilestone ? '编辑里程碑' : '添加里程碑' | close: showMilestoneForm = false | showMilestoneForm |
| OVERLAY-74 | src/views/ProjectsView.vue:1429 | 添加交付检查项 | close: showDeliveryCheckForm = false | showDeliveryCheckForm |
| OVERLAY-75 | src/views/ProjectsView.vue:1439 | meetingProposalTarget ? '提出改期建议' : '发起小组讨论' | close: showMeetingForm = false; meetingProposalTarget = null | showMeetingForm |
| OVERLAY-76 | src/views/ProjectsView.vue:1452 | 协商任务调整 | close: showAdjustmentForm = false | showAdjustmentForm |
| OVERLAY-77 | src/views/ProjectsView.vue:1467 | 添加项目交付项 | close: showDeliverableForm = false | showDeliverableForm |
| OVERLAY-78 | src/views/ProjectsView.vue:1481 | `提交成果 · ${activeDeliverable?.title &#124;&#124; ''}` | close: closeDeliverableEditor | showDeliverableEditor |
| OVERLAY-79 | src/views/ProjectsView.vue:1502 | 验收成果 | close: reviewTarget = null | reviewTarget |
| OVERLAY-80 | src/views/ProjectsView.vue:1513 | 邀请成员 | close: showInviteForm = false | showInviteForm |
| OVERLAY-81 | src/views/ProjectsView.vue:1521 | `${taskEventsTitle} · 进展记录` | close: taskEventsTitle = ''; taskEvents = [] | taskEventsTitle |
| OVERLAY-82 | src/views/ProjectsView.vue:1526 | 转交项目负责人 | close: transferTargetId = '' | transferTargetId |
| OVERLAY-83 | src/views/ProjectsView.vue:1531 | ({ archive: '归档项目', delete: '删除项目', leave: '退出项目', remove: '移出成员', restore: '恢复项目', 'decline-invite': '拒绝项目邀请', 'delete-milestone': '删除里程碑', 'meeting-confirm': '确认小组讨论', 'meeting-cancel': '取消讨论邀约', 'meeting-apply-proposal': '采用改期建议', 'delivery-check-delete': '删除交付检查项' })[confirmAction.kind] &#124;&#124; '确认操作' | close: confirmAction = null; confirm: runConfirmedAction | confirmAction |
| OVERLAY-84 | src/views/ScheduleView.vue:330 | Popover | — | — |
| OVERLAY-85 | src/views/ScheduleView.vue:480 | 删除课程 | close: deleteCourseTarget = null; confirm: confirmDeleteCourse | — |
| OVERLAY-86 | src/views/ScheduleView.vue:492 | 删除课程 | close: coursesRemovalTarget = null; confirm: confirmCoursesRemoval | coursesRemovalTarget |
| OVERLAY-87 | src/views/ScheduleView.vue:502 | 导入课表模板 | close: importTemplateTarget = null; confirm: confirmImportCourseTemplate | importTemplateTarget |
| OVERLAY-88 | src/views/ScheduleView.vue:512 | 删除课表模板 | close: deleteTemplateTarget = null; confirm: confirmDeleteCourseTemplate | deleteTemplateTarget |
| OVERLAY-89 | src/views/ScheduleView.vue:522 | 替换整张课表 | close: replaceAllTarget = null; confirm: confirmWholeScheduleReplacement | replaceAllTarget |
| OVERLAY-90 | src/views/TasksView.vue:801 | 完成多项待办 | close: bulkCompletionConfirm = null; confirm: confirmBulkComplete | bulkCompletionConfirm |
| OVERLAY-91 | src/views/TasksView.vue:820 | 批量改期有时间冲突 | close: bulkShiftConfirmation = null; confirm: confirmBulkShift | bulkShiftConfirmation |
| OVERLAY-92 | src/views/TasksView.vue:955 | editingId ? '编辑待办' : '添加待办' | close: showForm = false | showForm |
| OVERLAY-93 | src/views/TasksView.vue:1042 | 删除待办 | close: deleteTarget = null; confirm: confirmDelete | — |
| OVERLAY-94 | src/views/TasksView.vue:1044 | 时间冲突 | close: saveConflict = null; confirm: confirmConflictSave | saveConflict |
| OVERLAY-95 | src/views/TasksView.vue:1056 | 完成整个事项 | close: completionTarget = null; confirm: confirmWhole | completionTarget |
| OVERLAY-96 | src/views/TodayView.vue:470 | 日程详情 | close: eventDetail = null | eventDetail |
| OVERLAY-97 | src/views/TogetherView.vue:746 | 移除好友 | close: friendRemovalTarget = null; confirm: confirmRemoveFriend | friendRemovalTarget |
| OVERLAY-98 | src/views/TogetherView.vue:755 | 取消邀约 | close: invitationCancellationTarget = null; confirm: confirmCancelInvitation | invitationCancellationTarget |
| OVERLAY-99 | src/views/ledger-panels/BillFormModal.vue:2 | editingBillId ? '编辑固定账单' : '添加固定账单' | close: formOpen = false | formOpen |
| OVERLAY-100 | src/views/ledger-panels/BillFormModal.vue:129 | 删除固定账单 | close: deleteBillTarget = null; confirm: confirmDeleteBill | — |
| OVERLAY-101 | src/views/ledger-panels/BudgetSettingsModal.vue:2 | 月度预算 | close: emit('close') | open |
| OVERLAY-102 | src/views/ledger-panels/FxSettingsModal.vue:2 | 汇率设置 | close: emit('close') | open |
| OVERLAY-103 | src/views/ledger-panels/QuickEntryModal.vue:200 | editingId ? '编辑记录' : keepAdding ? '再记一笔' : '记一笔' | close: closeQuick | — |
| OVERLAY-104 | src/views/ledger-panels/TransactionDetailModal.vue:86 | detailExpense?.name ?? '记录详情' | close: $emit('update:open', false) | detailExpense |
| OVERLAY-105 | src/views/ledger-panels/TransactionDetailModal.vue:136 | 登记退款 | close: $emit('close-refund') | showRefund |
| OVERLAY-106 | src/views/ledger-panels/TransactionImportDialog.vue:217 | 导入账单 | close: close | open |
