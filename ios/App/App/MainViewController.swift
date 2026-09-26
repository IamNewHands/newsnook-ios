import Capacitor
import UIKit

public final class MainViewController: CAPBridgeViewController {
    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 14 / 255, green: 15 / 255, blue: 18 / 255, alpha: 1)
        bridge?.webView?.isOpaque = false
        bridge?.webView?.backgroundColor = view.backgroundColor
    }

    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeviceMediaControlsPlugin())
        bridge?.registerPluginInstance(ProxiedHttpPlugin())
        bridge?.registerPluginInstance(SecureStorePlugin())
        bridge?.registerPluginInstance(ZhihuSessionPlugin())
        bridge?.registerPluginInstance(LinuxDoSessionPlugin())
        bridge?.registerPluginInstance(SyncNotificationPlugin())
        bridge?.registerPluginInstance(ReadAloudPlugin())
        bridge?.registerPluginInstance(DlnaCastPlugin())
        // 系统内置翻译要求 iOS 18+，低版本不注册，JS 侧 isPluginAvailable 会如实返回 false。
        if #available(iOS 18.0, *) {
            bridge?.registerPluginInstance(AppleTranslationPlugin())
        }
    }
}
