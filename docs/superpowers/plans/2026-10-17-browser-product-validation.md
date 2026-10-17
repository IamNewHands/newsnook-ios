# NewsNook 浏览器产品与稳定性验收

## 结果

本轮已完成浏览器完整流程优化、原生异常退出修复、独立代码审查、自动化回归以及 Android 模拟器安装验收。最终审查没有未解决的 Critical 或 Important，审查中发现的同网址媒体刷新问题也已修复。

工作分支：`feat/browser-unified-ux-20261017`。基于 `ddb3099` 继续；不改应用版本、不新增生产依赖。预存的 `android/capacitor.settings.gradle` 环境路径改动不纳入提交。

## 产品流程

| 范围 | 完成内容 |
| --- | --- |
| 工具栏与首页 | 单条工具栏整体置顶或置底；主页、地址、加载/停止、标签与菜单；快捷访问添加、编辑、排序、删除；最近访问和网站隐藏/恢复。 |
| 搜索 | 独立搜索层、当前网址复制、分类引擎与建议；覆盖期间隐藏原生网页；取消保留原页，迟到操作不关闭新面板或丢失新输入。 |
| 历史、书签、标签、设置 | 统一子页、搜索、空状态与确认；保存真实网页标题；最多六个标签，独立切换和关闭；搜索引擎、地址位置、桌面模式有一致反馈。 |
| 数据可靠性 | 校验持久化数据形状和网址；写入成功后更新界面；失败保留输入并提示原因；保留现有 v1 存储契约。 |
| 用户脚本 | 网址/文件/源代码导入、权限确认、同身份更新、启停和删除；保存后同步原生快照，下一次导航生效；超时/取消/失败可恢复；已安装的大脚本仍可编辑。 |
| 媒体 | 按标签隔离，播放交接保留源页、请求头与关联 URL；本地合成 DASH 可播放；显式扫描在网页被面板遮挡时仍工作；完整导航清除旧文档资源。 |
| 播放器 | 修复 flex 收缩为 2px 的容器；保留可用播放、快退/快进、倍速、旋转和全屏，移除五个无实现的占位入口；浏览器不重复显示资源 FAB。 |
| 操作边界 | 返回/Escape 按层关闭；首次等待脚本时返回可立即取消；键盘焦点限制于当前工作区、搜索、子页、确认、资源、投屏或全屏层；悬浮分离后释放旧浏览器容器。 |
| 样式兼容 | 修复 Buer 主题误填充图标和选中背景混淆；保留减少动效与墨水屏规则；脚本窗口用独立 `@supports` 保留旧 WebView 的 vh 和基础间距回退。 |

## 异常退出证据与修复

1. 历史 `/tmp/nn-crash.log` 记录 `BrowserHostPlugin.onProgressChanged` 访问不存在的进度 TextView 导致空指针。保留基线已有判空，新增嵌入模式和失效视图回调回归。
2. 原 renderer 恢复可能删除最后一个标签或切到共享失效 renderer 的相邻页。本轮保留错误标签元数据，销毁失效视图，用户重试时重新创建；旧实例回调不能污染新会话。
3. **2026-10-17 09:15:53**，双标签 `Page.crash` 触发主壳重建；**09:15:55**，旧 Network 系统回调调用已清空的监听器，产生 `ConnectivityThread` 未捕获 NPE，PID 8656 退出。依赖源码表明注销只在 pause，destroy 只清空监听器，直接 Bridge 销毁会留下回调。
4. 新增应用内 `NewsNookNetworkPlugin`，保留原 Network API；pause/destroy 都注销，先使回调身份失效，主线程派发后再检查存活状态。即使未先收到 pause，destroy 也完整清理；不修改共享 node_modules。
5. 主壳恢复前获取一次性内存标签快照。恢复只还原 URL、标题、桌面模式和活动索引，不创建网页 WebView、不重新提交请求；界面提示“网页进程已恢复，请重新加载此页”。快照不写磁盘，消费后不在普通打开中重放。

## 自动化验证

| 验证 | 最终结果 |
| --- | --- |
| Android `:app:testCloudDebugUnitTest` | **27 类、128 项，0 失败、0 错误、0 跳过**。包括 Network 6 项、renderer/主壳、恢复快照、脚本、媒体、关闭与迟到回调。 |
| 浏览器与 WebView 兼容合集 | **11/11 入口退出码 0**；浏览器 9 个、兼容 2 个。Workspace 文件内部的三轮完整流程与恢复段通过。 |
| 硬件返回专项 | deferred 首开先红后绿；验证立即 close、一次退出、迟到 open 不复活。 |
| 真实 Chromium | 工作区、搜索、四类子页、确认、资源/投屏/全屏的 Tab、Shift+Tab、Escape；默认及浏览器 owner portal、悬浮分离；明暗主题计算样式。 |
| 共享播放器 | `floating-video-session.test.ts`、`floating-video-lifecycle.test.tsx`、`ink-video-lifecycle.test.tsx` 通过。 |
| 静态与构建 | TypeScript、修改文件 oxlint、`git diff --check`、完整 `npm run build`、Capacitor copy、`assembleCloudDebug` 全部通过。 |
| 最终 CSS 产物 | 确认 `93vh` 与基础 padding 留在无条件规则中，`93dvh` 和 `max()` 分别在 `@supports` 内；避免构建优化合并回退。 |

