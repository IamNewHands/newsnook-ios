import type { LinuxDoApiClient } from '../api/client'
import { linuxDoEndpoints } from '../api/endpoints'
import { uploadLinuxDoFile } from '../session/native'

export interface LinuxDoUpload {
  id?: number
  url: string
  shortUrl?: string
  originalFilename?: string
  width?: number
  height?: number
}

function absoluteUrl(value: string): string {
  if (!value.trim()) return ''
  try {
    const parsed = new URL(value, 'https://linux.do')
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

export class LinuxDoUploadService {
  private readonly api?: LinuxDoApiClient

  constructor(api?: LinuxDoApiClient) {
    this.api = api
  }

  async upload(file: File, onProgress?: (progress: number) => void): Promise<LinuxDoUpload> {
    const payload = await uploadLinuxDoFile(file, onProgress) as any
    const canonicalUrl = typeof payload?.url === 'string' ? absoluteUrl(payload.url) : ''
    const shortUrl = typeof payload?.short_url === 'string' ? payload.short_url : undefined
    if (!canonicalUrl) throw new Error('Linux.do 未返回可预览的 HTTP 上传地址')
    return {
      id: typeof payload?.id === 'number' ? payload.id : undefined,
      url: canonicalUrl,
      shortUrl,
      originalFilename: typeof payload?.original_filename === 'string' ? payload.original_filename : file.name,
      width: typeof payload?.width === 'number' ? payload.width : undefined,
      height: typeof payload?.height === 'number' ? payload.height : undefined,
    }
  }

  markdown(upload: LinuxDoUpload, file: File): string {
    const label = upload.originalFilename || file.name || 'upload'
    // Keep Discourse's upload:// short URL in the submitted Markdown so the
    // upload stays associated with the post and remains rebake/CDN friendly.
    // NewsNook resolves it to the canonical HTTP URL only inside local preview.
    const target = upload.shortUrl || upload.url
    return file.type.startsWith('image/')
      ? '![' + label.replace(/\]/g, '\\]') + '](' + target + ')'
      : '[' + label.replace(/\]/g, '\\]') + '](' + target + ')'
  }

  shortUrls(raw: string): string[] {
    return Array.from(new Set(raw.match(/upload:\/\/[A-Za-z0-9._~-]+/g) ?? []))
  }

  async lookupPreviewUrls(shortUrls: string[]): Promise<Record<string, string>> {
    if (!this.api || shortUrls.length === 0) return {}
    const payload = await this.api.postForm<Array<{ short_url?: string; url?: string }>>(
      linuxDoEndpoints.uploadLookupUrls,
      { 'short_urls[]': shortUrls },
      { auth: 'required' },
    )
    const result: Record<string, string> = {}
    for (const item of Array.isArray(payload) ? payload : []) {
      const shortUrl = typeof item?.short_url === 'string' ? item.short_url : ''
      const url = typeof item?.url === 'string' ? absoluteUrl(item.url) : ''
      if (shortUrl && url) result[shortUrl] = url
    }
    return result
  }
}
