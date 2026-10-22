# 三两事 Android 安装版

当前交付版本为 **1.13.0**，应用名“三两事”，包名 `com.sanliangshi.study.life`。支持 Android 7.0（API 24）及以上，目标 API 36。

## 安装和数据

1. 把 `release-android/sanliangshi-1.13.0.apk` 传到手机，打开安装。若系统要求，允许此次使用的文件管理器安装应用。
2. 之前浏览器/PWA 中的数据属于浏览器，APK 有独立的本地数据空间。先在旧入口导出备份，再在 APK 的数据管理中恢复；也可以使用原有账号同步流程，核对合并预览后再确认。
3. 后续安装使用同一签名的新 APK，选择覆盖安装。不要通过卸载旧版来更新；卸载会删除应用本地数据。
4. 课表及普通本机记录可以离线使用；账号同步、校园公开内容等仍需要网络。

APK 内置正式构建资源，不依赖每次启动重新下载网页，也不运行网页的 Service Worker 更新。原生版本更新通过签名 APK 覆盖安装完成；应用内可以自己检查、下载并安装新版（见下文"应用内更新"），但仍**没有**自动静默下载与商店分发。网页版仍保留完整 PWA 与离线更新能力。

## 原生适配

### 启动与外观

- 启动画面使用**应用自己的品牌色**：以前 `styles.xml` 里的 `@color/colorPrimary` 落到了 `@capacitor/android` 库自带的 `#3F51B5`（Material 默认靛蓝），装上第一眼就像"这不是我们的 App"。现在 `values/colors.xml` 提供了与 `src/style.css` 一致的色值，并有测试守住两边不漂移。
- 启动画面的图标是**自适应桌面图标**（`@mipmap/ic_launcher`）。此前用的是一张 192px、放在 `drawable/` 里的位图，在 3 倍屏上被放大到 160dp，边缘发虚。
- 窗口底色改为应用底色（`android:windowBackground`）。此前主题写的是 `@null`，冷启动时 WebView 还没画出第一帧，屏幕上会先出现系统默认的透明/黑色闪一下。
- 桌面图标按密度重新生成：传统图标 48/72/96/144/192px，自适应图标前景是 108dp 画布里居中的 72dp 图案。此前所有密度目录里塞的都是同一张 512px 图，启动器只截中间 2/3，桌面上的图标是"被放大裁掉一圈的便签"，与网页/PWA 图标对不上。生成脚本：`scripts/build-android-icons.ps1`。

### 安全区与系统栏

- 全站的安全区统一读 `var(--safe-top/right/bottom/left)`（定义在 `src/styles/safe-area.css`）。安卓的安全区不是 `env()`：原生层把状态栏/导航栏/刘海的高度算好后注入成 `--safe-area-inset-*` 这几个 CSS 变量，`env()` 在很多安卓内核上恒为 0；iOS 那边才认 `env()`。两路在同一个文件里合并，其余地方不再直接写 `env(safe-area-inset-*)`（有测试守着）。
- `capacitor.config.json` 里声明了 `plugins.SystemBars.initialViewportFitValueHint: "cover"`。不声明的话 Capacitor 会先按"不穿透"给窗口加内边距，等页面提交后再改回来，整个界面在启动时跳一下。
- 状态栏图标的明暗跟着**应用主题**走（默认浅色），不跟系统深浅走；系统是深色、应用是浅色时，浅色图标压在浅色顶栏上等于看不见。主题切换时通过 `SystemBars` 插件同步。

### 返回键

- 返回键在最外层按第一次只提示"再按一次返回键退出三两事"，两秒内再按才退到后台。此前一按就退出，误触会丢掉当前页面、滚动位置和打开着的筛选条件。
- 浮层（弹窗、底部面板）由 `composables/overlayStack.js` 压在同一条 history 上，返回键先关最上面那一层。
- 清单里显式声明了 `android:enableOnBackInvokedCallback="true"`：目标 API 36 起 `onBackPressed()` 不再被调用，必须走 `OnBackPressedDispatcher`（Capacitor 的 App 插件已经用它），并启用预测式返回动画。
- 返回键监听在界面挂载**之前**接上。Capacitor 自带的默认实现在没有 JS 监听器时会把返回键吃掉（能后退就退 WebView 的历史、页面变白，不能后退就什么都不做），启动那几秒里按返回键没有任何反应。

