# 浏览器产品验收记录

日期：2026-10-17

分支：`feat/browser-privacy-images-20261017`

开发基线：`6a9ab5f3247f36fb0aca4f9efe8fb554c9a126db`（简称 `6a9ab5f`）

工作区：`newsnook-browser-complete-20261017`

## 1. 当前状态与记录范围

**交付状态：Draft。** 实现、自动化与已列出的其他设备验收已完成；私密分享 chooser 的完整设备验收未完成，保留为合并前待办。当前模拟器的基线崩溃与旧设备覆盖限制继续明确保留。

隐私会话、UA 与常用设置、独立看图以及浏览器界面已有自动化和模拟器验证证据。最后完成的正式前端入口通过；原生测试为 **160 tests / 0 failures / 0 errors / 0 skipped**；全仓 oxlint 为 **0 errors / 26 warnings**，该批次修改范围为 **0 errors / 0 warnings**；视觉证据包含 **44 个常规状态和 3 个非零安全区状态**。

当前仍有两类事项需要保留：

- 最终调试包的图片查看器系统栏、已加载图片调整及关闭恢复、原生多标签站点清理已完成设备复验。私密分享的三轮主要设备尝试均未完成 chooser 验收；最新一轮真实点击“分享”后等待确认超时，普通与私密进程仍存活。桌面组件的真实触控诊断通过不替代这项设备验收。
- 当前 Android 17 x86_64、16KB 页大小、WebView 150 模拟器出现过主进程 `onTrimMemory` 路径上的 native `SIGILL`。准确基线 `6a9ab5f` 在同环境也复现同一 native 崩溃签名，说明新增私密功能不是必要条件；两轮触发级别不同，根因尚未定位、未修复。

本记录依据工作区源码、测试输出、结构化取证及截图整理。测试结果按完成批次记录；后续代码修改需要有对应结果，不能直接沿用早先批次的通过状态。已完成的包同步、设备结果、最终差异核对和交付材料整理均已记录。本次以 Draft 交付，私密分享 chooser 作为明确的合并前待办保留。

需求与边界见 [浏览器隐私、看图与完整体验设计](../specs/2026-10-17-browser-privacy-images-design.md) 和 [实施计划](../plans/2026-10-17-browser-privacy-images.md)。以下未特别标明的路径均相对仓库根目录；证据目录简称 `evidence/browser-privacy-images-20261017/`。

## 2. 环境与批次

| 项目 | 已核实范围 |
| --- | --- |
| 前端工具链 | Windows Node 26.8.2，使用工作区已有依赖 |
| 前端正式入口与 lint | 2026-10-17 12:44:28.521–12:44:35.121 UTC；完整命令、参数与退出码见 `browser-final-acceptance-results.json` |
| 原生最后完成批次 | 2026-10-17 12:44 批次；站点清理套件 XML 时间为 12:44:34.145 UTC，31 个测试套件合计 160 项，全部通过，构建 runner 退出码为 0 |
| 浏览器视觉测试 | 真实 React 组件、构建后的 CSS、独立 Chromium 临时配置；320×740 与 390×844 CSS 视口，DPR 2，Buer 浅色/深色 |
| Android 运行验证 | 隔离调试包，Android 17 x86_64、16KB 页大小的模拟器；设备 UA 记录 WebView `150.0.7871.181` |
| 旧版本设备覆盖 | API 28 AVD 的系统镜像目录缺失，未能启动；本记录没有实体机或 API 28 运行验收结论 |

Android 版本和 WebView 字符串可在 `device-netease-images.json` 中核查。旧 AVD 启动日志 `D:/tmp/newsnook-browser-api28-emulator.log` 明确指出 `system-images/android-28/google_apis/x86_64/` 不是有效目录，随后报无法找到 AVD 系统路径。源码中的旧 WebView 布局回退仅构成兼容性实现依据，不构成 API 28 或 WebView 69 的设备运行证明。

## 3. 功能验证

### 3.1 隐私会话与普通数据边界

原生实现使用专用 `:browser_private` 进程和独立 WebView 数据目录。会话身份由原生 `getBrowserContext()` 确认；前端 URL 标记仅选择界面入口。私密启动路径提前选择 `PrivateBrowserRoot`，避免普通应用的账户、偏好与恢复数据初始化进入私密界面。

前端在私密状态下不读取普通历史、书签、最近访问及快捷方式；访问记录、书签写入、恢复会话和普通设置持久化均有边界检查。私密设置仅保留在本次会话内，脚本 GM 存储使用内存偏好。首页、地址区、页内查找和私密看图保留明确的隐私标识。

源码依据：

