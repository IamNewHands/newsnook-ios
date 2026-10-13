import { Capacitor, registerPlugin } from '@capacitor/core'

export interface DlnaCastDevice {
  id: string
  name: string
  manufacturer?: string
  model?: string
  address: string
  supportsVolume: boolean
  /** 用户手动填 IP 添加的设备（iOS）。UI 据此给「移除」入口。 */
  manual?: boolean
}

export type DlnaCastState =
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'transitioning'
  | 'unknown'

export type DlnaCastMode = 'direct' | 'proxy'

export interface DlnaCastSession {
  id: string
  deviceId: string
  deviceName: string
  mode: DlnaCastMode
}

export interface DlnaCastStatus {
  state: DlnaCastState
  current: number
  duration: number
  volume?: number
  deviceName: string
}

export interface DlnaCastRestoreResult {
  session?: DlnaCastSession
  status?: DlnaCastStatus
}

type CastFormat = 'progressive' | 'hls' | 'dash'
type CastAction = 'play' | 'pause' | 'seek' | 'volume'

interface DlnaCastPlugin {
  discover(options: { timeoutMs: number }): Promise<{ devices: DlnaCastDevice[] }>
  start(options: {
    deviceId: string
    url: string
    title?: string
    format: CastFormat
    positionSeconds?: number
  }): Promise<DlnaCastSession>
  restore(): Promise<DlnaCastRestoreResult>
  getStatus(options: { sessionId: string }): Promise<DlnaCastStatus>
  control(options: {
    sessionId: string
    action: CastAction
    value?: number
  }): Promise<void>
  stop(options: { sessionId: string }): Promise<void>
  /** iOS 专属：手动填电视 IP。单播 SSDP 扫段之外的第二条发现路径。 */
  addManualDevice(options: {
    address: string
    name?: string
  }): Promise<{ device: DlnaCastDevice }>
  removeManualDevice(options: { deviceId: string }): Promise<void>
  listManualDevices(): Promise<{ devices: DlnaCastDevice[] }>
}

const NativeDlnaCast = registerPlugin<DlnaCastPlugin>('DlnaCast')

/** 有原生投屏出口的平台。 */
const NATIVE_CAST_PLATFORMS = ['android', 'ios']

export function isDlnaCastAvailable(): boolean {
  return (
    NATIVE_CAST_PLATFORMS.includes(Capacitor.getPlatform()) &&
    Capacitor.isPluginAvailable('DlnaCast')
  )
}

/**
 * 手动填 IP 只有 iOS 实现：Android 的组播发现本来就能扫到局域网里的电视，
 * 手动入口是 iOS 拿不到 multicast entitlement 的补偿路径。
 */
export function isManualDlnaDeviceSupported(): boolean {
  return Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('DlnaCast')
}

function requireNativeCast(): void {
  if (!isDlnaCastAvailable()) {
    throw new Error('当前平台不支持投屏')
  }
}

export async function discoverDlnaDevices(timeoutMs = 2600): Promise<DlnaCastDevice[]> {
  requireNativeCast()
  const result = await NativeDlnaCast.discover({ timeoutMs })
  return Array.isArray(result.devices) ? result.devices : []
}

export async function startDlnaCast(options: {
  deviceId: string
  url: string
  title?: string
  format: CastFormat
  positionSeconds?: number
}): Promise<DlnaCastSession> {
  requireNativeCast()
  return NativeDlnaCast.start(options)
}

export async function restoreDlnaCast(): Promise<DlnaCastRestoreResult> {
  if (!isDlnaCastAvailable()) return {}
  return NativeDlnaCast.restore()
}

export async function getDlnaCastStatus(sessionId: string): Promise<DlnaCastStatus> {
  requireNativeCast()
  return NativeDlnaCast.getStatus({ sessionId })
}

export async function controlDlnaCast(
  sessionId: string,
  action: CastAction,
  value?: number,
): Promise<void> {
  requireNativeCast()
  await NativeDlnaCast.control({
    sessionId,
    action,
    ...(value == null ? {} : { value }),
  })
}

export async function stopDlnaCast(sessionId: string): Promise<void> {
  if (!isDlnaCastAvailable()) return
  await NativeDlnaCast.stop({ sessionId })
}

/** 手动添加一台电视（iOS）。地址接受 `192.168.1.10`、`192.168.1.10:8080` 或完整 URL。 */
export async function addManualDlnaDevice(options: {
  address: string
  name?: string
}): Promise<DlnaCastDevice> {
  if (!isManualDlnaDeviceSupported()) {
    throw new Error('当前平台不支持手动添加投屏设备')
  }
  const result = await NativeDlnaCast.addManualDevice(options)
  return result.device
}

export async function removeManualDlnaDevice(deviceId: string): Promise<void> {
  if (!isManualDlnaDeviceSupported()) return
  await NativeDlnaCast.removeManualDevice({ deviceId })
}

export async function listManualDlnaDevices(): Promise<DlnaCastDevice[]> {
  if (!isManualDlnaDeviceSupported()) return []
  const result = await NativeDlnaCast.listManualDevices()
  return Array.isArray(result.devices) ? result.devices : []
}
