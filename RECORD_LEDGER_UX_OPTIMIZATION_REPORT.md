# STUDY LIFE RECORD + LEDGER UX OPTIMIZATION REPORT

日期：2026-09-12

## 1. Executive Summary

记录优化前：QuickRecord 已有自然语言解析、类型快捷入口和保存撤销，但手机打开会抢焦点；预览暴露置信度，类型/分类修改偏深。

记录优化后：输入框成为首要操作；手机默认不强制弹键盘；预览改为人话确认，支持就地切换类型、金额、日期和分类；保存反馈携带撤销与查看定位；补充跨类型最近 5 条。

账本优化前：摘要偏大且只突出支出；“记一笔”入口集中在页头；交易编辑需要从详情再进入另一个编辑弹窗。

账本优化后：摘要聚焦今天花费、本周花费、本月花费；页面使用单一“＋记一笔” CTA；交易按日期紧凑分组；详情内直接修改金额、分类、日期；保存后可查看并短暂高亮目标交易。

## 2. Precheck

当前主要入口为 Sidebar/移动底部“记录”、`Ctrl/Cmd+K`、Ledger 的“记一笔”和固定账单支付。当前数据链路已统一到 domain commands 与 `sl_expenses` 等现有存储键；已有本地保存、备份、同步和撤销边界。

本轮选择的方向：减少首屏噪音与误操作，优先保留金额 + 内容的快速路径；不新增业务域，不升级数据 schema，不改 Sync Protocol。

## 3. Record UI

- Input：单一主输入框，placeholder 为“今天想记点什么？”，辅助示例只保留一条。
- Preview：显示类型、标题、金额/日期/分类等用户可判断字段，不显示技术置信度。
- Recent：从 Task、Transaction、Note、Event、Important Date 合并最近 5 条，使用紧凑行。
- Save：保留“保存”为主 CTA，“保存并继续”为次级动作，保存中锁定重复点击。
- Undo：保存结果统一向父层传递撤销函数；交易结果另带实体定位信息。
- Mobile：打开不主动抢键盘；用户点击类型或最近记录后再聚焦；底部保存区域保持可达。
- Desktop：桌面 Enter 仍可快速保存，Shift+Enter 换行，Ctrl/Cmd+Enter 明确保存。

## 4. Record Interaction

主要流程为“打开记录 → 输入 → 识别 → 确认 → 保存”。不再要求先选类型；类型只作为识别后的快速纠错入口。

- 路径 A：保留自然语言直达，未增加点击。
- 路径 B：Ledger 仍为打开 → 记一笔 → 金额 → 保存，分类/账户可用默认值。
- 路径 C：交易详情 → 编辑 → 保存，从二次编辑弹窗收敛为详情内编辑，减少一次页面层级。
- 路径 D：保存后 Toast → 撤销，语义保持一致。

未接入用户行为埋点，因此不虚构平均点击数；本报告以代码路径和自动化回归为依据。

## 5. QuickRecord Parsing

- 修复/强化：补充“班会”日程识别；“今天实验挺顺利”等反思文本优先作为笔记；跳过“5分钟、2小时、3次、4号楼”等非金额数字。
- 保留：金额前后语序、中文金额、`块5`、收入、周期账单、批量换行、多意图拆分和不确定输入保留原文。
- 新增回归：午饭 15 元、打车 22.5、兼职收入 200、奖学金 1000、明天交实验报告、后天下午三点班会、实验记录和 5 分钟误判控制。
- 误判控制：金额必须结合货币/行为语境或明确裸金额位置，模糊输入继续走可保存笔记的降级出口。

## 6. Transaction Preview

- Amount：预览内可直接修改，使用 decimal inputmode。
- Type：支出/收入/待办/日程/重要日期/笔记可直接切换。
- Category：预览分类 chip 展开轻量选择器，优先显示当前分类与常用分类。
- Date：预览内保留 date input；默认今天。
- Account：预览显示默认账户，完整修改仍在“修改”区域完成。
- Inline Edit：标题、金额、日期、笔记可直接编辑；分类不再需要巨大 Modal。