- `src/main.tsx`
- `src/features/browser/PrivateBrowserRoot.tsx`
- `src/features/browser/browserPrivacy.ts`
- `src/features/browser/BrowserWorkspace.tsx`
- `src/features/browser/useBrowserSession.ts`
- `android/app/src/main/java/com/aizeek/newsnook/NewsNookApplication.java`
- `android/app/src/main/java/com/aizeek/newsnook/PrivateBrowserActivity.java`
- `android/app/src/main/java/com/aizeek/newsnook/PrivateBrowserSession.java`
- `android/app/src/main/java/com/aizeek/newsnook/UserscriptRuntime.java`

系统 WebView 在会话期间仍可能向隔离目录写入数据。当前实现及验收边界是独立存储、正常结束后清理、异常终止后下次启动清理；不能表述为底层磁盘绝对零写入。

#### 模拟器正常关闭

`device-private-close.json` 记录 12:30:57–12:31:24 UTC 的完整周期：

| 观察点 | 结果 |
| --- | --- |
| 普通会话初始状态 | Cookie 为 `browser_audit_session=normal`，存储标记为 `normal` |
| 私密页面首次请求 | Cookie 为空，页面之前的存储标记为 `null` |
| 私密页面独立写入 | Cookie 为 `browser_audit_session=private-cycle-close` |
| 会话期间自有目录 | `app_webview_newsnook_private_v1`、`cache/browser-private` |
| 正常关闭后 | 私密 PID 为空，自有目录列表为空 |
| 返回普通会话 | 普通 Cookie、存储标记与 UA 保持原值 |
| 私密地址持久化检查 | `privateUrlPersisted: false` |
| 脚本结论 | `passed: true`，对应 `.exit` 为 0 |

#### 模拟器强制停止与再次启动

`device-private-force.json` 记录 12:31:46–12:33:25 UTC 的周期。私密首次请求同样未携带普通 Cookie，普通存储标记未出现在私密页面。强制停止后，隔离目录仍存在于 `ownedAfterForceStop`；重新启动后的 `ownedAfter` 为空，私密 PID 为空，普通 Cookie、存储标记和 UA 保持，私密网址未持久化。最终 `passed: true`，对应 `.exit` 为 0。

这一周期的首次取证脚本调用遇到 CDP 错误 `Execution context was destroyed.`。原始失败输出保留在 `D:/tmp/newsnook-browser-private-force.log`，最终 JSON 将该信息保留为 `harnessRetry`，并补充重试后的目录、普通数据与私密网址检查结果。该首次失败属于取证执行上下文失效；不能将它写成隐私隔离业务失败，也不能省略重试事实。

自动化还覆盖了私密导航、历史/favicon 隔离、保存边界、会话恢复禁用，以及原生隔离目录和内存存储。对应正式前端日志为 `browser-final-package-test.log`；原生包括 `PrivateBrowserIsolationTest` 的 4 项测试及 `PrivateSharePluginTest` 的 3 项测试。

### 3.2 UA 与常用设置

设置已有明确默认值、规范化、加载与保存函数。新增网页设置使用 `newsnook:browser:preferences:v1`；原有搜索引擎、地址位置、历史、书签和快捷方式键保持兼容。

| 设置 | 默认值或有效范围 | 验证要点 |
| --- | --- | --- |
| 浏览器标识 | 系统 / 桌面 / 自定义；默认系统 | 使用设备 WebView 默认 UA；不将修改 UA 描述为更换浏览器内核 |
| 自定义 UA | 非空、最多 512 字符、ASCII 可见字符 U+0020–U+007E | 校验成功后保存去首尾空格的值；拒绝控制字符和非法输入，保留用户草稿及已确认状态 |
| 网页文字缩放 | 默认 100%，范围 75–200% | 规范化整数并限制范围；界面提供调整和恢复 100% |
| JavaScript | 开启 | 设置经原生接口应用 |
| 自动加载图片 | 开启 | 设置经原生接口应用 |
| 第三方 Cookie | 关闭 | 原生 WebView 设置 |
| 媒体播放需手势 | 开启 | 原生 WebView 设置 |
| 打开外部应用前确认 | 开启 | 原生导航处理 |
| 搜索引擎、地址位置 | 沿用既有选择 | 设置保存和重新读取有测试 |
| 私密状态下的设置 | 当前会话内生效 | 不覆盖普通浏览持久化设置 |

普通设置在保存成功后发布确认状态；写入失败显示错误并保留输入。异步保存期间相关控件禁用，避免重复请求和状态竞争。前端正式入口涵盖保存往返、非法 UA、写入失败、pending 竞争和隐私内存边界；偏好模块的 8 个子测试全部通过。原生 `BrowserHostLifecycleTest` 覆盖实际设置接线。

模拟器私密周期的普通和私密请求均记录了自定义 UA `NewsNook-Audit/1.0`，同时 Cookie 保持隔离。网易取证记录切回系统 UA 和 `textZoom: 100`。这些记录证明相应已执行路径；其余开关的验证依据是源码与自动化测试。

