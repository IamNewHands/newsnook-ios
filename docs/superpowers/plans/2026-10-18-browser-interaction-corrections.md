# Browser Interaction Corrections Implementation Plan

> **For agentic workers:** Use the assigned independent file scopes; the root agent integrates native host/session changes and runs shared Android gates. Steps use checkbox syntax.

**Goal:** 修复用户六项浏览器反馈，完成可验证的同会话隐私策略、脚本刷新、主图加载和桌面/搜索设置体验。

**Architecture:** 保留现有 React 工作区与 Native BrowserHost。隐私由配置和导航记录许可共同约束；脚本运行状态由实际启动消息返回；桌面策略统一管理 UA、Client Hints 和视口。移除旧私有进程入口，保留专有目录升级清理。

**Tech Stack:** React 19 / TypeScript / Capacitor 8 / Android WebView / AndroidX WebKit 1.17.1.

**Spec:** `docs/superpowers/specs/2026-10-18-browser-interaction-corrections-design.md`

## Global Constraints

- 无新增生产依赖；Android minSdk 24。
- 中文界面，复用主题，至少 44px 触控目标。
- 用户主工作树与已有 debug 包数据保持完整，设备验收用独立审计包。
- 只更新功能分支与现有草稿 PR，交付 Actions 调试包。
- 不弱化既有回归；旧私有进程专属用例改为新语义与升级清理用例。

## Review Focus

- 模式切换与晚到页面完成事件：私密导航不能在关闭隐私后补写历史。
- 多次脚本更新后马上刷新：只安装最新快照，新文档启动数不能混入旧页面。
- 缩略队列饱和与快速图片翻页：当前主图优先，可见错误可重试。
- 桌面开启后重启、再关闭：恢复 Android/iOS/自定义的原标识与手机视口。
- 搜索框为空、带文字、选中服务后提交：点击选择无导航，提交才生成搜索地址。

## Task 1: Persistent privacy

**Files:** BrowserWorkspace/browserPrivacy/main/logger；独立旧私有进程类与 Manifest；root 集成 BrowserHost/useBrowserSession。

**Interfaces:** `BrowserPreferences.privateMode: boolean=false`；`BrowserHostPlugin.isPrivacyModeEnabled(Context)`；navigation 事件 `recordHistory:boolean`。

- [x] RED：工作区切换后不得调用 openPrivate，保持 tab，持久开关；旧实现实际调用 1 次而失败。
- [x] 新策略阻止自动记录，保留明确保存动作；旧进程清理只含旧专有目录。
- [x] GREEN：开关/重新进入/晚事件/书签/旧目录边界；设备重启后仍生效，关闭后不回填。

## Task 2: Script refresh and execution count

**Files:** useBrowserSession/BrowserHostPlugin/UserscriptRuntime/newsnook-userscript-runtime.js；ScriptManager/Workspace；相关 scripts 与 native 测试。

**Interfaces:** BrowserState 包含 `activeScriptCount`、`matchedScriptCount`；运行时受验证的 started 消息按文档与 script id 去重。管理页的匹配数按当前网址和最新启用配置计算，实际运行数保持原生文档事实。

- [x] 设备 RED：页面打开时安装脚本，刷新没有 port/marker；回主页重进有；同 URL loadUrl 运行更新版本。
- [x] 更新快照比较、变更后刷新新文档、实际启动计数；保留普通 reload。
- [x] GREEN：最新启用快照先于刷新、同步失败不导航、旧准备版本重试、旧文档事件隔离；设备完成安装/停用/编辑后刷新。
- [x] 匹配数字 RED/GREEN：新增脚本安装确认后尚未刷新，匹配立即增加，实际运行数不提前增加；停用立即减少匹配数。

## Task 3: Image queue

**Files:** browserImages/BrowserImagesPanel/ImageLightbox 及图片测试。

- [x] RED：32 项缩略排队时打开已加载缩略图，主图未派发且永远 loading。
- [x] 主图优先，释放不可见请求，拒绝有可重试错误。
- [x] GREEN：真实 DOM 加载、饱和队列、快速切换、取消与重开；8 图设备 fixture 与网易 71 图页面完成主图翻页验证。

## Task 4: Search, UA and settings

**Files:** browserPreferences/SearchPanel/SettingsPanel/SearchCatalog/browser.css；root 集成 Host 与 document-start 桌面视口模块。

**Interfaces:** userAgentMode 增加 android/ios；`lastNonDesktopUserAgentMode` 持久化；`toggleBrowserDesktopMode(preferences)` 统一切换。

- [x] 桌面视口 RED/GREEN：980px 策略覆盖 device-width 与动态修改，退出恢复。
- [x] 前端选择流程、设置分组、原生 UA/CH 和桌面视口。
- [x] GREEN：空输入/文字输入只切换、明确提交才导航；UA 来回切换与现有设置回归。
- [x] 设备确认桌面 980px / Linux / mobile=false；恢复 iOS 与 Android 后均为 426px 手机视口。

## Task 5: Delivery

- [x] 定向测试、TypeScript/lint、完整浏览器与图片/脚本回归；Cloud 179 项单元测试和打包、Local Java 编译。
- [x] 独立设备包实际交互；83 个界面状态与 12 个视觉修复状态，独立代码/视觉 review。
- [ ] 最终审计 APK 安装检查、验证报告、功能分支提交与 PR80 更新、Actions 新提交调试 APK 校验。此项交付结果随 PR 更新，避免将尚未完成的 CI 写成已通过。
