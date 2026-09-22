import AVFAudio
import Capacitor
import MediaPlayer
import UIKit

@objc(DeviceMediaControlsPlugin)
public final class DeviceMediaControlsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceMediaControlsPlugin"
    public let jsName = "DeviceMediaControls"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
    ]

    private let volumeView = MPVolumeView(frame: .zero)
    private var originalBrightness: CGFloat?
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        observers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.restoreBrightness()
            }
        )
        DispatchQueue.main.async { [weak self] in
            self?.attachVolumeViewIfNeeded()
        }
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    @objc func getBrightness(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["value": Double(UIScreen.main.brightness)])
        }
    }

    @objc func setBrightness(_ call: CAPPluginCall) {
        guard let requested = call.getDouble("value") else {
            call.reject("缺少亮度值")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("亮度控制不可用")
                return
            }
            if self.originalBrightness == nil {
                self.originalBrightness = UIScreen.main.brightness
            }
            let target = CGFloat(Self.clamp01(requested))
            UIScreen.main.brightness = target
            call.resolve(["value": Double(UIScreen.main.brightness)])
        }
    }

    @objc func clearBrightness(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.restoreBrightness()
            call.resolve()
        }
    }

    @objc func getVolume(_ call: CAPPluginCall) {
        call.resolve(["value": Double(AVAudioSession.sharedInstance().outputVolume)])
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        guard let requested = call.getDouble("value") else {
            call.reject("缺少音量值")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("音量控制不可用")
                return
            }
            self.attachVolumeViewIfNeeded()
            guard let slider = self.volumeSlider else {
                call.reject("系统音量控件不可用")
                return
            }
            slider.value = Float(Self.clamp01(requested))
            slider.sendActions(for: .valueChanged)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                call.resolve(["value": Double(AVAudioSession.sharedInstance().outputVolume)])
            }
        }
    }

    private var volumeSlider: UISlider? {
        volumeView.subviews.compactMap { $0 as? UISlider }.first
    }

    private func attachVolumeViewIfNeeded() {
        guard volumeView.superview == nil, let host = bridge?.viewController?.view else { return }
        volumeView.frame = CGRect(x: -100, y: -100, width: 1, height: 1)
        volumeView.alpha = 0.001
        host.addSubview(volumeView)
    }

    private func restoreBrightness() {
        guard let originalBrightness else { return }
        UIScreen.main.brightness = originalBrightness
        self.originalBrightness = nil
    }

    private static func clamp01(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(1, max(0, value))
    }
}
