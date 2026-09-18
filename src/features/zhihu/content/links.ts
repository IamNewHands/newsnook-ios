import type { ZhihuEntityRef } from '../types'

export function parseZhihuMessagePeerId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input, 'https://www.zhihu.com')
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'www.zhihu.com' && host !== 'zhihu.com') return null
  const inbox = url.pathname.match(/^\/inbox\/([^/?#]+)/)
  return inbox?.[1] ? decodeURIComponent(inbox[1]) : null
}

export function parseZhihuVideoId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input, 'https://www.zhihu.com')
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'www.zhihu.com' && host !== 'zhihu.com') return null
  const video = url.pathname.match(/^\/video\/([0-9]+)(?:\/|$)/)
  return video?.[1] ?? null
}

export function parseZhihuLink(input: string): ZhihuEntityRef | null {
  let url: URL
  try {
    url = new URL(input, 'https://www.zhihu.com')
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'www.zhihu.com' && host !== 'zhihu.com' && host !== 'zhuanlan.zhihu.com') return null

  const answer = url.pathname.match(/^\/question\/([^/]+)\/answer\/([^/?#]+)/)
  if (answer?.[2]) return { kind: 'answer', id: answer[2] }
  const question = url.pathname.match(/^\/question\/([^/?#]+)/)
  if (question?.[1]) return { kind: 'question', id: question[1] }
  const article = url.pathname.match(/^\/p\/([^/?#]+)/)
  if (host === 'zhuanlan.zhihu.com' && article?.[1]) return { kind: 'article', id: article[1] }
  const pin = url.pathname.match(/^\/pin\/([^/?#]+)/)
  if (pin?.[1]) return { kind: 'pin', id: pin[1] }
  const people = url.pathname.match(/^\/people\/([^/?#]+)/)
  if (people?.[1]) return { kind: 'people', id: decodeURIComponent(people[1]) }
  const topic = url.pathname.match(/^\/topic\/([^/?#]+)/)
  if (topic?.[1]) return { kind: 'topic', id: topic[1] }
  return null
}
