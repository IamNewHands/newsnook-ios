import Capacitor
import Foundation
import SwiftUI
import Translation
import UIKit

/// 常驻的 1×1 隐藏宿主视图。
///
/// Translation 框架只在 SwiftUI `.translationTask` 的闭包里交出「能申请语言包下载」的
/// `TranslationSession`：`init(installedSource:target:)` 既要求语言已装好，也不能触发下载。
/// 所以这里挂一个几乎不可见的宿主视图，把 session 借给 Capacitor 调用方复用。
@available(iOS 18.0, *)
struct AppleTranslationHostView: View {
    @ObservedObject var host: AppleTranslationHost

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .translationTask(host.configuration) { session in
                host.adopt(session: session)
            }
    }
}

enum AppleTranslationError: LocalizedError {
    case timeout

    var errorDescription: String? {
        switch self {
        case .timeout:
            return "系统翻译初始化超时，请重试"
        }
    }
}

/// 借出并复用 `TranslationSession`。
///
/// 同一个语对复用同一个 session（框架允许一个 session 连续翻译多段文本）；
/// 语对变了、或者 session 报过错，就换一个新的。配置一变旧 session 再用会 fatalError，
/// 所以换配置之前必须先把它丢掉。
@available(iOS 18.0, *)
@MainActor
final class AppleTranslationHost: ObservableObject {
    @Published var configuration: TranslationSession.Configuration?

    private struct PendingRequest {
        let id: UUID
        let continuation: CheckedContinuation<TranslationSession, Error>
    }

    private var session: TranslationSession?
    private var sessionKey: String?
    private var pending: [PendingRequest] = []
    private var requestedKey: String?
    private var hostController: UIHostingController<AppleTranslationHostView>?

    /// 会话获取超时；真正的语言包下载不设上限，交给系统弹窗。
    private static let acquireTimeout: TimeInterval = 30

    nonisolated static func key(source: Locale.Language, target: Locale.Language) -> String {
        "\(source.minimalIdentifier)->\(target.minimalIdentifier)"
    }

    /// `.translationTask` 只在视图出现过之后才会执行，所以必须真的挂进视图层级。
    func attach(to parent: UIViewController?) {
        guard hostController == nil, let parent else { return }
        let controller = UIHostingController(rootView: AppleTranslationHostView(host: self))
        controller.view.backgroundColor = .clear
        controller.view.isUserInteractionEnabled = false
        controller.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        parent.addChild(controller)
        parent.view.addSubview(controller.view)
        controller.didMove(toParent: parent)
        hostController = controller
    }

    func session(
        for key: String,
        source: Locale.Language,
        target: Locale.Language
    ) async throws -> TranslationSession {
        if let cached = session, sessionKey == key { return cached }

        let requestId = UUID()
        let timeout = Self.acquireTimeout
        return try await withCheckedThrowingContinuation { continuation in
            pending.append(PendingRequest(id: requestId, continuation: continuation))
            requestedKey = key
            // 旧 session 必须先丢掉：配置一变，它再用就会 fatalError。
            session = nil
            sessionKey = nil
            // 先置 nil 再设新值：SwiftUI 只在配置「非 nil 且发生变化」时重跑 action，
            // 否则同一语对的第二次请求拿不到新 session。两次赋值分属两轮 runloop。
            configuration = nil
            Task { @MainActor in
                guard !self.pending.isEmpty else { return }
                self.configuration = TranslationSession.Configuration(source: source, target: target)
            }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                self.fail(requestId: requestId, error: AppleTranslationError.timeout)
            }
        }
    }

    func adopt(session: TranslationSession) {
        self.session = session
        sessionKey = requestedKey
        let waiting = pending
        pending = []
        for request in waiting {
            request.continuation.resume(returning: session)
        }
    }

    /// session 出过错就不能再用了，丢掉让下次重建。
    func discardSession() {
        session = nil
        sessionKey = nil
    }

    private func fail(requestId: UUID, error: Error) {
        guard let index = pending.firstIndex(where: { $0.id == requestId }) else { return }
        let request = pending.remove(at: index)
        request.continuation.resume(throwing: error)
    }
}

