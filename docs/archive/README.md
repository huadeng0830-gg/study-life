# Archive

本目录是**历史**审计与工作报告的归档，不是现行文档。

## 最重要的一条：这里的数字几乎都已过期

这些文档记录的是**当时**的状态。以下内容大概率与今天的代码不符：

- **测试文件数 / 用例数** —— 报告里出现的 170 / 1781 / 1860 / 1872 等，全都过期了。
- **版本号与源码签名** —— 报告里出现的 `版本51` / `db8fce779c` 等早已不是当前值。
- **行号引用** —— `UX_AUDIT_176_REPORT.md` 有 3500+ 行，此后代码持续变动，
  报告里的 `L####` 指针会漂移（本仓库已经因此踩过一次：某处指向的表整体移位了约 687 行）。

## 当前基线看哪里

- **本次审计范围、问题与未验证边界** → [`../PROJECT_AUDIT.md`](../PROJECT_AUDIT.md)；实际命令与结果见 [`../TEST_REPORT.md`](../TEST_REPORT.md)
- **对外承诺的能力清单** → [`../../README.md`](../../README.md)（这份是**经过逐条核实的**，没有虚报）
- **设计令牌的约定** → [`../../DESIGN_TOKENS.md`](../../DESIGN_TOKENS.md)，实际值由 `src/style.css` 和设计令牌测试核对

## 但请不要删掉这些报告

它们是**唯一**解释"为什么代码长成这样"的证据链。举几个不看报告就一定会被误改的例子：

- `overlayStack.js` 的浮层层叠阶梯 —— 为什么 `Modal` 要写**内联** `z-index`，
  以及三个来源（`App.vue` 的样式、`overlayStack.js` 的注释、`modalStackOrder.test.js` 的断言）
  必须同步改。删掉报告，下一个人会把这些反直觉的设计当成冗余清掉。
- `scopedChildReachability` 的登记表 —— 哪些"永远匹配不到节点的 scoped 规则"
  是**故意保留**的，以及每一条的理由。误删一条活规则，现有守卫抓不到（vitest 不处理 CSS）。
- 剥注释解析器的三次修错记录 —— 同一个 bug 需要在 3 份状态机里各修一遍，
  以及"覆盖面下限"这条断言如何抓到了一次假阴性。

## 各文件主题

| 文件 | 内容 |
| --- | --- |
| `UX_AUDIT_176_REPORT.md` | 最大的一份，3500+ 行，§1.1–§1.89 逐轮记录 176 项审计的勘察、证据与变异结果 |
| `FINAL_PRODUCT_AUDIT.md` | 产品向的整体体检 |
| `SYSTEM_CLOSURE_AUDIT.md` | 系统收口体检 |
| `RECORD_LEDGER_UX_OPTIMIZATION_REPORT.md` | 账本 UX 优化 |
| `LEDGER_REVIEW_CATEGORY_DRILLDOWN_REPORT.md` | 账本分类下钻 |
| `LEDGER_FINAL_OPTIMIZATION_REPORT.md` | 账本收尾优化 |
| `HANDOFF.md` / `NEXT_PROMPT.md` | 早期会话交接草稿。**已被 `.gitignore` 排除**，只在本地存在 |