## 7. Ledger UI

- Summary：并列展示今天花费、本周花费、本月花费，首页摘要只聚焦支出节奏；收入记账与筛选能力仍保留在明细和表单中。
- CTA：账本首页只保留一个主“＋记一笔”入口，复用 QuickRecord 与同一手动表单逻辑。
- Transactions：交易名、分类/时间、右对齐金额；不展示 ID、来源内部字段或同步字段。
- Groups：按今天、昨天、日期分组，并提供当天收支小计。
- Filters：搜索、日期、分类、账户、金额、来源和收支方向收纳在筛选区。
- Bills：固定账单仍为独立子区，待处理提醒只在有事项时出现。
- Stats：统计维持次级位置，分类排序列表优先于复杂图表。

## 8. Ledger Interaction

- New transaction：金额优先，移动端使用 decimal inputmode；金额 + 保存即可完成常见记录。
- Edit：交易详情内直接修改金额、分类、日期，不要求重新完整录入。
- Delete：普通交易删除后提供 Undo；固定账单支付继续使用“撤销支付”边界。
- Undo：创建、删除和固定账单已有领域命令语义保持不变。
- Search/Filter：保留组合筛选、空结果提示和清除筛选能力。

## 9. Record ↔ Ledger

QuickRecord transaction 和 Ledger manual entry 继续写入同一 Transaction domain，复用分类、默认账户、日期、校验、Toast 与 Undo。

QuickRecord 交易保存提示“已记录并记入账本 · ¥…”，可直接“查看”；Ledger 内会定位并短暂高亮该交易。来源字段仍只保留内部，不出现在普通列表。

## 10. Mobile

320/360/375/390/430：使用现有 `520px/768px/900px` 响应式边界，输入、预览、保存动作可换行；底部入口保持合理触控尺寸并收敛视觉重量。

Keyboard：Modal 继续使用 visualViewport 调整和 focused control 保持可见；QuickRecord 手机打开不强制弹键盘，Enter 默认换行。

One-hand：记录入口在底部中央；账本主 CTA 在内容流前部；保存按钮在移动端扩展为主要宽度。

Bottom Sheet：沿用项目 Modal 的移动端底部样式；交易详情编辑在同一轻量详情层完成。

## 11. Desktop

1366/1440/1920：记录使用中等宽度 Modal，账本内容受 `content-mid` 约束，不让交易列表无限拉宽；桌面快捷键保持简单。

## 12. Dark Mode

Record：输入、预览卡、分类选择器、警示提示改用主题 token，避免固定白底。

Ledger：摘要、交易列表、详情编辑、筛选、分类管理和 Toast 使用 `--card/--bg-tint/--ink-soft`；系统暗色补齐 border、muted text 与 focus ring token。

## 13. Accessibility

Keyboard：保留 Tab/Modal focus trap、Escape 关闭保护、IME composing 保护和 Ctrl/Cmd+Enter。

Focus：输入和保存控件保持清晰 focus-visible 基础样式；手机不以自动聚焦换取视觉浏览成本。

ARIA：记录、筛选、分类选择、交易入口和状态消息保留 aria-label/role/live 区域。

Touch targets：底部入口、麦克风、保存和主要编辑动作保持约 42–54px 高度；次级 chip 仍可触达。

## 14. Performance

Record open：QuickRecord 仍按需异步挂载；解析为本地同步计算，最近列表最多 5 条。

Ledger open：沿用模块级 ledger index 缓存和 VirtualList；筛选不引入新的全局扫描模块。

500/1000 Transactions：已有索引、搜索和统计 smoke 覆盖。

5000 Transactions：已有轻量筛选 smoke 覆盖；未引入复杂虚拟列表重构。

## 15. Regression

Bill：支付周期幂等、历史金额冻结、撤销支付与删除引用边界未改。

