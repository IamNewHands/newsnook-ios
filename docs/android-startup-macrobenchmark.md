# NewsNook Android 冷启动优化与测量

> 2026-10-22：新增 [架构对照与测量口径修正](./android-startup-architecture-lab.md)。本页第 9 节保留 10 月 21 日原始实验结果；当前实现已将 OS 上报移入有效内容的 OnDraw，业务就绪标记仍在绘制后发布。旧、新口径不能相减作为性能收益。
>
> 同日生产代码审查后，Web 层 `bootMark` / `bootMeasure` 仅在 Vite 开发态执行，Android 原生常规启动日志仅在 Debug 或隔离 Benchmark 输出。正式版不再执行 JS 启动诊断；隔离 Benchmark 的 AndroidX TTID/TTFD 和原生实绘完成标记继续有效，但基于旧版 JS 日志的阶段辅助字段可以为 `null`，不应补零或据此推导性能收益。

本文记录 `beta` 的启动边界、隔离测量方法和产物验证步骤。计时目标是：冷进程启动后，用户选择的初始界面已完成必要的本地恢复，并经过真实的可见绘制。新闻下载、网页加载和翻译网络请求可以继续进行。

本轮证据保存在仓库的 `node_modules/.cache/newsnook/cold-start-20261021/`。该目录是本机实验记录，不属于提交内容。原生路径或依赖版本发生明显变化后，应重新采集配置文件并测量。

## 1. 先确认比较的是哪种构建

### 修正此前 benchmark 构建未开启 R8 的问题

此前工程手动声明了 `benchmarkRelease` 和 `nonMinifiedRelease`，但没有执行 `initWith release`。实际使用的 AndroidX Baseline Profile Gradle 插件 1.4.1 不会再为这些已经存在的 build type 复制 Release 的压缩设置。名称中含有 `Release`，不能证明 R8 已启用。

本轮保存的原 `before.apk` 经 DEX 标记检查确认为 D8 产物。此前基于该构建记录的启动表，以及不完整的 11/12 样本，均不作为本轮 R8 优化前后的比较依据。原始记录保留，便于追溯。

当前构建类型的实际约束如下：

| Build type | 用途 | R8 / 资源压缩 | 包名与签名 |
| --- | --- | --- | --- |
| `release` | 正式分发 | 开启 | 原正式包名；保留正式签名检查 |
| `benchmarkRelease` | 性能测量 | 先 `initWith release`，继承开启状态 | `.benchmark` 后缀；本地 debug 签名；不可调试 |
| `nonMinifiedRelease` | 采集未混淆的规则 | 先继承 Release，再显式关闭两项压缩 | 同一隔离 `.benchmark` 包名；本地 debug 签名 |

只编译配置文件或构建隔离 benchmark APK，无须配置正式签名凭证。此例外不改变正式 APK/AAB 的签名要求。

### 建立可比较的旧版 R8 基线

旧版基线从 `f88f9dfa50183f5a5a15c2fdba9004901c4cb52d` 的独立工作树构建，恢复了本轮开始时已有的 profiling 改动，只补上正确的 Release 继承配置。旧版前端资源直接取自已保存 APK，245 个 Web 资源经逐字节校验一致；没有把本轮前端或原生优化混入旧版。

| 证据 | 值 |
| --- | --- |
| APK | `before-r8.apk` |
| APK 大小 | 4,240,405 字节 |
| SHA-256 | `12d683f0d343222f3dd8b0f56355363ab45ecf22f779051da34d5280ad389d57` |
| 构建证据 | `before-r8-build-evidence.json`、`before-r8-build.log` |
| 原始计时 | `before-r8-none.log/.json`、`before-r8-partial.log/.json` |
| 已校验汇总 | `before-r8-profile-report.json` |

该 APK 的 R8 标记、两份 DEX 与 R8 metadata 中的 SHA-256 一致，且 metadata 标记了启动 DEX。这里的“等价”指**与旧 Release 相同的 R8 收缩与混淆配置**，不表示旧版已经启用全部运行时优化。

### R8 收缩、运行时优化与资源优化分别验证

随后对 split / grouped 候选 APK 的 metadata 检查发现第二个配置问题：`options.isShrinkingEnabled` 和 `isObfuscationEnabled` 为 `true`，启动 DEX 与 Profile 优化标记也为 `true`，但 `options.isOptimizationsEnabled` 为 `false`，`stats.noOptimizationPercentage` 为 100。原因是原 Release 默认使用 `proguard-android.txt`，其中的 `-dontoptimize` 关闭了代码优化。

本轮已采用 `proguard-android-optimize.txt`，并按 AGP 8.13 的官方方式开启 `android.r8.optimizedResourceShrinking=true`。候选 APK 的 metadata 已实际确认代码、访问范围与资源联合优化开启。最终产物仍须执行第 7 节的 metadata / APK 校验；旧基线工作树保留旧 Release 设置，不追溯修改基线。

