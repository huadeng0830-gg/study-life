# Project Agent Instructions

## GitHub 发布、隐私与数据安全规则

这是强制规则，不是建议。凡涉及 `git add`、`git commit`、`git push`、GitHub 发布、Release、打包或开源整理，都必须先完成本节检查。

核心原则：GitHub 仓库应包含“如何运行这个程序”，而不应包含“谁使用过这个程序以及他产生了什么数据”。源码可以公开，真实用户内容、秘密和本地状态默认不能公开。

### 上传边界

- 默认只提交程序本身：源码、组件、页面、composables、utils/services、parser、tests、必要静态资源、配置、lock 文件、构建配置、Actions、README、LICENSE、`.gitignore`、schema/migration，以及完全虚构的 demo/sample。
- 默认不提交程序运行产生的内容：课程表、作息、作业、待办、笔记、通知原文、OCR 历史、账单/消费/收入、专注记录、日程、同步数据、LocalStorage/IndexedDB 导出、数据库、备份、上传附件、日志和截图。
- 不提交真实姓名、学号、手机号、邮箱、住址、账号、用户/设备/同步 ID、Cookie、Session 或其他身份信息。测试、fixture、mock、demo 必须使用虚构或彻底脱敏的数据；README 截图、GIF、视频同样必须脱敏。
- 不提交 API/access/refresh token、密码、secret、连接串、私钥/证书、`.env` 及其他真实环境变量。只允许提交不含秘密的 `.env.example`，且仅使用占位符或虚构值。
- 根据本项目实际情况重点忽略 `备份文件/`、`backups/`、用户数据/上传/导出目录、`.db`/`.sqlite*`、`node_modules/`、`dist/`、`coverage/`、缓存、临时文件、日志、测试产物和 IDE 文件；发现新的运行时数据目录要同步补充 `.gitignore`。

### 发布前检查

1. 先查看 `git status`、`git diff`、`git diff --cached`、`git ls-files`，确认待提交内容和已跟踪文件。
2. 扫描待提交内容及 README：敏感信息（key/token/password/secret/private key/连接串）、`.env`、数据库、备份、导出、上传文件、日志、截图和真实用户内容。
3. `.gitignore` 不是万能的：已被 Git 跟踪的文件仍会提交。发现应忽略的已跟踪敏感文件时，只从索引移除并保留本地文件（按需使用 `git rm --cached`），不得误删本地数据。
4. 首次公开或仓库尚未公开时检查 Git 历史中的秘密和用户数据；当前工作区删除文件不等于历史已安全。若发现秘密，先暂停，建议吊销/轮换，再处理历史并重新扫描。
5. 发布前输出简短检查结果：源码、用户数据、`.env`、Secrets、数据库、上传文件、README 脱敏、`.gitignore`、Git diff/历史扫描各项结论。

### 风险处理

- 不确定某文件是否包含隐私、秘密或用户数据时，默认暂停，不提交；说明文件、风险和建议，等待确认。
- 发现真实密钥、用户数据库/备份/通知/账单/私人笔记、`.env`、私钥，或无法判断的大型数据文件时，必须停止公开发布。
- 绝不为了 GitHub 删除本地真实数据。可以修改 `.gitignore`、从索引移除、建立 demo/sample；本地保留与 Git 不跟踪必须分开处理。
- 若运行时数据直接写入源码目录，将其记录为数据隔离问题；除非另行获准，不为发布擅自进行大规模数据结构重构。