源码依据：`browserPreferences.ts`、`BrowserSettingsPanel.tsx`、`BrowserWorkspace.tsx`、`BrowserHostPlugin.java`。

### 3.3 当前站点数据清理

清理入口受原生能力控制；缺少站点级清理能力时不显示无效操作。普通 WebView profile 中同一站点的数据共享，因此确认文案说明同站点登录状态也会受影响。实现不使用全应用清 Cookie 作为回退。

12:36 批次新增 `BrowserSiteDataLifecycleTest` **9 项**生命周期测试，总测试数由 146 增加为 155。测试采用可控的异步 provider 删除回调，验证以下边界：

1. 清理前退役同站点文档，完成后只恢复选中的标签页，其他站点保留。
2. 以 provider 返回的站点边界处理私有后缀，保留其他租户。
3. 访问私有后缀本身时，不误伤其独立租户。
4. `localhost` 按准确主机处理。
5. IP 地址跨协议、端口按同地址处理，保留其他 IP。
6. 删除期间新导航到待清理站点时保持休眠，并完成追加删除周期。
7. 同步 provider 回调不会跳过同站点文档退役。
8. 关闭会话后拒绝 pending 操作，迟到回调不能修改新会话。
9. 最终删除失败后不自动恢复旧文档，等待明确重试。

随后补充应用壳站点保护的 5 项测试：跨协议/端口保护壳主机、配置的应用服务器及同站点子域保护、独立 IP 站点允许清理、私有后缀独立租户不误判，以及缺少壳来源元数据时拒绝潜在破坏性清理。12:44 完整原生门禁中，本套件 **14 项全部通过**，全仓原生总计 **160 项全部通过**。

这些是 provider 与生命周期自动化测试，不代表在 14 种设备上执行了真实清理。

#### 最终包真实多标签清理

`device-site-clear.json` 记录了 2026-10-17 **12:49:51.048–12:49:56.264 UTC** 的通过周期，`passed: true`。模拟器隔离包为 `com.aizeek.newsnook.browseraudit.debug`，本轮 APK 的 SHA-256 为 `b54ee814b45790bb0d968b47f9aab63c853cfb97f318ae176a95588df702d939`。

A、B 都位于 `127.0.0.1:8138`，C 位于独立站点 `localhost:8138`。清理前 B 能读取 A 留下的 localStorage 与 IndexedDB 标记，证明 A/B 原本共享同站点状态。清理返回 `site: 127.0.0.1`、`sharedSiteData: true` 后，观察到：

| 检查 | 实际结果 |
| --- | --- |
| A/B 旧页面 | 旧 CDP targets 均不再存在 |
| B 重载请求 | Cookie 请求头为空；随后页面自行写入新的 B Cookie |
| B 首次读取的站点存储 | localStorage `prior: null`，IndexedDB `priorIdb: null` |
| 独立站点 C | Cookie、token、时间戳与原页面实例保持 |
| 重新激活 A | 使用新 target 和新 token；能够读取 B 在清理完成后新写入的标记 |

A 再次读取到 B 的标记属于清理完成后的新状态共享，不是保留了清理前的旧页面。完整过程保留三个标签的网址与身份关系。

记录的 `harnessNotes` 说明，前两次脚本准备误以为空白工作区已创建原生标签；最终通过轮先提交真实搜索表单，再调用原生标签及站点清理接口。此处保留准备过程与最终通过轮的区分。

### 3.4 独立看图与大图查看

用户从网页菜单主动进入看图。扫描结果保留标签页、文档与请求身份，不需要重载或离开源页面。实现收集当前图片、srcset/picture、懒加载、CSS 背景、SVG 和可达框架中的候选；提供“内容图片 / 全部图片”筛选，并明确展示截断或不可访问框架的情况。

列表上限 240 项，每页 24 项；图片数据有大小限制、并发与内存预算。原生图片读取与前端加载器共同检查身份，关闭、导航或切换时取消过期工作。灯箱复用现有图片查看器，支持切图、缩放、重试及用户发起的保存/分享；私密导出先确认，通过后才显示进行状态。

前端正式入口覆盖探测来源、保留签名 URL、并发队列、内存限制、重试、取消、StrictMode、内容筛选、大图复用、私密导出确认和分层返回。原生 `BrowserImageCaptureLifecycleTest` 的 6 项测试通过。

#### 网易模拟器样本

`device-netease-images.json` 来自 `https://m.163.com/` 的实际运行：

| 字段 | 结果 |
| --- | --- |
| 页面标题 | 手机网易网 |
| 候选总数 / 内容图片数 | **72 / 67** |
| 实际候选类型 | `img`、`lazy`、`background` |
| 不可访问框架 / 截断 | 0 / false |
| 原生加载的样本图片 | **320×240**，`image/webp`，5,846 字节，`valid: true` |
| 面板中检查的两个缩略图 | 均加载成功，natural size 为 320×240 |
| 面板头部位置 | **headerTop: 52** |

