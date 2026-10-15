import type { LinuxDoPost, LinuxDoReplyTarget } from '../types'

type ReplySource = Pick<LinuxDoPost, 'postNumber' | 'username' | 'name' | 'avatarTemplate'>
type ReplyingPost = Pick<LinuxDoPost, 'replyToPostNumber' | 'replyToUser'>

export interface LinuxDoThreadRow {
  post: LinuxDoPost
  rootPostNumber: number
  depth: number
  replyCount: number
  firstReply: boolean
  lastReply: boolean
  missingParent?: number
}

/** A partial-stream projection: absent parents never hide their replies. */
export function buildLinuxDoThreads(posts: LinuxDoPost[]): LinuxDoThreadRow[] {
  const ordered = [...posts].sort((a, b) => a.postNumber - b.postNumber)
  const byNumber = new Map(ordered.map(post => [post.postNumber, post]))
  const children = new Map<number, LinuxDoPost[]>()
  const roots: LinuxDoPost[] = []
  for (const post of ordered) {
    const parent = post.replyToPostNumber
    // Discourse replies can only target earlier floors. This also breaks cycles
    // and self-links without recursive validation or dropping malformed posts.
    if (parent && parent > 1 && parent < post.postNumber && byNumber.has(parent)) {
      const siblings = children.get(parent) ?? []
      siblings.push(post)
      children.set(parent, siblings)
    } else roots.push(post)
  }

  const rows: LinuxDoThreadRow[] = []
  for (const root of roots) {
    const start = rows.length
    const stack = [{ post: root, depth: 0 }]
    while (stack.length) {
      const { post, depth } = stack.pop()!
      const parent = post.replyToPostNumber
      rows.push({
        post, depth, rootPostNumber: root.postNumber, replyCount: 0,
        firstReply: false, lastReply: false,
        missingParent: parent && parent > 1 && parent < post.postNumber && !byNumber.has(parent) ? parent : undefined,
      })
      const replies = children.get(post.postNumber) ?? []
      for (let i = replies.length - 1; i >= 0; i--) stack.push({ post: replies[i], depth: depth + 1 })
    }
    const count = rows.length - start - 1
    rows[start].replyCount = count
    if (count) {
      rows[start + 1].firstReply = true
      rows[rows.length - 1].lastReply = true
    }
  }
  return rows
}

export function resolveReplyTarget(
  post: ReplyingPost,
  posts: ReplySource[],
): LinuxDoReplyTarget | undefined {
  if (post.replyToUser) return post.replyToUser
  if (!post.replyToPostNumber) return undefined
  const target = posts.find((candidate) => candidate.postNumber === post.replyToPostNumber)
  if (!target) return undefined
  return {
    username: target.username,
    name: target.name,
    avatarTemplate: target.avatarTemplate,
  }
}
