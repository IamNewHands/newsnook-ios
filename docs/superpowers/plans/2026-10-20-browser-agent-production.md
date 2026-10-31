# Browser Agent 生产实现计划与完成记录

> 按模块分工并独立审查。基线为 beta 645f9736113660395e7392a1a119f22212f7b55d；本轮不提交、不推送。

**目标：** 补齐既有 Android Browser Agent 的执行、接管与文件闭环，并消除虚假成功和停止竞态。

**架构：** DOM/frame 观察与原生输入互补；单 run 控制原生执行权；UI 只消费真实步骤与接管状态。

**技术栈：** React 19、TypeScript、Capacitor 8、Android WebView、AndroidX WebKit 1.17.1。

**设计：** `docs/superpowers/specs/2026-10-20-browser-agent-production.md`

## 全局约束

- 固定 beta 基线；保留本地浏览器、主题、半窗与现有阅读业务。
- 不引入新的浏览器内核、全局状态库、路由库或必需服务器。
- 每个动作绑定 run/request/tab/document；跨 frame 保留独立引用。
- 用户密码/验证码由人工接管；文件只通过受控 artifact 与系统选择器。
- 未确认停止前不得释放 busy；不可把已执行但未观察到结果当可安全重试。

## 审查重点

- 停止时 native、model transport、React 三种迟到结果。
- 异步导航/换 tab 后旧 snapshot、旧上传 callback 与旧审批。
- iframe/Shadow DOM 遮挡、变换与注入不支持时的能力回退。
- 提交已发生但后续观察超时导致重复执行。
- 文件取消、超限、MIME 不匹配与文件选择器引发 Activity pause。

### 任务 1：DOM 观察与受约束操作

负责文件： `android/app/src/main/assets/browser-agent.js`, `scripts/browser-agent.test.mjs`, new DOM behavior tests.

产出接口： `__newsNookAgentExecute(args):object`；bootstrap ready/command/result/cancel_ack 协议；observe、prepare_click、validate_snapshot、type、choose、submit、scroll、key 动作。

- [x] 增加真实 DOM 测试：shadow、目标改文案、遮挡、禁用、清空输入、frame 消息与取消。
- [x] 将目标身份、输入取消和跨 frame 行为的失败路径固化为回归断言。
- [x] 实现树遍历、目标校验、输入/表单行为和 bridge bootstrap。
- [x] 跑新测试与既有 `node scripts/browser-agent.test.mjs`。

### 任务 2：原生会话、框架、输入与文件

负责文件： `BrowserHostPlugin.java`，新增原生 Agent 会话、输入、文件类；`android/app/src/test` 行为测试。

产出接口： `agentSession({action,runId})`；`agentAction({action,runId,requestId,tabId,documentId,...})`；原生文件事件与能力信息。

- [x] 编写 run 所有权、取消 barrier、手势时序、文件单次结算的行为测试。
- [x] 完成 frame 路由、可信输入、稳定 tabId 导航、文件选择与下载登记。
- [x] 运行相关 Robolectric 测试及 debug compile/build；环境失败记录具体阻断。

### 任务 3：任务运行时与模型协议

负责文件： `browserAgent.ts`, new `agentRuntime.ts`, ReAct/runtime tests, 必要 `BrowserWorkspace.tsx` 接线。

产出接口： `createBrowserAgentRuntime(options)`；`start/pause/resume/stop/performTool/waitUntilReady`，类型化 step、handoff、artifact 回调。

- [x] 增加停止等待、暂停恢复、frame id 映射、过期审批、结果未知不重放、稳定 tab 的测试。
- [x] 将工具执行从 React 闭包抽出，所有已启动 session 的原生动作带 run/request。
- [x] 扩展手势、文件、接管、按条件等待与按键工具；验证 schema 与参数。
- [x] 修复 transport abort listener 清理、响应验证、上下文边界与真实步骤事件。
- [x] 跑 `npm run test:browser-agent` 和 runtime 回归。

### 任务 4：产品 UI 与交互

负责文件： `BrowserAgentPanel.tsx`, `agent.css`，需要时独立 UI 状态组件和组件测试。

消费任务 3 的 runtime 接口。

- [x] 替换 activity 字符串为真实步骤状态，接入暂停/接管/继续/停止确认。
- [x] 接入上传、下载真实产物，保留输入、当前任务与历史回答。
- [x] 组件测试验证停止 ACK 前禁止新 run、失败不显成功、迟到事件无效。
- [x] 在窄屏/宽屏与明暗主题查看关键状态；保持半窗/全屏/IME/Back。

### 任务 5：集成与交付

- [x] 运行相关浏览器回归、类型检查、lint、Web build、原生测试/构建。
- [x] 独立代码审查，修复具体问题；不为形式追加无关测试。
- [x] 更新 `docs/browser-agent.md` 能力、操作流程与实测边界。
最终补丁应用、源码快照一致性和文件校验值记录在交付包的 newsnook-beta-browser-agent-delivery.md。该记录独立于源码，避免补丁校验信息与补丁自身形成循环依赖。


## 最终实现补充

- [x] 模型已见上下文版本在推理、工具与完成边界校验；恢复后拒绝旧编号与旧结论。
- [x] 下载终态、暂停与未知结果进入完成门禁，失败或中断保留真实步骤和文件。
- [x] 输入和截图前等待原生完整可见区域及布局 ACK，在途遮挡取消输入。
- [x] PDF 解析移至 isolatedProcess Service，以只读 FD 和有界 JPEG 管道通信，具备超时与取消。
- [x] 原生全量 40 类、241 项测试通过：0 失败、0 错误、0 跳过；Agent 子组 61 项。
- [x] Android instrumentation 编译和 cloudDebug APK 构建成功。
- [x] 真实 Chromium UI 五组交互检查通过，覆盖拖动/全屏、焦点、停止 ACK、窄屏接管、让出页面与结果恢复。
- [x] 两份既有设备 smoke 脚本更新到新会话协议，静态语法检查通过。
- [x] CI 配置包含 Web、Chromium、原生单测及独立空白 API 28/34 AVD；工作流静态检查通过。

## 尚未执行的发布验收

- [ ] 在独立空白 Android 设备执行 5 项 instrumentation：WebView 2 项、PDF 3 项。
- [ ] 在独立空白设备执行升级后的 Android UI 与动作 smoke 脚本。
- [ ] 验收系统 SAF 选择器、输入法、旋转、前后台切换及目标 WebView Provider。
- [ ] 执行远端 CI、正式签名及发布构建；本轮只构建 cloudDebug，未构建 local/release。

当前环境没有可用隔离 Android 设备。编译、Robolectric 与桌面 Chromium 的通过不替代设备验收，也不证明任意网站及任意模型均可无人操作。
