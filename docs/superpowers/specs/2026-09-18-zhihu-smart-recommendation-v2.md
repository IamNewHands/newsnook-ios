# 知乎 Smart Recommendation V2

日期：2026-09-18

## 目标

让 NewsNook 的知乎推荐从“反复请求固定第一页”升级为一个本地优先、可解释、可退化、持续有新内容的推荐协调层。

成功标准：

- 同一用户连续刷新时，24 小时内已充分曝光的内容显著降权，不再反复占据首屏。
- 推荐候选不依赖单一入口，匿名用户也至少来自 Android 推荐、Web 推荐、热榜三路。
- 登录用户额外引入关注动态，但账号私有候选永远按知乎账号隔离。
- 上游游标持续前进；首屏重复度高时自动向后补页，而不是永远停在第一页。
- 已登录 Android 会话在不阻断阅读的前提下回传 `touch/read`，让知乎服务端画像也能前进。
- 任意推荐增强模块故障时，仍可回退到现有公开推荐，不能把知乎首页打空。
- 不依赖 NewsNook Cloud，不新增生产依赖，不影响 RSS/新闻主路径。

## 第一性约束

### 必须保持

1. Guest-first：未登录仍可看推荐。
2. Local-first：候选池、曝光历史、排序画像保留在本机。
3. Account isolation：关注流、账号行为和候选池按知乎账号隔离。
4. Graceful degradation：Smart 召回部分失败时使用成功来源；全部失败时才报错。
5. Stable pagination：同一推荐会话已经展示过的顺序不能因后续补池而重排。
6. Bounded storage：候选池与历史必须有 TTL 和容量上限。
7. Protocol honesty：`lastread/touch` 仍标记为 source-only，不伪装成 live verified。
8. Feedback must be non-blocking：曝光/阅读回传失败绝不能阻止用户打开内容。

### 删除 / 不做

- 不把 Zhihu++ 的后台“爬虫调度器 + Room 数据库 + 每分钟任务”照搬进 Web/Capacitor。
- 不为了推荐引入 Redux/Zustand、服务端队列、NewsNook Cloud 或新的全局状态层。
- 不把热门度当唯一排序依据。
- 不在刷新时随机洗牌造成“看似新鲜、实际不可预测”的列表。
- 不让技术来源模式暴露成普通用户必须理解的设置。

## 架构

```text
                    ┌──────────────────────────────┐
                    │ Zhihu upstream recall       │
                    │ Android / Web / Hot / Follow │
                    └──────────────┬───────────────┘
                                   │
                         partial-failure tolerant
                                   │
                    ┌──────────────▼───────────────┐
                    │ Smart candidate pool         │
                    │ per-account / bounded / TTL  │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Local ranking                │
                    │ affinity / freshness /       │
                    │ popularity / exposure fatigue│
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Diversity re-ranker          │
                    │ author / kind / question     │
                    │ exploration                  │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Stable recommendation session│
                    │ fixed consumed prefix + tail │
                    └──────────────┬───────────────┘
                                   │
                             Feed UI
                                   │
                  ┌────────────────┴────────────────┐
                  │                                 │
          viewport impression                 content open
                  │                                 │
          local exposure history             local preference
                  │                                 │
                  └──────────► touch/read ◄─────────┘
                         authenticated Android only
```

## 召回策略

匿名：

- Android topstory
- Web topstory
- Hot list

登录：

- Android topstory
- Web topstory
- Hot list
- Following moments

首次刷新并行抓各来源第一页。若候选池太小或第一页新增实体过少，只补有限数量后续页，避免请求风暴。

加载更多优先消费当前稳定推荐会话；接近尾部时使用该会话保存的各来源游标补池，只向尾部追加新实体，不改已经展示过的前缀。

## 排序信号

正向：

- 打开
- 赞同
- 收藏
- 关注作者
- 作者亲和
- 内容类型亲和
- 标题/摘要主题兴趣（复用 NewsNook 本地 tokenizer，仅保存在本机）
- 新鲜度
- 适度讨论度

显式负反馈：

- `不感兴趣`：立即从当前稳定 Feed 状态移除，30 天内硬排除同一实体，并对相似主题做负向学习；不误伤作者或内容类型。进入回答再返回时不能复活。
- `少推荐此作者`：只降低该作者亲和，不影响相似主题；只有候选存在稳定 author id/token 时才显示。
- 移动端使用标准长按动作菜单，桌面端支持右键与低存在感 hover 入口；不在卡片主视觉中常驻强按钮。

疲劳：

- 曝光次数
- 最近曝光时间
- 最近打开时间
- 同作者连续出现
- 同问题/同内容簇连续出现
- 内容类型连续出现

探索：

- 少量候选允许突破既有画像，避免兴趣茧房。
- 探索必须是确定性的会话内重排，不使用刷新即随机洗牌。

## 曝光定义

只有卡片在真实滚动容器中达到足够可见比例并持续一段时间，才算一次 impression。

不计：

- 左右滑动时的预览页
- skeleton
- 只擦边进入视口的卡片
- 页面刚挂载瞬间

本地 impression 立即记入画像；上游 `touch` 只在已登录且 transport 支持写入时批量回传。

## 存储

继续使用浏览器本地存储作为轻量候选池：

- 每个知乎账号独立 key；guest 独立。
- 候选池严格限量。
- 老候选按 TTL 清理。
- 推荐会话只保存实体 key、游标和时间戳。
- localStorage 配额/隐私模式失败时退化到当前进程内存，不阻断阅读。

当前规模下不引入 IndexedDB 是刻意的：候选只存摘要而非全文，容量有硬上限；减少一个异步数据库生命周期和迁移面，比提前增加复杂度更可靠。

## 用户控制

- 知乎账号页提供“重置智能推荐”。
- 重置只清除当前知乎账号（未登录时为 guest）的本地兴趣、曝光与负反馈画像，同时清空公共候选池和当前 Smart 会话，并立即重新召回。
- 不删除知乎账号、Cookie、收藏、草稿、评论草稿、私信草稿，也不影响 NewsNook 主新闻/RSS 阅读记录。

## 可观测性

- Smart 召回、反馈失败仅写 `log.feed`。
- 不记录 Cookie、token、正文或私信数据。
- 上游反馈失败不会展示干扰阅读的 Toast。
- 真实推荐读取失败仍沿用现有用户可见错误态。

## 发布策略

V2 第一阶段直接把知乎“推荐”主路径切到 Smart：

1. 保留旧 `android/web/mixed/local` 代码用于回归和诊断。
2. 新增 Smart 协调层、稳定会话和候选池。
3. 新增 impression 采样。
4. 新增 source-only `lastread/touch` 反馈服务。
5. 增加纯函数/服务级回归测试。
6. 通过 `test:zhihu-recommendation`、`test:zhihu-feed`、`test:zhihu-protocol`、lint、build 后再交付。
