// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年10月04日-版本3',
    signature: '39ca66af58',
    notes: [
      'OCR 引擎改为完全自托管：此前只给了 langPath，tesseract.js 会把 worker 与 WASM 引擎指向 cdn.jsdelivr.net，断网/墙内/CDN 故障时图片识课直接不可用，也与不接入外部网络服务的约束冲突',
      '随包新增 tesseract-core-simd-lstm.wasm.js（wasm 以 base64 内嵌，单文件自包含，约 3.8MB）与 tesseract-worker.min.js；corePath 给具体文件而非目录，避开需要同时发布三个 SIMD 变体的约 19.7MB',
      '新增 SIMD 能力探测：环境不支持时立刻给出可执行提示，且不再创建引擎、不再解码图片——此前要白等完一整轮预处理才失败',
      'Service Worker 的 OCR 缓存规则原先只匹配 .traineddata，自托管引擎不走缓存、每会话重下 3.8MB；已扩展并把 maxEntries 提到 4',
      '.gitattributes 把引擎文件声明为 binary，避免换行规范化破坏内嵌的 base64 wasm（已用 blob 哈希核对）',
      'eslint 忽略 public/ocr 与 coverage 等产物目录：引擎文件内嵌 base64，对它跑规则只会产生上千条与本项目无关的报错',
      '新增 tests/ocrEngineWiring.test.js：ocrPipeline.js 与 ocrService.js 此前零覆盖。断言引擎与 worker 必须同源且不得出现 CDN 主机名，并经变异验证（删掉 corePath/workerPath 即变红）',
    ],
  },
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
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '39ca66af58'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
