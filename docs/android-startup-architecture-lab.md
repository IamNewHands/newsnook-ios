# NewsNook Android 启动架构对照与收敛

本轮在既有 beta 工作区继续实施，起点为 `f88f9dfa` 加 10 月 21 日已存在的全部未提交改动。实验、失败记录、源码快照、原始 JSON、日志和 Perfetto 保存在 `node_modules/.cache/newsnook/startup-lab-20261022/`。

## 结论与边界

本轮完成原生列表、纯 WebView、最小 Capacitor、完整 NewsNook 四层对照，并在 WebView 124 和 149 两个环境检验预热假设。保留的生产修改只有消除重复请求和纠正系统计时帧归属；没有把少一次请求、字节减少或较早的计时信号换算为未经测量的毫秒收益。

原生、纯 WebView、最小 Capacitor 使用相同的 20 条离线文章数据和打开操作，但原生与 HTML 的排版实现不完全相同。完整 NewsNook 保留真实功能与本地状态，不是同等功能的最小壳。因此这些结果用于归因和排除路线，不是数学下界，也不能把两行之差全部算成可删除的代码成本。

当前没有连接物理手机。WebView 149 来自只读启动的 API 37.1 Android Studio AVD；旧环境是 Android 14 的 LDPlayer/WebView 124。系统版本、图形后端和虚拟硬件均不同，不能将两个环境的耗时相减称为 WebView 升级收益。原 LDPlayer 的 provider 和用户数据没有改动；新 AVD 不加载或保存快照，结束后关闭。

## 1. 先修正系统计时帧归属

10 月 21 日的实现是在 visual-state callback 后等待 OnDraw，再从下一次主线程任务中调用 `reportFullyDrawn()`。对交互较少的页面，这可能错过刚刚完成的内容帧。

真实 Perfetto 证据：旧纯 WebView 对照的一次样本在约 1115.28 ms 调用了 `reportFullyDrawn()`，之前的 doFrame 已在约 1115.23 ms 结束；AndroidX 最后选择了 2220.30 ms 完成的后续交互帧。这与原始 JSON 的 TTFD 一致。相关 SQL/CSV 为 `pilot-webview-none-iter003-frame-query.*`，使用的确切 AndroidX 1.5.0 源码保存在 `upstream/StartupTimingQuery.kt`。

当前顺序为：业务内容就绪 → 文档提交 → visual-state callback → 可见且有效尺寸的 OnDraw 内调用 OS 上报 → 绘制后的任务发布外部就绪标记。OS 上报一次，业务标记仍受暂停、导航、销毁和 renderer generation 保护。不能在超时、占位或 visual callback 本身发布业务就绪。

新增回归先失败（11 项中 1 项失败），修改后 11/11 通过。原始预实验中的旧口径 TTFD 全部保留，不用于与修正后的结果计算提速比例。

依据：
- Android 官方 StartupTimingMetric 定义：<https://developer.android.com/topic/performance/views/benchmarking/macrobenchmark-metrics-views>。TTFD 停止于包含或跟随 reportFullyDrawn 的帧完成。
- WebView VisualStateCallback：<https://developer.android.com/reference/android/webkit/WebView.VisualStateCallback>。回调表示相应内容可供后续绘制，而非已经显示。

## 2. 消除首次加载的重复 HTTP 派发

`useFeeds` 的 cache-miss 预取 effect 先启动请求，同一提交中 App 的首次主动刷新随后又启动相同请求，并取消第一条。真实 hook 测试在未修改代码时观测到同一个信源两次 fetch 派发。

修复只让自动预取延后一轮可取消的 microtask。App 在同一个 effect flush 中发起的主动刷新先获得执行权，既有 in-flight guard 随后抑制重复预取。没有增加固定时间等待，也没有延迟手动刷新。无人主动刷新的独立 hook 仍会正常预取缺失数据。

`scripts/feed-startup-fetch.test.tsx` 覆盖五个真实行为场景：首次主动刷新仅派发一次、独立预取并显示真实解析文章、卸载前取消、信源替换不派发旧请求、StrictMode 重放保留有效刷新。五项全部通过；既有预览、分页、缓存和预设切换回归也通过。无需增加新的清理状态机。

## 3. 独立测试壳与预热矩阵

`android/startuplab` 仅在 `-PnewsnookStartupLab=true` 时纳入 Gradle 工程，不是生产依赖。测试包名均位于 `com.aizeek.newsnook.startuplab.*`；完整应用只操作 `.benchmark`，不覆盖正式应用或用户原有 `.debug`。

