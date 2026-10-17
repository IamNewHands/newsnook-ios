# Browser Privacy and Images Implementation Plan

**Goal:** 完成浏览器隐私会话、常用设置、独立看图与统一交互。
**Architecture:** 原生隔离会话承载相同 BrowserWorkspace；原生设置与图片捕获有显式契约；React 会话 hook 处理生命周期，面板只管理显示与交互。
**Tech Stack:** React 19、TypeScript、Capacitor 8、Android System WebView、AndroidX WebKit 1.17.1。
**Spec:** ../specs/2026-10-17-browser-privacy-images-design.md

## 全局约束

从 6a9ab5f 建立 feat/browser-privacy-images-20261017；无新生产依赖；不更换内核、不改版本。所有用户数据修改受隐私边界约束。使用现有主题、控件与测试习惯。

## 审查重点

- 主壳/网页 renderer 崩溃、进程异常终止后不能恢复或残留私密地址。
- 迟到导航、扫描、图片请求和关闭不能复活已退出会话或覆盖新文档。
- 原生与React设置保存失败不分裂，UA切换正确恢复，首页和新建标签同样应用设置。
- 网易防盗链、srcset/lazy/background、blob/data及大量图片受预算保护。
- 320px、明暗/自定义主题、安全区、键盘、返回键和深层确认不遮挡网页或逃逸焦点。

## 工作项

- [x] 拉取远端确认最新功能分支，建立独立工作区，读取现有架构与第三方参考。
- [x] 基线 browser-workspace 测试 3 轮通过（Windows Node 26.8.2）。
- [x] 原生：独立 private 进程/目录与清理、GM 内存、真实上下文、UA/settings/find/site-data、图片 Host 接线。
- [x] 图片：BrowserImageCapture、扫描 asset、browserImages 模型、BrowserImagesPanel 与现有灯箱扩展、针对性测试。
- [x] UI：BrowserPreferences 归一化与持久化、设置与共享页面细节、隐私呈现、针对性测试。
- [x] 主集成：PrivateBrowserRoot 入口、useBrowserSession 协议和代次取消、BrowserWorkspace 菜单/查找/分享/图片/隐私边界。
- [x] 红绿验证隐私历史零写、原生隐私隔离、设置和图片关键行为。
- [x] 已完成一轮正式前端入口、类型/lint、原生单元测试和隔离 Debug 构建；最终原生批次 160 tests / 0 failures / 0 errors / 0 skipped，站点清理套件为 14 项（9 项生命周期 + 5 项应用壳保护）。
- [x] 完成 44 个明暗/宽度视觉状态，以及 3 个非零安全区状态；修复选中卡片、字体、窄屏尺寸、私密标识、确认时序及安全区问题。
- [x] Android 17 模拟器验证私密正常关闭、强制停止后再次启动清理、普通数据保持，以及网易 72/67 图片、320×240 WebP 和 2/67 灯箱切图。
- [x] 独立审查与实际问题修正；保存中文验收记录 `../reports/2026-10-17-browser-product-validation.md`。
- [x] 补充浏览器灯箱的系统栏主题作用域和主图加载前调整禁用；目标红绿测试及前端构建通过。
- [x] 针对最终灯箱补丁和站点清理壳保护重新完成正式入口、修改范围 lint 与完整原生门禁：12:44 前端入口通过，31 个 JS/TS 文件零警告，全仓原生 160 项通过；隔离 APK 构建通过。
- [x] 最终隔离调试包查看器设备复验：light 主题保持，进入白色状态栏图标、退出恢复黑色；2/68、330×248 主图、调整面板与关闭后 12 个可见缩略图恢复。切图 click 后未等 React 提交的瞬时 disabled 读数不作为成败依据。
- [x] 最终包真实多标签站点清理通过：127.0.0.1 的 A/B 旧实例退役，B 重载请求无旧 Cookie、localStorage/IndexedDB prior 为 null；localhost 的 C 保持，A 重新激活为新实例。证据为 device-site-clear.json。
- [ ] 合并前待办：Android 宿主下的 DOM / 可访问性树对照诊断与私密分享 chooser 完整设备验收。三轮主要尝试均未完成，最新 13:15 轮真实点击分享后等待确认超时，两 PID 均存活；桌面独立组件真实触控通过不记作 Android 设备通过。
- [x] 归档 Android 17 x86_64 / 16KB / WebView 150 主进程 onTrimMemory SIGILL 的当前分支与准确 6a9ab5f 基线对照：当前 ordinary-only 在 BACKGROUND、基线在 COMPLETE 复现相同顶部 PC/BuildId；私密新增不是必要条件，根因仍未定位、未修复。
- [x] 完成最终分支、差异、证据与交付材料核对；交付判断为 Draft，明确 chooser 未完成、基线崩溃未定因及旧设备覆盖受限。
- [x] 代码随此实施计划提交至独立功能分支。

## 接口与分工

