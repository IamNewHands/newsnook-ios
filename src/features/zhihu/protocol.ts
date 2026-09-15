/**
 * 知乎私有协议能力矩阵。
 *
 * 这里是运行时 UI 与 service 的唯一能力闸门。第三方源码只能证明“曾有实现入口”，
 * 不能证明今天的线上协议仍可用，因此默认状态是 source-only。只有带实网验证记录的
 * 操作才能提升为 verified；未知写操作必须保持 blocked，禁止 UI 假成功。
 */

export type ZhihuProtocolStatus =
  | 'source-only'
  | 'verified'
  | 'upstream-unsupported'
  | 'blocked'

export type ZhihuAuthMode = 'guest' | 'optional' | 'required' | 'local-only'
export type ZhihuRetryPolicy = 'safe-read' | 'never'

export interface ZhihuProtocolEvidence {
  /** repository-relative path，便于审计；不得放 Cookie/token/私信正文。 */
  path: string
  /** source = 源码事实，corpus = 脱敏真实响应语料，live = 本项目授权实网记录，local-test = 本地行为测试。 */
  kind: 'source' | 'corpus' | 'live' | 'local-test'
  note: string
}

export interface ZhihuOperationContract {
  operation: string
  zIds: readonly string[]
  status: ZhihuProtocolStatus
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'LOCAL'
  auth: ZhihuAuthMode
  retry: ZhihuRetryPolicy
  /** 固定协议路径；动态实体以 :name 表示。未知协议必须为 null。 */
  endpoint: string | null
  /** 可安全提交仓库的脱敏 fixture。没有真实响应语料时不得补“看起来像真的”假 fixture。 */
  fixture?: string
  evidence: readonly ZhihuProtocolEvidence[]
  note: string
}

const REF = 'third-party/zhihu-plus-plus-master/'

