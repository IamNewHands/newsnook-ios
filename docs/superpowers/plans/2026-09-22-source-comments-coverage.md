# 全来源评论覆盖（Comments Coverage for All Built-in Sources）

- 日期：2026-09-22
- 仓库：`IamNewHands/newsnook-ios`（iOS 层建于上游 `t59688/newsnook` v1.8.7）
- 需求来源：用户直接请求 ——「我需要现在应用中已支持的所有来源都支持显示评论，如果有的话。也就是具体来源具体适配，有的不一定叫『跟帖』」
- TaskStartSnapshot：git HEAD `9e76526`，工作树干净

## 1. Goal

应用内置来源（`src/sources/registry/builtinSources.ts`，共 101 条）中，**凡是上游存在可程序化获取的评论/回复/讨论数据的来源**，都要在阅读页展示评论（入口 + 抽屉）；上游没有评论的来源保持现状——不显示入口，不显示空壳。UI 取词按来源实际称呼（跟帖 / 评论 / 回复 / 讨论 / 吐槽 / 留言），不再一律写「跟贴」。

## 2. 现状（Baseline）

| 项 | 现状 |
|---|---|
| 评论能力 | `src/features/comments/`：`types.ts`（`CommentProvider` 契约）· `service.ts`（provider 注册 + 分发）· `providers/*`（5 个）· `components/*`（抽屉 + 卡片） |
| 已有 provider | eastmoney（东财股吧跟帖）· netease（网易跟贴）· zhihu（知乎）· jandan（煎蛋吐槽）· hackerNews（HN 讨论） |
| 门控 | `supportsComments(article)` → `canHandle` 命中才渲染入口；不命中则三处入口 + 抽屉全不渲染 |
| 入口位置 | `src/screens/ReaderScreen.tsx`：顶栏按钮（约 1394）· 正文底部卡片（约 1719）· 右下浮动胶囊（约 1875） |
| 网络通道 | `src/lib/http.ts` 的 `fetchAbsoluteText`（GET）/ `fetchAbsoluteFormPost`（form POST）。原生走 CapacitorHttp（可带自定义头）；Web/dev 走 `/api/page`、`/api/post` 代理，代理**自动补同源 Referer**、但**只转发 UA/Accept**，自定义头在 Web 端会丢 |
| 既有测试 | `scripts/comments-provider.test.ts`（离线分发测试，`npm run test:comments`） |
| 上游版本 | 上游 v1.8.8-beta.14 的 `src/features/comments/` 与本仓库 v1.8.7 完全一致 → 无现成 provider 可移植 |

## 3. Change Necessity

- 纯文档/配置不可行：覆盖率由代码中的 provider 集合决定，没有 provider 就没有数据源。
- 最小代码边界：**新增 `src/features/comments/providers/*.ts` 并在 `service.ts` 注册**（既有扩展点，AGENTS.md 5.3 明确「新跟贴源 → 实现 CommentProvider，在 comments/service 注册」）。
- 唯一需要改动的既有契约：`CommentProvider` 增加**可选** `label`（该站对评论的称呼）+ `service.ts` 暴露取词函数，供 UI 替换硬编码「跟贴」。可选字段 → 向后兼容，不破坏现有 5 个 provider。

## 4. 架构与契约

```
ReaderScreen ── supportsComments()/commentsNounFor() ──> service.ts（注册表 + 分发）
                                                            │
                                     providers/<site>.ts ────┴── providers/<family>.ts
                                                            │
                                        fetchAbsoluteText / fetchAbsoluteFormPost（lib/http）
```

契约增补（`types.ts`，全部可选，向后兼容）：

```ts
export interface CommentProvider {
  canHandle(article: {...}): boolean
  getComments(...): Promise<CommentsQueryResult>
  getSummaryCount?(...): Promise<number | undefined>
  /** 该站对评论的称呼：'跟贴' | '评论' | '回复' | '讨论' | '吐槽' | '留言'；缺省按 '评论' */
  label?: string
}
```

