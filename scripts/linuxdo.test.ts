import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseHTML } from 'linkedom'

const parsed = parseHTML('<html><body></body></html>')
Object.assign(globalThis, {
  window: parsed.window,
  document: parsed.document,
  DOMParser: parsed.window.DOMParser,
  Node: parsed.window.Node,
  NodeFilter: parsed.window.NodeFilter,
  HTMLAnchorElement: parsed.window.HTMLAnchorElement,
})

const { detectBrowserChallenge } = await import('../src/lib/browserChallenge')
const { decodeCategories, decodeCurrentUser, decodeNotifications, decodeTagNames, decodeTopic, decodeTopics } = await import('../src/features/linuxdo/api/decode')
const { linuxDoCapabilities } = await import('../src/features/linuxdo/capabilities')
const { linuxDoEndpoints } = await import('../src/features/linuxdo/api/endpoints')
const { sanitizeLinuxDoCooked } = await import('../src/features/linuxdo/content/sanitize')
const { LinuxDoDraftService } = await import('../src/features/linuxdo/draft/service')
const { LinuxDoUploadService } = await import('../src/features/linuxdo/upload/service')
const { LinuxDoBookmarkService } = await import('../src/features/linuxdo/bookmark/service')
const { LinuxDoPeopleService } = await import('../src/features/linuxdo/people/service')
const { LinuxDoSearchService } = await import('../src/features/linuxdo/search/service')
const { LinuxDoNotificationService } = await import('../src/features/linuxdo/notification/service')

assert.equal(
  detectBrowserChallenge({
    status: 403,
    headers: { server: 'cloudflare', 'cf-ray': 'abc-SJC' },
    body: '<html><head><title>Just a moment...</title></head><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></html>',
  }),
  'cloudflare',
)
assert.equal(
  detectBrowserChallenge({
    status: 403,
    headers: { server: 'nginx' },
    body: '{"errors":["You are not permitted to view this resource."]}',
  }),
  null,
)

const user = decodeCurrentUser({
  current_user: {
    id: 42,
    username: 'frank',
    name: 'Frank',
    avatar_template: '/user_avatar/linux.do/frank/{size}/1_2.png',
    trust_level: 3,
    unread_notifications: 7,
  },
})
assert.equal(user?.username, 'frank')
assert.equal(user?.trustLevel, 3)
assert.equal(user?.unreadNotifications, 7)
assert.match(user?.avatarTemplate ?? '', /96/)

const feed = decodeTopics({
  users: [
    { id: 1, username: 'alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' },
    { id: 2, username: 'bob', avatar_template: '/user_avatar/linux.do/bob/{size}/2.png' },
  ],
  topic_list: {
    topics: [{
      id: 100,
      slug: 'hello',
      title: 'Hello Linux.do',
      posts_count: 4,
      reply_count: 3,
      views: 1234,
      like_count: 18,
      created_at: '2026-09-20T00:00:00Z',
      last_posted_at: '2026-09-20T01:00:00Z',
      category_id: 9,
      tags: ['linux', { id: 'newsnook', name: 'newsnook' }, { text: 'android' }],
      posters: [{ user_id: 1, description: 'Original Poster' }, { user_id: 2, description: 'Most Recent Poster' }],
    }],
  },
})
assert.equal(feed.length, 1)
assert.equal(feed[0]?.replyCount, 3)
assert.equal(feed[0]?.posters[1]?.username, 'bob')
assert.deepEqual(feed[0]?.tags, ['linux', 'newsnook', 'android'])
assert.deepEqual(decodeTagNames([{ id: 'ai', text: 'AI' }, { name: 'dev' }, 'news']), ['AI', 'dev', 'news'])
assert.equal(decodeTagNames([{ foo: 'bar' }]).includes('[object Object]'), false)
assert.deepEqual(decodeTagNames(['[object Object]', 'valid']), ['valid'])