这证明该次页面快照、原生图片读取和界面展示已连通。72/67 是该次网页内容的结果，不是对网易所有页面或后续动态内容的固定保证。

`device-lightbox.json` 记录计数从 `1 / 67` 切换至 **`2 / 67`**，切换后主图显示尺寸为 330×248；对应截图为 `device-lightbox.png`。该证据早于后续“主图加载前禁用调整”和系统栏明暗作用域补丁。补丁后的设备结果单独记录如下。

#### 最终查看器设备复验

主集成已实际审查 `device-viewer-final.json/.png` 与 `device-viewer-close.json/.png`。本轮动态页面共有 **73 个资源、68 张内容图片**，当前计数 **2/68**；主图成功显示，尺寸 **330×248**，调整面板可展开，面板头部仍为 **52px**。

应用主题始终保持 `light`。打开浏览器查看器时，状态栏图标为白色；关闭后恢复黑色，`viewerClosed: true`，主题仍为 `light`。主集成同时复查关闭后的图片列表，12 个可见缩略图均成功恢复；关闭瞬间的短暂占位属于转场，未观察到持续失效。

JSON 记录首次加载时 `initialDisabled: true`。`afterSwitchDisabled: false` 是程序触发 click 后、React 尚未完成该次渲染提交时读取的瞬时值，不能作为切图期间禁用逻辑成功或失败的证据。主图加载完成后可展开调整面板有设备证据；慢加载、错误状态、邻图加载不提前启用等边界由已通过的 `browser-image-chrome.test.tsx` 验证，不从这一瞬时读数扩大结论。

#### 私密分享设备尝试与未完成范围

确认流程和原生分享实现的自动化通过，完整系统 chooser 的设备验收未完成。保留的三轮主要设备记录如下：

| 记录 | 时间（UTC）与进程 | 实际到达阶段及未完成原因 |
| --- | --- | --- |
| `device-private-share-slow-ui-attempt.json` | 13:11:08.181–13:12:23.244；普通 PID 26762、私密 PID 27057 | 完成私密 fixture（初次 prior 为 null）、看图 8 项、进入大图及图片操作；等待“继续分享”超时。失败收尾时普通 PID 已空、私密 PID 仍在，不能归为确定的分享逻辑缺陷。 |
| `device-private-share-home-readiness-attempt.json` | 13:13:43.650–13:14:14.980；普通 PID 27722、私密 PID 28044 | 8 秒首页等待超时，轮询阶段 `lastUi: []`；随后 `uiAtFailure` 已有隐私首页和搜索按钮，两 PID 仍在。该轮尚未到 chooser，不描述为持续白屏或分享逻辑失败。 |
| `device-private-share.json` | 13:15:49.819–13:16:57.682；普通 PID 28269、私密 PID 28706 | 首页等待延长至 22 秒后，约 15 秒观察到首页，继续完成 fixture、8 项看图、大图和图片操作菜单。13:16:42.548 真实点击处于 enabled 状态的“分享”，随后等待“继续分享”超时；收尾仍为操作菜单，普通与私密 PID 均存活。 |

三轮均为 `passed: false`、`externallySent: false`。最新一轮已越过前一轮首页等待的时序问题；该轮阻塞不能以普通进程消失或已知 `SIGILL` 直接解释，具体原因尚未定位。另外保留 `device-private-share-startup-attempt.json`、`device-private-share-timeout-attempt.json` 两份驱动准备阶段失败记录；它们不是成功的业务验收。更早失败尝试后的会话关闭与隔离目录清理已完成，不另计为新的功能通过项。

#### 真实触控诊断及边界

`browser-private-share-touch.json` 记录 13:21:00.429–13:21:03.871 UTC 的桌面 Chromium 单场景诊断。427×952 CSS 视口、DPR 3 下，从图片到操作菜单再到“分享”均使用 `Input.dispatchTouchEvent`，没有通过预先 `focus()` 或 DOM `click()` 代替触控。“分享”中心为 CSS 坐标 (213.5, 831)，事件记录中的 pointer、touch 与 click 为 `isTrusted: true`。确认对话框实际出现并获得焦点，层级和命中正确；可访问性树中的“继续分享”按钮为 `ignored: false`。对应前后截图为 `browser-private-share-touch-before.png`、`browser-private-share-touch-after.png`。

该诊断仅覆盖独立 `BrowserImagesPanel` 与 `ImageLightbox` fixture，未包含完整 `BrowserWorkspace` / `FullPage` 的额外对话框层级及 Android 原生宿主。它证明该组件组合可由真实触控打开确认，不能覆盖或推翻 13:15 的 Android 设备失败，也没有执行系统 chooser。

