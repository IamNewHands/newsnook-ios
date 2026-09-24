# 国际新闻源审计（2026-09-24）

目标：把“国际中文”和“国际英文”按**正文可直接阅读的语言**拆开，同时把“综合新闻”和“评论 / 智库”拆开。`NewsSource.group === 'intl'` 继续只承担国际源网络分流，不再拿它表达语言。

## 国际中文

| 媒体 | 探测结果 | Newsnook 接入决策 |
|---|---|---|
| BBC 中文 | BBC 官方简体首页 `https://www.bbc.com/zhongwen/simp` 正常提供 `zh-hans` 内容；但公开 `feeds.bbci.co.uk/zhongwen/simp/rss.xml` 会 301 到繁体 `trad/rss.xml` | 不再使用 RSS；`bbc-chinese` 解析第一方 `__NEXT_DATA__`，只接受 `/simp` 正文链接，并以 `cacheVersion=simp-v1` 淘汰升级前的繁体缓存 |
| 纽约时报中文网 | 第一方 RSS：`https://cn.nytimes.com/rss/`，实测 200 且持续更新 | `feed`：`nytimes-zh` |
| 华尔街日报中文网 | 站点仍存在，但当前直接请求返回访问控制；旧中文 RSS 地址不可用，未发现稳定第一方公开 RSS | 不使用第三方镜像；暂不内置。若以后接入，应做浏览器会话 / 授权感知的自定义源，并尊重订阅墙 |
| RFI 中文 | 第一方 RSS：`https://www.rfi.fr/cn/rss`，实测 200 / `application/rss+xml` | `feed`：`rfi-zh` |
| 联合早报 | `/rss`、`/rss.xml` 均不可用；`/news/world` 公开 HTML 可稳定获取文章卡片 | 第一方自定义 HTML：`zaobao` kind，源 `zaobao-world`；不依赖 RSSHub / FeedX |
| DW 中文 | 第一方 RDF RSS：`https://rss.dw.com/rdf/rss-chi-all`，实测持续更新 | `feed`；修正原 `dw-top` 误接英文 `rss-en-top` 的问题 |
| FT中文网 | 第一方 RSS：`https://www.ftchinese.com/rss/feed`，实测 200 / `application/rss+xml` | `feed`：`ftchinese` |
| 彭博商业周刊中文版 | `bbwc.cn` 仍在运营；未发现稳定公开第一方 RSS，当前运行环境对部分路径还有 TLS/站点访问异常 | 暂不内置第三方 feed。后续仅在找到稳定第一方列表接口后做自定义解析 |
| 日经中文网 | `cn.nikkei.com` 当前对自动请求返回 403；未发现可直接使用的中文第一方 RSS | 暂不内置；若做需自定义浏览器/站点适配。英文 Nikkei Asia 可直接 RSS |
| 路透中文网 | `cn.reuters.com` 已不再提供独立中文站，当前会转向 Reuters 全球站；旧中文 RSS 不可用 | 不创建“路透中文”伪源，也不接第三方镜像 |
| 南华早报（SCMP） | 有官方 RSS，但当前公开站是英文；“China”是报道栏目，不是中文版本 | 归“国际英文”；保留 `scmp-china` / `scmp-news`，名称避免暗示中文 |
| 今日俄罗斯中文 / RT 中文 | 未发现与 RT.com 对应、可稳定验证的公开中文 RSS；“俄罗斯卫星通讯社中文”是另一个产品/站点，不应自动等同 | 暂不误配。若产品要的是 Sputnik 中文，应单独立项探测其当前站点/API |
| 美国之音中文网 | 官方 RSS 订阅页仍提供中文“新闻”聚合源，实测 XML 200 | `feed`：`voa-zh` |
| 中央社 · 国际 | 官方 RSS 服务明确列出“国际”FeedBurner 源，实测 XML 200 | `feed`：`cna-intl-zh` |

## 国际英文

综合新闻栏只放新闻源，不再混入评论/智库：

- 第一方 RSS：BBC World、DW English、NYT World、WSJ World News、Nikkei Asia、Channel NewsAsia World、SCMP、NPR、Guardian World、France 24、Al Jazeera。
- Google News World 保留为聚合补充，但不是核心第一方媒体。
- taxonomy v3 不再把所有英文长文塞进一个“国际深读”：Foreign Affairs / Project Syndicate →「全球视野·国际评论」，NYRB →「深度人文·海外思想长文」，Bloomberg Opinion →「财经商业·产业评论」，Sinocism →「中国资讯·外部观察」。

## 结构约束（taxonomy v3）

1. 国际新闻按语言与媒体形态进入 `world-zh`（中文公共媒体）、`world-zh-press`（中文报刊通讯）、`world-news`（英文公共媒体）、`world-news-press`（英文报刊聚合）、`world-asia`（亚太观察）、`world-opinion`（国际评论），不再维护旧 `intl*` 分类。
2. 内置 taxonomy 全局互斥：同一个普通内置信源只属于一个预设、一个分类；知乎社区工作区 `workspaceOnly` 不进入预设。
3. `group: 'intl'` 继续只承担网络代理/路由属性，不表达语言和 UI 分类。
4. 同一真实 Feed 不允许用多个 source ID 伪装成不同栏目；父/子 Feed 也不得在同一预设里制造明显重复。
5. 优先第一方 RSS/Atom；没有第一方 feed 时才做站点自定义解析；不把 RSSHub/FeedX 等第三方镜像设为内置硬依赖。
6. 旧用户布局通过 taxonomy migration 物化为自定义分类/预设，不按新分类猜测重排。