Native 新 Network 测试先出现四项预期失败；恢复行为先出现三项预期失败；媒体扫描/reset 先出现两项预期失败。对应修复后完整套件均通过。

前端合集及补充验证：`evidence/browser-product-20261017/frontend-final-results.json`、`frontend-final-logs/`。播放器 owner 最终日志：`D:/tmp/nn-browser-player-owner-final.log`。原生完整日志：`/tmp/nn-browser-media-flow-all-green.log`。

## 最终安装包设备验收

设备为 `emulator-5554`，Android 17 模拟器，调试包 `com.aizeek.newsnook.debug`。安装前备份私有数据，增量覆盖安装，未卸载或清空应用。使用本机受控网页验证两个标签、真实 MP4、DOM 媒体和脚本。

### 三轮主动故障注入

最终安装包三轮结果如下，每轮恢复后继续观察 5 秒。每次注入前等待受控网页实际完成加载；排除早期测试工具采样到 about:blank 或前一手动请求仍在途的尝试。

| UTC 时间 | 注入目标 | 应用 PID 前/后 | 标签前/后 | 页面请求数前/后 | 数据 |
| --- | --- | --- | --- | --- | --- |
| 09:47:50 | 网页 renderer | 12109 / 12109 | 2 / 2 | 9 / 9 | 历史、书签、快捷方式、搜索/布局、脚本一致 |
| 09:48:14 | 主界面 renderer | 12109 / 12109 | 2 / 2 | 10 / 10 | 一致 |
| 09:48:39 | 网页 renderer | 12109 / 12109 | 2 / 2 | 11 / 11 | 一致 |

三次均重建主壳并回到浏览器错误占位，用户重新加载可以继续访问。最终安装日志中 **`FATAL EXCEPTION` 为 0**，Network 适配器初始化共 4 次（初次启动加三次恢复）。注入本身产生的 Chromium renderer crash 日志属于预期。

原始结果：`crash-page-final-1-result.json`、`crash-main-final-2-result.json`、`crash-page-final-3-result.json` 和 `device-final-crash-log.txt`，均在上述 evidence 目录。

### 操作与显示

- 媒体面板打开时，在受控网页追加一个未预加载的视频元素：面板资源数保持 **1**；点“重新扫描”变为 **2**，面板仍保持覆盖；刷新同网址后旧元素消失，资源数回到 **1**。
- 实际 MP4 播放到 **6 秒**，`readyState=4`；320px 视口视频为 **318 × 178.875px**，全屏按钮边界 **259–299px**；无重复资源 FAB、无无实现占位控件。
- 横屏全屏为 **710 × 320px**，退出全屏与 Android 硬件返回正常；悬浮播放和“恢复到此处”正常。
- 源代码安装与同身份更新经权限确认成功；GM 函数可用；安装/更新在刷新后执行，停用后刷新不再执行。HTTP 脚本网址导入按现有 HTTPS 要求拒绝。测试脚本的带端口范围使用 `@include`，不把无效 `@match` 当成注入故障。
- 单条工具栏顶部/底部布局、原生网页覆盖与恢复、标签、书签、菜单、320px 首页和搜索均已操作。320px 搜索页面没有横向溢出。
- 真实 Chromium 完成明暗主题和键盘回归；模拟器检查了内容主题与系统输入法浮动栏。未把浮动输入栏宣称为完整停靠键盘的覆盖，也未宣称验证全部 Android/WebView 版本或实际电视投屏设备。

截图包含 `browser-home-final.png`、`browser-search-320-final.png`、`browser-settings-320-final.png`、`browser-settings-dark-final.png`、`browser-recovery-final.png`、`browser-manual-scan-final.png`、`browser-player-final.png`、`browser-fullscreen-final.png`。临时 DOM 深色主题截图用于内容样式检查，不代表原生系统栏的主题切换验收。

## 数据与环境恢复

验收后恢复原始浏览器/脚本持久化数据，重启并逐键比较：**原始 7 个键与当前 7 个键完全相同**。分辨率恢复到物理 **1280 × 2856**，取消测试 override；`show_ime_with_hard_keyboard` 恢复为 **0**，`user_rotation` 为 **0**；临时内容主题恢复。最后一次手动重启用于数据恢复，不属于崩溃。

最终 APK：`android/app/build/outputs/apk/cloud/debug/app-cloud-debug.apk`。构建与验收证据位于隔离工作区，私有数据备份不进入 Git 提交。
