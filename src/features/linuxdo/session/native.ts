import { Capacitor, registerPlugin } from '@capacitor/core'

import type { LinuxDoSessionSnapshot } from '../types'

interface LinuxDoSessionPlugin {
  authenticate(options?: { url?: string }): Promise<LinuxDoSessionSnapshot>
  probeUserApiKeySupport(): Promise<{ supported: boolean; version: number; reason?: string }>
  authenticateUserApiKey(): Promise<LinuxDoSessionSnapshot>
  cancelUserApiKeyAuth(): Promise<void>
  clearUserApiKey(): Promise<void>
  snapshot(): Promise<LinuxDoSessionSnapshot>
  request(options: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; headers?: Record<string, string>; body?: string }): Promise<{ status: number; data: string; headers?: Record<string, string> }>
  beginUpload(options: { fileName: string; mimeType: string }): Promise<{ uploadId: string }>
  appendUploadChunk(options: { uploadId: string; base64: string }): Promise<{ bytesWritten: number }>
  finishUpload(options: { uploadId: string }): Promise<Record<string, unknown>>
  cancelUpload(options: { uploadId: string }): Promise<void>
  clearBrowserSession(): Promise<void>
}

const NativeLinuxDoSession = registerPlugin<LinuxDoSessionPlugin>('LinuxDoSession')

export async function probeLinuxDoUserApiKeySupport(): Promise<{ supported: boolean; version: number; reason?: string }> {
  if (!Capacitor.isNativePlatform()) return { supported: false, version: 0, reason: 'native-required' }
  return NativeLinuxDoSession.probeUserApiKeySupport()
}

export async function authenticateLinuxDo(): Promise<LinuxDoSessionSnapshot> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Linux.do 登录与互动功能需要在 NewsNook App 中使用')
  }
  return NativeLinuxDoSession.authenticateUserApiKey()
}

export async function cancelLinuxDoAuthentication(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await NativeLinuxDoSession.cancelUserApiKeyAuth()
}

export async function verifyLinuxDoBrowserSession(url = 'https://linux.do/'): Promise<LinuxDoSessionSnapshot> {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    throw new Error('浏览器端无法安全复用 Linux.do 登录会话；请在 NewsNook App 中使用')
  }
  return NativeLinuxDoSession.authenticate({ url })
}

export async function readLinuxDoSession(): Promise<LinuxDoSessionSnapshot> {
  if (!Capacitor.isNativePlatform()) return { authenticated: false, authMode: 'none' }
  return NativeLinuxDoSession.snapshot()
}

export async function requestLinuxDoNative(options: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; headers?: Record<string, string>; body?: string }): Promise<{ status: number; data: string; headers?: Record<string, string> }> {
  if (!Capacitor.isNativePlatform()) throw new Error('Linux.do 原生请求仅可在 App 内使用')
  return NativeLinuxDoSession.request(options)
}

export async function uploadLinuxDoFile(file: File, onProgress?: (progress: number) => void): Promise<Record<string, unknown>> {
  if (!Capacitor.isNativePlatform()) throw new Error('Linux.do 上传需要原生应用')
  const { uploadId } = await NativeLinuxDoSession.beginUpload({
    fileName: file.name || 'upload.bin',
    mimeType: file.type || 'application/octet-stream',
  })
  const chunkSize = 256 * 1024
  try {
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer())
      let binary = ''
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      }
      await NativeLinuxDoSession.appendUploadChunk({ uploadId, base64: btoa(binary) })
      onProgress?.(file.size ? Math.min(0.8, ((offset + bytes.length) / file.size) * 0.8) : 0.8)
    }
    const result = await NativeLinuxDoSession.finishUpload({ uploadId })
    onProgress?.(1)
    return result
  } catch (error) {
    await NativeLinuxDoSession.cancelUpload({ uploadId }).catch(() => undefined)
    throw error
  }
}

export async function clearLinuxDoSession(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await NativeLinuxDoSession.clearUserApiKey()
}

export async function clearLinuxDoBrowserSession(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await NativeLinuxDoSession.clearBrowserSession()
}