`service.ts` 增补：

```ts
export function commentsLabelFor(article): string      // provider?.label ?? '评论'
```

分发优先级（`PROVIDERS` 顺序即优先级，必须保留注释中的既有约束）：`eastmoney → netease → zhihu → 站点专属 → 平台族通用 → jandan → hackerNews`。**平台族通用 provider 必须排在站点专属之后**，避免抢走专属站点的更优解析。

## 5. 兼容边界

| 边界 | 决策 |
|---|---|
| 现有 5 个 provider 行为 | 不改解析逻辑，仅补 `label` |
| 无评论来源 | 不注册 provider（现状即「不显示」），不改门控 |
| Web 端 | 平台族接口若必须自定义头（Referer/Cookie/签名），Web 端会失效；此类 provider 在注释里标注「Web 端受限，原生可用」，不额外加代理参数（避免扩大 `/api/page` 契约） |
| 存储/缓存 | 评论不落盘（现状），本次不引入评论缓存 |
| 云同步 | 不涉及 |

## 6. TDD Route

- mode：`off`（本会话 Aegis TDD mode: off）
- decision：`skipped`
- authority：会话配置
- test posture：**解析函数与分发逻辑必须有离线测试**（真实响应样本作为 fixture 固化），网络可用性靠取证脚本实测记录，不进 CI。
- verification：`npm run test:comments` + `npx tsc -b`（构建期类型检查）+ `npm run lint` + 逐站真实接口抽样验证脚本输出。

## 7. Ripple Signal Triage

- 触发信号：`CommentProvider` 契约（新增可选字段）· 分发表（`service.ts`）· UI 取词（ReaderScreen/CommentsDrawer，UI 与 provider 双端）。
- canonical owner：`src/features/comments/`（契约与分发）、`src/screens/ReaderScreen.tsx`（入口渲染）。
- 下游消费者：仅阅读页；列表页、分享、云同步、墨水屏不消费评论。
- 兼容/回退/退役：字段可选 → 无兼容风险；硬编码「跟贴」文案在取词接入后退役（保留 `label` 缺省 '评论' 作为兜底）。
- 需要前置架构对齐：**否**（扩展既有扩展点，无新 owner）。

## 8. Tasks

### Task 1 — 取词契约与 UI 去硬编码（与取证无关，先做）
- 文件：`src/features/comments/types.ts`、`service.ts`、5 个既有 provider、`src/screens/ReaderScreen.tsx`、`src/features/comments/components/CommentsDrawer.tsx`、`scripts/comments-provider.test.ts`
- 变更：加可选 `label`；加 `commentsLabelFor()`；既有 provider 补词（东财/网易=跟贴、知乎=评论、煎蛋=吐槽、HN=讨论）；UI 用取词替换硬编码「跟贴」，抽屉标题/空态/加载文案跟随取词
- 验证：`npm run test:comments`（含取词断言）+ `npx tsc -b`
- 兼容：缺省 '评论'；未知 provider 行为不变

### Task 2 — 平台族通用 provider
- 文件：`providers/wordpress.ts`（`/wp-json/wp/v2/comments?post=`）· `providers/substack.ts`（`/api/v1/post/<id>/comments`）· `providers/giscus.ts`（GitHub Discussions，公开仓库免 token 有速率限制）· 视取证结果决定是否加 `disqus.ts`
- 变更：按 host 特征 `canHandle`；解析函数独立导出以便 fixture 测试
- 验证：fixture 解析测试 + 取证脚本命中 ≥2 个真实站点

### Task 3 — 站点专属 provider（按取证分级 A/B 分批）
- 文件：`providers/<site>.ts`，每站一个；`service.ts` 注册
- 分批依据：取证报告的 A 级（纯 HTTP 免登录）优先，B 级（需特定头/参数）次之，C 级（需登录/强反爬）本轮不做
- 验证：每站 fixture 测试 + 真实接口抽样输出 2 条评论样本

