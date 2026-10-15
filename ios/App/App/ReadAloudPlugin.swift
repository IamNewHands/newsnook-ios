import AVFoundation
import Capacitor
import MediaPlayer
import UIKit

/// iOS 侧的「文章朗读」原生能力。
///
/// 与 Android `ReadAloudPlugin` + `ReadAloudPlaybackService` 的分工对齐：Android 把播放
/// 生命周期放在前台 Service 里（Plugin 只是薄桥），iOS 没有前台 Service，等价物是
/// `UIBackgroundModes: audio` + 一直保持 active 的 `AVAudioSession(.playback)`：
/// 只要会话还 active，App 就不会被挂起，后台朗读继续、锁屏控制也一直有效。
/// 因此会话的 active 区间与 Android 的 Service 存活区间一致——从第一次 speak /
/// `setMediaSession(active: true)` 到 stop / `setMediaSession(active: false)`，
/// **暂停时不释放会话**（Java 的 pause 也只 abandonAudioFocus，不停服务）。
///
/// 事件名、字段与文案按 Java 源对齐：`readAloudEvent` 的 `type` / `utteranceId` /
/// `characterOffset` / `message`。因此 JS 侧的 `providers/androidSystem.ts` 与
/// `media/androidMediaSession.ts` 不需要改一行——它们本来就只依赖插件接口。
///
/// 字符偏移一律用 **UTF-16 码元**计数，与 Java `String` 下标、JS
/// `String.prototype.substring` 同一套；Swift 的 `String.count` 是字素簇，不能用。
@objc(ReadAloudPlugin)
public final class ReadAloudPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReadAloudPlugin"
    public let jsName = "ReadAloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMediaSession", returnType: CAPPluginReturnPromise),
    ]

    // Java 侧的边界值，逐条对齐。
    private static let minRate: Float = 0.5
    private static let maxRate: Float = 2.5
    private static let minPitch: Float = 0.5
    private static let maxPitch: Float = 2.0
    private static let maxAudioBase64Bytes = 18 * 1024 * 1024
    private static let audioCacheDirectoryName = "readaloud"
    private static let audioCacheTTL: TimeInterval = 24 * 60 * 60
    private static let defaultTitle = "有所闻"
    private static let defaultSource = "文章朗读"

    // ── 播放状态：全部只在主线程读写（Capacitor 默认把插件方法派到主队列）──
    private let synthesizer = AVSpeechSynthesizer()
    private var speechDelegate: ReadAloudSpeechDelegate?
    private var audioPlayer: AVAudioPlayer?
    private var audioDelegate: ReadAloudAudioDelegate?
    private var audioFileURL: URL?
    private var audioPrepared = false

    private var logicalUtteranceId: String?
    private var fullText = ""
    private var voiceId = ""
    private var languageTag = ""
    private var rate: Float = 1
    private var pitch: Float = 1
    private var currentOffset = 0
    private var baseOffset = 0
    private var paused = false
    private var synthesizerPaused = false

    private var sessionActive = false
    private var mediaState = "paused"
    private var mediaTitle = ReadAloudPlugin.defaultTitle
    private var mediaSource = ReadAloudPlugin.defaultSource
    private var mediaArtwork = ""
    private var mediaSegmentIndex = 0
    private var mediaSegmentCount = 0
    private var loadedArtworkURL: String?
    private var currentArtwork: MPMediaItemArtwork?
    private var artworkToken = 0

    private var resumeOnFocusGain = false
    private var observers: [NSObjectProtocol] = []
    private let ioQueue = DispatchQueue(
        label: "com.aizeek.newsnook.read-aloud-io",
        qos: .userInitiated
    )

    // MARK: - 生命周期

    public override func load() {
        let delegate = ReadAloudSpeechDelegate(owner: self)
        speechDelegate = delegate
        synthesizer.delegate = delegate
        configureRemoteCommands()
        observeAudioSession()
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        if synthesizer.isSpeaking || synthesizer.isPaused {
            synthesizer.stopSpeaking(at: .immediate)
        }
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: [.notifyOthersOnDeactivation]
        )
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    // MARK: - 插件方法

    @objc func isAvailable(_ call: CAPPluginCall) {
        guard !AVSpeechSynthesisVoice.speechVoices().isEmpty else {
            call.reject("系统语音不可用")
            return
        }
        call.resolve(["available": true])
    }

    @objc func listVoices(_ call: CAPPluginCall) {
        // 与 Java 一致：先按语言再按名字排序，让「我的 → 朗读」里的列表稳定。
        let voices = AVSpeechSynthesisVoice.speechVoices()
            .sorted { left, right in
                left.language == right.language
                    ? left.name < right.name
                    : left.language < right.language
            }
            .map { voice -> [String: Any] in
                [
                    "id": voice.identifier,
                    "name": voice.name,
                    "engineName": "Apple",
                    "lang": voice.language,
                    // AVSpeechSynthesizer 只念设备上已安装的音色，从不联网取音；
                    // 增强/高级音色也是下载到本地之后才可用。
                    "local": true,
                ]
            }
        call.resolve(["voices": voices])
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard
            let utteranceId = call.getString("utteranceId"), !utteranceId.isEmpty,
            let text = call.getString("text"),
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            call.reject("缺少朗读文本或 utteranceId")
            return
        }

        logicalUtteranceId = utteranceId
        fullText = text
        voiceId = call.getString("voiceId", "")
        languageTag = call.getString("languageTag", "")
        rate = Self.clamp(Float(call.getDouble("rate", 1)), min: Self.minRate, max: Self.maxRate)
        pitch = Self.clamp(
            Float(call.getDouble("pitch", 1)),
            min: Self.minPitch,
            max: Self.maxPitch
        )
        currentOffset = clampOffset(call.getInt("startOffset", 0))
        baseOffset = currentOffset
        paused = false
        synthesizerPaused = false

        speakFrom(currentOffset)
        call.resolve()
    }

    @objc func pause(_ call: CAPPluginCall) {
        pauseInternal(emitPlayControl: true)
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        resumeInternal(emitPlayControl: true)
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopInternal(emitControl: true)
        call.resolve()
    }

    @objc func playAudio(_ call: CAPPluginCall) {
        guard
            let utteranceId = call.getString("utteranceId"), !utteranceId.isEmpty,
            let base64 = call.getString("base64"), !base64.isEmpty
        else {
            call.reject("缺少 AI TTS 音频或 utteranceId")
            return
        }
        let mimeType = call.getString("mimeType", "audio/mpeg")

        // Java 先剥 data URL 前缀再判长度，这里保持一致（同一份 base64 会先被
        // `providers/aiTts.ts` 拼成 data URL）。
        let encoded = Self.stripDataURLPrefix(base64)
        guard encoded.utf8.count <= Self.maxAudioBase64Bytes else {
            call.reject("AI TTS 音频过大")
            return
        }

        // 与 Android 的 ioExecutor 对齐：最大 18 MB 的 base64 解码 + 落盘不能占主线程。
        ioQueue.async { [weak self] in
            guard let self else {
                call.reject("AI TTS 音频缓存或播放服务启动失败")
                return
            }
            let result = Self.writeAudioFile(base64: encoded, mimeType: mimeType)
            DispatchQueue.main.async {
                switch result {
                case .failure(let message):
                    call.reject(message)
                case .success(let url):
                    self.logicalUtteranceId = utteranceId
                    self.fullText = ""
                    self.paused = false
                    self.playAudioFile(at: url)
                    call.resolve()
                }
            }
        }
    }

    @objc func setMediaSession(_ call: CAPPluginCall) {
        // Java 在 active=false 时走 ACTION_STOP：停播放并广播 stop。
        guard call.getBool("active", false) else {
            stopInternal(emitControl: true)
            call.resolve()
            return
        }

        sessionActive = true
        mediaTitle = Self.nonBlank(call.getString("title", ""), fallback: mediaTitle)
        mediaSource = Self.nonBlank(call.getString("sourceName", ""), fallback: mediaSource)
        mediaArtwork = call.getString("artwork", "")
        mediaState = Self.nonBlank(call.getString("state", ""), fallback: mediaState)
        mediaSegmentIndex = max(0, call.getInt("segmentIndex", 0))
        mediaSegmentCount = max(0, call.getInt("segmentCount", 0))

        // 会话 active 区间 = Android 前台 Service 存活区间。
        activateAudioSession()
        updateNowPlaying()
        call.resolve()
    }

    // MARK: - 朗读控制

    private func speakFrom(_ requestedOffset: Int) {
        guard !fullText.isEmpty else { return }
        let offset = clampOffset(requestedOffset)
        if offset >= utf16Length {
            currentOffset = utf16Length
            emit("ended", characterOffset: currentOffset)
            return
        }
        guard activateAudioSession() else {
            emit("error", characterOffset: currentOffset, message: "无法获取媒体音频会话")
            return
        }

        paused = false
        synthesizerPaused = false
        currentOffset = offset
        baseOffset = offset

        let utterance = AVSpeechUtterance(string: Self.dropUTF16Prefix(fullText, count: offset))
        utterance.rate = Self.iosRate(rate)
        utterance.pitchMultiplier = pitch
        utterance.voice = resolveVoice()
        utterance.preUtteranceDelay = 0
        utterance.postUtteranceDelay = 0
        synthesizer.speak(utterance)
    }

    private func pauseInternal(emitPlayControl: Bool) {
        guard isSpeakingOrPaused else { return }
        paused = true
        if synthesizer.isSpeaking {
            // iOS 有真正的暂停（Android 的 TTS 没有，只能 stop 后按 offset 重念）。
            // 用 .word 让当前词念完再停，听感比 Android 的「重念当前词」更自然。
            if synthesizer.pauseSpeaking(at: .word) {
                synthesizerPaused = true
            }
        }
        if let player = audioPlayer, player.isPlaying {
            player.pause()
        }
        mediaState = "paused"
        updateNowPlaying()
        if emitPlayControl { emit("pause") }
    }

    private func resumeInternal(emitPlayControl: Bool) {
        guard paused else { return }
        paused = false
        mediaState = "playing"
        updateNowPlaying()

        if !fullText.isEmpty {
            var continued = false
            if synthesizerPaused {
                synthesizerPaused = false
                continued = synthesizer.continueSpeaking()
            }
            // 暂停还没落地时 continueSpeaking() 会返回 false，退回按 offset 重念。
            if !continued { speakFrom(currentOffset) }
        } else if let player = audioPlayer, audioPrepared {
            activateAudioSession()
            player.play()
        }
        if emitPlayControl { emit("play") }
    }

    private func stopInternal(emitControl: Bool) {
        paused = false
        synthesizerPaused = false
        sessionActive = false
        if synthesizer.isSpeaking || synthesizer.isPaused {
            // 立刻打断：`didCancel` 由 delegate 静默吞掉（我们自己发起的取消不算错误）。
            synthesizer.stopSpeaking(at: .immediate)
        }
        releaseAudioPlayer(deleteFile: true)
        deactivateAudioSession()
        fullText = ""
        logicalUtteranceId = nil
        currentOffset = 0
        baseOffset = 0
        mediaState = "paused"
        resetArtwork()
        updateNowPlaying()
        if emitControl { emit("stop") }
    }

    // MARK: - AI TTS 音频播放

    private func playAudioFile(at url: URL) {
        releaseAudioPlayer(deleteFile: false)
        audioFileURL = url

        guard activateAudioSession() else {
            emit("error", message: "无法获取媒体音频会话")
            Self.removeFile(at: url)
            audioFileURL = nil
            return
        }
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            let delegate = ReadAloudAudioDelegate(owner: self)
            player.delegate = delegate
            audioDelegate = delegate
            player.prepareToPlay()
            guard player.play() else {
                throw NSError(
                    domain: "NewsNookReadAloud",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "AVAudioPlayer.play() 返回 false"]
                )
            }
            audioPlayer = player
            audioPrepared = true
            mediaState = "playing"
            updateNowPlaying()
            emit("started")
        } catch {
            emit("error", message: "AI TTS 音频缓存或播放失败")
            Self.removeFile(at: url)
            audioFileURL = nil
        }
    }

    private func releaseAudioPlayer(deleteFile: Bool) {
        if let player = audioPlayer {
            player.delegate = nil
            player.stop()
            audioPlayer = nil
        }
        audioDelegate = nil
        audioPrepared = false
        if deleteFile, let url = audioFileURL {
            Self.removeFile(at: url)
            audioFileURL = nil
        }
    }

    // MARK: - delegate 回调（由 ReadAloudSpeechDelegate / ReadAloudAudioDelegate 转发）

    fileprivate func handleSpeechStarted() {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.fullText.isEmpty else { return }
            self.mediaState = "playing"
            self.updateNowPlaying()
            self.emit("started", characterOffset: self.currentOffset)
        }
    }

    fileprivate func handleSpeechFinished() {
        DispatchQueue.main.async { [weak self] in
            // stopInternal 会先清空 fullText；暂停中到达的 didFinish 也要忽略
            // （与 Java onDone 的 `!paused` 判据一致）。
            guard let self, !self.paused, !self.fullText.isEmpty else { return }
            self.currentOffset = self.utf16Length
            self.mediaState = "paused"
            self.updateNowPlaying()
            self.emit("ended", characterOffset: self.currentOffset)
        }
    }

    /// 我们自己调 `stopSpeaking` 触发的取消不是错误，什么都不发。
    fileprivate func handleSpeechCancelled() {}

    fileprivate func handleSpeechRange(location: Int) {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.fullText.isEmpty else { return }
            // `characterRange` 是「去掉 startOffset 之后那段文本」里的位置，
            // 加回 baseOffset 才是相对整段文本的绝对偏移。
            self.currentOffset = min(self.utf16Length, max(0, self.baseOffset + location))
            self.emit("range", characterOffset: self.currentOffset)
        }
    }

    fileprivate func handleAudioFinished() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.releaseAudioPlayer(deleteFile: true)
            self.mediaState = "paused"
            self.updateNowPlaying()
            self.emit("ended")
        }
    }

    fileprivate func handleAudioDecodeError() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.releaseAudioPlayer(deleteFile: true)
            self.mediaState = "paused"
            self.updateNowPlaying()
            self.emit("error", message: "AI TTS 音频无法播放")
        }
    }

    // MARK: - 音频会话

    @discardableResult
    private func activateAudioSession() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            // 与 Android 的 USAGE_MEDIA + CONTENT_TYPE_SPEECH 对齐。
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true)
            return true
        } catch {
            return false
        }
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: [.notifyOthersOnDeactivation]
        )
    }

    private func observeAudioSession() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        observers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: session,
                queue: .main
            ) { [weak self] note in
                self?.handleInterruption(note)
            }
        )
        observers.append(
            center.addObserver(
                forName: AVAudioSession.routeChangeNotification,
                object: session,
                queue: .main
            ) { [weak self] note in
                self?.handleRouteChange(note)
            }
        )
    }

    /// 等价 Java `handleAudioFocusChange`：临时丢失焦点先暂停并记住，恢复时若系统允许
    /// 就继续念（focus-gain + play 两个事件，顺序与 Java 一致）。
    private func handleInterruption(_ note: Notification) {
        guard
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }

        switch type {
        case .began:
            resumeOnFocusGain = sessionActive && mediaState == "playing"
            pauseInternal(emitPlayControl: false)
            emit("focus-loss")
        case .ended:
            let rawOptions = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            guard resumeOnFocusGain, options.contains(.shouldResume) else { return }
            resumeOnFocusGain = false
            resumeInternal(emitPlayControl: false)
            emit("focus-gain")
            // JS 同步自己的状态；重复 resume 到 native 会因 paused=false 安全 no-op。
            emit("play")
        @unknown default:
            break
        }
    }

    /// 等价 Android `ACTION_AUDIO_BECOMING_NOISY`：耳机拔出。
    /// Java 侧只 emit，暂停由 JS 的 media adapter 驱动；这里同样只发事件。
    private func handleRouteChange(_ note: Notification) {
        guard
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
            reason == .oldDeviceUnavailable
        else { return }
        emit("noisy")
    }

    // MARK: - 锁屏 / 控制中心

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.playCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
            guard let self else { return .commandFailed }
            self.resumeInternal(emitPlayControl: false)
            self.emit("play")
            return .success
        }

        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
            guard let self else { return .commandFailed }
            self.pauseInternal(emitPlayControl: false)
            self.emit("pause")
            return .success
        }

        // 耳机线控与部分车机的「播放/暂停」走 togglePlayPauseCommand，必须单独接。
        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
            guard let self else { return .commandFailed }
            if self.paused {
                self.resumeInternal(emitPlayControl: false)
                self.emit("play")
            } else {
                self.pauseInternal(emitPlayControl: false)
                self.emit("pause")
            }
            return .success
        }

        center.stopCommand.isEnabled = true
        center.stopCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
            guard let self else { return .commandFailed }
            self.emit("stop")
            self.stopInternal(emitControl: false)
            return .success
        }

        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
            guard let self else { return .commandFailed }
            self.pauseInternal(emitPlayControl: false)
            self.emit("next")
            return .success
        }

        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { [weak self] _ -> MPRemoteCommandHandlerStatus in
            guard let self else { return .commandFailed }
            self.pauseInternal(emitPlayControl: false)
            self.emit("previous")
            return .success
        }

        // Android 的 PlaybackState 只声明了 play/pause/stop/next/previous，
        // iOS 侧把其余命令显式关掉，避免锁屏出现「用不了但看得见」的按钮。
        for command in [
            center.skipForwardCommand,
            center.skipBackwardCommand,
            center.seekForwardCommand,
            center.seekBackwardCommand,
            center.changePlaybackPositionCommand,
            center.changePlaybackRateCommand,
            center.ratingCommand,
            center.likeCommand,
            center.dislikeCommand,
            center.bookmarkCommand,
        ] {
            command.isEnabled = false
        }
    }

    private func updateNowPlaying() {
        loadArtworkIfNeeded()
        refreshNowPlayingInfo()
    }

    private func refreshNowPlayingInfo() {
        let center = MPNowPlayingInfoCenter.default()
        guard sessionActive else {
            center.nowPlayingInfo = nil
            center.playbackState = .stopped
            return
        }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: mediaTitle,
            MPMediaItemPropertyArtist: mediaSource,
            MPMediaItemPropertyAlbumTitle: mediaSegmentCount > 0
                ? "第 \(mediaSegmentIndex + 1) / \(mediaSegmentCount) 段"
                : "文章朗读",
            MPNowPlayingInfoPropertyPlaybackRate: mediaState == "playing" ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyMediaType: NSNumber(
                value: MPNowPlayingInfoMediaType.audio.rawValue
            ),
        ]
        if let artwork = currentArtwork {
            info[MPMediaItemPropertyArtwork] = artwork
        }
        center.nowPlayingInfo = info
        // Android 把 loading 映射成 STATE_BUFFERING（锁屏仍显示为「正在播放」）。
        center.playbackState = mediaState == "playing" || mediaState == "loading"
            ? .playing
            : .paused
    }

    /// 封面是 http(s) URL（Java 用的是 METADATA_KEY_ART_URI），异步取回后重刷一次。
    private func loadArtworkIfNeeded() {
        let target = mediaArtwork
        guard !target.isEmpty, target != loadedArtworkURL else { return }
        guard
            let url = URL(string: target),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https"
        else { return }

        loadedArtworkURL = target
        artworkToken += 1
        let token = artworkToken
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, self.artworkToken == token, self.mediaArtwork == target else {
                    return
                }
                self.currentArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.refreshNowPlayingInfo()
            }
        }.resume()
    }

    private func resetArtwork() {
        artworkToken += 1
        loadedArtworkURL = nil
        currentArtwork = nil
        mediaArtwork = ""
    }

    // MARK: - 事件与工具

    /// Java `emit(type, utteranceId, characterOffset, message)`：空字段**整个省略**
    /// 而不是给 null —— JS 的 media adapter 靠 `if (event.utteranceId) return` 区分
    /// 「朗读事件」与「媒体控制事件」。
    private func emit(_ type: String, characterOffset: Int? = nil, message: String? = nil) {
        var event: JSObject = ["type": type]
        if let id = logicalUtteranceId, !id.isEmpty {
            event["utteranceId"] = id
        }
        if let characterOffset {
            event["characterOffset"] = characterOffset
        }
        if let message {
            event["message"] = message
        }
        notifyListeners("readAloudEvent", data: event)
    }

    private var isSpeakingOrPaused: Bool {
        if paused { return true }
        if !fullText.isEmpty, synthesizer.isSpeaking || synthesizer.isPaused { return true }
        if audioPlayer != nil { return true }
        return false
    }

    /// Java `fullText.length()`：UTF-16 码元数。
    private var utf16Length: Int {
        fullText.utf16.count
    }

    private func clampOffset(_ offset: Int) -> Int {
        min(utf16Length, max(0, offset))
    }

    /// 指定了 voiceId 就按 identifier 找（JS 侧用的是 `listVoices` 回的 id）；
    /// 否则按语言标签找，`Locale.toLanguageTag()` 那种 `zh-Hans-CN` 再退一步按主语言前缀。
    /// 都找不到时返回 nil，交给系统按设备语言挑——等价 Java 回落到 `Locale.getDefault()`。
    private func resolveVoice() -> AVSpeechSynthesisVoice? {
        if !voiceId.isEmpty, let voice = AVSpeechSynthesisVoice(identifier: voiceId) {
            return voice
        }
        guard !languageTag.isEmpty else { return nil }
        if let exact = AVSpeechSynthesisVoice(language: languageTag) {
            return exact
        }
        let primary = languageTag.split(separator: "-").first.map(String.init) ?? languageTag
        let candidates = AVSpeechSynthesisVoice.speechVoices().filter {
            $0.language.hasPrefix(primary)
        }
        return candidates.first { $0.language == primary } ?? candidates.first
    }

    private static func iosRate(_ androidRate: Float) -> Float {
        // Android `setSpeechRate` 的 1.0 是常速，iOS 的常速是
        // AVSpeechUtteranceDefaultSpeechRate（0.5），所以按比例映射再夹进 iOS 区间。
        let mapped = androidRate * AVSpeechUtteranceDefaultSpeechRate
        return min(
            AVSpeechUtteranceMaximumSpeechRate,
            max(AVSpeechUtteranceMinimumSpeechRate, mapped)
        )
    }

    private static func clamp(_ value: Float, min minimum: Float, max maximum: Float) -> Float {
        if value.isNaN { return minimum }
        return Swift.max(minimum, Swift.min(maximum, value))
    }

    private static func nonBlank(_ value: String?, fallback: String) -> String {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return fallback }
        return trimmed
    }

    /// 去掉 `data:audio/mpeg;base64,` 前缀（Java 用 `indexOf(',')`）。
    private static func stripDataURLPrefix(_ value: String) -> String {
        guard let comma = value.firstIndex(of: ",") else { return value }
        return String(value[value.index(after: comma)...])
    }

    /// 按 UTF-16 码元数丢掉前缀；若切点落在代理对中间就回退一个码元，
    /// 避免造出孤立代理（JS 的 `substring` 会切出半个字符，这里不跟着错）。
    private static func dropUTF16Prefix(_ text: String, count: Int) -> String {
        let units = Array(text.utf16)
        var index = Swift.min(Swift.max(0, count), units.count)
        if index > 0, index < units.count, (0xDC00...0xDFFF).contains(units[index]) {
            index -= 1
        }
        return String(decoding: units[index...], as: UTF16.self)
    }

    private static func suffixForMime(_ mimeType: String) -> String {
        let normalized = mimeType.lowercased()
        if normalized.contains("wav") { return "wav" }
        if normalized.contains("aac") { return "aac" }
        if normalized.contains("flac") { return "flac" }
        if normalized.contains("ogg") || normalized.contains("opus") { return "ogg" }
        return "mp3"
    }

    private enum AudioWriteResult {
        case success(URL)
        case failure(String)
    }

    private static func writeAudioFile(base64: String, mimeType: String) -> AudioWriteResult {
        let directory = FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(audioCacheDirectoryName, isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
        } catch {
            return .failure("无法创建朗读缓存目录")
        }
        pruneAudioCache(in: directory)

        guard let data = Data(base64Encoded: base64, options: [.ignoreUnknownCharacters]) else {
            return .failure("AI TTS 音频缓存或播放服务启动失败")
        }
        let url = directory.appendingPathComponent(
            "tts-\(UUID().uuidString).\(suffixForMime(mimeType))"
        )
        do {
            try data.write(to: url, options: .atomic)
            return .success(url)
        } catch {
            return .failure("AI TTS 音频缓存或播放服务启动失败")
        }
    }

    /// Java `pruneCache`：清掉 24 小时前的缓存音频，清理失败不影响朗读。
    private static func pruneAudioCache(in directory: URL) {
        let cutoff = Date().addingTimeInterval(-audioCacheTTL)
        guard
            let entries = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]
            )
        else { return }
        for entry in entries {
            let values = try? entry.resourceValues(
                forKeys: [.contentModificationDateKey, .isRegularFileKey]
            )
            guard values?.isRegularFile == true else { continue }
            guard let modified = values?.contentModificationDate, modified < cutoff else {
                continue
            }
            try? FileManager.default.removeItem(at: entry)
        }
    }

    private static func removeFile(at url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}