/// iOS 18+ 系统内置翻译（Translation 框架）。
///
/// 整个类带 `@available(iOS 18.0, *)`，因此在更低版本的系统上不会被注册，
/// JS 侧 `Capacitor.isPluginAvailable('AppleTranslation')` 会如实返回 false。
@available(iOS 18.0, *)
@objc(AppleTranslationPlugin)
public final class AppleTranslationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleTranslationPlugin"
    public let jsName = "AppleTranslation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLanguageStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareLanguagePack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "translate", returnType: CAPPluginReturnPromise),
    ]

    private var host: AppleTranslationHost?

    @MainActor
    private func sharedHost() -> AppleTranslationHost {
        if let existing = host { return existing }
        let created = AppleTranslationHost()
        created.attach(to: bridge?.viewController)
        host = created
        return created
    }

    @objc func getLanguageStatus(_ call: CAPPluginCall) {
        guard let pair = languagePair(call) else {
            call.reject("缺少原文或译文语言")
            return
        }
        Task { @MainActor in
            let status = await LanguageAvailability().status(from: pair.source, to: pair.target)
            call.resolve(Self.payload(status))
        }
    }

    @objc func prepareLanguagePack(_ call: CAPPluginCall) {
        guard let pair = languagePair(call) else {
            call.reject("缺少原文或译文语言")
            return
        }
        Task { @MainActor in
            let host = sharedHost()
            do {
                let session = try await host.session(
                    for: AppleTranslationHost.key(source: pair.source, target: pair.target),
                    source: pair.source,
                    target: pair.target
                )
                try await session.prepareTranslation()
                let status = await LanguageAvailability().status(from: pair.source, to: pair.target)
                call.resolve(Self.payload(status))
            } catch {
                host.discardSession()
                call.reject(Self.message(for: error))
            }
        }
    }

    @objc func translate(_ call: CAPPluginCall) {
        guard let pair = languagePair(call) else {
            call.reject("缺少原文或译文语言")
            return
        }
        let texts = call.getArray("texts", String.self) ?? []
        guard !texts.isEmpty else {
            call.reject("缺少待翻译文本")
            return
        }
        Task { @MainActor in
            let host = sharedHost()
            do {
                let session = try await host.session(
                    for: AppleTranslationHost.key(source: pair.source, target: pair.target),
                    source: pair.source,
                    target: pair.target
                )
                let requests = texts.enumerated().map { index, text in
                    TranslationSession.Request(
                        sourceText: text,
                        clientIdentifier: String(index)
                    )
                }
                let responses = try await session.translations(from: requests)
                // 对不上号的条目原样返回原文，避免整批失败。
                var translations = texts
                for response in responses {
                    guard
                        let identifier = response.clientIdentifier,
                        let index = Int(identifier),
                        translations.indices.contains(index)
                    else { continue }
                    translations[index] = response.targetText
                }
                call.resolve(["translations": translations])
            } catch {
                host.discardSession()
                call.reject(Self.message(for: error))
            }
        }
    }

    /// 解析参数：必须在 `@MainActor` 之外也能调用，所以显式 `nonisolated`。
    nonisolated private func languagePair(
        _ call: CAPPluginCall
    ) -> (source: Locale.Language, target: Locale.Language)? {
        guard
            let source = call.getString("sourceLanguage"), !source.isEmpty,
            let target = call.getString("targetLanguage"), !target.isEmpty
        else { return nil }
        return (Locale.Language(identifier: source), Locale.Language(identifier: target))
    }

    nonisolated private static func payload(_ status: LanguageAvailability.Status) -> [String: Any] {
        switch status {
        case .installed:
            return ["status": "installed", "ready": true]
        case .supported:
            return ["status": "supported", "ready": false]
        case .unsupported:
            return ["status": "unsupported", "ready": false]
        @unknown default:
            return ["status": "unsupported", "ready": false]
        }
    }

    nonisolated private static func message(for error: Error) -> String {
        if let own = error as? AppleTranslationError, let text = own.errorDescription {
            return text
        }
        // TranslationError 的具体错误码是 iOS 26 才公开的；更低的系统只用系统自带描述。
        if #available(iOS 26.0, *) {
            if TranslationError.notInstalled ~= error {
                return "该语对的语言包还没下载，请先点「下载语言包」"
            }
            if TranslationError.unsupportedLanguagePairing ~= error {
                return "系统不支持这个语对"
            }
            if TranslationError.unsupportedSourceLanguage ~= error {
                return "系统不支持该原文语言"
            }
            if TranslationError.unsupportedTargetLanguage ~= error {
                return "系统不支持该译文语言"
            }
            if TranslationError.nothingToTranslate ~= error {
                return "没有可翻译的内容"
            }
        }
        return "系统翻译失败：\(error.localizedDescription)"
    }
}
