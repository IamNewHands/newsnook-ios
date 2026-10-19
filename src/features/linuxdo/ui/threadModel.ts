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

/** Computes the connected conversation chain (all ancestors and descendants) for a focused post. */
export function computeConversationChain(
  targetPostNumber: number,
  posts: LinuxDoPost[],
): Set<number> {
  const chain = new Set<number>([targetPostNumber])
  const byNumber = new Map<number, LinuxDoPost>()
  const children = new Map<number, number[]>()

  for (const post of posts) {
    byNumber.set(post.postNumber, post)
    const parent = post.replyToPostNumber
    if (parent && parent > 1 && parent < post.postNumber) {
      const list = children.get(parent) ?? []
      list.push(post.postNumber)
      children.set(parent, list)
    }
  }

  // 1. Ancestor branch upwards to root
  let curr = byNumber.get(targetPostNumber)
  while (curr?.replyToPostNumber && curr.replyToPostNumber > 1 && byNumber.has(curr.replyToPostNumber)) {
    chain.add(curr.replyToPostNumber)
    curr = byNumber.get(curr.replyToPostNumber)
  }

  // 2. Descendant tree downwards
  function collectDescendants(parentNum: number) {
    const directKids = children.get(parentNum) ?? []
    for (const kidNum of directKids) {
      chain.add(kidNum)
      collectDescendants(kidNum)
    }
  }
  collectDescendants(targetPostNumber)

  return chain
}

/** Extracts a concise single-line preview snippet from post HTML for quote pills. */
export function extractQuoteSnippet(cookedHtml: string, maxLength = 45): string {
  if (!cookedHtml) return ''
  let text = cookedHtml
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' [代码] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + '…'
  }
  return text
}

