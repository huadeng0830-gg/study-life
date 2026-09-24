# Apple Shortcuts / Web / Android 平台研究备忘录

> 研究日期：2026-09-10（Asia/Shanghai）  
> 范围：只查 Apple、WebKit、Android Developers、Chrome for Developers 的官方一手资料；未读取本地应用代码，也未修改源码、配置、依赖或数据。

## 结论先行

| 结论 | 证据等级 | 说明 |
|---|---|---|
| iPhone/iPad 的 Shortcuts 支持 `shortcuts://run-shortcut?...` | **官方明确支持** | Apple 明确写出 scheme、参数和示例；目标 shortcut 必须已保存在 Shortcuts collection。 |
| Shortcuts 支持 x-callback-url | **官方明确支持** | `x-success`、`x-cancel`、`x-error` 均有定义；成功运行时可回传文本 `result`，错误时可回传 `errorMessage`。 |
| Safari 网页可发起 `shortcuts://` | **官方明确支持 URL scheme 可在浏览器使用；具体网页触发方式仍需实测** | Apple 明确说 URL schemes 可用于 web browser；这支持 Safari 页面导航到该 URL，但没有对每种脚本/隐藏 iframe/后台触发方式作保证。 |
| iOS Home Screen PWA/独立 Web App 可稳定发起 `shortcuts://` | **未找到官方明确承诺；只能推断/需实测** | Apple/WebKit 明确支持 Home Screen web app，但检索到的官方资料没有把“standalone PWA → `shortcuts://`”列为受保证能力。应保留用户点击触发，并在目标 iOS/Safari 版本上验证。 |
| Share Sheet 可把 Safari 等 app 的内容交给 shortcut | **官方明确支持** | shortcut 需开启 “Show in Share Sheet”；可限制接收类型；若输入类型不匹配，shortcut 可能不显示。 |
| Web Clipboard 可作为“网页 → Shortcut”的桥 | **组合能力中部分官方明确、端到端只可推断** | Apple 明确 `input=clipboard` 会把系统剪贴板传给 shortcut；WebKit 明确网页写剪贴板需安全上下文和用户手势。两者串起来可形成桥，但“写入后立即启动并被 shortcut 读取”的端到端时序不是 Apple 文档承诺。 |
| Android 没有在本次官方资料中找到与 `shortcuts://` 一对一的系统 Shortcuts URL scheme | **研究范围内的否定性结论；属于推断，不是 Google 官方声明“不存在”** | Android 官方推荐的对应构件是 Intent/deep link/App Links、Android Sharesheet、Clipboard，以及 Chrome 的 Web Share/Web Share Target。 |

## 1. Apple Shortcuts URL scheme

Apple 的官方 Shortcuts User Guide 明确支持运行已保存的 shortcut：

```text
shortcuts://run-shortcut?name=[name]&input=[input]&text=[text]
```

官方定义的参数是：

- `name`：要运行的 shortcut 名称。
- `input`（可选）：可以是 `text` 或 `clipboard`。
- `text`：当 `input=text` 时，作为初始输入；当 `input=clipboard` 时会被忽略。
- 文本需要 URL 编码；官方示例使用了 `%20` 编码空格。

例如：

```text
shortcuts://run-shortcut?name=Lookup%20Goetta&input=text&text=goetta%20is%20great
shortcuts://run-shortcut?name=Add%20to%20Notes&input=clipboard
```

Apple 同一页面还明确说，URL schemes 可用于“自己的 app、web browser 或 command line”。这使得 Safari 页面导航到 `shortcuts://...` 有官方依据；它并不等于 Apple 对所有浏览器安全上下文、脚本触发方式或后台触发方式都作了保证。

Apple 还建议：如果只是一个 shortcut 调用另一个 shortcut，应使用 Shortcuts 内置的 **Run Shortcut** action；URL scheme 的定位是从 Shortcuts 之外的其他 app 集成。

来源：