现有证据没有证明 Android 系统 chooser 成功打开、取消后正确返回或外部应用收到图片。**Android 宿主下的 DOM / 可访问性树对照诊断，以及私密分享 chooser 的完整设备验收，均保留为合并前待办**；本轮交付采用 Draft 状态，不因自动化或桌面触控诊断通过而补记设备通过。

源码依据：`BrowserImagesPanel.tsx`、`browserImages.ts`、`ImageLightbox.tsx`、`BrowserImageCapture.java`、`android/app/src/main/assets/browser-image-probe.js`。

## 4. 界面、交互与安全区

浏览器控件统一使用现有主题变量和系统 UI 字体。主要操作采用 14–16px 文字层级，常规辅助文字采用 13px；代码和 UA 输入保留代码字体。设置、标签页、搜索及收藏列表采用统一头部、分组与错误状态，保持页面主体和单条主工具栏的层级。

### 4.1 常规视觉矩阵：44 个状态

两个视口宽度（320、390）乘以两种主题（浅色、深色）乘以下 11 个状态，共 44 张截图：

- 设置顶部、权限与数据、非法自定义 UA。
- 标签页、普通首页、隐私首页。
- 普通看图、私密看图。
- 普通大图、私密大图、私密导出确认。

取证使用实际 `BrowserWorkspace`、设置组件、偏好保存函数、`BrowserImageLoader` 和 `ImageLightbox`。图片 fixture 为确定性内存 PNG；普通 favicon 请求被屏蔽以检验真实错误回退。私密首页由 fixture 提供明确的私密上下文，因此这一部分证明界面与交互，不替代原生进程隔离验证。

这组矩阵通过先 `focus()` 再 DOM `click()` 触发按钮；私密导出场景选择“保存到相册”，验证确认框、焦点和取消，未运行“分享 → 系统 chooser”。因此矩阵的点击断言不等同于设备真实触控。13:21 单独补充的真实触控诊断见上一节，其范围仍限于桌面组件 fixture。

已处理并复核的可见问题包括：当前标签卡片背景与边界不明显、浅色标签文字对比弱、favicon 失败竞争、UA 错误文字偏淡、320px 说明孤字换行、图片数字字体混杂、窄屏图片尺寸截断、大图背景透出底层内容、私密大图缺少标识，以及确认前提前显示保存进度。

矩阵中的文档均无横向溢出；自动检查到的 `.browser-icon-button` 均不少于 44px。该断言针对被检查的标准图标按钮，不扩大表述为全应用所有交互点均完成无障碍审计。原有脚本管理、播放器与浏览器键盘/焦点断言保留并通过。

证据：`browser-visual-matrix.json`、`browser-final-visual.log`、`browser-visual-test.exit` 和 `browser-visual-review.md`。

### 4.2 非零安全区：追加 3 个状态

模拟器初次取证发现看图标题被系统状态栏覆盖。实际测得顶部安全区 52px、底部安全区 24px；`BrowserImagesPanel` 根节点随后补充 `--sat / --sab` 内边距。

追加测试使用 320×740 视口及上述非零安全区，覆盖：

- 普通看图，浅色。
- 私密看图，深色。
- 私密大图，深色。

看图头部为 52px，滚动区底部为 716px；大图关闭按钮和缩略条通过安全区边界断言。网易模拟器复验亦记录 `headerTop: 52`。

证据：`browser-safe-area-matrix.json`、`browser-safe-area.log`、`browser-safe-area-test.exit`，以及三个文件名包含 `safe-area` 的截图。原始 `device-images.png` 保留早期问题现场；安全区修正后的设备依据为 `device-netease-images.json/.png`。

## 5. 实际质量门禁

### 5.1 正式前端入口

执行命令：

```text
npm run test:browser
```

根 `package.json` 实际展开为：

```text
node --experimental-test-module-mocks --import tsx scripts/browser-workspace.test.tsx
&& node --import tsx scripts/browser-product-panels.test.tsx
&& node --import tsx scripts/browser-preferences.test.ts
&& npm run test:browser-images
```

图片子入口依次运行 `browser-images.test.ts`、`browser-image-probe.test.ts`、`browser-images-panel.test.tsx`，以及新加入的 `browser-image-chrome.test.tsx`。最后一项以 `--experimental-test-module-mocks --import tsx` 运行，覆盖临时系统栏、恢复当前主题、迟到原生回调及仅主图加载后启用调整。本批次退出码为 **0**。会话生命周期与产品流程内置 3 轮均通过；设置、查找、图片取消、私密启动、恢复及错误标签页、面板与图片验证均通过。偏好模块单独报告 **8 pass / 0 fail / 0 cancelled / 0 skipped**，这个“8”仅属于偏好模块，不是整个浏览器入口总测试数。

