# Windows 桌面版个人签名证书

此目录中的 `.cer` 只含公开证书，不含签名私钥。它是供个人自用的自签名 Authenticode 证书，不是受 Windows 默认信任的公开 CA 证书。

首次安装桌面版前，请确认 SHA-256 指纹为：

`AAF8B9287E05E1B3FF0114DF5BEF80350248A651D91669D3011B910CBE3A5091`

然后在 `certmgr.msc`（当前用户证书管理器）中，将官方 Release 附带的 `study-life-code-signing.cer` 分别导入：

- 受信任的根证书颁发机构 → 证书
- 受信任的发布者 → 证书

未导入证书时，Windows 可能拦截或警告此安装包，自动更新也无法验证更新签名。只信任从本项目官方仓库或 Release 下载、且指纹匹配的证书。

签名私钥和密码只保存在 GitHub Actions Secrets 中，严禁提交到仓库。该证书有效期至 2031-10-08。

发布 Windows 桌面版前，在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置：

- `WIN_CSC_LINK`：PFX 证书文件的 Base64 内容。
- `WIN_CSC_KEY_PASSWORD`：导出 PFX 时设置的密码。

这两个值只用于 GitHub Actions 的签名步骤；不要放入源码、普通仓库变量、Release 附件或聊天消息。配置完成后再推送 `v*` 版本标签触发桌面版发布。