- root：main.tsx、PrivateBrowserRoot、browserPrivacy、useBrowserSession、BrowserWorkspace、BrowserFindBar、workspace测试和集成验证。
- privacy_research：BrowserHostPlugin、UserscriptRuntime、MainActivity、私密进程/生命周期类、manifest、原生测试。
- browser_images：图片helper/asset/模型/面板、ImageLightbox向后兼容扩展和图片测试。
- browser_ui：browserPreferences、Settings/Start/Search/Tabs/Places/Primitives、browser.css和对应测试。

## 过程记录

- 2026-10-17：原工作区存在生成的 capacitor.settings.gradle 路径改动，不迁移、不覆盖。
- 2026-10-17：WSL Node 无法使用现有 Windows esbuild，改用已安装 Windows Node 26.8.2；不修改共享node_modules。
- 2026-10-17：系统WebView无纯内存 profile，使用独立进程/目录及清理边界，明确不承诺物理零写入。
- 2026-10-17：12:36 原生批次为 155 项；补充壳站点保护后，12:44 完整原生批次为 160 项，全通过。正式前端和 31 文件修改范围 lint 于 12:44:28.521–12:44:35.121 UTC 全通过。
- 2026-10-17：最终设备包 SHA-256 为 b54ee814b45790bb0d968b47f9aab63c853cfb97f318ae176a95588df702d939。主集成已审查 device-viewer-final/close JSON 与 PNG，并于 12:49:51–12:49:56 UTC 完成多标签站点清理通过轮；私密分享完整设备验收未完成，按 Draft 交付保留为合并前待办。
- 2026-10-17：强制停止私密会话的首次 CDP 取证遇到 execution context destroyed，原始输出和重试事实保留；重试后的目录清理、普通数据与私密网址检查通过。
- 2026-10-17：实际运行环境为 Android 17 x86_64 / 16KB / WebView 150 模拟器。API 28 AVD 系统镜像缺失，未能启动；本轮没有实体机或 API 28 运行验收。主进程 onTrimMemory SIGILL 根因尚未定位，未声称修复。12:43:56 UTC 起普通进程在 privatePid 为空时接受内存回调，RUNNING_LOW/CRITICAL 存活、BACKGROUND 触发 SIGILL；证据为 device-ordinary-trim.json 与 device-ordinary-trim-crash.log。
- 2026-10-17：准确基线 6a9ab5f 包 SHA-256 为 fc40c82acc97d7040374a6b2bb210a8249f333d2ca1d1503e962f6b41cfe5097；同环境 baselineaudit PID26359 / UID10241 在 RUNNING_LOW/CRITICAL/BACKGROUND 后存活，COMPLETE 时于 13:10:25.890 触发 SIGILL/code2，顶部 PC0x7827733/0x7828673 与 BuildId68328f9a49348833c7ebe4e41849dca6c2462e4f 相同。仅确认相同崩溃签名在基线也存在，不声称触发级别或全部栈帧一致。
- 2026-10-17：基线崩溃归因使用后来补取 device-baseline-trim-crash.log 中真实 PID26359 的段落；device-baseline-trim.json 的 crashLog 混入旧 PID25866，不作为归因证据。私密分享 chooser 仍未完成设备验收。
- 2026-10-17：私密分享 slow UI 轮（13:11:08.181–13:12:23.244，普通 26762 / 私密 27057）已到 8 项看图与大图操作，等“继续分享”超时，收尾普通 PID 已空。首页 readiness 轮（13:13:43.650–13:14:14.980，普通 27722 / 私密 28044）等待 8 秒超时，后续 uiAtFailure 已有首页控件；该轮现保存在 device-private-share-home-readiness-attempt.json，尚未到 chooser。两份更早的启动/输入驱动失败另行保留。
- 2026-10-17：device-private-share.json 为 13:15:49.819–13:16:57.682 的第三轮；首页等待延长至 22 秒后约 15 秒观察到控件，继续完成 fixture、8 项看图、大图与菜单，13:16:42.548 真实点击 enabled 的“分享”，等待“继续分享”超时。失败时普通 28269 / 私密 28706 均存活，不能直接归于 owner 消失或既有 SIGILL；未完成 chooser 验收。
- 2026-10-17：13:21:00.429–13:21:03.871 的桌面单场景使用 Input.dispatchTouchEvent 完成图片、菜单和分享，确认框出现并获得焦点，可访问性树“继续分享”未被忽略。证据为 browser-private-share-touch.json 与 before/after PNG；该 fixture 仅含图片面板/灯箱，不含 Workspace/FullPage 额外对话框和 Android 宿主，不替代设备通过。原 44 状态矩阵用 focus() + DOM click()，私密导出覆盖保存确认与取消，不覆盖系统 chooser。
- 2026-10-17：更早失败尝试的会话关闭与目录清理已完成，不另计功能通过。实现、自动化、其他设备验收与交付整理完成，以 Draft 交付；Android DOM / 可访问性树诊断及 chooser 完整验收保留为合并前待办。本计划不声明推送或远端 CI 通过。