真实优化 APK 随后复现了 Capacitor 8.4 的权限注解缺陷：`DlnaCastPlugin.restore()` 首次进入权限路径即崩溃。对同一 APK 的 mapping 和 DEX 反汇编确认，`Plugin.getPermissionStates()` 的 `annotation.permissions()` 已被 R8 折叠为无条件 `throw null`。项目回移 [Capacitor #8646](https://github.com/ionic-team/capacitor/pull/8646) 对 [#8589](https://github.com/ionic-team/capacitor/issues/8589) 的修复，仅保留 `com.getcapacitor.annotation.**`、`PluginMethod` 和 `NativePlugin` 三类运行时注解接口及成员。修复后的优化 APK 已完成实际启动与绘制，完整优化保持开启；没有用关闭 R8 或全包 keep 掩盖问题。

这也说明，APK 由 R8 生成、存在 `baseline.prof`，或者标记了启动 DEX，均不能单独证明运行时优化已启用。配置依据见 [Android 官方 R8 优化说明](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization) 与 [keep rules 说明](https://developer.android.com/topic/performance/app-optimization/keep-rules-overview)。

## 2. 启动完成的定义

Android 的 `StartupTimingMetric` 分别报告 TTID 与 TTFD：

- **TTID**：系统收到启动 Intent，直到目标界面第一帧完成。
- **TTFD**：系统收到启动 Intent，直到包含或跟随 `reportFullyDrawn()` 信号的帧完成。

指标定义见 [Android 官方 Macrobenchmark metrics](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics)。业务代码负责在正确的界面状态调用上报，不能用空 WebView、占位壳或网络已开始代替完成。

### React 与原生之间的约定

`useStartupReadiness` 维护事件驱动的 blocker 集合。在当前初始界面所需 blocker 全部释放后，等待两个 `requestAnimationFrame`，由 `BootstrapRoot` 发出 `first-ui-frame`。新增 blocker 会取消尚未完成的帧调度，Provider 只成功通知一次。

以下本地工作参与门控：

| 初始界面 | 必须完成的工作 | 不作为启动门槛的工作 |
| --- | --- | --- |
| 首页 | 偏好与 Secret 水合、启动链接判定、初始模块提交、实际可见信息流的本地预存恢复 | 新闻网络刷新、正文预取、后台翻译 |
| Reader | 当前 `article.id` 的同步正文缓存或本地预存读取；命中时随正文一起提交 | 本地未命中或错误后的网络正文解析 |
| Browser | JS 与专属 CSS、匹配当前入口的原生命令、最新有效 `state/tabs`、所需可见性的 bounds 确认 | 网页 `state.loading`、远端页面请求 |
| 首次引导 | 当前显示的引导界面提交 | 被引导覆盖的后台信息流 |

浏览器恢复先完成、`getLaunchUrl()` 后返回外部链接时，就绪状态必须对应新的入口身份，旧恢复会话不能为新导航放行。入口身份与实际打开命令使用同一个 `resolveBrowserAddress()` 结果，避免无尾斜杠、主机大小写或默认端口规范化导致永久等待。Reader 被 Browser 覆盖时，不拖延当前实际选择的 Browser 界面。

原生收到 JS 信号后，还会等待文档提交以及 `postVisualStateCallback`，随后确认 WebView 已附着、可见、窗口可见且尺寸有效，并观察一次原生 `OnDraw`。当前实现就在该有效内容帧的 OnDraw 中调用 `reportFullyDrawn()`，让系统以包含该信号的帧完成时刻计算 TTFD；绘制后的主线程任务才发布业务完成标记。仅收到 visual-state callback 仍不足以放行。10 月 22 日发现旧的“绘制后才调用 OS 上报”会在静态页面上选中后续用户交互帧，因此修正的是计时归属，不是提前伪造业务完成。

暂停、导航、销毁与旧 generation 的回调均会使过期工作失效；恢复前台可以重新等待尚未完成的绘制。Splash 的 2.5 秒兜底只允许遮罩退出，不会把超时当成界面完成，也不会伪造 `reportFullyDrawn()` 成功。

### 仪器测试等待真实绘制标记

`StartupReady.kt` 等待以下三个条件同时成立：

- 原生容器 resource ID：`android:id/content`
- package：`com.aizeek.newsnook.benchmark`
- content description：`newsnook-first-frame-ready`

标记放在原生容器，而不是 WebView 宿主节点。实测发现：命令行在启动后连接无障碍服务时可以读到宿主 ID/description；instrumentation 在启动前启用 WebView 无障碍服务后，WebView 改为提供虚拟 HTML 树，宿主 ID/description 会消失。失败时保存的完整树证明原生 `android:id/content` 仍稳定存在，因此仅调整标记的传递位置，真实 WebView 绘制完成条件保持不变。

15 秒内没有出现标记，测试失败。标记只在成功的真实绘制上报后设置，并且受 `BuildConfig.STARTUP_BENCHMARK` 控制；正式 Release 为 `false`，不会向正式应用的辅助功能树添加技术标签。等待动作位于 instrumentation，不额外延长应用 Splash。

旧版的 TTFD 上报条件较宽，且旧 benchmark 只等待容器。因此，旧版 TTFD 与新版真实绘制 TTFD **不能直接计算为同一口径的改善百分比**。TTID、JS 阶段计时与新版 TTFD 应分别列出，保留这种口径差异。

## 3. 本轮移出关键路径的工作

| 改动 | 启动收益来源与保留的行为 |
| --- | --- |
| LinuxDo / Zhihu 的 OkHttp 客户端延迟初始化 | 首次真实 API 调用才创建客户端与 TLS 相关对象；保留原超时、重定向和销毁行为，并保证并发初始化安全 |
| local 的 Bergamot JNI 与下载客户端按需初始化 | 插件加载保留轻量状态，首次能力、模型或翻译等真实操作再初始化 JNI；下载客户端在首次下载时创建，不伪造能力返回值 |
| 翻译工作收集与 Provider 动态加载 | 未启用翻译或空列表不加载语言检测、变体词表及 Provider；已有翻译缓存仍同步展示；异步 import 前建立取消信号，保留批处理与持久化逻辑 |
| 正文缓存依赖边界 | 纯文本判断移到 `htmlText`，缓存 guard 不再绕经正文解析共享模块把 DOMPurify、媒体依赖拉进首页静态入口；原解析与净化能力保留 |
| Browser / Agent / History 样式按路由加载 | 模块与对应 CSS 一起到达后才提交界面，避免无样式首帧；不移动存在级联顺序冲突的 LinuxDo 样式 |
| CSS 兼容处理后的最终压缩 | 先生成旧 WebView 兼容规则，再进行最终 minify；移除会截断嵌套 `color-mix()` 的旧正则，保留未识别的完整动态表达式 |
| 稍后读正文的初始整理延后 | 仅首次批量维护等待启动后 idle；显式收藏在同一交互中立即 pin 已有正文，后续维护恢复原提交后时序，避免离线正文被容量淘汰 |
| 就绪状态由事件驱动 | 无轮询；本地异步恢复、取消和当前入口身份直接决定是否等待，避免占位界面提前完成 |

主 Feed 是默认启动页面，保持直接进入；同步解析仍使用原有 `linkedom`，没有为减少入口字节而替换成行为不同的 DOM 实现。播放器和大型翻译引擎继续按需加载。已有 `Application.onCreate` 的官方 WebView 异步启动保留，不为等待 warmup 人为推迟首页 WebView 的使用；这是 [WebView 位于关键路径时的官方建议](https://developer.android.com/develop/ui/views/layout/webapps/optimize-webview-startup)。

入口资源合并实验已经完成，最终保留默认分包。实验仅匹配 Rolldown 的 `$initial` 静态依赖，关闭递归吸入其他依赖，并启用严格执行顺序；候选保留大型功能的动态边界，但未取得可重复的完整启动收益，且增加入口 JS 字节。资源数变少不能替代真实启动改善。具体取舍见第 9 节；分组语义参见 [Rolldown CodeSplittingGroup](https://rolldown.rs/reference/TypeAlias.CodeSplittingGroup) 和 [manual code splitting](https://rolldown.rs/in-depth/manual-code-splitting)。

## 4. 设备、场景与数据保护

本轮测量设备是 `emulator-5554`，LDPlayer Android 14 / API 34，WebView provider 为 Chrome `124.0.6367.82`。场景为**已完成首次引导、列表缓存为空的回访首页**。它不是首次安装引导、已有大量缓存的信息流，也不是外部链接进入 Reader/Browser 的耗时结论。

使用以下隔离包：

| 包 | 用途 |
| --- | --- |
| `com.aizeek.newsnook.benchmark` | 可覆盖安装的性能测量目标 |
| `com.aizeek.newsnook.profiletests` | instrumentation runner |
| `com.aizeek.newsnook.debug` | 用户原有调试应用，本轮不安装、不清理、不卸载 |
| `com.aizeek.newsnook` | 正式应用，本轮不安装、不清理、不卸载 |

有用户数据的设备遵守仓库 `AGENTS.md`：只用 `adb install -r`。不要运行 `adb uninstall`、`pm clear` 或可能由 UTP 卸载目标的 `connectedAndroidTest`。本文使用直接 instrumentation；不通过会启动设备管理流程的 Gradle 生成任务采集。

开始计时前，通过隔离应用的正常 UI 固定首页、引导和偏好状态。COLD 表示每轮从冷进程开始，不意味着删除本地数据或恢复到首次安装。测量期间停止宿主机上的重构建等负载，并保持设备、网络、缓存、安装版本、WebView 版本与温度条件一致。

AndroidX 在本模拟器明确警告无法完整清除 ART Runtime Image，后续迭代可能继承更快的类加载状态。即使 12 个样本完整，也只能据此描述本模拟器的结果，不能证明物理设备的稳定百分比或当前技术栈的绝对下限。

## 5. 构建并直接运行 Macrobenchmark

以下示例从仓库根目录执行，采用 PowerShell 7（UTF-8 输出），假设 Android SDK 的 `adb` 与项目所需 JDK 已配置。环境准备见 [Android 构建文档](./android-build.md)。

先构建同一份前端和测量 APK：

```powershell
npm run android:sync
.\android\gradlew.bat -p android :app:assembleCloudBenchmarkRelease :baselineprofile:assembleBenchmarkRelease --no-daemon --console=plain
```

然后选择已确认的隔离设备，并创建此次运行的独立本机记录目录：

```powershell
$deviceSerial = "emulator-5554"
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = "node_modules/.cache/newsnook/cold-start-$runStamp"
New-Item -ItemType Directory -Force $runDir | Out-Null
adb -s $deviceSerial install -r android/app/build/outputs/apk/cloud/benchmarkRelease/app-cloud-benchmarkRelease.apk
adb -s $deviceSerial install -r android/baselineprofile/build/outputs/apk/benchmarkRelease/baselineprofile-benchmarkRelease.apk
```

确认目标应用通过正常 UI 处于约定的回访首页后，分别运行：

```powershell
adb -s $deviceSerial shell am instrument -w -r -e class "com.aizeek.newsnook.benchmark.StartupBenchmark#startupNoProfile" -e androidx.benchmark.enabledRules Macrobenchmark -e androidx.benchmark.suppressErrors EMULATOR com.aizeek.newsnook.profiletests/androidx.test.runner.AndroidJUnitRunner | Set-Content -Encoding utf8 "$runDir/none.log"
adb -s $deviceSerial pull /storage/emulated/0/Android/media/com.aizeek.newsnook.profiletests/com.aizeek.newsnook.profiletests-benchmarkData.json "$runDir/none.json"
adb -s $deviceSerial pull /storage/emulated/0/Android/media/com.aizeek.newsnook.profiletests "$runDir/none-device-output"

adb -s $deviceSerial shell am instrument -w -r -e class "com.aizeek.newsnook.benchmark.StartupBenchmark#startupWithProfile" -e androidx.benchmark.enabledRules Macrobenchmark -e androidx.benchmark.suppressErrors EMULATOR com.aizeek.newsnook.profiletests/androidx.test.runner.AndroidJUnitRunner | Set-Content -Encoding utf8 "$runDir/profile.log"
adb -s $deviceSerial pull /storage/emulated/0/Android/media/com.aizeek.newsnook.profiletests/com.aizeek.newsnook.profiletests-benchmarkData.json "$runDir/profile.json"
adb -s $deviceSerial pull /storage/emulated/0/Android/media/com.aizeek.newsnook.profiletests "$runDir/profile-device-output"
```

在物理设备上删除两条命令中的 `-e androidx.benchmark.suppressErrors EMULATOR`。两个方法各执行 12 轮：

- `startupNoProfile`：`CompilationMode.None()`。
- `startupWithProfile`：`CompilationMode.Partial(BaselineProfileMode.Require)`，没有可安装的配置文件时应失败。

**每条 instrumentation 命令完成后，立即保存对应 JSON 和 Perfetto 文件，再启动下一条。** 实测确认后续 instrumentation 会清理共享输出目录中的旧 trace，并覆盖固定名称的 JSON；仅保存日志中报告的设备路径无法保留证据。以上 pull 都保存在当前项目环境中。先确认日志显示真正的 JUnit 成功（如 `OK (1 test)`），没有 `FAILURES!!!`；不能仅凭 adb 退出码或 `INSTRUMENTATION_CODE: -1` 判定成功。

使用实际脚本校验并汇总：

```powershell
npm run android:bench:report -- "$runDir/none.log" "$runDir/profile.log" --samples "$runDir/none.json" "$runDir/profile.json"
node scripts/android-macrobenchmark-report.mjs "$runDir/none.log" "$runDir/profile.log" --samples "$runDir/none.json" "$runDir/profile.json" --json | Set-Content -Encoding utf8 "$runDir/report.json"
```

报告器检查 JUnit 结果、完整计时字段、唯一匹配的方法名、原始样本数与 `repeatIterations` 一致，以及 JSON 的 min/median/max 与日志相符。偶数样本的 median 为中间两项均值；p90 使用 nearest-rank，即排序后的第 `ceil(n × 0.9)` 项。没有原始样本时不会编造 n 或 p90。脚本中的 delta 是**同一 APK 的 Partial 相对 None**；比较新旧 APK 时另行列出相同编译模式，不能混用。

通过两个编译模式只是一个区块。物理设备应重复交替顺序，例如 None → Partial → Partial → None；新旧 APK 对照也应采用交替区块。保存每个区块的 APK SHA-256、测试顺序、设备信息与原始样本。Perfetto 文件以 instrumentation 输出中报告的设备路径为准，及时 pull 到此次目录；直接运行不会自动把它们收集到 Gradle 的 connected-test 输出目录。

## 6. 安全采集并更新 Baseline / Startup Profiles

规则应来自最终选定的前端和原生代码。先执行 `npm run android:sync`，再构建未混淆目标及相应 runner：

```powershell
.\android\gradlew.bat -p android :app:assembleCloudNonMinifiedRelease :baselineprofile:assembleNonMinifiedRelease --no-daemon --console=plain
adb -s $deviceSerial install -r android/app/build/outputs/apk/cloud/nonMinifiedRelease/app-cloud-nonMinifiedRelease.apk
adb -s $deviceSerial install -r android/baselineprofile/build/outputs/apk/nonMinifiedRelease/baselineprofile-nonMinifiedRelease.apk
```

为此次采集指定一个新的设备输出目录，仅用于本次 profile 产物。输出管理可能清理选定目录中的普通文件，因此不要复用含有其他记录的目录：

```powershell
$profileRunStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$profileDeviceDir = "/sdcard/Android/media/com.aizeek.newsnook.profiletests/profile-$profileRunStamp"
adb -s $deviceSerial shell am instrument -w -r -e class "com.aizeek.newsnook.benchmark.BaselineProfileGenerator#startup" -e androidx.benchmark.enabledRules BaselineProfile -e androidx.benchmark.suppressErrors EMULATOR -e androidx.benchmark.output.enable true -e additionalTestOutputDir $profileDeviceDir com.aizeek.newsnook.profiletests/androidx.test.runner.AndroidJUnitRunner | Set-Content -Encoding utf8 "$runDir/profile-generation.log"
```

物理设备同样移除 EMULATOR 参数。当前 generator 只采集一个冷启动关键流程（CUJ），设置 `includeInStartupProfile = true`、最多 10 轮、连续稳定 3 轮。它与计时测试等待同一个真实绘制标记，不把后续浏览和网络请求主动加进启动采集流程。

确认 JUnit 成功后，从日志取得本次实际产物路径，再用 `adb pull` 保存到 `$runDir`。不要仅凭旧目录里存在同名文件就认定采集成功。当前 AndroidX 组合可能只输出 `BaselineProfileGenerator_startup-startup-prof.txt` 及其带时间戳的副本，没有单独的 `baseline-prof.txt` 并不表示失败。

当前只采集启动 CUJ，Gradle 插件的合并规则会把 startup 规则也作为 baseline 输入。因此，将本次确认的新启动规则用于以下两份源码文件是等价的：

- `android/app/src/main/generated/baselineProfiles/baseline-prof.txt`
- `android/app/src/main/generated/baselineProfiles/startup-prof.txt`

更新前记录旧、新文件的 SHA-256 与规则行数。若需合并或去重，按完整行处理，保留采集到的 `H` / `S` / `P` 标志和类、方法签名，不手工推断热度标志。将来加入非启动 CUJ 时，必须重新区分 baseline 与 startup 的适用规则，不能继续把所有规则复制到两份文件。

`mergeIntoMain true` 使公共启动规则进入 cloud 和 local；`automaticGenerationDuringBuild false` 保持普通 CI Release 构建不依赖连接设备。Cloud 采集不证明 local 专属 JNI 路径已获得运行时覆盖。本轮 local 专属初始化有单元回归，arm64 JNI 的真实运行性能仍需对应设备测量。

## 7. 验证配置文件真正进入 R8 与最终 APK

更新规则后，重新编译产物：

```powershell
.\android\gradlew.bat -p android :app:compileCloudReleaseArtProfile :app:compileLocalReleaseArtProfile :app:assembleCloudBenchmarkRelease :baselineprofile:assembleBenchmarkRelease --no-daemon --console=plain
```

这些任务可以在没有正式签名凭证时验证 ART/R8 集成。检查同一次构建、同一 variant 的以下文件，不要把旧 APK 与新 intermediates 混在一起：

| 层次 | 典型位置（均相对于 `android/app/build/intermediates/`） | 需要确认 |
| --- | --- | --- |
| 合并启动规则 | `merged_startup_profile/<variant>/merge<Variant>StartupProfile/startup-prof.txt` | 本次源码 startup 规则及 H/S/P 标志完整一致 |
| 合并 ART 规则 | `merged_art_profile/<variant>/merge<Variant>ArtProfile/baseline-prof.txt` | 完整覆盖本次源码 baseline 规则与标志，允许库追加规则 |
| R8 后规则 | `r8_art_profile/<variant>/minify<Variant>WithR8/baseline-prof.txt` | 与本次压缩后类、方法对应 |
| ART 二进制 | `binary_art_profile/<variant>/compile<Variant>ArtProfile/baseline.prof` | 非空 |
| Profile metadata | `binary_art_profile_metadata/<variant>/compile<Variant>ArtProfile/baseline.profm` | 非空 |
| R8 metadata | `r8_metadata/<variant>/minify<Variant>WithR8/r8-metadata.dat` | 检查优化标记与实际 DEX 校验和 |
| DEX | `dex/<variant>/minify<Variant>WithR8/classes*.dex` | 与 metadata 以及最终 APK 的 DEX 一致 |

这里的 `<Variant>` 是任务名形式，例如 `CloudBenchmarkRelease`；`<variant>` 为 `cloudBenchmarkRelease`。本工程当前 R8 metadata 是可读 JSON。确认：

- `options.isShrinkingEnabled`、`options.isObfuscationEnabled`、`options.isOptimizationsEnabled` 均为 `true`。
- `resourceOptimization.isOptimizedShrinkingEnabled` 为 `true`。
- `startupOptimization.isDexLayoutOptimizationEnabled` 为 `true`。
- `startupOptimization.isProfileGuidedOptimizationEnabled` 为 `true`。
- 记录 `stats.noOptimizationPercentage` 等实际统计值；保留必要入口可能限制部分优化，不预设它必须为零。
- 至少一个 `dexFiles` 条目标记 `startup: true`。
- 每份实际 DEX 的 SHA-256 与相应 metadata 的 `checksum` 一致，最终 APK 内的 DEX 又与它们一致。
- 最终 benchmark APK 中 `assets/dexopt/baseline.prof` 与 `baseline.profm` 非空，且 hash 匹配本次编译结果。
- 源 Profile 的 hash 匹配本次设备采集；在内存中按完整 descriptor 合并 H/S/P 标志后，merged startup 与源码完全相等，merged ART 包含源码的所有规则及标志。R8 后规则会合法改名、内联与裁剪，不直接要求它与源文件相等。
- 正式 Release 的 `BuildConfig.STARTUP_BENCHMARK` 为 `false`，隔离 benchmark 为 `true`；进一步确认正式 DEX 中不存在 `newsnook-first-frame-ready`，benchmark DEX 中存在。
- APK 的 Web 文件集合必须精确等于本次 `dist` 加 Capacitor 生成的两个空兼容文件 `cordova.js`、`cordova_plugins.js`，再逐文件比较内容，拒绝实验残留的额外旧 bundle。

[Android 官方 Startup Profile 验证方法](https://developer.android.com/topic/performance/baselineprofiles/confirm-startup-profiles) 同样要求检查启动 DEX 和 R8 构建证据。配置文件非空只能证明有文件，不能单独证明启动 DEX 布局已生效。部分 synthetic 规则在 R8 内联或删除后不能匹配时，保留并评估实际警告，不统一隐藏。

本轮对 cloud/local 正式 Release 验证到 R8、DEX 与 ART 编译中间产物；没有构建或签署新的正式发布 APK。完整 APK 校验针对隔离的 `cloudBenchmarkRelease`，不会把目录中已有的旧正式 APK 算作本次产物。

重新安装最终 R8 APK 与 benchmark runner，然后执行第 5 节的 None / Partial Require 对照。采集规则时安装的 nonMinified APK 不能直接用于最终性能结论。

## 8. 本轮行为验证

截至本轮前端冻结，以下验证已执行通过；行为回归与性能测量分开记录：

| 范围 | 验证内容 |
| --- | --- |
| 原生单元测试 | 共 44 项：cloud 42、local 2；包括真实绘制门控 10、renderer 生命周期 3、LinuxDo 25、客户端惰性初始化 4、Bergamot 初始化 2 |
| Reader | 真实 Reader 持住本地预存 Promise 时两帧仍不上报；命中正文提交后放行；未命中或错误不等待网络；覆盖层、卸载与迟到结果 |
| 稍后读 | 真实 hook、按钮交互与正文缓存容量淘汰；idle 未执行时刚收藏的旧正文仍被固定保护，移除与连续切换保持一致 |
| Browser | 真实 Workspace/session 共 12 项；原生命令、快照、bounds、失败与取消，以及恢复先完成而启动链接后到的竞态；原 Workspace 三轮回归通过 |
| 前端集成 | `test:android-startup`、`test:prestore`、`test:cache`、`test:feed-translation`、lint、TypeScript 与生产 Web 构建、Capacitor sync |
| 优化 APK 的真实 UI | 回访首页；首次进入“我的”、历史与外观页面；冷进程 ACTION_VIEW 打开 `https://EXAMPLE.com:443`，确认 Browser 内容与控件后退出回首页；未修改外观设置 |
| 构建/解析工具 | R8 build-type 继承、生产 marker 隔离、JUnit 假成功拒绝、不完整样本拒绝、even median / p90、CSS 最终压缩与旧 WebView fallback |

常用复验入口：

```powershell
npm run test:android-startup
npm run test:prestore
npm run test:cache
npm run test:feed-translation
npm run lint
npm run android:sync
```

也可以单独运行三个真实组件回归：

```powershell
node --experimental-test-module-mocks --import tsx scripts/reader-startup.test.tsx
node --import tsx scripts/later-pinning.test.tsx
node --experimental-test-module-mocks --import tsx scripts/browser-session-startup.test.tsx
```

上述测试覆盖正确性。它们不能代替最终 APK 的可见界面检查，也不能把模块加载减少换算为毫秒收益。

## 9. 最终结果与实验取舍

### 最终采用版本与产物

最终保留默认分包、两帧 React 就绪与原生 visual callback 后真实绘制的方案。资源合并和 early-fence 均未采用；early-fence 的六个文件已按实验前 SHA-256 精确恢复，撤回源码与结果仍保存在本机证据目录。

| 产物 | 本次结果 |
| --- | --- |
| 隔离目标 APK | `after-final.apk`；3,959,891 字节 |
| APK SHA-256 | `dd7c10a499b21fbd18031fc7c9369999b07a1944f192bdf51f3ac9b2a6ce381b` |
| benchmark runner | `after-final-tests.apk`；SHA-256 `4e9763be8a15802ef87a5150ce1cfd95debc62c14c0ba14f3d61b433ba5620b1` |
| 静态入口图 | `final-chosen-entry-assets.json` |
| 全部产物校验 | `final-artifact-verification.json` |
| 最终构建 | `final-artifacts-build.log`；三个变体均重新执行 R8，构建成功 |

相对旧版等价 R8 APK 的 4,240,405 字节，隔离 APK 减少 280,514 字节（6.62%）。这属于安装包体积差异，不换算为冷启动毫秒收益。

### 同一首页状态下的最终 36 个有效样本

实际顺序为旧版 None → 最终版本 None → 最终版本 Partial Require（11/12，拒绝）→ Partial Require 重测（11/12，拒绝）→ 独立单轮 recorder 诊断 → 恢复原冻结 runner 后的一次附带 recorder 日志的完整 Partial Require 区块。两次失败、单轮诊断和最后一次 Partial 之间，目标 App APK 与默认采集配置一致；三次 12 轮 Partial 使用同一份原测试方法，独立诊断仅使用临时 runner 执行 1 轮。测试 APK 恢复后核验 SHA-256；设备上实际安装的目标 APK hash 也与最终产物相同。

下表采用三组完整结果，每组 12 个样本，均通过 JUnit 成功与原始 JSON 完整性检查；36 份对应 trace 均在下一次 instrumentation 前保存，失败区块另有 24 份 trace，单轮诊断另有 1 份。接纳条件在最后一次复测前固定为完整性，不以耗时是否改善筛选，全部慢样本保留。单轮诊断不参加表内统计，也不补入旧区块。所有主指标取 AndroidX 原始 JSON，p90 为 nearest-rank，单位为毫秒。

| 构建 / 编译模式 | n | TTID median | TTID p90 | TTFD median | TTFD p90 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 旧版等价 R8 / None | 12 | 1760.17 | 1938.05 | 旧口径，不作新旧比较 | — |
| 最终版本 / None | 12 | 1748.94 | 1884.30 | 2206.61 | 2475.14 |
| 最终版本 / Partial Require | 12 | 1710.08 | 1926.68 | 2246.22 | 2436.59 |

本区块新版 None 的 TTID median 相对旧版 None 减少 11.23 ms（0.64%）；最终版本 Partial 的 TTFD median 相对同 APK 的 None 增加 39.61 ms（1.80%）。这两项分别比较同编译模式的新旧 APK、同 APK 的两种编译模式，不能把它们混成一个优化比例。

旧版 TTFD 与 TTID 相等，仍受旧上报口径限制，不与新版真实绘制 TTFD 计算改善百分比。本轮是同模拟器上的顺序区块，存在运行时状态与时间顺序影响；没有重复交替区块或物理设备样本，不宣称统计显著或普遍稳定的耗时改善。此前 `before-r8-none` 的 TTID median 为 1986.05 ms，与本轮旧版结果的差异也说明只挑某一轮会夸大收益。

主证据为 `final-before-none`、`final-after-none`、`final-after-partial-logged` 各自的 `.log`、`.json`、`-summary.json`、`-native.log`、`-traces/`，以及 `final-measure-suite-record.json`、`final-after-partial-retry-record.json`、`final-after-partial-logged-record.json`、`final-profile-report.json`、`final-metrics.json`。两次失败的 `final-after-partial`、`final-after-partial-repeat` 与 suite 的失败状态保持原样，未改写为成功。APK hash、测试顺序和完成时间均已记录。

### 两次首轮采集异常与诊断边界

两个失败 Partial 区块各有 12 次完整的原生启动与报告，但 iteration000 的 trace 没有覆盖完整启动；原始 11 项指标逐一对应 iteration001–011。异常 trace 从 tracing_started 到 measureBlock 约 30.05 s，measureBlock / startActivityAndWait 均未闭合，采集在实际应用 report 前约 1.85 / 2.07 s 停止。默认 TraceConfig 没有 duration 或 max-file-size 上限，两个坏 trace 的 failed flush 计数分别为 5、4；这些次数不是丢失事件数，也不能指认某个数据源。

精确 AndroidX 1.5.0 源码允许在某轮指标缺失时跳过该轮，再在其余指标非空时让 JUnit 成功，因此项目的完整样本校验仍不可省略。旧 recorder 日志已经轮转；metadata / args 也没有提供 slow-source 名称，不能指定是哪个数据源，更没有证据要求改变 App marker。

独立单轮诊断采用同一目标 APK、默认采集配置和 Partial Require，仅 iterations=1；提前保存 `PerfettoCapture`、`perfetto`、`NewsNookStartup` 标签。该次 EXITCODE=0、指标和 trace 完整，未复现异常。诊断源码与测试 APK 单独归档，临时源码已移除；随后恢复原冻结的测试 APK 再作上述完整 12 轮测量。最后一次完整区块也保留 recorder 日志。测量后重建普通 runner，构建目录中的应用与测试 APK 均与冻结版本逐字节相同，记录在 `final-normal-runner-restored.json`。没有通过调大超时、移除数据源、修改 App 就绪信号或补数使失败结果变成成功。

诊断后的完整区块证明本次取得有效 Partial 样本，不证明采集故障已根治，也不估计故障率。它发生在诊断与多次采集之后；COLD 仍指 App 冷进程，不表示整机、WebView provider 与 recorder 都首次运行。该运行历史与 Runtime Image 限制共同约束跨模式比较。

对应记录为 `partial-final-capture-boundaries.json`、`partial-capture-requested-config-summary.json`、`partial-missing-data-loss-counters.json`、`partial-slow-source-metadata-check.json`、`recorder-first-partial-diagnostic-record.json` 与最后一次 `-recorder.log`。

### 入口资源的确定性变化

以下是构建后文件的静态入口闭包字节，不含动态路由与功能 chunk，也不把 gzip/brotli 比例作为推算依据。

| 入口内容 | 旧版字节 | 最终字节 | 减少 |
| --- | ---: | ---: | ---: |
| JavaScript | 1,211,276 | 1,034,220 | 177,056（14.62%） |
| CSS | 433,314 | 320,742 | 112,572（25.98%） |
| 合计 | 1,644,590 | 1,354,962 | 289,628（17.61%） |

最终静态闭包为 124 份 JS 与 1 份 CSS，共 125 份资源；旧版为 124 份资源，因此这里没有“请求数下降”的结论。Browser、Reader、播放器和大型翻译引擎仍保持动态边界。`linkedom` 约 188,911 字节仍在入口，用于维持原同步解析与隐私语义；没有用异步接口或行为不同的解析器替换它。

### 未采用的实验

**静态入口合并。** 将 124 份静态 JS 合并为 3 份时，入口 JS 增加到 1,044,609 字节。第一次完整 grouped 区块 TTFD median 为 2025.44 ms，看似快于当时 split 的 2264.39 ms；但 grouped 重复区块只得到 11/12 个原始样本，已经按失败归档，不能作为有效对照；诊断值也未重现首次收益。HTML→main 的共同阶段没有形成稳定改善，因此保留默认分包。早期人工冻结 Web 目录还发现两个无用旧 bundle；本轮最终 APK 与下面的 canonical A/B 均已采用精确文件清单，早期结果不作为最终包体积或严密配对的依据。

**提前 visual-state 请求（early-fence）。** 首个 RAF 提前请求视觉状态，第二个 RAF 才确认业务就绪；实验保留真实 draw 后才上报，并补齐取消、暂停、StrictMode 与跨文档边界。正确性回归通过后仍必须满足性能保留条件。

| 指标 | canonical A | early-fence B |
| --- | ---: | ---: |
| 有效样本 | 12 | 12 |
| TTID median / p90 | 1915.64 / 2039.68 ms | 1836.45 / 2069.23 ms |
| TTFD median / p90 | 2339.32 / 2568.58 ms | 2357.66 / 2706.44 ms |
| 启动至 report 后 500 ms 的 `postAndWait` 总量 median | 261.68 ms | 329.07 ms |
| 同窗口 `drawGl` 总量 median | 466.23 ms | 539.67 ms |

两类等待发生在不同线程并有重叠，不能相加。两组 report 后 500 ms 均有 12/12 完整覆盖，均未发现该窗口内 ≥100 ms 的上述单次等待；本次没有“大等待被搬到 report 后”的证据。拒绝 B 的理由是完整启动和整体绘制等待均没有改善，新增复杂度缺少收益支撑，不宣称已证明统计显著回归。

对应证据为 `early-fence-ab-target-comparison.json`、两组 `early-fence-*-none-draw-diagnostics/`、`early-fence-controlled-artifacts.json` 与 `early-fence-rejected.json`。canonical A APK hash 为 `f3490f4bb6c68c2ac34a211cf00156ee77c08fc163540cc4cacae779504d805d`，B 为 `e95310e85f3684dc147fc505117caacb044eb9027a21f3f827a60018896b4e49`；该对照使用重采 Profile 前的同一份 4018 条源规则，最终 APK 已更新为下面的新规则。

### 新 Profile 与编译链结果

本次采集在 2026-10-21 13:49 UTC 完成，JUnit `OK (1 test)`，执行时间 98.511 s。设备实际输出位于本次专用目录 `cold-start-20261021-profile-final/`，时间戳副本为 `BaselineProfileGenerator_startup-startup-prof-2026-10-21-13-49-16.txt`；它与无时间戳副本逐字节相同。

源规则由 4018 条更新为 4055 条；两份源码均为 339,422 字节，SHA-256 为 `d1a62cb86024bd87afd7ba1a99bc702b292abdaeffcdf99e2e19d42fabfcf1f0`。本次唯一 CUJ 为启动，因此同一份采集结果写入 baseline 与 startup，未手工删改 H/S/P 标志。旧规则、实际采集文件与更新记录分别保存在 `profile-before-final/`、`profile-final-output/`、`profile-final-source-update.json`。

Cloud Release、Local Release 和 Cloud Benchmark Release 的检查全部通过：

- fresh 源规则进入各自 merged startup / merged ART 输入。
- R8 收缩、混淆、代码优化和访问范围优化为 true，资源联合优化为 true。
- 启动 DEX 布局与 Profile 优化为 true，均有标记为 startup 的 DEX，实际 DEX hash 匹配 metadata。
- R8 `noOptimizationPercentage` 为 cloud / benchmark 16.61、local 12.63，已摆脱旧全局 `-dontoptimize` 的 100；该统计不是耗时占比，不为追求零值而删除必要保留规则。
- cloud/local 正式 DEX 不含 benchmark 完成标记；benchmark DEX 包含它。
- 最终 benchmark APK 的 DEX 与 Profile 匹配本次中间产物；`baseline.prof` 为 4,053 字节，`baseline.profm` 为 177 字节。
- APK Web 清单为 254 份当前 dist 文件加两个空 Capacitor 兼容文件，共 256 份，无实验旧 bundle 残留。

Cloud/local 正式变体验证范围是 R8/ART 编译链；本轮实际构建、安装和计时的是隔离 benchmark APK，没有新签署正式 APK，也未修改发布签名要求。

### 当前瓶颈与结论边界

Perfetto 中反复出现的长段位于 WebView 原生绘制链：主线程 `postAndWait` 等待，与 RenderThread 的 `WebViewFunctor::drawGl` 重叠。一个慢样本中 visual callback→report 约 513 ms，`postAndWait` 约 503.71 ms，而 `reportFullyDrawn()` 调用自身约 0.109 ms；主线程主要处于睡眠等待。旧路径的 trace 也出现过同类长等待，不能据此认定新增 invalidate 独自造成成本，更不能仅凭函数名断定是 GPU fence、驱动或 WebView renderer 的哪一个内部原因。

最终两组 native 日志均有 12 次完整启动；None 的 2 次、Partial 的 3 次无完整 Activity/报告的准备 attach 已排除。以下为当前最终 APK 的逐次 native 里程碑差值，各阶段 n=12，单位为 ms，列出 median / nearest-rank p90：

| 阶段 | 最终 None | 最终 Partial |
| --- | ---: | ---: |
| Activity 开始 → bridge load 开始 | 430.5 / 546 | 418.0 / 553 |
| bridge load 开始 → 完成 | 37.5 / 47 | 35.0 / 46 |
| bridge onCreate 完成 → HTML head | 503.5 / 589 | 476.5 / 617 |
| HTML head → main module ready | 190.0 / 210 | 191.5 / 224 |
| JS first-ui-frame → visual callback | 165.5 / 459 | 189.5 / 475 |
| visual callback → 最终报告 | 111.0 / 502 | 85.0 / 439 |
| JS first-ui-frame → 最终报告，逐次直接计算 | 479.5 / 563 | 424.0 / 554 |

记录见 `final-native-phase-summary.json` 与两组 `-native.log`。以上使用 native elapsedRealtime 里程碑，起点不同于 AM 的 TTID/TTFD，不能拼成系统总启动时间；各列 median 也不能相加。最后一行由每次启动直接作差后再汇总。局部阶段变短不等于总 TTFD 变短，仍以主表原始计时为准。历史慢样本的 513 ms 也不是最终区块的中位数。

所有原始 trace 在当前项目环境中分析，只输出目标应用相关的聚合。Perfetto v58.2 重新计算的 TTFD 与 AndroidX 保存值有差异，因此主表始终使用原始 Macrobenchmark JSON，trace 仅用于归因。原生阶段差值或 callback 提前都不能替代完整启动收益。

已验证的应用侧工作削减与构建修复全部保留，不能证明收益的额外复杂度已撤回。这里没有“达到所有设备上的理论极限”的证据：Android 14 模拟器、Chrome WebView 124、空缓存回访首页的结论不能外推到物理设备、大缓存、初装、深链耗时或 local arm64 JNI。真实 Reader/Browser 回归验证的是正确性，不代表这些场景的冷启动性能已计时。

Baseline Profiles 优化应用 ART 代码，Startup Profiles 改善应用 DEX 布局；它们不会消除 WebView provider、渲染进程、HTML/CSS 与 JavaScript 的工作。当前 provider 未提供的 warmup 诊断值保留为 null，不能解释成零耗时。进一步判断剩余瓶颈，必须使用目标物理设备与对应 WebView 的实测，不继续叠加缺少证据的启动技巧。
