import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

const isNative = Capacitor.isNativePlatform()

/**
 * 跨平台触觉反馈服务。
 * 在 Android 真机上调用高低频线性马达以提供原生触觉；在 Web 环境静默安全降级。
 */
export const haptics = {
  /**
   * 细微滴答：用于 Tab 切换、分段器切换、微交互。
   */
  async tick(): Promise<void> {
    if (!isNative) return
    try {
      await Haptics.impact({ style: ImpactStyle.Light })
    } catch {
      // 容错降级
    }
  },

  /**
   * 选项切换/轮盘步进：用于列表条目切换、选择器变更。
   */
  async selection(): Promise<void> {
    if (!isNative) return
    try {
      await Haptics.selectionChanged()
    } catch {
      try {
        await Haptics.impact({ style: ImpactStyle.Light })
      } catch {
        // 容错降级
      }
    }
  },

  /**
   * 临界段落顿挫：用于下拉刷新拉满触发阈值、滑动越界卡扣。
   */
  async snap(): Promise<void> {
    if (!isNative) return
    try {
      await Haptics.impact({ style: ImpactStyle.Medium })
    } catch {
      // 容错降级
    }
  },

  /**
   * 开关拨动：用于 ToggleSwitch、长按操作。
   */
  async toggle(): Promise<void> {
    if (!isNative) return
    try {
      await Haptics.impact({ style: ImpactStyle.Light })
    } catch {
      // 容错降级
    }
  },

  /**
   * 确认成功：用于稍后读收藏、配置成功保存。
   */
  async success(): Promise<void> {
    if (!isNative) return
    try {
      await Haptics.notification({ type: NotificationType.Success })
    } catch {
      // 容错降级
    }
  },

  /**
   * 警告或失败。
   */
  async warning(): Promise<void> {
    if (!isNative) return
    try {
      await Haptics.notification({ type: NotificationType.Warning })
    } catch {
      // 容错降级
    }
  },
}
