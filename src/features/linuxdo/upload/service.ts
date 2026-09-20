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
  if (/^https?:\/\//i.test(value)) return value
  return value.startsWith('/') ? 'https://linux.do' + value : value
}

export class LinuxDoUploadService {
  async upload(file: File, onProgress?: (progress: number) => void): Promise<LinuxDoUpload> {
    const payload = await uploadLinuxDoFile(file, onProgress) as any
    const url = String(payload?.short_url ?? payload?.url ?? '')
    if (!url) throw new Error('Linux.do 未返回上传地址')
    return {
      id: typeof payload?.id === 'number' ? payload.id : undefined,
      url: absoluteUrl(url),
      shortUrl: typeof payload?.short_url === 'string' ? payload.short_url : undefined,
      originalFilename: typeof payload?.original_filename === 'string' ? payload.original_filename : file.name,
      width: typeof payload?.width === 'number' ? payload.width : undefined,
      height: typeof payload?.height === 'number' ? payload.height : undefined,
    }
  }

  markdown(upload: LinuxDoUpload, file: File): string {
    const label = upload.originalFilename || file.name || 'upload'
    return file.type.startsWith('image/')
      ? '![' + label.replace(/\]/g, '\\]') + '](' + (upload.shortUrl || upload.url) + ')'
      : '[' + label.replace(/\]/g, '\\]') + '](' + (upload.shortUrl || upload.url) + ')'
  }
}
