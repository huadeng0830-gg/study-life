# 三两事微信小程序（首发骨架）

当前小程序工程覆盖校园目录、公开反馈与建议、校园审核队列，以及账号资料和三两豆。它与仓库中的 Vue/PWA 共用 Supabase Edge Functions 和数据库。

## 配置与本地预览

1. 在微信公众平台创建并认证小程序，获得 AppID；在微信开发者工具中打开 `miniprogram/` 并把 `project.config.json` 的空 `appid` 替换为真实 AppID。
2. 在 `config.js` 填入 Supabase 项目 URL 与公开 anon/publishable key。此文件只用于公开配置，严禁填 service-role key、微信 AppSecret、邮箱密码或其他服务端密钥。
3. 在 Supabase 项目 Function Secrets 中设置 `WECHAT_MINIPROGRAM_APP_ID`、`WECHAT_MINIPROGRAM_APP_SECRET` 与至少 32 字符的随机 `WECHAT_IDENTITY_HASH_SECRET`。部署经审查的 `wechat-auth`、`campus-community`、`campus-life` 和 `campus-social` Edge Functions。校园社区与审核所需数据库迁移已在生产应用；不要重复应用 `20261015100000_campus_community_rewards.sql`，也不要在迁移历史漂移修复前运行全量 `db push`。
4. 在微信公众平台配置 Supabase HTTPS 域名为 request 合法域名。正式发布前需检查微信内容安全、隐私保护指引、用户授权文案和 AppID 对应环境。

生产数据库已包含校园社区与审核所需 schema，但尚未配置 AppID、AppSecret、Supabase Function Secrets、微信 request 合法域名或小程序发布环境，因此本目录暂时不能完成真实微信登录或线上数据请求。开发者工具预览也需要配置 request 合法域名或使用开发工具的本地调试选项。

## 登录与账号关联

小程序通过 `wx.login` 获取一次性 code，由 `wechat-auth` 服务端调用微信 `jscode2session`。OpenID 使用服务端 HMAC 哈希后保存；`session_key` 不返回客户端、不写日志、不持久化。Supabase service-role key 和微信 AppSecret 仅能配置在 Edge Function Secrets。

首次微信登录会建立内部 Supabase 账号。已有邮箱用户可先用其已验证邮箱登录，再执行微信绑定，账号资料和校园记录会合并到该邮箱账号。若账号有冲突的唯一记录，或原微信账号持有审核/管理权限，合并会整体回滚并提示管理员介入。微信内部地址不是经过验证的联系邮箱，因此不能单独申请审核员；审核员必须绑定已验证邮箱。

## 三两豆

充值豆和贡献豆独立记账。充值、兑换与具体数字权益价格暂未开放；后台权益目录默认禁用。资质齐备后再配置应用内数字权益目录；不用于用户间转账或校园商品服务。

贡献豆有两种来源：总管理员批准的审核员每完成 1 条并写明依据，可得 3 个贡献豆，每日最多 20 条；审核员每月随机抽查约 10%，实质错判会说明理由后更正或重开，只追回未花部分，缺额从后续贡献奖励抵扣。登录用户提交的建议通过安全检查后匿名公开，只有总管理员确认“已解决”并设置奖励时，才一次性发放 0–20 个贡献豆；提交本身不保证获奖，公开页会显示已发奖励数。
