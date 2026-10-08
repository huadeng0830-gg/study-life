# Windows 桌面版分发研究

研究日期：2026-10-06。仅评估分发与更新，不打包、不上传、不部署；官网与桌面产品的整体拆分见 `desktop-product-plan.md`。

## 决策建议

当前实现采用 Windows x64 完整 NSIS `.exe` 安装包与同仓库公开 GitHub Releases；Cloudflare Pages 继续托管网页。R2 仍是未来可评估的镜像选项，需先测目标网络、缓存策略和成本，不能预先保证中国大陆的速度。

已安装的 `1.0.3` 客户端把更新源写死在 `huadeng0830-gg/study-life-desktop-releases`。`1.0.4` 需要将同一套 `latest.yml`、`.blockmap` 和安装包暂时镜像到该旧仓库；新安装包本身已指向主仓库 `study-life`，因此这只是一次性迁移。发布仓库需要临时提供 `LEGACY_RELEASES_TOKEN`（旧仓库 `Contents: write`），之后可移除该 secret 和兼容步骤。

## 已核验事实

| 项目 | 官方边界 | 本项目含义 |
| --- | --- | --- |
| Windows 打包 | NSIS 是 electron-builder 的默认 Windows 目标；`nsis-web` 在安装时下载应用包 | 首版选完整 NSIS 安装包，下载一次后可离线安装，减少安装过程的网络依赖。参见 [NSIS 文档](https://www.electron.build/v26/docs/nsis/) |
| 应用身份 | NSIS 升级/卸载身份由 `appId` 关联；发布后改动会影响已有安装的升级 | 首次发行前固定 `appId`，产品展示名可以另行更新。参见 [NSIS 文档](https://www.electron.build/v26/docs/nsis/) |
| 官网静态文件 | Cloudflare Pages 单个静态资源最多 25 MiB，官方建议大文件使用 R2 | 官网放介绍、截图、下载按钮，不把安装包放入 Pages 静态构建。参见 [Pages Limits](https://developers.cloudflare.com/pages/platform/limits/) |
| GitHub Releases | 单个 Release asset 必须小于 2 GiB；每个 Release 最多 1,000 个附件；文档未设总大小和下载带宽上限 | 足以承载内测安装包、更新附件和版本记录；对外下载使用公开发行资源，不能把发布令牌嵌入客户端。参见 [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) |
| R2 文件 | 对象上限 5 TiB；单次上传上限 5 GiB，较大文件可分段上传 | 安装包大小通常不会触及 R2 对象上限；实际包大小必须以后续构建为准。参见 [R2 Limits](https://developers.cloudflare.com/r2/platform/limits/) |
| R2 公网下载 | 自定义域名可配置缓存；`r2.dev` 公共开发入口限流且可能限制带宽，不适合生产 | 若采用 R2，应配置生产自定义域名，而非把 `r2.dev` 作为官网正式下载地址。参见 [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) |
| R2 成本 | Standard 免费额度每月为 10 GB-month 存储、100 万次 A 类操作、1,000 万次 B 类操作；R2 出网流量免费，但其他计费服务可能另收费 | 小规模分发可能落在免费额度内，不能据此承诺永久零成本；域名和签名另计。参见 [R2 Pricing](https://developers.cloudflare.com/r2/pricing/) |
| 大陆网络 | Cloudflare China Network 文档注明 R2 桶不能在中国大陆创建，其自定义域名不支持大陆网络，可通过 Global Acceleration 扩展 | 普通 R2 自定义域名不能等同于已有大陆 CDN；文档也不代表大陆用户必然不能访问。是否采用主下载地址需要对目标用户网络实测。参见 [China Network products](https://developers.cloudflare.com/china-network/reference/available-products/) |

## 自动更新

项目已接入 `electron-updater` 的 NSIS 更新控制器。安装包必须在 `desktop-app` 中安装锁定的生产依赖；`npm run desktop:verify` 会检查 `app.asar` 内的更新器、版本和 `resources/app-update.yml`。新版本由 `.github/workflows/desktop-release.yml` 在推送匹配桌面 SemVer 的 `v*` 标签后构建并发布。发布必须包含同次构建生成的 `latest.yml`、NSIS 安装包与 `.blockmap`；用户端只读取公开发行资源，不携带发布令牌。参见 [Auto Update](https://www.electron.build/v26/docs/features/auto-update/) 和 [Publishing](https://www.electron.build/v26/docs/publish/)。

发布规则：保留生成的 `.blockmap` 等更新附件，不要手工改安装包或哈希。GitHub Actions 先构建目录包并验证更新器，再通过 `electron-builder --publish always` 创建或更新正式 Release；`latest.yml` 和对应安装包由同一次构建上传。NSIS 差分下载支持属于可配置能力，参见 [NsisOptions](https://www.electron.build/v26/docs/api/app-builder-lib.interface.nsisoptions/)。

首版可先提供“检查新版本 → 官网下载”并进行小范围内测；正式加入“发现更新 → 用户选择下载 → 用户选择重启安装”，避免在有未保存内容时强制重启。失败时应保留当前版本并提供手动下载。这些是本项目的产品设计建议。

Windows 更新签名校验使用预期发布者名称；需要签名配置与下载更新的签名匹配。不能把 HTTPS 和文件哈希校验表述为发布者身份校验的替代品。参见 [WindowsConfiguration](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowsconfiguration/)。

## Windows 签名与首次安装提示

Microsoft 当前文档明确：有效 OV/EV 证书可以显示经验证的发布者，但新文件或未知发布者仍可能出现 SmartScreen 提示；EV 证书已经不再立即绕过 SmartScreen。无签名和自签名不能建立可信发布者，企业策略可能禁止用户继续运行。不能承诺“买签名就不会弹警告”。参见 [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

注意文档冲突：electron-builder v26 的 [Windows 签名说明](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/) 仍包含 EV 立即消除警告的旧说法；此处以维护 Windows 安全机制的 Microsoft 文档为准。

Microsoft Artifact Signing 的 Public Trust 个人资格目前仅支持美国或加拿大；组织地域支持列表也不包含中国。不能默认将其当成中国个人开发者可直接购买的廉价签名方案。正式签名须根据实际发布主体与 CA 的资格/费用核验。参见 [Artifact Signing prerequisites](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart#prerequisites)。

## 上线前需实际验证

- 安装、覆盖升级、卸载后的用户数据保留策略；正式升级前备份与迁移回退。
- 干净 Windows 环境的首次下载和安装体验，签名/SmartScreen 实际结果。
- 中国电信、联通、移动及校园网的下载连通性、下载成功率；网络结果不能从服务商品牌推断。
- 下载按钮直达安装包，展示版本、大小、系统要求、SHA-256、更新记录及备用下载。
- 更新源返回正确文件、缓存策略不会读取过期元数据；从已安装旧版本到新版本完成一次真实更新演练。
- 按 `AGENTS.md` 做发布前隐私检查，只分发程序文件；签名私钥、发布令牌、用户备份、日志和真实截图不进入仓库或安装包。

以上检查属于后续实现/发布阶段；本轮未执行打包或对外发行，也未验证网络速度、签名资格或最终安装包大小。