### Task 4 — 无评论来源清单与文档
- 文件：`docs/news-sources.md`（或本计划附录）+ `scripts/comments-provider.test.ts`（断言 D 类来源 `supportsComments === false`，防止误匹配）
- 验证：`npm run test:comments`

### Task 5 — 端到端验证与交付
- 变更：`package.json` 版本号（唯一源）+ CHANGELOG + iOS IPA 构建（GitHub Actions，macOS）
- 验证：真机抽样（中文科技站 / 社区站 / 财经站 / 国际站各 ≥1）截图或读数；`npm run build` 通过

## 9. 取证矩阵（自测脚本产出；4 个调研子代理失败，改为自建脚本探测）

- 取证目录：`D:\GitHub_Clone\_recon\newsnook-comments\`（探测脚本 + 原始响应）
- 端到端验证脚本：`verify-comments-live.mts`（用 provider 导出的 URL 构造 + 解析函数直连上游）
- 分级：A=纯 HTTP 免登录；B=需特定头/参数/签名；C=需登录或强反爬（本轮不做）；D=无公开评论（不注册 provider）

### 9.1 已实测（2026-09-22，node fetch 直连上游）

**WordPress REST（已实现 `providers/wordpress.ts`）** — 主机登记表 + 双接口风格：

| 主机 | REST 风格 | 实测结果 |
|---|---|---|
| syncedreview.com | pretty | postId 47256，评论 ≥100（计数上限 100），首条 Darcie ✅ |
| theue.me | pretty | postId 1394，评论 3 条（中文），首条 王掌柜 ✅ |
| qbitai.com | pretty | URL 数字段即 postId 493865（slug 是中文标题），该篇 0 条 ✅ |
| marktechpost.com / pansci.asia / aiera.com.cn / zhidx.com / jack-clark.net / themarginalian.org | pretty | 接口 200，样本文章 0 条（评论区可用、暂无评论） |
| woshipm.com / huanqiukexue.com | query（`?rest_route=`） | 接口 200，样本文章 0 条 |
| appinn.com | — | REST 被站点封禁（401 `rest_forbidden`）→ 不登记 |
| uisdc / tmtpost / leiphone / sspai / ithome / huxiu / solidot / ruanyifeng / baoyu / gcores / zhishifenzi / geekpark | — | 返回 HTML 外壳或 403，**不是**真 REST → 不登记（sspai/ithome/huxiu 等走站点专属适配） |
| aldaily.com | — | Cloudflare 403 挑战 |

**Substack（已实现 `providers/substack.ts`）** — `*.substack.com` + 自有域名白名单：

| 主机 | 实测结果 |
|---|---|
| thezvi.substack.com | postId 215721533，comment_count 37 / 解析 37 ✅ |
| oneusefulthing.org | postId 216098733，comment_count 71 / 解析 71 ✅（**apex 不可达，必须用 www**） |
| magazine.sebastianraschka.com | postId 214816783，comment_count 66 / 解析 66 ✅ |
| interconnects.ai / astralcodexten.com / lastweekin.ai | 接口 200，comment_count 可用 |
| latent.space / fabricatedknowledge.com / construction-physics.com / understandingai.org | 接口 200；`only_paid` 文章评论返回空数组（未付费不可见） |
| sinocism.com | 本机网络不可达（需代理）→ 保留登记，失败时按「计数未知」隐藏入口 |

**关键实测结论（已写进代码注释）**：

1. Substack 的 `/api/v1/posts?limit=50` 响应达 **2.4 MB**（含全文 HTML），会直接 fetch failed；改用
   `/api/v1/archive?sort=new&limit=20&offset=N`（约 90–150 KB，同样带 `comment_count`）。
2. 请求 URL **必须保留文章自身主机名**（含 `www.`）：`oneusefulthing.org` apex 不可达、`www.` 可通。
   登记表查表另用去 `www.` 的归一键。
3. WordPress 站点大量文章零评论 → 平台族必须 `requiresCommentCount: true`（确知 >0 才显示入口）。

### 9.2 待取证（下一轮）

> 已在 §9.4 全部走完一轮（文章页 HTML 挖线索 + 接口穷举），结论见该节；下表保留最初的候选清单。

中文站点专属接口（逐个实测，A/B 级才实现）：sspai 少数派 · ithome IT之家 · kr36 36氪 · huxiu 虎嗅 ·
ifanr 爱范儿 · geekpark 极客公园 · gcores 机核 · guokr 果壳 · jiqizhixin 机器之心 · leiphone 雷锋网 ·
tmtpost 钛媒体 · solidot · v2ex · cls 财联社 · wscn 华尔街见闻 · latepost 晚点 · jazzyear 甲子光年 ·
zhishifenzi 知识分子 · uisdc 优设；国际站 arstechnica · theverge · quanta · guardian（开放 API 需 key）等。

### 9.3 站点专属实测（Task 3 第一批，2026-09-22）

| 站点 | sourceId | 接口 | 分级 | 结果 |
|---|---|---|---|---|
| 机核 gcores | gcores | `GET gapi/v1/<articles\|radios>/<id>/comments?page[limit]=20&page[offset]=0&include=user`（**必须** `Accept: application/vnd.api+json`） | A | ✅ 已实现 `providers/gcores.ts`：articles 220062 记录数 1、radios 220055 记录数 8，真实评论解析成功；`meta.record-count` 供入口门控；头像 `https://image.gcores.com/<thumb>` |
| V2EX | v2ex | `GET api/topics/show.json?id=<id>`（取 replies 数）+ `GET api/replies/show.json?topic_id=<id>`（全部回复） | A | ✅ 已实现 `providers/v2ex.ts`：topic 1243998 replies=12 / 解析 11 条（v1 API 免登录；v2 需 Token 401，不用） |
| 少数派 sspai | sspai | `api/v1/comment/list?article_id=` → `{"error":3004,"msg":"请登录"}` | C | ✗ 需登录态，本轮不做 |
| IT之家 ithome | ithome | 候选 `dyn.ithome.com/api/comment/getcommentlist` / `api.ithome.com/json/comment/...` 均 404 | 待续 | 需重新定位真实接口 |
| 虎嗅 huxiu | huxiu | `api-comment.huxiu.com` 主机存在，但 `/v1/comment/list`、`/comment/list` 均 code2「页面不存在」 | 待续 | 主机已确认，路径待挖（建议从 JS bundle 找） |
| 爱范儿 ifanr | ifanr | `wp-json/wp/v2/comments?post=` → 204（REST 关闭） | 待续 | 需另找评论通道 |
| 钛媒体 tmtpost / 雷锋网 leiphone / 果壳 guokr / 机器之心 jiqizhixin / 知识分子 zhishifenzi / 优设 uisdc / 晚点 latepost / 甲子光年 jazzyear / 36氪 kr36 / 极客公园 geekpark / Solidot | — | 未取证 | 待续 | 下一批 |

