/**
 * DLNA 投屏控制：设备发现、连接（先刷新原生播放上下文再起播）、遥控与结束。
 * 电视播放归渲染器（直连）或前台中转服务所有，播放器 UI 卸载不停止投屏。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import {
  addManualDlnaDevice,
  discoverDlnaDevices,
  isDlnaCastAvailable,
  isManualDlnaDeviceSupported,
  removeManualDlnaDevice,
  startDlnaCast,
  type DlnaCastDevice,
  type DlnaCastSession,
  type DlnaCastStatus,
} from '../../lib/dlnaCast'
import {
  controlActiveDlnaCast,
  setActiveDlnaCast,
  stopActiveDlnaCast,
  useDlnaCastSession,
} from '../../features/cast/session'
import { prepareNativeMediaPlayback } from '../../features/mediaSniffer/native'
import { isAirPlaySupported, showAirPlayPicker } from './airPlay'
import { playableFormatForUrl, type PlayableFormat } from './playback'

export function useCastControls(options: {
  src: string
  format?: PlayableFormat
  title?: string
  sourcePage?: string
  requestHeaders?: Record<string, string>
  extraUrls?: string[]
  videoRef: RefObject<HTMLVideoElement | null>
  current: number
  duration: number
  immersive: boolean
  exitFullscreen: () => void
  showPlayerToast: (message: string) => void
}) {
  const {
    src,
    format,
    title,
    sourcePage,
    requestHeaders,
    extraUrls,
    videoRef,
    current,
    duration,
    immersive,
    exitFullscreen,
    showPlayerToast,
  } = options

  const castSessionRef = useRef<DlnaCastSession | null>(null)
  const [castOpen, setCastOpen] = useState(false)
  const [castDevices, setCastDevices] = useState<DlnaCastDevice[]>([])
  const [castSearching, setCastSearching] = useState(false)
  const [castConnectingId, setCastConnectingId] = useState<string | null>(null)
  const [castManualPending, setCastManualPending] = useState(false)
  const [castError, setCastError] = useState<string | null>(null)
  const {
    session: castSession,
    status: castStatus,
    error: castSessionError,
  } = useDlnaCastSession()

  const manualDeviceSupported = isManualDlnaDeviceSupported()
  const airPlaySupported = isAirPlaySupported()

  const refreshCastDevices = useCallback(async () => {
    if (!isDlnaCastAvailable()) {
      setCastError('当前平台不支持投屏')
      return
    }
    setCastSearching(true)
    setCastError(null)
    try {
      const devices = await discoverDlnaDevices()
      setCastDevices(devices)
    } catch (error) {
      setCastDevices([])
      setCastError(error instanceof Error ? error.message : '搜索投屏设备失败')
    } finally {
      setCastSearching(false)
    }
  }, [])

  const openCastPicker = useCallback(() => {
    if (!isDlnaCastAvailable()) {
      showPlayerToast('当前平台不支持投屏')
      return
    }
    setCastError(null)
    setCastOpen(true)
    if (!castSessionRef.current) void refreshCastDevices()
  }, [refreshCastDevices, showPlayerToast])

  const connectCastDevice = useCallback(async (device: DlnaCastDevice) => {
    const castFormat = playableFormatForUrl(src, format)
    if (castFormat === 'dash') {
      setCastError('DASH 视频源暂不支持投屏')
      return
    }

    setCastConnectingId(device.id)
    setCastError(null)
    try {
      // Refresh the native playback context before the TV starts requesting the
      // temporary relay URL. This preserves Referer/Cookie/proxy information
      // captured for custom CMS sources.
      await prepareNativeMediaPlayback({
        url: src,
        sourcePage,
        format: castFormat,
        headers: requestHeaders,
        extraUrls,
        forceBridge: true,
      })

      const video = videoRef.current
      const positionSeconds = video && Number.isFinite(video.currentTime)
        ? video.currentTime
        : current
      const session = await startDlnaCast({
        deviceId: device.id,
        url: src,
        title: title || '文章视频',
        format: castFormat,
        positionSeconds,
      })

      const initialStatus: DlnaCastStatus = {
        state: 'playing',
        current: positionSeconds,
        duration,
        deviceName: session.deviceName,
      }
      castSessionRef.current = session
      setActiveDlnaCast(session, initialStatus)
      video?.pause()
      if (immersive) exitFullscreen()
    } catch (error) {
      setCastError(error instanceof Error ? error.message : '无法开始投屏')
    } finally {
      setCastConnectingId(null)
    }
  }, [current, duration, exitFullscreen, extraUrls, format, immersive, requestHeaders, sourcePage, src, title, videoRef])

  const addManualCastDevice = useCallback(
    async (address: string) => {
      if (!manualDeviceSupported) {
        setCastError('当前平台不支持手动添加投屏设备')
        return
      }
      const trimmed = address.trim()
      if (!trimmed) {
        setCastError('请填写电视的 IP 地址')
        return
      }
      setCastManualPending(true)
      setCastError(null)
      try {
        const device = await addManualDlnaDevice({ address: trimmed })
        setCastDevices((current) => [
          ...current.filter((item) => item.id !== device.id),
          device,
        ])
        // 手输一次 IP 的意图就是投屏，别再让用户点一次。
        await connectCastDevice(device)
      } catch (error) {
        setCastError(error instanceof Error ? error.message : '添加投屏设备失败')
      } finally {
        setCastManualPending(false)
      }
    },
    [connectCastDevice, manualDeviceSupported],
  )

  const removeManualCastDevice = useCallback(
    async (deviceId: string) => {
      if (!manualDeviceSupported) return
      try {
        await removeManualDlnaDevice(deviceId)
      } catch {
        // 移除失败不阻塞 UI：下面照样把它从列表里摘掉。
      }
      setCastDevices((current) => current.filter((item) => item.id !== deviceId))
    },
    [manualDeviceSupported],
  )

  /**
   * AirPlay 走 WebKit 的 `webkitShowPlaybackTargetPicker()`，路由的是这个 video
   * 元素本身（不是 App 的音频会话），所以不需要任何原生代码。
   */
  const startAirPlay = useCallback(() => {
    if (!showAirPlayPicker(videoRef.current)) {
      showPlayerToast('当前 WebView 不支持 AirPlay，请改用投屏')
    }
  }, [showPlayerToast, videoRef])

  const sendCastControl = useCallback(async (
    action: 'play' | 'pause' | 'seek' | 'volume',
    value?: number,
  ) => {
    if (!castSessionRef.current) return
    setCastError(null)
    await controlActiveDlnaCast(action, value)
  }, [])

  const endCast = useCallback(async () => {
    castSessionRef.current = null
    setCastError(null)
    setCastOpen(false)
    try {
      await stopActiveDlnaCast()
    } catch {
      // The renderer may already be offline; native cleanup still runs when possible.
    }
    showPlayerToast('已结束投屏')
  }, [showPlayerToast])

  useEffect(() => {
    castSessionRef.current = castSession
  }, [castSession])

  useEffect(
    () => () => {
      // Leaving the player only detaches this UI. Television playback belongs to
      // the renderer (direct) or the foreground relay service (compatibility mode).
      castSessionRef.current = null
    },
    [],
  )

  return {
    castOpen,
    setCastOpen,
    castDevices,
    castSearching,
    castConnectingId,
    castManualPending,
    castError,
    castSession,
    castStatus,
    castSessionError,
    manualDeviceSupported,
    airPlaySupported,
    openCastPicker,
    refreshCastDevices,
    connectCastDevice,
    addManualCastDevice,
    removeManualCastDevice,
    startAirPlay,
    sendCastControl,
    endCast,
  }
}