### 键盘、拍照与其它原生能力

- 清单里声明了 `android:windowSoftInputMode="adjustResize"`，键盘不会盖住输入框。
- `file_paths.xml` 增加了 `<external-files-path name="camera" path="Pictures/" />`。此前拍照取壁纸时 `FileProvider` 找不到匹配的根，异常被吞掉，相机拍完拿不到任何文件，"拍照设置壁纸"在安卓上必然失败（网页端正常，所以很容易漏掉）。
- 声明了 `android.permission.VIBRATE`，专注结束的震动反馈不再被系统丢弃。
- 关闭了 WebView 的回弹光晕与长按灰块，并禁止长按按钮文字弹出放大镜（见 `src/styles/touch-feedback.css`）。

### 分享、导出与提醒

- 备份、清单等 Blob 下载交给 Android 系统分享面板，可选择文件保存位置或其他应用。临时导出保存在应用私有缓存，保留最多 10 个文件，后续导出时清理过期文件；其他应用只能读取分享的 URI。
- **分享面板可以被取消**。取消时不会标记"已备份"——此前无论成功失败都写入了备份时间戳，备份提醒会安静地停七天，而文件根本没保存。
- 安卓 WebView 没有 Web Share API，`navigator.share` 恒为 undefined，所以"分享"原先会静默退化成复制到剪贴板。现在安卓上改用系统分享面板（`@capacitor/share`）。
- 安卓 WebView 里没有 `Notification`，到点的提醒原先**整条丢掉**（既没有系统通知，界面上也没有提示）。现在改为应用内提示，界面文案也照实说明"安卓安装版不支持系统通知"。
- 读不到剪贴板时的提示按平台说人话：手机上没有 Ctrl + V，安卓上提示长按输入框粘贴。

### 应用内更新（检查 → 下载 → 安装）

安卓安装版可以在应用内完成更新，不必再自己去下载 APK：

1. 打开「更多 → 版本与更新」，点「检查更新」。
2. 应用会向 **GitHub Releases** 查询最新稳定版（与 Windows 桌面版同一个发布通道）。有新版时显示版本号、更新说明与安装包大小。
3. 点「下载安装包」——下载与落盘都在原生侧完成（约 8 MB，不进 WebView 内存），带进度。
4. 点「安装到系统」，系统安装器接管。Android 8 以上第一次会要求你允许本应用「安装未知应用」，应用会带你去系统设置页开这个权限。

要点：

- **覆盖安装，不会清除本机资料**。新包与旧包包名相同、签名相同，系统按升级处理，本机的课表、待办、账目、壁纸都保留。**不要卸载旧版**，卸载会清空数据。
- 更新源用 GitHub 而不是网页的 `release.json`：APK 的 origin 是 `study-life.pages.dev`，而 WebView 的本地资源服务器会拦截对同一 host 的所有请求并返回安装包里那份旧清单 —— 读到的永远是"自己"，永远查不到新版。GitHub 的域名不在拦截名单里，走的是真实网络。
- 下载地址有白名单：只接受 `https` 且主机是 `github.com` / `objects.githubusercontent.com`，原生插件与网页层各挡一次；安装包只落在应用私有缓存目录（`cache/updates/`），文件名经过净化，不接受路径分隔符。
- 自动检查有 90 秒节流，反复打开面板不会反复去问更新服务；手动检查随时可以。
- 原生插件：`android/app/src/main/java/.../ApkUpdatePlugin.java`（下载/安装/取消/授权检查），在 `MainActivity` 的 `super.onCreate()` **之前**登记 —— BridgeActivity 的 `onCreate` 末尾就会创建 Bridge 并加载插件，之后再登记就静默失效了。

### 离线识别