// MARK: - AVFAudio delegate

/// `AVSpeechSynthesizerDelegate` / `AVAudioPlayerDelegate` 单独放 NSObject，不让
/// CAPPlugin 子类直接满足协议：AVFAudio 的 delegate 协议在 SDK 里带主线程标注，
/// 让插件类去满足容易撞上隔离检查（本仓库已有 `ProxiedHttpSessionDelegate` 这个先例）。
/// `AVSpeechSynthesizer.delegate` 是 weak，所以插件必须强引用这两个对象。
private final class ReadAloudSpeechDelegate: NSObject, AVSpeechSynthesizerDelegate {
    weak var owner: ReadAloudPlugin?

    init(owner: ReadAloudPlugin) {
        self.owner = owner
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didStart utterance: AVSpeechUtterance
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.owner?.handleSpeechStarted()
        }
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.owner?.handleSpeechFinished()
        }
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.owner?.handleSpeechCancelled()
        }
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        willSpeakRangeOfSpeechString characterRange: NSRange,
        utterance: AVSpeechUtterance
    ) {
        let location = characterRange.location
        DispatchQueue.main.async { [weak self] in
            self?.owner?.handleSpeechRange(location: location)
        }
    }
}

private final class ReadAloudAudioDelegate: NSObject, AVAudioPlayerDelegate {
    weak var owner: ReadAloudPlugin?

    init(owner: ReadAloudPlugin) {
        self.owner = owner
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.owner?.handleAudioFinished()
        }
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.owner?.handleAudioDecodeError()
        }
    }
}