Transaction：稳定 ID、金额按分归一化、软删除、来源边界和编辑校验未改。

QuickRecord：适配器仍写入真实 Task/Transaction/Note/Event/Milestone/Bill 集合。

Sync / Backup / Vault：本轮未改同步协议和持久化 schema；现有全量测试通过。

Undo：记录和账本保存/删除继续提供撤销闭环。

## 16. Tests

Before：工作区原有记录/账本回归已覆盖大部分领域边界。

Added：专项解析回归 8 类场景；QuickRecord 预览类型纠正、技术置信度隐藏、手机 Enter 行为回归。

After：全量 78 个测试文件、630 个测试通过。

## 17. Validation

- lint：PASS
- typecheck：PASS
- tests：PASS（78 files / 630 tests）
- build：PASS（Vite production build；PWA precache 86 entries / 1771.69 KiB）
- diff-check：PASS（仅有 Git 的 LF/CRLF 提示，无 whitespace error）
- deploy：上一版 PASS（Cloudflare Pages `study-life/main`；https://a4f8ffe3.study-life.pages.dev）；本轮摘要调整已构建，尚未再次部署

## 18. Changed Files

本轮直接触及的文件（其中 `App.vue`、`Sidebar.vue` 等在本轮开始前已存在未提交改动，均已保留）：

- [App.vue](D:/study-life/study-life/src/App.vue)
- [QuickRecordPanel.vue](D:/study-life/study-life/src/components/QuickRecordPanel.vue)
- [Sidebar.vue](D:/study-life/study-life/src/components/Sidebar.vue)
- [adapters.js](D:/study-life/study-life/src/composables/quickRecord/adapters.js)
- [entities.js](D:/study-life/study-life/src/composables/quickRecord/entities.js)
- [parser.js](D:/study-life/study-life/src/composables/quickRecord/parser.js)
- [theme.js](D:/study-life/study-life/src/composables/theme.js)
- [LedgerView.vue](D:/study-life/study-life/src/views/LedgerView.vue)
- [release.config.js](D:/study-life/study-life/release.config.js)（按显式发布请求同步版本说明与源码签名）
- [quickRecord.test.js](D:/study-life/study-life/tests/quickRecord.test.js)
- [quickRecordPanel.test.js](D:/study-life/study-life/tests/quickRecordPanel.test.js)
- [本报告](D:/study-life/study-life/RECORD_LEDGER_UX_OPTIMIZATION_REPORT.md)

## 19. Deliberately Not Added

未增加专业预算、资产管理、投资、报销/发票系统、复杂会计分类、更多分类层级、AI Agent、社交能力、新独立 Domain、同步协议改造或数据 schema 升级；未 commit、push。

## 20. Remaining Opportunities

1. 用真实 320–430px 设备完成键盘弹起、safe-area 和单手操作验收。
2. 为“查看刚保存的交易”补充 VirtualList 的精确滚动定位，而不是仅在当前可见范围高亮。
3. 在不改变数据模型的前提下，为交易字段修改补充可选的单次 Undo 快照。

## 21. Final Decision

RECORD UI: PASS  
RECORD SPEED: IMPROVED  
RECORD ERROR RECOVERY: IMPROVED  
LEDGER UI: PASS  
LEDGER SCANNABILITY: IMPROVED  
LEDGER ENTRY SPEED: IMPROVED  
LEDGER EDITING: IMPROVED  
MOBILE: PASS（代码级 smoke；等待真实设备体验验收）  
DESKTOP: PASS  
DARK MODE: PASS（主题 token 与代码级检查）  
ACCESSIBILITY: PASS（代码级检查）  
FULL REGRESSION: PASS  
NEW BUSINESS DOMAIN: NO  
SYNC SCHEMA CHANGED: NO  
COMMIT: NO  
PUSH: NO  
DEPLOY: 上一版 PASS；本轮摘要调整未部署  
READY FOR NEXT REVIEW: YES