完整结果见 `browser-final-package-test.log` 和 `browser-final-acceptance-results.json`。最后执行时间为 **12:44:28.521–12:44:35.121 UTC**，已包含系统栏与主图加载状态补丁。日志末行确认 `Browser image chrome: temporary system bars, current-theme restoration, delayed native replies and loaded-only adjustments OK`。

### 5.2 原生测试与隔离调试包

Windows Node 执行 `D:/tmp/newsnook-browser-build-runner.cjs native`，实际原生命令为：

```text
gradlew.bat :app:testCloudDebugUnitTest --console=plain
&& gradlew.bat -I D:/tmp/newsnook-browser-audit.init.gradle :app:assembleCloudDebug --console=plain
```

最后完整批次在 12:44 执行，站点清理套件 XML 时间为 12:44:34.145 UTC。`D:/tmp/newsnook-browser-native.exit` 为 0，日志包含构建成功；最新前端资源的 Capacitor 同步也已通过。直接汇总 `android/app/build/test-results/testCloudDebugUnitTest/TEST-*.xml` 得到：

| 统计项 | 数量 |
| --- | ---: |
| XML 测试套件 | 31 |
| tests | **160** |
| failures | **0** |
| errors | **0** |
| skipped | **0** |

其中与本次浏览器主要变更直接相关的测试套件包括 `BrowserHostLifecycleTest`（24）、`BrowserImageCaptureLifecycleTest`（6）、`BrowserSiteDataLifecycleTest`（14）、`PrivateBrowserIsolationTest`（4）、`PrivateSharePluginTest`（3）；总计 160 还包含仓库其他原生回归。

完整日志位于 `D:/tmp/newsnook-browser-native.log`。生成的隔离 APK 位于 `android/app/build/outputs/apk/cloud/debug/app-cloud-debug.apk`，applicationId 为 `com.aizeek.newsnook.browseraudit.debug`。最终设备使用的 APK SHA-256 为 `b54ee814b45790bb0d968b47f9aab63c853cfb97f318ae176a95588df702d939`；查看器和多标签清理已复验，私密分享 chooser 完整设备验收未完成。本次工作环境中的对应 XML、日志和设备尝试记录作为 Draft 交付证据保留。

### 5.3 构建与视觉脚本

已完成的完整前端 `npm run build`、44 状态视觉脚本和追加 3 状态安全区脚本退出码均为 0。前端构建包含项目既有构建前检查、TypeScript 与 Vite，输出仍有既有大体积 chunk 提示。

视觉入口为 `scripts/browser-dialog-focus.test.mjs`；`--safe-area-only` 执行新增安全区目标。截图通过 `BROWSER_TEST_EVIDENCE_DIR` 保存；Windows/WSL 环境中的证据 runner 在 Windows Node 进程内设置该变量，避免截图未落盘。

本记录整理阶段未重复构建或 44 张截图，也未修改产品代码。

### 5.4 全仓与修改范围 lint

| 命令与范围 | 退出码 | errors | warnings |
| --- | ---: | ---: | ---: |
| `npm run lint`，全仓 oxlint | 0 | **0** | **26** |
| `oxlint --deny-warnings`，最终 31 个修改/新增 JS、TS 文件 | 0 | **0** | **0** |

全仓 26 条现存警告分布在 13 个未修改文件，与该批次修改范围的交集为空。规则分布为：`react(only-export-components)` 9、`react-hooks(exhaustive-deps)` 8、`eslint(no-unused-vars)` 5、`eslint(no-control-regex)` 2、`eslint(no-useless-escape)` 2。

修改范围通过 `git diff --name-only -z HEAD` 与 `git ls-files --others --exclude-standard -z` 合并，再筛选 JS/TS 扩展名生成。Java、XML、CSS 不属于本次 oxlint 的 JS/TS 检查范围。没有为消除警告修改无关产品文件。

证据为 `browser-final-lint-scope.json`、`browser-final-lint-summary.json`、`browser-final-lint-diagnostics.json` 及完整 lint 日志。`browser-final-changed-lint.log` 为空，对应退出码为 0，表示通过且无诊断。最后一轮检查已将 `src/lib/nativeChrome.ts` 与 `scripts/browser-image-chrome.test.tsx` 纳入，总范围为 31 个文件；新范围同样没有诊断。

## 6. 未解决问题与待最终验证

### 6.1 普通进程内存回调崩溃复现

`device-ordinary-trim.json` 和 `device-ordinary-trim-crash.log` 记录了 2026-10-17 **12:43:56.673–12:44:00.411 UTC** 的独立复现。开始时 `privatePid` 为空，普通 audit 包的 PID 为 **22619**。脚本将应用通过 Home 键置于后台，随后依次发送内存回调：

| `am send-trim-memory` 级别 | 观察结果 |
| --- | --- |
| `RUNNING_LOW` | PID 22619 仍存活 |
| `RUNNING_CRITICAL` | PID 22619 仍存活 |
| `BACKGROUND` | 普通 PID 消失，`survived: false` |

