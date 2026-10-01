import Foundation

/// 注入到嗅探 WebView 的探针脚本。
///
/// 启发式规则从 Android `MediaSnifferPlugin.PROBE_SCRIPT_TEMPLATE` 移植：
/// `isHighValue`（只有 manifest / MSE / 播放器 JSON 才算「抓到重点」）、
/// `looksMediaUrl`、`looksLikePlayerJson`、`inspectPayload`（递归翻播放器配置）、
/// `triggerPlayback`（自动点「播放」）都保持同样的判定，站点适配经验不会丢。
///
/// 与 Android 的两处必要差别：
/// 1. **传输**：Android 用 `window.top.postMessage` + `@JavascriptInterface` 收集；
///    iOS 用 `WKScriptMessageHandler`。脚本以 `forMainFrameOnly: false` 注入，
///    所以每个 iframe 都能直接上报，不需要再往 top 转发一层。
/// 2. **额外来源**：`fetch` / `XMLHttpRequest` / `MediaSource` 钩子在两边都有，
///    但 iOS 拿不到 WebView 的网络层（见 `MediaSnifferStreamProxy` 的说明），
///    因此这里是**唯一**的观察来源，覆盖不到跨进程的媒体子请求。
enum MediaSnifferProbeScript {
    static let messageHandlerName = "newsnookSniffer"
    static let noncePlaceholder = "__NEWSNOOK_SESSION_NONCE__"
    static let maxBodyTextPlaceholder = "__NEWSNOOK_MAX_BODY_TEXT__"

    static func make(nonce: String, maxBodyText: Int) -> String {
        template
            .replacingOccurrences(of: noncePlaceholder, with: nonce)
            .replacingOccurrences(of: maxBodyTextPlaceholder, with: String(maxBodyText))
    }