### 9.4 站点专属实测（Task 3 第二批，2026-09-22）

取证脚本：`probe-batch2*.mts`（文章页 HTML 挖接口线索）· `probe-ithome.mts` · `probe-disqus.mts` · `probe-solidot*.mjs`。

| 站点 | sourceId | 接口 | 分级 | 结果 |
|---|---|---|---|---|
| Solidot | solidot | 文章页 `https://www.solidot.org/story?sid=<sid>` 内 `<!-- comments start --> … <!-- comments end -->` 服务端直出 | A | ✅ 已实现 `providers/solidot.ts`：sid 84911 计数 1 / 解析 1 条（Craynic「很正常」），嵌套 `ul.reply_ul` 还原成 quotes；零评论文章该区间为空 → 计数 0 → 入口隐藏 |
| 知识分子 | zhishifenzi | 文章页 `.comments_content li.heng` 服务端直出 | A | ✅ 已实现 `providers/zhishifenzi.ts`：`/media/media/22.html` 计数 1 / 解析 1 条（叶水送）；二级回复要另行请求，本轮只取一层 |
| IT之家 ithome | ithome | 计数可用：`cmt.ithome.com/api/comment/count?newsid=<id>` → `ccd.innerHTML = '6'` | B · 待续 | 列表接口未定位：`/api/comment/list`、`/apiv2/comment/list`、`/api/comment/show` 等 10 种形状均 404（GET/POST 都试过）；`comment.es5.min.js`（41KB）只暴露 `/apiv2/comment/submit`、`/api/comment/complain`、`/api/webcomment/logout` |
| 虎嗅 huxiu | huxiu | — | B · 待续 | `api-comment.huxiu.com` 主机在，路径仍未知；文章页 HTML 无评论线索 |
| 钛媒体 tmtpost · 雷锋网 leiphone · 果壳 guokr · 机器之心 jiqizhixin · 极客公园 geekpark · 36氪 kr36 · 爱范儿 ifanr | — | — | B · 待续 | 文章页均为客户端渲染：HTML 里没有评论接口线索。leiphone 页内有 `data-article_cmtNum`（计数）但列表走 SeaJS 模块（模块名未定位）；guokr 页内 `is_replyable: true`，接口未找到 |
| 甲子光年 jazzyear | jazzyear | `/api/comment-list` 存在 | C | 401 `Unauthorized`（评论列表要登录态） |
| 少数派 sspai | sspai | `api/v1/comment/list?article_id=` | C | `{"error":3004,"msg":"请登录"}` |
| Quanta（及所有 Disqus 站） | quanta | 短名 `quanta-mag` 已确认 | C | `disqus.com/embed/comments/` 已不下发 `api_key`，无 key 取不到列表；`count-data.js` 只能拿计数，取不到评论本体，不做 |
| Ars Technica | arstechnica | — | C | 文章页直接 405 |
| The Verge | verge | — | B · 待续 | 文章页 336KB，无评论接口线索（站点用 Coral） |
| 小众软件 appinn | appinn | WordPress REST 被站点封禁 | D | `rest_forbidden` 401 → 不登记进平台族（**注意：这与「点开没有数据」无关**，见 §9.5） |