测试壳分为 nativeui、webview、capacitor。WebView/Capacitor 各有 none、background、full 三种预热。background 使用 `setShouldRunUiThreadStartUpTasks(false)`，full 使用 true；都不等待回调，也不人为推迟实际 WebView 创建。每次测试等待真实绘制标记，然后实际点击 Open article 1 并核实 Article 1 opened。

最小 Capacitor 保留框架核心插件但没有 NewsNook 业务插件。纯 WebView 仅响应本地 https://localhost 入口，其余请求拒绝；页面 CSP 禁止外部网络依赖。数据、样式和操作不依赖新闻接口。

所有主表采用 AndroidX 原始 JSON。每组必须有正确 JUnit 成功、全部正数有限样本、声明与实际样本数一致，以及完整 trace 集合。n=6 的 p90 等于该组最大值，仅适合筛查，不宣称稳定分布。曾出现 JUnit 成功而原始样本少一项的情况，这些区块整组拒绝并保留。

### 实测结果（单位 ms）

以下均为完整区块；失败区块没有被补数。小样本矩阵用于筛查，完整应用的候选按反向重复检验。

**Android 14 / LDPlayer / Chrome WebView 124：**

| Case | n | TTID median | TTFD median | TTFD p90 |
| --- | ---: | ---: | ---: | ---: |
| Native / none (`aligned-nativeui-none`) | 6 | 280.19 | 280.19 | 374.13 |
| WebView / none (`aligned-webview-none`) | 6 | 911.82 | 1160.36 | 2344.33 |
| Capacitor / none (`aligned-capacitor-none-retry`) | 6 | 924.51 | 1251.91 | 2322.38 |
| WebView / background (`aligned-webview-background`) | 6 | 1056.78 | 1335.39 | 2410.83 |
| Capacitor / background (`aligned-capacitor-background`) | 6 | 995.07 | 1508.48 | 1871.99 |
| WebView / full (`aligned-webview-full`) | 6 | 980.29 | 1810.13 | 2355.47 |
| Capacitor / full (`aligned-capacitor-full`) | 6 | 1042.82 | 1685.21 | 2162.35 |

**只读 API 37.1 AVD / WebView 149：**

| Case | n | TTID median | TTFD median | TTFD p90 |
| --- | ---: | ---: | ---: | ---: |
| Native / none (`modern-native`) | 6 | 440.55 | 440.55 | 712.17 |
| WebView / none (`modern-webview`) | 6 | 1109.87 | 1564.48 | 2027.22 |
| Capacitor / none A1 (`modern-cap-a1`) | 6 | 1202.47 | 1715.41 | 1890.15 |
| Capacitor / background B1 (`modern-cap-b1`) | 6 | 1244.96 | 1773.41 | 1995.14 |
| Capacitor / background B2 (`modern-cap-b2`) | 6 | 1187.70 | 1770.81 | 2216.14 |
| Capacitor / none A2 (`modern-cap-a2`) | 6 | 1116.40 | 1573.94 | 2164.78 |

**完整 NewsNook：只改变 Application 预热，A-B-B-A，每组 12 次：**

| Case | n | TTID median | TTFD median | TTFD p90 |
| --- | ---: | ---: | ---: | ---: |
| Original warmup A1 (`warmup-a1`) | 12 | 1859.02 | 2275.92 | 2616.44 |
| No warmup B1 (`warmup-b1`) | 12 | 1821.47 | 2085.18 | 2430.20 |
| No warmup B2 (`warmup-b2`) | 12 | 1874.36 | 2264.85 | 2705.38 |
| Original warmup A2 (`warmup-a2`) | 12 | 1844.58 | 2287.09 | 2594.07 |

**完整 NewsNook：只改变首次重复预取，每组 12 次，DEX 和非 Web 文件相同：**

| Case | n | TTID median | TTFD median | TTFD p90 |
| --- | ---: | ---: | ---: | ---: |
| Frame-aligned baseline A1 (`final-a1`) | 12 | 1856.51 | 2293.26 | 2878.73 |
| Deduplicated requests B1 (`final-b1`) | 12 | 1896.65 | 2181.51 | 2407.62 |
| Deduplicated requests B2 (`final-b2`) | 12 | 1796.55 | 2130.84 | 2568.03 |
| Frame-aligned baseline A2 (`final-a2`) | 12 | 1780.95 | 2027.45 | 2364.02 |

修复包 B1/B2 分别为 2181.51 / 2130.84 ms，但反向基线 A2 达到 2027.45 ms。基线自身从 2293.26 ms 漂移到 2027.45 ms，已大于早先观察到的改善，不能宣称稳定整体提速。重复请求减少是单独的行为证据，保留为避免无效网络/桥接工作，不将其包装成固定毫秒收益。