const topic = decodeTopic({
  id: 100,
  slug: 'hello',
  title: 'Hello Linux.do',
  posts_count: 2,
  views: 99,
  like_count: 5,
  created_at: '2026-09-20T00:00:00Z',
  last_posted_at: '2026-09-20T01:00:00Z',
  tags: [{ id: 'linux', name: 'linux' }, { text: 'guide' }],
  post_stream: {
    stream: [501, 502],
    posts: [{
      id: 501,
      post_number: 1,
      username: 'alice',
      cooked: '<p>Hello <img src=x onerror="alert(1)"></p><script>alert(1)</script>',
      created_at: '2026-09-20T00:00:00Z',
      actions_summary: [{ id: 2, count: 4, acted: true, can_act: true }],
      bookmarked: true,
      bookmark_id: 77,
      bookmark_name: 'later',
    }],
  },
})
assert.equal(topic.postStream.stream.length, 2)
assert.equal(topic.postStream.posts[0]?.actions[0]?.acted, true)
assert.equal(topic.postStream.posts[0]?.bookmarked, true)
assert.equal(topic.postStream.posts[0]?.bookmarkId, 77)
assert.deepEqual(topic.tags, ['linux', 'guide'])
assert.doesNotMatch(topic.postStream.posts[0]?.cooked ?? '', /<script/i)
assert.doesNotMatch(topic.postStream.posts[0]?.cooked ?? '', /onerror/i)

const categories = decodeCategories({
  category_list: {
    categories: [{ id: 9, name: '开发调优', slug: 'dev', topic_count: 123, description_text: '技术讨论' }],
  },
})
assert.equal(categories[0]?.slug, 'dev')

const notifications = decodeNotifications({
  notifications: [{ id: 8, notification_type: 5, read: false, created_at: '2026-09-20T00:00:00Z', topic_id: 100, fancy_title: 'Hello' }],
})
assert.equal(notifications[0]?.read, false)
assert.equal(notifications[0]?.topicId, 100)

const dirty = '<p onclick="evil()">safe</p><iframe src="javascript:alert(1)"></iframe>'
const clean = sanitizeLinuxDoCooked(dirty)
assert.doesNotMatch(clean, /onclick/i)
assert.doesNotMatch(clean, /javascript:/i)