### 9.5 附带修复：推荐栏单源筛选为空（用户报「小众软件点开没有数据」）

- 现象：在「推荐」分类下点开低频来源（一天一两条的小众软件这类），列表空白，而信源入口上的条数徽标显示有内容。
- 根因（读代码定位，非猜测）：`App.tsx` 先 `rankRecommendations(...)`（内部截断到 `RECOMMEND_LIMIT = 120`），**之后**才按 `categoryFilterSourceId` 过滤。
  推荐栏候选池是预设内全部信源（上百个），120 个名额被高频源（快讯类每小时数十条）占满，低频源整体被截掉。
- 验证：小众软件 feed 本身正常（HTTP 200 / 89KB / 解析 10 条，标题日期摘要齐全）——所以不是抓取或解析问题。
- 修复：`lib/recommend.ts` 新增 `rankRecommendationsForSource(candidates, profile, sourceId, options)`，**先按源裁剪再排序截断**；`App.tsx` 改用该函数，并抽出 `sourceScopedArticles` 供非推荐路径复用。
- 回归测试：`scripts/recommend.test.ts` Task 16 —— 160 条高频 + 2 条低频的池子里，断言「旧顺序（先截断后过滤）得到 0 条」+「新顺序得到 2 条」+「不选源时与整体排序完全等价」。

### 9.6 执行进展