独立 crash 日志在 **12:43:59.760** 记录 `SIGILL` / `ILL_ILLOPN`。顶部两个 `libwebviewchromium.so` PC 为 **0x7827733 / 0x7828673**，BuildId 为 `68328f9a49348833c7ebe4e41849dca6c2462e4f`；堆栈含 `WV.yh1.onTrimMemory` 和 `android.app.Application.onTrimMemory`。复现脚本为 `D:/tmp/newsnook-browser-ordinary-trim.cjs`。

这一证据说明同一崩溃无需私密进程存在也能复现。当前没有定位到生产源码中的根因，不能据此直接判定为 WebView 引擎缺陷，也不能声称修复。该风险已单独保留给最终交付判断。

### 6.2 准确基线对照

主集成另以准确开发基线 `6a9ab5f3247f36fb0aca4f9efe8fb554c9a126db` 构建独立 `com.aizeek.newsnook.baselineaudit.debug` 包，在同一 Android 17 x86_64 / 16KB / WebView 150 环境执行普通模式内存回调对照。基线 APK SHA-256 为 `fc40c82acc97d7040374a6b2bb210a8249f333d2ca1d1503e962f6b41cfe5097`。

`device-baseline-trim.json` 的来源、安装和步骤元数据记录运行于 **13:10:10.281–13:10:26.496 UTC**，初始 PID 为 **26359**。后续补取的 `device-baseline-trim-crash.log` 明确标识 `baselineaudit`、PID **26359**、UID **10241**；fatal signal 时间为 **13:10:25.890**，后续 tombstone 段再次确认该进程身份。两轮实际观察为：

| 内存回调级别 | 当前分支 ordinary-only，PID 22619 | 准确基线，PID 26359 |
| --- | --- | --- |
| `RUNNING_LOW` | 存活 | 存活 |
| `RUNNING_CRITICAL` | 存活 | 存活 |
| `BACKGROUND` | `SIGILL` / code 2 | 存活 |
| `COMPLETE` | 该轮未继续记录 | `SIGILL` / code 2 |

基线真实 PID 的 crash 段显示顶部 `libwebviewchromium.so` PC 同为 **0x7827733 / 0x7828673**，BuildId 同为 `68328f9a49348833c7ebe4e41849dca6c2462e4f`；相关调用链包括 `WV.yh1.onTrimMemory`、`ComponentCallbacksController`、`Application.onTrimMemory` 和 `ActivityThread.handleTrimMemory`。

**归因只使用后来补取的 `device-baseline-trim-crash.log` 中真实 baseline PID 26359 的段落。** 原 `device-baseline-trim.json` 内嵌 `crashLog` 混入旧 PID **25866** 的堆栈，不能将它作为基线崩溃归因证据。步骤中瞬时返回的 PID 字符串也不能取代有明确进程身份的 fatal signal 与 tombstone。

对照结论仅为：准确基线在同环境复现了与当前 ordinary-only 记录相同的 native 崩溃签名，新增私密功能不是出现该签名的必要条件。两轮触发级别及完整栈帧数不同，不表述为所有触发条件或完整堆栈完全一致。当前仍未定位到生产源码中的根因，不能据此直接断言 WebView 引擎缺陷，也未修复该崩溃。

### 6.3 最终设备复验与覆盖限制

| 项目 | 当前事实 | 后续验收要求 |
| --- | --- | --- |
| 模拟器 native 崩溃 | 当前普通模式在 `BACKGROUND`、准确基线在 `COMPLETE` 复现同一顶部 PC/BuildId 签名；新增私密功能不是必要条件，根因未定位 | 仅使用基线真实 PID 26359 的补取 crash 段；保留触发级别与整体堆栈差异，不将对照或功能通过表述为根因确定或崩溃已修复 |
| 浏览器大图系统栏 | 最终包设备复验完成：light 主题不变，进入查看器使用白色状态栏图标，关闭后恢复黑色 | 证据见 `device-viewer-final` 与 `device-viewer-close` JSON/PNG；迟到回调和主题恢复的其他边界由自动化覆盖 |
| 主图加载与调整 | 最终包初始禁用、主图加载和调整面板展开已观察；关闭后 12 个可见缩略图恢复 | `afterSwitchDisabled` 是 React 提交前的瞬时读数，不作为成功或失败依据；加载边界依已通过自动化 |
| 原生多标签站点清理 | 最终包设备复验通过：A/B 旧实例退役，B 重载无旧 Cookie/存储，独立站点 C 保持 | 证据见 `device-site-clear.json`；原生完整 160 项及站点清理套件 14 项也通过 |
| 私密分享 chooser | 三轮主要设备尝试均未完成；最新一轮真实点击分享后等待确认超时，两 PID 均存活。桌面组件触控可打开确认，DOM / 可访问性树可见 | Android 宿主 DOM / 可访问性树对照诊断与完整 chooser 验收为合并前待办；不记 chooser、取消返回或外部接收通过，不把桌面 fixture 成功扩大到设备，也不以已知崩溃解释最新失败 |
| 旧 Android / 实体机 | 旧 API 28 AVD 镜像缺失，未运行；本轮无实体机验收 | 有可用环境后再补运行证据，保留当前覆盖限制 |

