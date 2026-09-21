const ORIGIN = 'https://linux.do'

export const linuxDoEndpoints = {
  origin: ORIGIN,
  sessionCurrent: ORIGIN + '/session/current.json',
  csrf: ORIGIN + '/session/csrf.json',
  latest: (page = 0) => ORIGIN + '/latest.json?page=' + page,
  top: (period: 'daily' | 'weekly' | 'monthly' | 'all' = 'weekly', page = 0) =>
    ORIGIN + '/top.json?period=' + period + '&page=' + page,
  newTopics: (page = 0) => ORIGIN + '/new.json?page=' + page,
  unread: (page = 0) => ORIGIN + '/unread.json?page=' + page,
  categories: ORIGIN + '/categories.json',
  category: (slug: string, id: number, page = 0) =>
    ORIGIN + '/c/' + encodeURIComponent(slug) + '/' + id + '.json?page=' + page,
  tags: ORIGIN + '/tags.json',
  tag: (tag: string, page = 0) => ORIGIN + '/tag/' + encodeURIComponent(tag) + '.json?page=' + page,
  topic: (slug: string, id: number, postNumber?: number) => ORIGIN + '/t/' + encodeURIComponent(slug) + '/' + id + (postNumber ? '/' + postNumber : '') + '.json',
  posts: (topicId: number, ids: number[]) =>
    ORIGIN + '/t/' + topicId + '/posts.json?' + ids.map((id) => 'post_ids[]=' + encodeURIComponent(String(id))).join('&'),
  search: (q: string, page = 1) => ORIGIN + '/search.json?q=' + encodeURIComponent(q) + '&page=' + page,
  user: (username: string) => ORIGIN + '/u/' + encodeURIComponent(username) + '.json',
  userSummary: (username: string) => ORIGIN + '/u/' + encodeURIComponent(username) + '/summary.json',
  userBadges: (username: string) => ORIGIN + '/user-badges/' + encodeURIComponent(username) + '.json',
  userActivity: (username: string, offset = 0, filter?: number) => {
    const params = new URLSearchParams({ username, offset: String(offset) })
    if (filter !== undefined) params.set('filter', String(filter))
    return ORIGIN + '/user_actions.json?' + params.toString()
  },
  notifications: (offset = 0, limit = 30) => ORIGIN + '/notifications.json?offset=' + offset + '&limit=' + limit,
  markNotificationsRead: ORIGIN + '/notifications/mark-read.json',
  postsCreate: ORIGIN + '/posts.json',
  post: (id: number) => ORIGIN + '/posts/' + id + '.json',
  postRaw: (id: number) => ORIGIN + '/posts/' + id + '/raw',
  postAction: ORIGIN + '/post_actions.json',
  postActionDelete: (id: number) => ORIGIN + '/post_actions/' + id + '.json',
  topicNotification: (id: number) => ORIGIN + '/t/' + id + '/notifications.json',
  bookmarks: ORIGIN + '/bookmarks.json',
  bookmarkDelete: (bookmarkId: number) => ORIGIN + '/bookmarks/' + bookmarkId + '.json',
  drafts: ORIGIN + '/drafts.json',
  draft: (key: string) => ORIGIN + '/drafts/' + encodeURIComponent(key) + '.json',
  uploads: ORIGIN + '/uploads.json',
  userBookmarks: (username: string) => ORIGIN + '/u/' + encodeURIComponent(username) + '/bookmarks.json',
  boostCreate: (postId: number) => ORIGIN + '/discourse-boosts/posts/' + postId + '/boosts.json',
  boost: (boostId: number) => ORIGIN + '/discourse-boosts/boosts/' + boostId + '.json',
  boostsGiven: (username: string) => ORIGIN + '/discourse-boosts/users/' + encodeURIComponent(username) + '/boosts-given.json',
  boostsReceived: (username: string) => ORIGIN + '/discourse-boosts/users/' + encodeURIComponent(username) + '/boosts-received.json',
} as const
