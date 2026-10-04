// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年10月04日-版本2',
    signature: 'db2c3f992b',
    notes: [
      '修复云同步限流可被完全绕过：限流键里含被猜的访问码哈希，换一个码就换一个桶，每个猜测值各自享有独立额度。新增不受请求体影响的粗粒度兜底层（额度为设备额度的 4 倍，容得下同一 NAT 下多台设备各自用满 burst）',
      '旧版 6 位数字访问码鉴权改为显式开关 SYNC_LEGACY_CODE_AUTH 且默认关闭。该密钥空间只有 10^6 且服务端不校验正确性，留着等于公开一个可爆破的口子；注意 SYNC_LEGACY_MIGRATION 只管存储后端、从来不是鉴权开关',
      '移除同步面板里已失效的 6 位访问码输入入口（后端恒返 410）；已连接的旧版用户仍保留升级与断开入口',
    ],
  },
  {
    version: '2026年10月04日-版本1',
    signature: 'fe04eaa0e0',
    notes: [
      '修复发布签名闸门的三处根因：签名不再随工作区换行符变化（core.autocrlf + 无 .gitattributes 曾导致同一份源码算出三个不同签名）、二进制资源改为按原始字节入哈希（此前 png 与 OCR 语言包有近半数字节被 utf8 解码成 U+FFFD，换图标换模型都不触发闸门）、补上 sync-protocol.js 这个真正影响前后端产物的输入',
      '新增 .gitattributes 统一换行；.gitignore 补齐 AGENTS.md 要求的 .env 与 .db/.sqlite*，并把交接草稿规则锚定到仓库根目录',
      'bump 脚本与版本工具改为换行符无关，修复 CRLF 检出下说明被静默丢弃却仍打印成功的缺陷',
    ],
  },
  {
    version: '2026年10月01日-版本1',
    signature: '7e6d692345',
    notes: [
      '账本全面审核修复：详情改金额放大100倍',
      '退款继承币种与分摊并按我承担口径计算',
      '账单日期推进锚点修复不可逆漂移',
      '修复收支口径不一致导致的同屏矛盾',
      '导出范围与界面合计对齐并防CSV公式注入',
      '新增完整编辑入口与收入结余展示',
      '新增预算节奏与导出全部历史',
    ],
  },
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = 'db2c3f992b'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