`onTrimMemory` 崩溃与私密强制停止脚本的 CDP 上下文失效分别记录。前者是尚未定位的原生异常，后者有取证重试及最终业务检查结果；两者不能合并归因。

## 7. 证据索引与交接

| 证据 | 内容 |
| --- | --- |
| `browser-final-acceptance.md` | 正式前端入口及 lint 的详细批次记录 |
| `browser-final-acceptance-results.json` | 命令参数、时间、退出码和 lint 统计 |
| `browser-final-package-test.log` | 正式前端入口完整输出 |
| `browser-final-lint-*.json`、lint 日志 | 修改范围、26 条全仓警告及修改范围零诊断 |
| `browser-visual-review.md` | 截图驱动的界面问题与修正记录 |
| `browser-visual-matrix.json` | 44 个常规状态 |
| `browser-safe-area-matrix.json` | 3 个非零安全区状态 |
| `device-private-close.json/.exit` | 正常关闭后的隔离目录清理与普通数据保持 |
| `device-private-force.json/.exit` | 强制停止、再次启动、取证重试和清理结果 |
| `device-netease-images.json/.png` | 网易 72/67 图片、WebP 读取和 headerTop 52 |
| `device-lightbox.json/.png` | 早期实际大图切换至 2/67 |
| `device-viewer-final.json/.png`、`device-viewer-close.json/.png` | 最终查看器 2/68、已加载主图与调整面板、系统栏进入/退出及主题保持 |
| `device-site-clear.json` | 最终包真实多标签站点清理通过，同站点退役和独立站点保持 |
| `device-private-share.json` | 13:15 最新设备轮：完成首页、8 项看图与操作菜单，真实点击分享后等待确认超时，两 PID 均存活；未完成 chooser 验收 |
| `device-private-share-home-readiness-attempt.json` | 13:13 首页 8 秒等待超时，收尾已出现首页控件；未到 chooser |
| `device-private-share-slow-ui-attempt.json` | 13:11 已到私密图片操作，等待继续分享超时且普通 PID 已空；未完成 chooser 验收 |
| `browser-private-share-touch.json`、`browser-private-share-touch-before.png`、`browser-private-share-touch-after.png` | 13:21 桌面独立组件的真实触控诊断，确认框 DOM / 可访问性树可见；不含 Android 宿主或系统 chooser |
| `device-private-share-startup-attempt.json`、`device-private-share-timeout-attempt.json` | 另外两份驱动准备失败记录，不作为业务通过 |
| `device-ordinary-trim.json`、`device-ordinary-trim-crash.log` | 当前分支无私密进程时，普通进程在 BACKGROUND 内存回调复现 SIGILL |
| `device-baseline-trim.json` | 准确 6a9ab5f 的来源、APK hash、安装及步骤元数据；内嵌 crashLog 混入旧 PID，不用于崩溃归因 |
| `device-baseline-trim-crash.log` | 后补取的真实 baselineaudit PID 26359 / UID 10241 崩溃段；COMPLETE 级别、相同顶部 PC 和 BuildId |
| `android/app/build/test-results/testCloudDebugUnitTest/` | 原生 160 项测试 XML |
| `D:/tmp/newsnook-browser-native.log/.exit` | 原生测试与隔离调试包构建 |
| `D:/tmp/newsnook-browser-private-force.log` | 首次 CDP 上下文失效的原始取证输出 |
| `D:/tmp/newsnook-browser-api28-emulator.log` | API 28 AVD 镜像缺失的启动失败依据 |

**最终交付结论：Draft。** 产品实现、正式前端入口、31 文件修改范围 lint、完整原生 160 项门禁，以及私密关闭/清理、实际看图和站点清理等已完成设备验收均已记录；最终分支、差异和交付材料已核对。

私密分享 chooser 完整设备验收未完成，Android 宿主下的 DOM / 可访问性树对照诊断与完整流程验收作为合并前待办保留。最新设备轮的两 PID 均存活，桌面组件触控诊断通过不覆盖该轮失败。SIGILL 的当前分支与准确基线独立证据已归档：两轮触发级别不同、顶部 PC/BuildId 签名相同，新增私密功能不是必要条件，根因仍未定位、未修复。API 28 和实体机覆盖限制保持明确。本记录不包含推送或远端 CI 已通过的结论。