- [Apple Support — Run a shortcut using a URL scheme on iPhone or iPad](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios)
- [Apple Support — Intro to URL schemes in Shortcuts](https://support.apple.com/en-euro/guide/shortcuts/apd621a1ad7a/ios)

## 2. x-callback-url

官方格式示例：

```text
shortcuts://x-callback-url/run-shortcut?name=Calculate%20Tip&input=text&text=24.99&x-success=...&x-cancel=...
```

Shortcuts 支持三类回调：

- `x-success`：交互成功后打开；如果运行 shortcut，回调 URL 会追加 `result` 参数，值为 shortcut 的文本输出。
- `x-cancel`：用户取消时打开；因为未完成，不提供 shortcut 输出。
- `x-error`：执行出错时打开；回调 URL 会追加 `errorMessage` 参数。

因此，若调用方需要“完成/取消/失败”三态，x-callback-url 比普通 `shortcuts://run-shortcut` 更适合。回调 URL 本身应按 URL 查询参数进行编码；这一点是 URL 构造的工程要求，不应把未编码的 `&`、`?` 等直接嵌入外层 URL。

来源：

- [Apple Support — Use x-callback-url with Shortcuts on iPhone or iPad](https://support.apple.com/en-gb/guide/shortcuts/apdcd7f20a6f/ios)

## 3. Safari 与 iOS Home Screen PWA

### 3.1 Safari 网页

**官方明确支持的部分：** Apple 写明 URL schemes 可在 web browser 中使用；Apple 也把 Safari 作为可接收 onscreen items 的 app 示例。因此，Safari 中由用户点击触发的链接/导航到 `shortcuts://...` 是有官方文档依据的路径。

**不能从官方文档直接推出的部分：** Apple 没有在该页面逐项承诺以下行为：

- 隐藏 iframe 或非顶层导航一定会唤起 Shortcuts；
- 页面加载后自动跳转、定时器、后台脚本一定能唤起 Shortcuts；
- 唤起后页面一定能保持原有导航状态；
- x-callback 返回后一定恢复到原 Safari tab。

工程上应把调用放在明确的用户点击/触摸路径，并提供“未安装/未处理/用户取消”的 fallback。

### 3.2 Home Screen PWA / standalone Web App

**官方明确支持的部分：** WebKit 说明，用户把网站加到 Home Screen 后，带有相应 manifest `display` 的网站可以作为 Home Screen web app 打开；Apple 也提供了检查 Home Screen web app 的开发者工具路径。

**结论：** 在本次检索到的官方资料中，没有找到“Home Screen standalone PWA 可以调用 `shortcuts://`”这一条明确承诺。因此这里不能写成无条件的“支持”。更稳妥的判断是：PWA 仍运行在 WebKit/web-app 上下文中，可能沿用网页 URL 导航能力，但是否唤起 Shortcuts、是否受独立窗口导航策略影响，属于平台版本相关行为，应在实际 iOS/Safari 版本和真实设备上验证。

建议的验证矩阵至少包括：Safari tab、Home Screen web app、不同 iOS 版本、用户点击触发与页面自动触发、普通 scheme 与 x-callback、Shortcuts 已安装且 shortcut 名称存在/不存在。

来源：

- [Apple Support — Run a shortcut using a URL scheme](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios)
- [Apple Support — Turn a website into an app in Safari on iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
- [WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Apple Developer — Inspecting iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)

## 4. Share Sheet：调用方式、输入和权限边界

### 4.1 让 shortcut 出现在 Share Sheet

Apple 的官方步骤是：在 shortcut 详情中打开 **Show in Share Sheet**。打开后，用户可以在任何有 Share 按钮的 app 中选择内容，再选择该 shortcut。shortcut 编辑器会出现一个定义输入的起始 action；还可以限制输入类型。

Apple 还明确说明：如果 shortcut 没出现在 Share Sheet，可能是当前 app 没有能传给该 shortcut 输入的合适内容。也就是说，“已启用 Share Sheet”不等于“所有 app、所有内容类型都一定显示”。

**权限判断：** 对 iPhone/iPad，官方使用说明要求的是用户在 shortcut 详情里启用该开关和选择输入类型；本次资料没有显示一个额外的、类似相册/通讯录那样的独立 runtime permission。macOS 的 Shortcuts sharing extension 另有系统设置权限，不能直接套用到 iOS。

### 4.2 网页调用系统分享

WebKit 的官方资料说明 Safari 支持 Web Share API：`navigator.share()` 可以调用宿主系统的原生分享对话框，把文本、链接等交给用户选择的 app 或联系人。

这条路径与 `shortcuts://` 不同：Web Share 只负责打开系统分享 UI，是否出现 Shortcuts、shortcut 是否能处理该 MIME/input 类型，由系统和 shortcut 配置决定。把它当作“用户驱动的 Share Sheet 入口”是合理的；把它当作“可直接运行指定 shortcut 的 API”则不是官方支持的结论。

WebKit 还说明，Web Share 受 user activation 约束；第三方 iframe 若要调用 Web Share，需要通过 Permissions Policy 的 `allow="web-share"` 显式允许。这些约束也支持把分享按钮放在顶层页面、由用户直接点击。

来源：

- [Apple Support — Launch a shortcut from another app on iPhone or iPad](https://support.apple.com/en-euro/guide/shortcuts/apd163eb9f95/ios)
- [Apple Support — Receive onscreen items from other apps](https://support.apple.com/en-euro/guide/shortcuts/apd350ce757a/ios)
- [WebKit — New WebKit Features in Safari 12.1](https://webkit.org/blog/8718/new-webkit-features-in-safari-12-1/)
- [WebKit — The User Activation API](https://webkit.org/blog/13862/the-user-activation-api/)
- [WebKit — Allowing Web Share on Third-Party Sites](https://webkit.org/blog/13708/allowing-web-share-on-third-party-sites/)
- [Apple Developer — UIActivityViewController](https://developer.apple.com/documentation/uikit/uiactivityviewcontroller)

## 5. 剪贴板：Apple/WebKit 的权限与行为

### 5.1 网页写入/读取剪贴板

WebKit 对 Async Clipboard API 的官方说明包括：

- `navigator.clipboard` 只在 secure context 中提供；HTTP 页面不可用。
- `clipboard.write` / `writeText` 必须在 user gesture（例如 click/touch）中调用；脱离用户手势会立即 reject。
- 网页读取剪贴板的限制更严格：没有用户手势会 reject；用户明确执行粘贴时可放行；否则 iOS 会展示带有 Paste 选项的 UI，只有用户确认后才授予读取。
- HTML 与 PNG 写入/读取会经过清理；脚本、隐藏内容和部分元数据不会原样作为可信 IPC 传递。

这些规则意味着：网页可以在用户点击时把文本写入剪贴板，然后导航到 `shortcuts://run-shortcut?...&input=clipboard`；但这不是无权限、无交互的后台通道。

### 5.2 系统 pasteboard 的 app 访问提示

Apple 的 `UIPasteboard` 文档说明，自 iOS 14 起，当 app 在系统无法判断用户有意访问时读取来自其他 app 的 general pasteboard 内容，系统会通知用户。`UIPasteControl` 文档还说明，iOS 16 及以后，程序化粘贴会请求用户批准；使用系统提供的 Paste control 可在用户明确点击的路径上完成粘贴而不触发该提示。

这里要区分两层：

1. 网页使用 WebKit Async Clipboard API，受 secure context/user gesture/系统 UI 约束。
2. 原生 app 使用 `UIPasteboard`，受 iOS pasteboard 的访问提示和用户意图判断约束。

不要把“shortcut 能读 `input=clipboard`”理解成“网页可以静默把任意剪贴板内容交给 shortcut”。`input=clipboard` 是 Shortcuts 端的输入定义；网页是否能写、用户是否允许读取、是否发生页面切换，仍由 WebKit/iOS 行为决定。

来源：

- [WebKit — Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/)
- [Apple Developer — UIPasteboard](https://developer.apple.com/documentation/uikit/uipasteboard/)
- [Apple Developer — UIPasteControl](https://developer.apple.com/documentation/uikit/uipastecontrol)
- [Apple Support — Run a shortcut using a URL scheme](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios)

## 6. Android 等价/兜底方式

Android 没有在本次官方资料中出现一个可直接对应 Apple `shortcuts://run-shortcut`、且由系统 Shortcuts app 统一处理的 URL scheme。下面是官方资料支持的可用构件；它们解决的是“网页/应用把内容交给另一个 app 或 PWA”，不是完整的 Android 版 Shortcuts。

### 6.1 原生 app → 原生 app：Intent / Sharesheet

Android 官方推荐通过 `ACTION_SEND` 发送文本/文件，并通过 `Intent.createChooser()` 展示系统 Sharesheet。接收方在 manifest 中声明 `ACTION_SEND` 与 MIME type 的 intent-filter 后，会出现在 Sharesheet/intent resolver 中。

这通常是 Android 上最接近 iOS Share Sheet → Shortcut 的通用兜底：由用户选择一个已安装的接收 app；接收 app 负责执行后续自动化。它不是“按 shortcut 名称直接运行”的系统 API。

来源：

- [Android Developers — Sending the user to another app](https://developer.android.com/training/basics/intents/sending)
- [Android Developers — Receive simple data from other apps](https://developer.android.com/develop/ui/compose/sharing/receive)
- [Android Developers — AEP guideline: Share Sheet](https://developer.android.com/distribute/aep/aep-req-share-sheet)

### 6.2 Web → Android app：Deep Links / App Links

Android 官方定义了两类相关方式：

- **Custom deep link**：自定义 URI scheme，例如 `example://products/123`；它不是标准 Web link，若多个 app 注册同一 scheme，可能出现 disambiguation dialog。
- **Android App Links**：使用 `http`/`https`，并以网站上的 Digital Asset Links 验证 app 与域名的关联；验证后可直接打开 app，未安装 app 时可回退到网站。

因此，面向网页/PWA 的长期方案应优先考虑自己控制域名的 HTTPS App Link，而不是把某个自定义 scheme 当作跨浏览器的可靠自动化协议。自定义 scheme 可作为已知 app 的 fallback，但其浏览器行为和冲突处理需实测。

来源：

- [Android Developers — Create deep links](https://developer.android.com/training/app-links/create-deeplinks)
- [Android Developers — About App Links](https://developer.android.com/training/app-links/about)

### 6.3 Web → 系统分享：Web Share API / Web Share Target

Chrome for Developers 的官方文档说明：

- Web Share API 让 web app 使用系统分享能力。
- Web Share Target API 让已安装的 web app 注册成系统分享目标，接收数据、链接、文本或文件。
- 为防止网站随机出现在 intent chooser 中，用户必须先把 web app 加到 Home Screen；随后在 manifest 中声明 `share_target`。

这给 Android PWA 提供了比 `clipboard → 自定义 scheme` 更清晰的系统集成路径：

1. Web 页面/PWA 使用 `navigator.share()` 把内容交给系统。
2. 已安装的 PWA 可作为 Web Share Target 接收内容。
3. 如果目标是原生 app，则由原生 app 通过 `ACTION_SEND` 接收。

来源：

- [Chrome for Developers — Receiving shared data with the Web Share Target API](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)
- [Chrome for Developers — Capabilities overview](https://developer.chrome.com/docs/capabilities)

### 6.4 Android 剪贴板兜底

Android 的 `ClipboardManager` 提供全局 primary clipboard，可通过 `setPrimaryClip()` 写入、`getPrimaryClip()` 读取，并能监听内容变化。

但它不是完全静默的跨 app IPC：

- Android 12+：app 首次读取来自其他 app 的 clip data 时，系统会以 toast 通知用户。
- Android 13+：系统对写入剪贴板提供标准视觉确认和内容预览；敏感内容应设置 `ClipDescription.EXTRA_IS_SENSITIVE` 以隐藏预览。
- Android API reference 还记录了：如果 app 不是默认 IME 或没有 input focus，`getPrimaryClip()` 可能返回 `null`；实际行为应按目标 Android 版本和设备验证。

所以 Android 剪贴板可作为“用户点击复制 → 用户切换到另一个 app 粘贴”的低配 fallback，但不应作为可靠、隐形的自动化触发协议。

来源：

- [Android Developers — ClipboardManager](https://developer.android.com/reference/android/content/ClipboardManager)
- [Android Developers — Android 12 behavior changes: Clipboard access notifications](https://developer.android.com/about/versions/12/behavior-changes-all)
- [Android Developers — Android 13 features: Clipboard preview](https://developer.android.com/about/versions/13/features)
- [Android Developers — Secure Clipboard Handling](https://developer.android.com/privacy-and-security/risks/secure-clipboard-handling)

## 7. 面向跨平台调用方的保守决策

以下是基于上述官方能力边界的工程推断，不是平台方的额外承诺：

1. **iOS 指定 shortcut：** 优先使用用户点击触发的 `shortcuts://run-shortcut`；需要结果/取消/错误回传时使用 x-callback-url。
2. **iOS 传大段文本或非文本：** 优先把 Share Sheet 作为显式用户路径；shortcut 开启 Show in Share Sheet 并限制输入类型。
3. **iOS clipboard 桥：** 仅作为用户明确点击后的短文本 fallback；需要 secure context、处理 `writeText` 失败，并不要把系统剪贴板读取当成无提示能力。
4. **iOS PWA：** 不要把 standalone PWA 的 `shortcuts://` 唤起当成已由 Apple 保证的能力；保留普通 HTTPS 流程、提示用户在 Safari 打开或使用 Share Sheet，并做真实设备回归。
5. **Android 原生集成：** 原生 app 之间使用 `ACTION_SEND`/Sharesheet；网页到自有 app 使用 HTTPS App Links；需要把 PWA 放进系统分享目标时使用 Web Share Target。
6. **Android 自定义 scheme：** 只作为 app 已安装、scheme 已知且经过设备/浏览器测试的 fallback；不要把它视作 Android 全局自动化协议。
7. **任何平台：** 把未安装目标 app、用户拒绝、取消、无匹配输入类型、回调丢失和浏览器不支持当成正常分支，而不是异常。

## 8. 证据标记说明

- **官方明确支持**：官方文档直接描述了该能力、参数、输入/输出或系统行为。
- **推断**：由多个官方能力拼接得出的工程判断，官方没有把端到端场景作为保证写出来。
- **需实测**：受 OS 版本、浏览器、设备、用户手势、安装状态、输入类型或系统默认 app 影响；资料不足以给出跨版本保证。