const discourseMedia = sanitizeLinuxDoCooked(`
  <p>before <img src="/images/emoji/twitter/smiley.png" class="emoji" alt="smiley" width="20" height="20"> after</p>
  <div class="lightbox-wrapper">
    <a class="lightbox" href="/uploads/default/original/1X/photo.png">
      <img src="/uploads/default/optimized/1X/photo_2_690x74.png" width="690" height="74">
      <div class="meta"><span class="filename">image</span><span class="informations">2134×230 22.6 KB</span></div>
    </a>
  </div>
`)
assert.match(discourseMedia, /data-linuxdo-role="emoji"/)
assert.match(discourseMedia, /data-linuxdo-role="content-image"/)
assert.match(discourseMedia, /data-linuxdo-role="image-block"/)
assert.match(discourseMedia, /data-linuxdo-original-src="https:\/\/linux\.do\/uploads\/default\/original/)
assert.doesNotMatch(discourseMedia, /<a[^>]+data-linuxdo-role="image-link"[^>]+href=/)
assert.match(discourseMedia, /https:\/\/linux\.do\/uploads\/default\/optimized/)
assert.doesNotMatch(discourseMedia, /2134×230/)
assert.doesNotMatch(discourseMedia, />image</)

const discourseSemantics = sanitizeLinuxDoCooked(`
  <aside class="quote" data-topic="321" data-post="7" data-username="alice">
    <div class="title"><img class="avatar" src="/user_avatar/linux.do/alice/48/1.png">alice:</div>
    <div class="quote-controls">↗</div>
    <blockquote><p>quoted <span class="spoiler">secret</span></p></blockquote>
  </aside>
  <aside class="onebox discourse-topic">
    <header class="source">linux.do</header>
    <article class="onebox-body">
      <a href="/t/hello/654/3"><img src="/user_avatar/linux.do/bob/96/2.png"><h3>Topic preview</h3></a>
      <p>Compact description</p>
    </article>
  </aside>
  <p>Hello <a class="mention" href="/u/bob">@bob</a></p>
`)
assert.match(discourseSemantics, /data-linuxdo-role="quote"/)
assert.match(discourseSemantics, /data-linuxdo-topic-id="321"/)
assert.match(discourseSemantics, /data-linuxdo-post-number="7"/)
assert.match(discourseSemantics, /data-linuxdo-username="alice"/)
assert.match(discourseSemantics, /data-linuxdo-role="quote-header"/)
assert.match(discourseSemantics, /data-linuxdo-role="quote-avatar"/)
assert.match(discourseSemantics, /data-linuxdo-role="quote-body"/)
assert.match(discourseSemantics, /data-linuxdo-role="spoiler"/)
assert.match(discourseSemantics, /data-linuxdo-role="onebox-topic"/)
assert.match(discourseSemantics, /data-linuxdo-href="https:\/\/linux\.do\/t\/hello\/654\/3"/)
assert.match(discourseSemantics, /data-linuxdo-role="onebox-image"/)
assert.match(discourseSemantics, /data-linuxdo-role="onebox-title"/)
assert.match(discourseSemantics, /data-linuxdo-role="mention"/)
assert.doesNotMatch(discourseSemantics, /data-linuxdo-role="content-image"[^>]*user_avatar\/linux\.do\/alice/)

assert.equal(linuxDoEndpoints.latest(2).endsWith('/latest.json?page=2'), true)
assert.equal(linuxDoEndpoints.category('dev', 9, 3).endsWith('/c/dev/9.json?page=3'), true)
assert.equal(linuxDoEndpoints.search('hello world').includes('q=hello%20world'), true)

const capabilities = linuxDoCapabilities()
assert.equal(capabilities.bookmarks, true)
assert.equal(capabilities.drafts, true)
assert.equal(capabilities.uploads, true)
assert.equal(capabilities.boost.available, true)
assert.equal(linuxDoEndpoints.boostCreate(501).endsWith('/discourse-boosts/posts/501/boosts.json'), true)
assert.equal(linuxDoEndpoints.drafts.endsWith('/drafts.json'), true)
assert.equal(linuxDoEndpoints.draft('topic_100').endsWith('/drafts/topic_100.json'), true)
assert.equal(linuxDoEndpoints.userBookmarks('frank').endsWith('/u/frank/bookmarks.json'), true)
assert.equal(linuxDoEndpoints.notifications(60, 30).endsWith('/notifications.json?offset=60&limit=30'), true)
assert.equal(linuxDoEndpoints.topic('hello', 100, 42).endsWith('/t/hello/100/42.json'), true)
assert.equal(linuxDoEndpoints.postRaw(501).endsWith('/posts/501/raw'), true)

const draftService = new LinuxDoDraftService({} as any)
assert.equal(draftService.keyFor({ action: 'createTopic' }), 'new_topic')
assert.equal(draftService.keyFor({ action: 'reply', topicId: 100 }), 'topic_100')
assert.equal(draftService.keyFor({ action: 'edit', postId: 501 }), 'post_501')

const uploadService = new LinuxDoUploadService()
assert.equal(uploadService.markdown({ url: 'https://linux.do/u.png', originalFilename: 'u.png' }, new File(['x'], 'u.png', { type: 'image/png' })), '![u.png](https://linux.do/u.png)')
assert.equal(uploadService.markdown({ url: 'https://linux.do/a.zip', originalFilename: 'a.zip' }, new File(['x'], 'a.zip', { type: 'application/zip' })), '[a.zip](https://linux.do/a.zip)')

const fakeApi = {
  getJson: async (url: string) => {
    if (url.includes('/bookmarks.json')) return { bookmarks: [{ id: 7, post_id: 501, post_number: 3, topic_id: 100, title: 'Saved topic', slug: 'saved-topic' }] }
    if (url.includes('/user_actions.json')) return { user_actions: [{ action_type: 5 }], topics: [], users: [] }
    return { user: { id: 42, username: 'frank', name: 'Frank', trust_level: 3, topic_count: 2, post_count: 10, likes_received: 8 } }
  },
} as any
const bookmarkService = new LinuxDoBookmarkService(fakeApi)
const bookmarkResult = await bookmarkService.list('frank')
assert.equal(bookmarkResult.items[0]?.topicId, 100)
assert.equal(bookmarkResult.items[0]?.postNumber, 3)
const peopleService = new LinuxDoPeopleService(fakeApi)
const profile = await peopleService.profile('frank')
assert.equal(profile.trustLevel, 3)
assert.equal(profile.postCount, 10)

const searchService = new LinuxDoSearchService({
  getJson: async () => ({
    topics: [],
    users: [{ id: 5, username: 'alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' }],
    posts: [{ id: 91, post_number: 6, username: 'alice', blurb: '<b>matched</b>', created_at: '2026-09-20T00:00:00Z', topic: { id: 44, slug: 'search-hit', title: 'Search Hit' } }],
  }),
} as any)
const search = await searchService.search('matched')
assert.equal(search.posts[0]?.topicId, 44)
assert.equal(search.posts[0]?.topicSlug, 'search-hit')
assert.match(search.posts[0]?.cooked ?? '', /matched/)

let notificationForm: Record<string, unknown> | undefined
const notificationService = new LinuxDoNotificationService({
  postForm: async (_url: string, form: Record<string, unknown>) => { notificationForm = form },
} as any)
await notificationService.markRead(12)
assert.equal(notificationForm?.id, 12)
assert.equal('notification_id' in (notificationForm ?? {}), false)

const javaSource = readFileSync('android/app/src/main/java/com/aizeek/newsnook/LinuxDoSessionPlugin.java', 'utf8')
const authJavaSource = readFileSync('android/app/src/main/java/com/aizeek/newsnook/LinuxDoUserApiAuth.java', 'utf8')
const manifestSource = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')
const clientSource = readFileSync('src/features/linuxdo/api/client.ts', 'utf8')
const threadViewSource = readFileSync('src/features/linuxdo/ui/ThreadViews.tsx', 'utf8')
const passwordLoginSource = readFileSync('src/features/linuxdo/session/password.ts', 'utf8')
const accountViewSource = readFileSync('src/features/linuxdo/ui/AccountView.tsx', 'utf8')
assert.equal(javaSource.includes('result.put("cookie"'), false)
assert.equal(javaSource.includes('result.put("key"'), false)
assert.match(javaSource, /followRedirects\(false\)/)
assert.match(javaSource, /"Set-Cookie"\.equalsIgnoreCase/)
assert.match(javaSource, /isApiAllowedUrl/)
assert.match(javaSource, /User-Api-Key/)
assert.match(javaSource, /User-Api-Client-Id/)
assert.match(authJavaSource, /AndroidKeyStore/)
assert.match(authJavaSource, /AES\/GCM\/NoPadding/)
assert.match(authJavaSource, /RSA\/ECB\/OAEPWithSHA-1AndMGF1Padding/)
assert.match(authJavaSource, /Intent\.ACTION_VIEW/)
assert.match(authJavaSource, /Intent\.CATEGORY_BROWSABLE/)
assert.doesNotMatch(authJavaSource, /resolveActivity\(activity\.getPackageManager\(\)\)/)
assert.doesNotMatch(authJavaSource, /CustomTabsIntent/)
assert.match(authJavaSource, /\/user-api-key\/new/)
assert.doesNotMatch(authJavaSource, /\/user-api-key\/device\.json/)
assert.doesNotMatch(authJavaSource, /\/user-api-key\/device\/poll\.json/)
assert.match(authJavaSource, /AUTH_REDIRECT = "newsnook:\/\/linuxdo-auth\/callback"/)
assert.match(authJavaSource, /appendQueryParameter\("padding", "oaep"\)/)
assert.match(authJavaSource, /appendQueryParameter\("auth_redirect", AUTH_REDIRECT\)/)
assert.match(authJavaSource, /PREF_PENDING_NONCE/)
assert.match(authJavaSource, /PREF_PENDING_STARTED_AT/)
assert.match(authJavaSource, /handleRedirect\(Uri uri\)/)
assert.match(authJavaSource, /constantTimeEquals\(expectedNonce, nonce\)/)
assert.match(authJavaSource, /SCOPES = "write"/)
assert.doesNotMatch(authJavaSource, /SCOPES = "read,write"/)
assert.match(authJavaSource, /CLIENT_ID_PREFIX = "newsnook-android-v1-"/)
assert.match(authJavaSource, /PREF_CLIENT_ID/)
assert.doesNotMatch(authJavaSource, /java\.time\.Instant/)
assert.match(clientSource, /authMode !== 'user-api-key'/)
assert.match(javaSource, /call\.reject\(message, code\)/)
assert.doesNotMatch(javaSource, /call\.reject\(code, message\)/)
assert.match(javaSource, /handleOnNewIntent\(Intent intent\)/)
assert.match(javaSource, /userApiAuth\.handleRedirect\(intent\.getData\(\)\)/)
assert.match(manifestSource, /android:scheme="newsnook" android:host="linuxdo-auth" android:pathPrefix="\/callback"/)
assert.match(threadViewSource, /event\.preventDefault\(\)\s*\n\s*event\.stopPropagation\(\)/)
assert.match(threadViewSource, /querySelectorAll<HTMLImageElement>\('img\[data-linuxdo-role="content-image"\]'\)/)
assert.match(threadViewSource, /onPrevious=/)
assert.match(threadViewSource, /onNext=/)
assert.match(threadViewSource, /\[data-linuxdo-role="quote"\]/)
assert.match(threadViewSource, /\[data-linuxdo-role="onebox"\]/)
assert.match(threadViewSource, /\[data-linuxdo-role="spoiler"\]/)
assert.match(passwordLoginSource, /\/session\/csrf\.json/)
assert.match(passwordLoginSource, /\/session\.json/)
assert.match(passwordLoginSource, /second_factor_token/)
assert.match(passwordLoginSource, /second_factor_method/)
assert.doesNotMatch(passwordLoginSource, /localStorage|sessionStorage|console\.(?:log|debug|info|warn|error)/)
assert.match(accountViewSource, /autoComplete="current-password"/)
assert.match(accountViewSource, /GitHub \/ Google 等第三方登录/)
assert.match(accountViewSource, /await authenticateLinuxDo\(\)/)
assert.match(accountViewSource, /await cancelLinuxDoAuthentication\(\)/)
assert.doesNotMatch(accountViewSource, /Browser\.open\(\{ url: 'https:\/\/linux\.do\/login'/)
const cssSource = readFileSync('src/index.css', 'utf8')
assert.match(cssSource, /\.reader-prose\.linuxdo-post-prose p\s*\{\s*text-indent:\s*0\s*!important;/)
assert.match(cssSource, /font-size:\s*15\.5px/)
assert.match(cssSource, /data-linuxdo-role='quote'/)
assert.match(cssSource, /data-linuxdo-role='onebox-topic'/)
assert.match(cssSource, /data-linuxdo-role='mention'/)
assert.match(cssSource, /data-linuxdo-role='spoiler'/)
const lightboxSource = readFileSync('src/components/ImageLightbox.tsx', 'utf8')
assert.match(lightboxSource, /左右滑动切换/)
assert.match(lightboxSource, /aria-label="上一张"/)
assert.match(lightboxSource, /aria-label="下一张"/)

console.log('linuxdo: ok')