    private static let template = """
    (() => {
      if (window.__newsnookMediaProbeInstalled) return;
      window.__newsnookMediaProbeInstalled = true;
      const nonce = '__NEWSNOOK_SESSION_NONCE__';
      const maxBodyText = __NEWSNOOK_MAX_BODY_TEXT__;
      const inFrame = window !== window.top;
      if (window.__newsnookLastHighValueAt == null) window.__newsnookLastHighValueAt = 0;
      const events = window.__newsnookMediaEvents = window.__newsnookMediaEvents || [];
      const seen = new Set();
      const inspectedPayloads = new WeakSet();
      const isHighValue = (event) => {
        // 直连的 mp4/webm 常常是贴片广告。用它来「静默退出」会在真正的
        // HLS/DASH 请求到来之前就结束会话，所以只认 manifest / MSE / 播放器 JSON。
        if (!event || event.source === 'performance') return false;
        const mime = String(event.mimeType || event.mseMimeType || '').toLowerCase();
        const url = String(event.url || '').toLowerCase();
        if (mime.includes('mpegurl') || mime.includes('dash+xml') || mime.includes('vnd.apple.mpegurl')) return true;
        if (/\\.(?:m3u8|mpd)(?:[?#]|$)/.test(url)) return true;
        if (event.source === 'mse' && event.mseMimeType) return true;
        if ((event.source === 'fetch' || event.source === 'xhr') && event.bodyText && looksLikePlayerJson(event.bodyText)) return true;
        if (event.source === 'static' && event.url && /\\.(?:m3u8|mpd)(?:[?#]|$)/i.test(String(event.url))) return true;
        return false;
      };
      const report = (observation) => {
        try {
          const handler = window.webkit && window.webkit.messageHandlers
            ? window.webkit.messageHandlers.newsnookSniffer
            : null;
          if (handler) handler.postMessage(observation);
        } catch (_) {}
      };
      const push = (event) => {
        try {
          const key = [event.source, event.url || '', event.mimeType || '', event.drmKeySystem || '', event.bodyText ? 'body' : ''].join('|');
          if (seen.has(key)) return;
          seen.add(key);
          const observation = {
            pageUrl: location.href,
            timestamp: Date.now(),
            sessionNonce: nonce,
            fromIframe: inFrame || undefined,
            ...event
          };
          const priority = (item) => {
            const mime = String(item.mimeType || item.mseMimeType || '').toLowerCase();
            const url = String(item.url || '').toLowerCase();
            if (/^(video|audio)\\//.test(mime) || /mpegurl|dash\\+xml/.test(mime) || /\\.(m3u8|mpd)(?:[?#]|$)/.test(url)) return 3;
            if (/\\.(m4s|ts)(?:[?#]|$)/.test(url)) return 1;
            if (/\\.(js|css|html?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)(?:[?#]|$)/.test(url)) return 0;
            return 2;
          };
          if (events.length >= 256) {
            let lowest = 4, lowestIndex = -1;
            events.forEach((item, index) => { const value = priority(item); if (value < lowest) { lowest = value; lowestIndex = index; } });
            if (lowestIndex < 0 || priority(observation) <= lowest) return;
            events.splice(lowestIndex, 1);
          }
          events.push(observation);
          if (isHighValue(observation)) window.__newsnookLastHighValueAt = Date.now();
          report(observation);
          return observation;
        } catch (_) { return undefined; }
      };
      const looksMediaUrl = (value) => {
        const url = String(value || '');
        if (!url) return false;
        if (url.startsWith('blob:')) return true;
        return /\\.(?:m3u8|mpd|mp4|m4v|webm|mov|flv|mkv|m4a|aac|mp3|ogg|opus|m4s|ts|cmfv|cmfa)(?:[?#]|$)/i.test(url);
      };
      const looksLikePlayerJson = (text) => {
        const trimmed = String(text || '').trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
        return /"(?:url|playurl|play_url|manifestUrl|hlsmanifesturl|dashmanifesturl|manifest_url|video_url|media_url|backupUrl|backup_url|file)"\\s*:/i.test(trimmed)
          || /"(?:video|audio|stream|streams|playinfo|player)"\\s*:/i.test(trimmed);
      };
      const positiveNumber = (value) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : undefined;
      };
      const triggerPlayback = () => {
        if (window.__newsnookPlaybackTriggered) return;
        try {
          const playPattern = /play|watch|观看|播放/i;
          const candidates = [];
          document.querySelectorAll('button,[role="button"]').forEach((el) => {
            const text = (el.textContent || '').trim();
            const label = [text, el.getAttribute('aria-label') || '', el.getAttribute('title') || ''].join(' ');
            if (playPattern.test(label)) candidates.push({ priority: 0, element: el });
          });
          document.querySelectorAll('a[href]').forEach((el) => {
            const href = el.getAttribute('href') || '';
            try {
              const target = new URL(href, location.href);
              if (target.origin !== location.origin) return;
              if (/\\/(?:play|watch|vodplay|player|embed|video\\/play)(?:[/?#]|$)/i.test(target.pathname + target.search + target.hash)) candidates.push({ priority: 1, element: el });
            } catch (_) {}
          });
          document.querySelectorAll('iframe[src],iframe[data-src]').forEach((el) => {
            const raw = el.getAttribute('src') || el.getAttribute('data-src') || '';
            try {
              const target = new URL(raw, location.href);
              if (/\\/(?:player|embed|play|watch)(?:[/?#]|$)/i.test(target.pathname + target.search + target.hash)) candidates.push({ priority: 2, element: el });
            } catch (_) {}
          });
          const candidate = candidates.sort((left, right) => left.priority - right.priority)[0];
          if (!candidate) return;
          window.__newsnookPlaybackTriggered = true;
          try { candidate.element.click(); } catch (_) {}
        } catch (_) {}
      };
      const inspectPayload = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 12 || inspectedPayloads.has(value)) return;
        inspectedPayloads.add(value);
        if (Array.isArray(value)) {
          value.forEach((item) => inspectPayload(item, depth + 1));
          return;
        }
        try {
          const url = [value.url, value.contentUrl, value.playbackUrl, value.src, value.baseUrl, value.base_url, value.playurl, value.play_url, value.backupUrl, value.backup_url, value.manifestUrl]
            .find((item) => typeof item === 'string' && item);
          const mimeType = [value.mimeType, value.contentType, value.mime]
            .find((item) => typeof item === 'string');
          // 图片 URL（favicon/logo/海报）不是可播放媒体，宽高不构成视频信号。
          const pathOnly = String(url).split('?')[0].split('#')[0];
          const isImagePath = /\\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/i.test(pathOnly);
          if (url && !isImagePath) {
            const codecText = `${mimeType || ''} ${typeof value.codecs === 'string' ? value.codecs : ''}`;
            const hasVideo = Boolean(value.qualityLabel || /^video\\//i.test(mimeType || '') || /(?:avc1|av01|hvc1|hev1|vp0?9|vp8)/i.test(codecText));
            const hasAudio = Boolean(value.audioQuality || value.audioSampleRate || value.audioChannels || /^audio\\//i.test(mimeType || '') || /(?:mp4a|aac|opus|vorbis|ac-3|ec-3)/i.test(codecText));
            if (looksMediaUrl(url) || mimeType || hasVideo || hasAudio) {
              push({
                source: 'static',
                url,
                mimeType,
                codecs: typeof value.codecs === 'string' ? value.codecs : undefined,
                mediaKind: /^audio\\//i.test(mimeType || '') ? 'audio' : hasVideo ? 'video' : undefined,
                hasAudio: hasAudio ? true : hasVideo && value.qualityLabel ? false : undefined,
                hasVideo: hasVideo || undefined,
                width: positiveNumber(value.width),
                height: positiveNumber(value.height),
                bitrate: positiveNumber(value.bitrate),
              });
            }
          }
        } catch (_) {}
        try { Object.values(value).forEach((item) => inspectPayload(item, depth + 1)); } catch (_) {}
      };
      const inspectPlayerState = () => {
        try { inspectPayload(window.ytInitialPlayerResponse); } catch (_) {}
        try { inspectPayload(window.__playinfo__); } catch (_) {}
        try { inspectPayload(window.__INITIAL_STATE__); } catch (_) {}
        try { inspectPayload(window.__NUXT__); } catch (_) {}
        try {
          const config = window.ytcfg && window.ytcfg.get ? window.ytcfg.get('PLAYER_VARS') : null;
          if (config) inspectPayload(config);
        } catch (_) {}
      };
      const scanDom = () => {
        try {
          document.querySelectorAll('video,audio').forEach((element) => {
            const isAudio = String(element.tagName).toUpperCase() === 'AUDIO';
            const url = element.currentSrc || element.src || '';
            if (url) {
              push({
                source: 'dom',
                url: String(url),
                mediaKind: isAudio ? 'audio' : 'video',
                width: positiveNumber(element.videoWidth),
                height: positiveNumber(element.videoHeight),
                mseMimeType: element.src && String(element.src).startsWith('blob:') ? 'application/x-mpegurl' : undefined,
              });
            }
            try {
              element.querySelectorAll('source').forEach((source) => {
                const sourceUrl = source.src || source.getAttribute('src') || '';
                if (!sourceUrl) return;
                push({
                  source: 'dom',
                  url: String(sourceUrl),
                  mimeType: source.type || undefined,
                  mediaKind: isAudio ? 'audio' : 'video',
                });
              });
            } catch (_) {}
          });
        } catch (_) {}
      };
      const scanPerformance = () => {
        try {
          const entries = performance.getEntriesByType('resource') || [];
          entries.forEach((entry) => {
            const url = String(entry.name || '');
            const initiator = String(entry.initiatorType || '');
            if (!looksMediaUrl(url) && initiator !== 'video' && initiator !== 'audio') return;
            push({ source: 'performance', url, mediaKind: initiator === 'audio' ? 'audio' : undefined });
          });
        } catch (_) {}
      };
      // fetch 钩子：拿得到最终 URL 与 content-type，播放器配置 JSON 也在这里捞。
      try {
        const originalFetch = window.fetch;
        if (typeof originalFetch === 'function') {
          window.fetch = function (...args) {
            const input = args[0];
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const method = String((args[1] && args[1].method) || (input && input.method) || 'GET').toUpperCase();
            const promise = originalFetch.apply(this, args);
            try {
              if (looksMediaUrl(url)) push({ source: 'fetch', url: String(url), method });
            } catch (_) {}
            return promise.then((response) => {
              try {
                const finalUrl = response && response.url ? response.url : url;
                const mimeType = response && response.headers && response.headers.get
                  ? response.headers.get('content-type') || undefined
                  : undefined;
                if (looksMediaUrl(finalUrl) || (mimeType && (/^(video|audio)\\//i.test(mimeType) || /mpegurl|dash\\+xml/i.test(mimeType)))) {
                  push({ source: 'fetch', url: String(finalUrl), method, mimeType, statusCode: response && response.status });
                }
                if (mimeType && /json/i.test(mimeType) && typeof response.clone === 'function') {
                  response.clone().text().then((text) => {
                    if (looksLikePlayerJson(text)) {
                      push({ source: 'fetch', url: String(finalUrl), method, mimeType, bodyText: String(text).slice(0, maxBodyText) });
                    }
                  }).catch(() => {});
                }
              } catch (_) {}
              return response;
            });
          };
        }
      } catch (_) {}
      // XHR 钩子：老播放器大多走 XHR 取配置与分片。
      try {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
          this.__newsnookUrl = String(url);
          this.__newsnookMethod = method;
          return originalOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (...args) {
          try {
            this.addEventListener('load', () => {
              try {
                const mimeType = this.getResponseHeader ? this.getResponseHeader('content-type') : null;
                const finalUrl = this.responseURL || this.__newsnookUrl;
                const isJson = mimeType && /json/i.test(mimeType);
                const bodyText = isJson && typeof this.responseText === 'string'
                  ? this.responseText.slice(0, maxBodyText)
                  : undefined;
                if (
                  looksMediaUrl(finalUrl)
                  || (mimeType && (/^(video|audio)\\//i.test(mimeType) || /mpegurl|dash\\+xml/i.test(mimeType)))
                  || (bodyText && looksLikePlayerJson(bodyText))
                ) {
                  push({
                    source: 'xhr',
                    url: String(finalUrl),
                    method: String(this.__newsnookMethod || 'GET').toUpperCase(),
                    mimeType: mimeType || undefined,
                    statusCode: this.status,
                    bodyText,
                  });
                }
              } catch (_) {}
            });
          } catch (_) {}
          return originalSend.apply(this, args);
        };
      } catch (_) {}
      // MSE：blob 地址本身没有信息，但 addSourceBuffer 的 mime 说明这是 HLS/DASH。
      try {
        if (window.MediaSource) {
          const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
          MediaSource.prototype.addSourceBuffer = function (mimeType) {
            try {
              if (!this.__newsnookMediaSessionId) {
                this.__newsnookMediaSessionId = 'mse-' + Date.now() + '-' + Math.random().toString(36).slice(2);
              }
              push({ source: 'mse', mseMimeType: String(mimeType), mediaSessionId: this.__newsnookMediaSessionId });
            } catch (_) {}
            return originalAddSourceBuffer.call(this, mimeType);
          };
        }
      } catch (_) {}
      // DRM：加密流投不了屏也转不了码，必须让上层知道。
      try {
        if (navigator.requestMediaKeySystemAccess) {
          const originalRequest = navigator.requestMediaKeySystemAccess.bind(navigator);
          navigator.requestMediaKeySystemAccess = function (keySystem, configs) {
            try { push({ source: 'mse', drmKeySystem: String(keySystem) }); } catch (_) {}
            return originalRequest(keySystem, configs);
          };
        }
      } catch (_) {}
      const scan = () => {
        scanDom();
        scanPerformance();
        inspectPlayerState();
      };
      scan();
      try {
        const observer = new MutationObserver(() => scan());
        observer.observe(document.documentElement || document, { childList: true, subtree: true });
      } catch (_) {}
      setInterval(scan, 800);
      try {
        document.addEventListener('DOMContentLoaded', () => { scan(); triggerPlayback(); });
        window.addEventListener('load', () => { scan(); triggerPlayback(); });
      } catch (_) {}
      try { triggerPlayback(); } catch (_) {}
      window.__newsnookCollectMedia = () => { scan(); return events; };
    })();
    """
}