预热 B1 改善未在 B2 重现；149 的最小壳也没有显示背景预热优于无预热的稳定趋势。保留原生产策略，避免按一次或一个设备的结果全局修改初始化方式。

这轮主矩阵包括旧环境 42、新环境 36、预热对照 48、最终代码对照 48 个有效样本，合计 174 个；此外保留早期试验、完整应用参考区块、失败区块和最终产物复验，详见本机 `measurement-attempts.csv`。174 不包括旧计时口径的预实验，亦不是来自一个同质场景的统计总体。


## 4. 不采用的路线

**关闭生产预热：不采用。** 在完整应用上固定同一份 Web 资源、配置、源 Profile 和计时协议，只改变 Application 预热，按 A→B→B→A 各 12 次实测。首个 B 看似改善约 191 ms，第二个 B 未重现该幅度且 p90 变差。原 Application 已按 SHA-256 精确恢复。官方也指出，预热后过早调用 WebView API 会等待初始化赶上，不能自动获得性能收益：<https://developer.android.com/develop/ui/views/layout/webapps/optimize-webview-startup>。

**系统 provider 替换：未做。** 原模拟器由其他工作共享，不为实验修改其内核。149 的验证来自单独只读 AVD，而非将 124 原地升级。

**额外的“同 DEX 替换 HTML”诊断：未取得有效结果。** 首次实验页的箭头函数表达式替换产生了语法错误，未通过就绪验证；该 APK、日志和失败状态保留且不计入架构数据。后续重新构造工具调用被阻止，该方式停止，没有绕过限制。四层主对照使用正常 Gradle 构建的独立壳及完整应用，不依赖这个失败实验。

**原生首页/静态快照替换：未进入生产。** 原生列表对照不包含完整 NewsNook 的业务与数据一致性约束；其速度不能证明简单覆盖一张截图或放置无法立即操作的假首页可满足需求。本轮没有据此引入第二套生产首页、切换闪烁或双状态存储。

## 5. 验证与产物

- `final-web-checks-record.json`：重复请求、预览、站点分页、预设导航、Android 启动、预存、缓存、翻译、lint、TypeScript/Vite、Capacitor sync。
- `final-native-build.log`：cloud/local 原生回归、三种 R8/ART 编译产物和隔离 APK 构建。该轮 cloud 44 项、local 2 项，无失败或跳过。
- `feed-fix-artifact-control.json`：前端修复前后 APK 的全部 DEX 和非 Web 文件逐字节相同；对照不混入预热或原生代码修改。
- `no-warmup-artifact.json` / `no-warmup-decision.json`：单变量预热对照及精确恢复记录。
- `modern-avd.json` / `modern-avd-closed.json`：只读 AVD 启动参数、归属、配置 hash 和关闭记录。
- `final-artifact-verification.json`：最终 Profile 输入、R8 优化开关、DEX/hash、源规则消费、正式包 marker 隔离、APK 与 dist 精确匹配、测试壳不进入生产。

最终交付数据在下方追加；没有签署或发布正式版本，没有提交或推送 beta。最终 `.benchmark` APK 不是正式发布签名的升级包。

<!-- DELIVERY_RESULTS -->

## 6. 维护入口与原始实验归档

**这是历史架构实验报告，不是当前可直接执行的测试脚本清单。** 最终 beta 收尾已将一次性 `android/startuplab`、`scripts/android-startup-lab*.mjs` 及临时执行脚本移出 Git 工作区，保存在同级 Windows 归档目录 `D:\\TianFeng\\Code\\TianFeng\\newsnook-startup-archive-20261022`。完整原始记录仍保存在忽略的 `node_modules/.cache/newsnook/startup-lab-20261022/`。移除的是临时实验执行器，不是生产冷启动实现或原始测量结论。

当前仓库内可复现的正式回归入口：

```powershell
npm run test:android-startup
npm run lint
npm run android:sync
```

如需重新采集 Profile 或 Macrobenchmark，应使用保留的 `android/baselineprofile` 模块和 [测量文档](./android-startup-macrobenchmark.md)；不要运行已归档的 lab 命令。正式 Release 不启用 `android:shell="true"`，仅隔离的 `.benchmark` 与 Profile 生成变体允许 shell 性能采样。

普通 Release 构建无需连接设备。COLD 只代表冷进程，不代表清空数据或 ART 全冷；物理设备需要另外保存 provider、设备、APK hash、状态和重复对照，不能把模拟器数据当普遍极限。停止条件保持：只有实证减少的工作或可复现的收益才进入生产。