| 任务 | 状态 | 证据 |
|---|---|---|
| Task 1 取词契约 + UI 去硬编码 | ✅ 完成 | `npm run test:comments`（含取词断言）· `tsc -b` exit 0 |
| Task 2 平台族 WordPress / Substack | ✅ 完成 | 单测通过 · 真实接口 6/6 通过 |
| Task 3 第一批 机核 + V2EX | ✅ 完成 | 单测通过 · 真实接口通过 |
| Task 3 第二批 Solidot + 知识分子 | ✅ 完成 | 单测 9 组通过 · 真实接口 11/11 通过（`verify-comments-live.mts`） |
| Task 3 剩余站点 | ✅ 取证完结（无可实现项） | 见 9.4：ithome / huxiu / tmtpost 等 7 站为 B 级待续，jazzyear / sspai / Disqus / arstechnica 为 C 级，appinn 为 D 级 |
| 契约增补 | ✅ | `label` / `defaultTab` / `requiresCommentCount` + `commentsLabelFor` / `commentsDefaultTabFor` / `shouldShowCommentEntry` |
| Task 4 无评论来源清单与文档 | ✅ 完成 | `docs/news-sources.md` §8（11 个 provider 覆盖表 + 逐站落选理由）+ 测试 9 防误匹配断言 |
| 附带：推荐栏单源筛选为空 | ✅ 完成 | 见 9.5；`scripts/recommend.test.ts` Task 16 |
| Task 5 端到端 + iOS 构建 | ⏳ 待授权 | 本地 `npm run build` 已验证；推送到 GitHub / 触发 IPA 发布需用户明确授权 |

当前 provider 总数：**11**（eastmoney / netease / zhihu / jandan / hackerNews / wordpress / substack / gcores / v2ex / solidot / zhishifenzi）。
覆盖来源：按 sourceId 命中 36 个（网易 25 频道 + 东财 2 + 其余 9），按主机命中 22 个（WordPress / Substack 平台族），合计 58 / 135 个内置来源；其余 77 个为 D 类（无公开评论接口）。

### 9.7 计划外新增：信源筛选从横向滑动条改为展开面板（用户追加需求）

原需求：「顶部选择推荐分类，下面的所有新闻源现在是左右滑动的，看着不方便，改成点击能展开小面板的样式。」

- 变更文件：`src/components/SourceFilterChips.tsx`（重写为「一个触发按钮 + portal 展开面板」）、`src/screens/FeedScreen.tsx`（外层容器不再需要横向滚动类）。
- 形态：入口只占一行（`全部信源 · N` / `当前信源 · N` + 右侧清除按钮）；点击展开一个小面板，信源以换行胶囊网格铺开，> 12 个来源时带搜索框；面板经 `createPortal` 挂到 `document.body` 并用 `fixed` 定位（头部有 `backdrop-blur`，会成为 `fixed` 后代的包含块，不能直接在里面用 fixed 遮罩），位置按触发按钮矩形夹在视口内。
- 行为保留：`全部` 选项、条数徽标、收藏图标、**长按收藏 / 从分类移出**的动作菜单（`ContextActionMenu`）、Esc 与点击外部关闭。
- 不再使用 `horizontal-scroll-rail` / `scroll-hidden` 横向轨道（该类仍被 `CategoryRail` 等使用，未删除）。
- 未做真机视觉验证：本机无 iOS 模拟器；生产构建通过（`npm run build` exit 0）作为静态门禁，视觉验收留给真机。

## 10. 风险与退役

| 风险 | 处置 |
|---|---|
| 站点接口无契约、随时变 | 解析全部走「字段缺失即跳过」的容错路径；失败不阻塞正文阅读（现状即静默失败） |
| 平台族误匹配（同 host 多来源） | `canHandle` 用 host + 路径特征双条件；分发顺序保证专属 provider 优先 |
| 取证把「推测」当「实测」 | 每站证据须含 HTTP 状态 + 响应片段 + 2 条评论样本，缺一不可；仅页面特征推断的归 B 级并标注 |
| 请求量/风控 | 单主机 ≤1 请求/秒；评论只在用户主动点击时拉取（现状），不做预取批量 |
| 退役 | 无既有路径被删除；硬编码「跟贴」文案退役，改由 `label` 提供 |

## 11. 执行路线

- 决策：`inline`（任务间共享同一分发文件与取词契约，协同成本低于分治收益）
- `User confirmation required: no`（用户已明确要求「所有来源都适配」；无凭据、发布、付费或不可逆边界被跨越）