识别引擎（3.8MB）、worker 与中文语言包（2.4MB）**直接打进安装包**，断网也能识别。此前安卓上沿用网页版的"缓存里有没有模型"判断，手机一断网就把图片识课拦掉——明明带着 6MB 离线模型，提示却说"还没有缓存识别模型"。

### 其它原生适配

- 邮箱密码登录在 APK 中完成。注册、找回密码、重新发送验证邮件转交外部浏览器，避免邮件验证状态留在 APK、邮件却在浏览器打开。浏览器中完成后回到 APK 登录；链接不携带邮箱、密码或 token。
- 第三方 OAuth 暂不在 APK 中展示，避免未配置原生深链时出现无法返回的流程。

`capacitor.config.json` 使用现有站点的 HTTPS 主机名作为本地资源 origin，未配置远程 `server.url`。**这个主机名不能改**：改掉等于换 origin，本机存储（localStorage/IndexedDB）会整体换分区，老用户升级后会"数据全没了"。禁用明文流量、混合内容、发布版 WebView 调试和系统备份；FileProvider 只暴露私有缓存下的导出目录与相机目录。

## 在 Windows 上重新构建

需要 Node.js 22+。在项目根目录执行：

```powershell
npm ci
npm run android:setup
npm run android:apk
```

首次 `android:setup` 下载并验证 Temurin JDK 21、Android Command Line Tools 19.0，安装 API 36 和构建工具。SDK 要求时需在终端阅读并接受相应许可。工具均放在被忽略的 `.tools/android`，不修改系统 Java 安装。

`android:apk` 会构建 Android 专用网页资源、执行 Capacitor sync、编译 release、签名、校验签名并输出 SHA256。正式构建要求源码签名与版本说明一致；修改发布源码后，先通过项目 `release:bump` 流程更新正式版本或尚未发布版本的说明。

改了桌面图标后要重新生成（生成结果已提交进仓库）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android-icons.ps1
```

产物：

```text
release-android/sanliangshi-<version>.apk
release-android/sanliangshi-<version>.apk.sha256
```

签名保存在 `.tools/android/signing/`，**不进 Git、APK 或公开发布包**。请私下保管该目录；后续覆盖更新必须使用相同签名。更换电脑时需安全迁移已有签名，不能为同一应用重新生成一把钥匙。

## 验证范围

原生层的配置、图标尺寸、FileProvider 路径与安全区变量用法由 `tests/androidNative.test.js` 守住（29 项），应用内更新的协议层（不可信载荷解析、地址白名单、检查/下载/安装状态机）由 `tests/androidAppUpdate.test.js` 守住（18 项），都不需要真机就能发现回归。

本次已完成 release 编译、APK v2 签名验证、包名/版本/API 检查、包内私密文件扫描、网页交互与离线回归、原生导出和邮件流程的模拟测试。**尚未进行 Android 真机安装、分享目标读文件、系统返回、键盘、覆盖升级与"应用内下载安装"实测**；编译和模拟测试不能替代这些设备验证。

目前 APK 和网页构建为本地交付，尚未上传 GitHub Release 或部署线上网站。浏览器账号入口参数会随网页新版本部署生效；旧网页版仍可从"我的账号"手动打开对应流程。

## 已知限制

- 安卓上**没有**系统通知与后台提醒：APK 用的是普通 WebView，没有接入本地通知插件。到点的提醒只在应用打开时以应用内提示出现。
- 安卓上未保存的"导航设置"草稿在进程被系统回收后会丢失。网页端靠 `beforeunload` 拦截，安卓没有等价机制（应用是被杀掉而不是被卸载），暂时没有可靠的兜底。
- 应用被切到后台时，系统可能在内存紧张时直接回收进程，此时尚未写入的改动会丢失；应用已在进入后台时提交本机待写队列。

技术依据：[Capacitor Android](https://capacitorjs.com/docs/android)、[Capacitor Share](https://capacitorjs.com/docs/apis/share)、[Capacitor SystemBars](https://capacitorjs.com/docs/apis/system-bars)、[Android 16 行为变更](https://developer.android.com/about/versions/16/behavior-changes-16)、[Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)。