export const ZHIHU_OPERATIONS = [
  {
    operation: 'session.login', zIds: ['Z01'], status: 'source-only', method: 'POST', auth: 'guest', retry: 'never', endpoint: null,
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/account/ZhihuAccountClient.kt`, note: '参考项目存在认证客户端；本项目未获授权账号完成实网登录闭环。' }],
    note: '登录参数、挑战与今日签名仍需授权实网验证，当前 UI 不宣称可登录。',
  },
  {
    operation: 'session.switch-account', zIds: ['Z01'], status: 'blocked', method: 'LOCAL', auth: 'local-only', retry: 'never', endpoint: null,
    evidence: [], note: '先实现 generation 隔离；在登录闭环完成前不提供可选远端账号。',
  },
  {
    operation: 'feed.recommended', zIds: ['Z02', 'Z03'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://api.zhihu.com/topstory/recommend',
    fixture: 'scripts/fixtures/zhihu/feed.recommended.source.json',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/HomeFeedViewModel.kt`, note: '参考实现标记 allowGuestAccess。' },
      { kind: 'corpus', path: `${REF}shared/src/jvmTest/resources/real-api/mobile-home-card.json`, note: '参考仓库保存的脱敏真实响应语料。' },
    ], note: '允许匿名只读尝试；挑战页/非 JSON 必须作为错误呈现。',
  },
  {
    operation: 'feed.hot', zIds: ['Z02'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/HotListViewModel.kt`, note: '参考实现入口。' }],
    note: '尚无本项目实网响应 fixture。',
  },
  {
    operation: 'feed.following', zIds: ['Z02'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/moments_v3',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/local/LocalRecommendationEngine.kt`, note: '参考代码存在 moments_v3 feed_type=recommend 路径；关注流精确语义仍需验证。' }],
    note: '未完成登录时禁用。',
  },
  {
    operation: 'search.query', zIds: ['Z04'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/search_v3',
    fixture: 'scripts/fixtures/zhihu/search.query.source.json',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/SearchViewModel.kt`, note: '参考项目搜索实现。' },
      { kind: 'corpus', path: `${REF}shared/src/jvmTest/resources/search/search-general-sanitized.json`, note: '参考仓库脱敏搜索语料。' },
    ], note: '分类筛选参数仍按 source-only 处理。',
  },
  {
    operation: 'question.read', zIds: ['Z05', 'Z06'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/questions/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ContentDetailCache.kt`, note: '问题详情 URL 与 include 字段。' }],
    note: '公开只读候选。',
  },
  {
    operation: 'question.answers', zIds: ['Z05'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/questions/:id/answers',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/QuestionFeedViewModel.kt`, note: '参考项目回答分页实现。' }],
    note: '排序、limit 与 include 仍按源实现解析，不视作实网已验证。',
  },
  {
    operation: 'answer.read', zIds: ['Z05', 'Z06', 'Z17'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/answers/:id',
    fixture: 'scripts/fixtures/zhihu/answer.read.source.json',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ContentDetailCache.kt`, note: '回答详情 URL 与 include 字段。' },
      { kind: 'corpus', path: `${REF}shared/src/jvmTest/resources/real-api/answer-detail.json`, note: '参考仓库脱敏真实响应语料。' },
    ], note: 'fixture 只保留结构，不复制第三方正文。',
  },
  {
    operation: 'article.read', zIds: ['Z06', 'Z17'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/articles/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ContentDetailCache.kt`, note: '文章详情 URL。' }], note: '公开只读候选。',
  },
  {
    operation: 'pin.read', zIds: ['Z06', 'Z17'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/pins/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ContentDetailCache.kt`, note: '想法详情 URL。' }], note: '公开只读候选。',
  },
  {
    operation: 'vote.set', zIds: ['Z07'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/:contentType/:id/voters',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/ArticleViewModel.kt`, note: '参考实现存在回答/文章赞同写操作。' }], note: '非幂等写；未经授权实网读回验证，UI 不启用。',
  },
  {
    operation: 'comment.list-root', zIds: ['Z08'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/:type/:id/root_comment',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/RootCommentViewModel.kt`, note: '根评论分页入口。' }], note: '只读候选。',
  },
  {
    operation: 'comment.list-child', zIds: ['Z08'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/comment/:id/child_comment',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/ChildCommentViewModel.kt`, note: '子评论分页入口。' }], note: '只读候选。',
  },
  {
    operation: 'comment.create', zIds: ['Z08'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/:type/:id/comment',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/BaseCommentViewModel.kt`, note: '参考实现存在评论发送。' }], note: '未经授权写入/读回，不启用。',
  },
  {
    operation: 'comment.update', zIds: ['Z08'], status: 'blocked', method: 'PATCH', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '未定位到可靠编辑协议；不能用删后重发冒充编辑。',
  },
  {
    operation: 'people.read', zIds: ['Z09', 'Z15'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: '参考用户页与内容分类请求。' }], note: '公开资料只读候选。',
  },
  {
    operation: 'people.content', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/:contentKind',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: '回答/文章/问题/想法等用户内容分页入口。' }], note: '仅开放公开内容分类；收藏/关注关系另走私有能力。',
  },
  {
    operation: 'topic.read', zIds: ['Z04', 'Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v5.1/topics/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/TopicScreen.kt`, note: '话题详情参考实现。' }], note: '公开话题资料只读候选。',
  },
  {
    operation: 'topic.feed', zIds: ['Z04', 'Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v5.1/topics/:id/feeds/:mode',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/TopicScreen.kt`, note: '精华/热门/时间线/想法/待回答分页入口。' }], note: '默认只读热门讨论；其他筛选按源码证据逐步开放。',
  },
  {
    operation: 'collection.list', zIds: ['Z10', 'Z15'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/collections',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/CollectionsViewModel.kt`, note: '收藏夹列表参考实现。' }], note: '私有数据，登录前不请求。',
  },
  {
    operation: 'draft.answer.save', zIds: ['Z11', 'Z12'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/questions/:id/draft',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuAnswerPublisher.kt`, note: '参考回答草稿写入。' }], note: '没有远端列表/详情/删除闭环，禁止假造草稿箱。',
  },
  {
    operation: 'draft.remote.list', zIds: ['Z11'], status: 'blocked', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: null,
    evidence: [], note: '参考代码未形成可靠远端草稿箱列表协议证据。',
  },
  {
    operation: 'answer.publish', zIds: ['Z12'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/content/publish',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuAnswerPublisher.kt`, note: '参考发布入口。' }], note: '发布超时也不能自动重试；未授权验证前 UI 禁用。',
  },
  {
    operation: 'answer.delete', zIds: ['Z12'], status: 'blocked', method: 'DELETE', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '没有完整删除闭环证据。',
  },
  {
    operation: 'pin.publish', zIds: ['Z13'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/content/drafts',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuPinPublisher.kt`, note: '参考想法草稿/发布链路。' }], note: '字段和提交状态仍需实网读回。',
  },
  {
    operation: 'article.publish', zIds: ['Z13'], status: 'blocked', method: 'POST', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '未形成文章创作完整协议闭环。',
  },
  {
    operation: 'question.publish', zIds: ['Z13'], status: 'blocked', method: 'POST', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '未形成提问/问题编辑完整协议闭环。',
  },
  {
    operation: 'image.upload', zIds: ['Z14'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/images',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuImageUpload.kt`, note: '参考三段式图片上传链路。' }], note: '上传域 Cookie 隔离与失败恢复需真机验证。',
  },
  {
    operation: 'video.upload', zIds: ['Z14'], status: 'blocked', method: 'POST', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '仅找到播放取源，没有可靠视频上传协议。',
  },
  {
    operation: 'profile.update', zIds: ['Z15'], status: 'blocked', method: 'PATCH', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '资料修改缺少完整证据。',
  },
  {
    operation: 'notification.list', zIds: ['Z16'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/notifications/v3/timeline/entry',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/NotificationViewModel.kt`, note: '通知时间线参考实现。' }], note: '账号私有，不进入公共缓存。',
  },
  {
    operation: 'message.list', zIds: ['Z16'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/messages',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PrivateMessageScreen.kt`, note: '私信列表/会话参考实现。' }], note: '账号私有，不进入 Cloud Sync。',
  },
  {
    operation: 'message.send', zIds: ['Z16'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/messages',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PrivateMessageScreen.kt`, note: '参考项目存在私信发送路径。' }], note: '未经授权写入/读回，UI 禁用。',
  },
  {
    operation: 'bridge.article', zIds: ['Z17'], status: 'blocked', method: 'LOCAL', auth: 'local-only', retry: 'never', endpoint: null,
    evidence: [], note: '由 NewsNook 本地 Article/分享桥接测试提升，不依赖远端写协议。',
  },
  {
    operation: 'workspace.behavior', zIds: ['Z18'], status: 'blocked', method: 'LOCAL', auth: 'local-only', retry: 'never', endpoint: null,
    evidence: [], note: '由导航/主题/返回栈/双变体测试逐项证明。',
  },
] as const satisfies readonly ZhihuOperationContract[]

const ZHIHU_OPERATION_BY_NAME = new Map<string, ZhihuOperationContract>(
  ZHIHU_OPERATIONS.map((item) => [item.operation, item]),
)

export function zhihuOperation(operation: string): ZhihuOperationContract | undefined {
  return ZHIHU_OPERATION_BY_NAME.get(operation)
}

/** 只有 verified 远端操作和已经完成 local-test 的本地操作才允许 mutation UI 调用。 */
export function isZhihuOperationEnabled(operation: string): boolean {
  const contract = zhihuOperation(operation)
  return contract?.status === 'verified'
}

/** source-only GET 可以作为显式“实验性只读”尝试；写操作绝不因源码证据自动放行。 */
export function canAttemptZhihuRead(operation: string): boolean {
  const contract = zhihuOperation(operation)
  if (!contract || contract.method !== 'GET') return false
  return contract.status === 'verified' || contract.status === 'source-only'
}
