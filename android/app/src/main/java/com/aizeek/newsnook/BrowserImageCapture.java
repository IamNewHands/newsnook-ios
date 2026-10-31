package com.aizeek.newsnook;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Explicit, tab-scoped image inspection. The website receives no Capacitor
 * bridge, event handlers, click interception, or automatic image requests.
 * Source bytes use bounded RAM or short-lived app-private cache files. Files
 * are deleted on eviction, image-mode close or navigation; crash leftovers
 * are cleared at the next browser image session startup.
 */
final class BrowserImageCapture {
    static final int MAX_IMAGES = 240;
    // Upstream bytes are spooled to private cache, never Base64-transferred as a preview.
    // This bound protects disk/network abuse, not the size of a viewable image.
    static final int MAX_SOURCE_BYTES = 128 * 1024 * 1024;
    static final int MAX_CACHE_ENTRY_BYTES = 3 * 1024 * 1024;
    static final int MAX_THUMB_SOURCE_BYTES = 16 * 1024 * 1024;
    static final int MAX_DISPLAY_BYTES = 2 * 1024 * 1024;
    static final int PAGE_CHUNK_BYTES = 192 * 1024;
    static final long LOAD_TIMEOUT_MS = 90000L;
    static final long PREVIEW_TIMEOUT_MS = 60000L;
    static final long THUMB_TIMEOUT_MS = 30000L;
    private static final long SCAN_TIMEOUT_MS = 6000L;
    private static final int MAX_REQUEST_CONTEXTS = 320;
    private static final String CANCELLED = "图片读取已取消";
    private final WebView webView;
    private final File tempDir;
    private static final AtomicBoolean tempDirectoryInitialized = new AtomicBoolean();
    private final int tabId;
    private final String key = "__newsnookImages_" + UUID.randomUUID().toString().replace("-", "");
    private final String probe;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final OkHttpClient client = new OkHttpClient.Builder()
        .cache(null).followRedirects(false).followSslRedirects(false)
        .connectTimeout(7, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(55, TimeUnit.SECONDS).build();
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 20, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(8), runnable -> new Thread(runnable, "NewsNookBrowserImage"));
    private final Map<String, Work> work = new LinkedHashMap<>();
    // Only one hardware/software bitmap decode at a time: at most one ~10MB
    // sampled bitmap plus its optional scaled copy, even with two downloads.
    private final Semaphore decodePermit = new Semaphore(1);
    private volatile Page page;
    private Scan pendingScan;
    private volatile boolean closed;

    private static final class Page {
        final String id = UUID.randomUUID().toString();
        final Map<String, JSONObject> candidates = new LinkedHashMap<>();
        final Map<String, Map<String, String>> headers = Collections.synchronizedMap(new LinkedHashMap<>());
        final SourceCache sources = new SourceCache();
        final Map<String, File> exports = Collections.synchronizedMap(new LinkedHashMap<>());
        final String url;
        String activeImageScan;
        Page(String url) { this.url = url; }
        void release(String requestId) {
            if (requestId == null) {
                synchronized (exports) {
                    for (File file : exports.values()) if (file != null) file.delete();
                    exports.clear();
                }
            } else {
                File file = exports.remove(requestId);
                if (file != null) file.delete();
            }
        }
        void dispose() {
            sources.clear();
            release(null);
        }
    }

    private static final class Scan {
        final Page page;
        final String requestId;
        final Consumer<String> failure;
        Runnable timeout;
        Scan(Page page, String requestId, Consumer<String> failure) {
            this.page = page; this.requestId = requestId; this.failure = failure;
        }
    }

    static final class Bytes {
        final byte[] value;
        final File file;
        final String mime;
        private int holders = 1;
        Bytes(byte[] value, String mime) { this.value = value; this.file = null; this.mime = mime; }
        Bytes(File file, String mime) { this.value = null; this.file = file; this.mime = mime; }
        long size() { return value != null ? value.length : file == null ? 0 : file.length(); }
        synchronized Bytes retain() { if (holders == 0) throw new IllegalStateException("image bytes released"); holders++; return this; }
        synchronized boolean canMove() { return file != null && holders == 1; }
        synchronized void release() {
            if (holders == 0) return;
            if (--holders == 0 && file != null) file.delete();
        }
    }

    /**
     * Raw source bytes the page's thumbnail requests already paid for. The
     * viewer's display request reuses them instead of downloading the same URL
     * a second time; the cache lives and dies with its page document.
     */
    static final class SourceCache {
        private static final int MAX_ENTRIES = 24;
        private static final int MAX_BYTES = 12 * 1024 * 1024;
        // A tiny disk LRU prevents fetching the same 7–20MB photo for thumbnail
        // and display. Cached source files are deleted on eviction/navigation.
        private static final int MAX_DISK_FILES = 2;
        private static final int MAX_DISK_BYTES = 40 * 1024 * 1024;
        private final Map<String, Bytes> entries = new LinkedHashMap<>(16, .75f, true);
        private boolean disposed;

        synchronized Bytes get(String url) {
            if (disposed) return null;
            Bytes bytes = entries.get(url);
            return bytes == null ? null : bytes.retain();
        }

        synchronized void put(String url, Bytes bytes) {
            if (disposed) return;
            if (bytes.value != null && bytes.value.length > MAX_BYTES) return;
            if (bytes.file != null && bytes.size() > MAX_DISK_BYTES) return;
            Bytes old = entries.put(url, bytes.retain());
            if (old != null) old.release();
            long heap = 0, disk = 0;
            int files = 0;
            for (Bytes value : entries.values()) {
                if (value.file != null) { files++; disk += value.size(); }
                else heap += value.size();
            }
            Iterator<Map.Entry<String, Bytes>> oldest = entries.entrySet().iterator();
            while (oldest.hasNext() && (entries.size() > MAX_ENTRIES || heap > MAX_BYTES
                    || files > MAX_DISK_FILES || disk > MAX_DISK_BYTES)) {
                Bytes removed = oldest.next().getValue();
                if (removed.file != null) { files--; disk -= removed.size(); }
                else heap -= removed.size();
                oldest.remove();
                removed.release();
            }
        }

        synchronized void discard(String url) {
            Bytes discarded = entries.remove(url);
            if (discarded != null) discarded.release();
        }

        synchronized void evict() {
            for (Bytes bytes : entries.values()) bytes.release();
            entries.clear();
        }

        synchronized void clear() {
            disposed = true;
            evict();
        }
    }

    private static final class Encoded {
        final byte[] value;
        final String mime;
        final int width;
        final int height;
        final boolean reduced;
        Encoded(byte[] value, String mime, int width, int height, boolean reduced) {
            this.value = value; this.mime = mime; this.width = width; this.height = height; this.reduced = reduced;
        }
    }

    private static final class Work {
        final Page page;
        final String requestId;
        final String imageId;
        final JSONObject image;
        final boolean thumbnail;
        final boolean original;
        final Consumer<JSONObject> success;
        final Consumer<String> failure;
        final AtomicBoolean cancelled = new AtomicBoolean();
        final AtomicBoolean settled = new AtomicBoolean();
        final CountDownLatch transferReady = new CountDownLatch(1);
        volatile Call call;
        volatile Future<?> future;
        volatile Bytes transferred;
        volatile File transferFile;
        long transferBytes;
        String transferMime;
        volatile String transferError;
        Runnable timeout;
        Runnable poll;
        Work(Page page, String requestId, String imageId, JSONObject image, boolean thumbnail, boolean original,
             Consumer<JSONObject> success, Consumer<String> failure) {
            this.page = page; this.requestId = requestId; this.imageId = imageId;
            this.image = image; this.thumbnail = thumbnail; this.original = original;
            this.success = success; this.failure = failure;
        }
    }

    BrowserImageCapture(WebView view, int id, String initialUrl) {
        webView = view;
        tempDir = new File(view.getContext().getCacheDir(), "browser-image-session");
        if (tempDirectoryInitialized.compareAndSet(false, true)) {
            // Both native source files and handed-off share copies are wiped
            // when a new process first opens its browser image subsystem.
            for (File directory : new File[] {tempDir,
                    new File(view.getContext().getCacheDir(), "browser-image-share")}) {
                File[] stale = directory.listFiles();
                if (stale != null) for (File file : stale) if (file.isFile()) file.delete();
            }
        }
        if (!tempDir.exists() && !tempDir.mkdirs()) throw new IllegalStateException("Cannot create image cache");
        tabId = id;
        page = new Page(initialUrl);
        workers.allowCoreThreadTimeOut(true);
        String source;
        try (InputStream input = view.getContext().getAssets().open("browser-image-probe.js")) {
            source = new String(readBounded(input, 64 * 1024), StandardCharsets.UTF_8);
        } catch (Exception ignored) { source = ""; }
        probe = source;
    }

    void onPageStarted(String url) {
        if (closed) return;
        cancel(null, null);
        Page previous = page;
        if (previous != null) previous.dispose();
        page = new Page(url);
    }

    /** Observe request context without replacing the original WebView request. */
    void onRequest(WebResourceRequest request) {
        Page current = page;
        if (closed || current == null || request == null || request.isForMainFrame()) return;
        String url = request.getUrl().toString();
        if (!isHttpUrl(url)) return;
        Map<String, String> captured = new LinkedHashMap<>();
        Map<String, String> original = request.getRequestHeaders();
        if (original != null) {
            for (Map.Entry<String, String> entry : original.entrySet()) {
                String name = entry.getKey().toLowerCase(Locale.ROOT);
                if (!"referer".equals(name) && !"origin".equals(name) && !"user-agent".equals(name)
                    && !"authorization".equals(name) && !"accept".equals(name) && !"accept-language".equals(name)) continue;
                String value = entry.getValue();
                if (value != null && value.length() <= 8192 && value.indexOf('\r') < 0 && value.indexOf('\n') < 0) {
                    captured.put(name, value);
                }
            }
        }
        synchronized (current.headers) {
            current.headers.put(url, captured);
            while (current.headers.size() > MAX_REQUEST_CONTEXTS) {
                current.headers.remove(current.headers.keySet().iterator().next());
            }
        }
    }

    void scan(String requestId, Consumer<JSONObject> success, Consumer<String> failure) {
        if (closed) { failure.accept("网页已关闭"); return; }
        if (!validRequestId(requestId)) { failure.accept("扫描请求无效"); return; }
        if (probe.isEmpty()) { failure.accept("图片扫描暂不可用，请重启应用后重试"); return; }
        String liveUrl = webView.getUrl();
        if (isHttpUrl(liveUrl) && !liveUrl.equals(page.url)) onPageStarted(liveUrl);
        Page current = page;
        if (!isHttpUrl(current.url)) { failure.accept("请先打开一个网页"); return; }
        cancel(null, null);
        current.candidates.clear();
        Scan scan = new Scan(current, requestId, failure);
        pendingScan = scan;
        scan.timeout = () -> {
            if (pendingScan == scan) {
                pendingScan = null;
                failure.accept("扫描超时，请等网页加载完成后重试");
            }
        };
        main.postDelayed(scan.timeout, SCAN_TIMEOUT_MS);
        String scanId = UUID.randomUUID().toString();
        String script = probe.replace("__NEWSNOOK_IMAGE_KEY__", JSONObject.quote(key))
            .replace("__NEWSNOOK_IMAGE_SCAN__", JSONObject.quote(scanId));
        try {
            webView.evaluateJavascript(script, result -> {
                if (closed || page != current || pendingScan != scan) return;
                pendingScan = null;
                main.removeCallbacks(scan.timeout);
                try {
                    JSONObject payload = decode(result);
                    String sourcePage = payload.optString("pageUrl");
                    String actualUrl = webView.getUrl();
                    if (!sourcePage.equals(current.url) || (isHttpUrl(actualUrl) && !sourcePage.equals(actualUrl))) {
                        failure.accept("网页已变化，请重新扫描"); return;
                    }
                    JSONArray input = payload.optJSONArray("items");
                    JSONArray items = new JSONArray();
                    if (input != null) for (int index = 0; index < Math.min(input.length(), MAX_IMAGES); index++) {
                        JSONObject item = input.optJSONObject(index);
                        if (!validCandidate(item, scanId)) continue;
                        Map<String, String> captured = current.headers.get(item.optString("sourceUrl"));
                        JSONObject publicHeaders = new JSONObject();
                        String referer = captured == null ? defaultReferer(item.optString("sourceUrl"), item.optString("pageUrl"))
                            : captured.get("referer");
                        if (referer != null && !referer.isEmpty()) publicHeaders.put("Referer", referer);
                        if (captured != null && captured.get("origin") != null) publicHeaders.put("Origin", captured.get("origin"));
                        String ua = captured == null ? null : captured.get("user-agent");
                        publicHeaders.put("User-Agent", ua == null ? webView.getSettings().getUserAgentString() : ua);
                        item.put("requestHeaders", publicHeaders);
                        current.candidates.put(item.getString("id"), item);
                        items.put(item);
                    }
                    current.activeImageScan = requestId;
                    success.accept(new JSONObject().put("tabId", tabId).put("documentId", current.id)
                        .put("requestId", requestId).put("pageUrl", current.url).put("items", items)
                        .put("truncated", payload.optBoolean("truncated", false) || input != null && input.length() > MAX_IMAGES)
                        .put("inaccessibleFrames", Math.max(0, Math.min(1000, payload.optInt("inaccessibleFrames", 0)))));
                } catch (Exception ignored) { failure.accept("无法读取这页的图片，请重新扫描"); }
            });
        } catch (RuntimeException ignored) {
            pendingScan = null;
            main.removeCallbacks(scan.timeout);
            failure.accept("网页暂时无法扫描，请重试");
        }
    }

    void load(String documentId, String requestId, String imageId, boolean thumbnail, boolean original,
              Consumer<JSONObject> success, Consumer<String> failure) {
        Page current = page;
        if (closed || current == null || !current.id.equals(documentId)) { failure.accept("网页已变化，请重新扫描"); return; }
        JSONObject image = current.candidates.get(imageId);
        if (image == null || !validRequestId(requestId)) { failure.accept("图片已失效，请重新扫描"); return; }
        if (work.containsKey(requestId) || work.size() >= 10) { failure.accept("正在读取其他图片，请稍后重试"); return; }
        Work request = new Work(current, requestId, imageId, image, thumbnail, original, success, failure);
        work.put(requestId, request);
        request.timeout = () -> cancelWork(request, "图片读取超时，请重试");
        main.postDelayed(request.timeout, thumbnail ? THUMB_TIMEOUT_MS : original ? LOAD_TIMEOUT_MS : PREVIEW_TIMEOUT_MS);
        // Read WebView settings on its owning UI thread.
        final String userAgent = webView.getSettings().getUserAgentString();
        try {
            request.future = workers.submit(() -> {
                Bytes bytes = null;
                try {
                    ensureLive(request);
                    bytes = "page".equals(image.optString("transport")) ? readFromPage(request) : readHttp(request, userAgent);
                    ensureLive(request);
                    JSONObject result = new JSONObject().put("tabId", tabId).put("documentId", current.id)
                        .put("requestId", requestId).put("imageId", imageId);
                    if (original) {
                        ImageInfo info = imageInfo(bytes);
                        // An explicit save/share has priority over reusing this
                        // file as a source cache. Detach so its disk bytes can be
                        // renamed into the export instead of copied a second time.
                        if ("http".equals(image.optString("transport"))) {
                            current.sources.discard(image.optString("sourceUrl"));
                        }
                        File exported = prepareOriginal(bytes, info.mime);
                        current.exports.put(requestId, exported);
                        ensureLive(request);
                        result.put("mimeType", info.mime).put("byteLength", exported.length())
                            .put("width", info.width).put("height", info.height).put("reduced", false)
                            .put("fileUri", Uri.fromFile(exported).toString());
                    } else {
                        decodePermit.acquire();
                        Encoded encoded;
                        try { ensureLive(request); encoded = encode(bytes, thumbnail); }
                        finally { decodePermit.release(); }
                        ensureLive(request);
                        result.put("mimeType", encoded.mime).put("byteLength", encoded.value.length)
                            .put("width", encoded.width).put("height", encoded.height).put("reduced", encoded.reduced)
                            .put("dataUrl", "data:" + encoded.mime + ";base64," + Base64.encodeToString(encoded.value, Base64.NO_WRAP));
                    }
                    main.post(() -> complete(request, result, null));
                } catch (Exception error) {
                    String message = error.getMessage();
                    main.post(() -> complete(request, null, message == null ? "图片无法加载，请重试" : message));
                } catch (OutOfMemoryError error) {
                    main.post(() -> complete(request, null, "图片尺寸过大，当前设备无法解码"));
                } finally {
                    if (bytes != null) bytes.release();
                }
            });
        } catch (RuntimeException ignored) { complete(request, null, "正在读取其他图片，请稍后重试"); }
    }

    /** Streams the encoded original to private, request-scoped cache instead of a 6 MB heap buffer. */
    private Bytes readHttp(Work request, String userAgent) throws Exception {
        String originalUrl = request.image.optString("sourceUrl");
        HttpUrl url = HttpUrl.parse(originalUrl);
        if (url == null) throw new IOException("图片网址无效");
        Bytes cached = request.page.sources.get(originalUrl);
        if (cached != null) return cached;
        Map<String, String> captured = request.page.headers.get(originalUrl);
        String pageUrl = request.image.optString("pageUrl", request.page.url);
        for (int redirects = 0; redirects <= 4; redirects++) {
            ensureLive(request);
            String target = url.toString();
            Map<String, String> headers = headersFor(target, originalUrl, pageUrl, captured, userAgent,
                CookieManager.getInstance().getCookie(target));
            Request.Builder builder = new Request.Builder().url(url);
            for (Map.Entry<String, String> entry : headers.entrySet()) builder.header(entry.getKey(), entry.getValue());
            Call call = client.newCall(builder.build());
            request.call = call;
            try (Response response = call.execute()) {
                int status = response.code();
                if (status >= 300 && status < 400) {
                    String location = response.header("Location");
                    HttpUrl next = location == null ? null : url.resolve(location);
                    if (next == null || "https".equals(url.scheme()) && !"https".equals(next.scheme())) {
                        throw new IOException("图片跳转不可用，请返回网页查看");
                    }
                    url = next;
                    continue;
                }
                if (!response.isSuccessful() || response.body() == null) throw new IOException("图片加载失败 HTTP " + status);
                int sourceLimit = request.thumbnail ? MAX_THUMB_SOURCE_BYTES : MAX_SOURCE_BYTES;
                if (response.body().contentLength() > sourceLimit) {
                    throw new IOException(request.thumbnail ? "图片较大，点开即可查看" : "图片文件过大，当前设备无法处理");
                }
                String mime = response.header("Content-Type", "").split(";")[0].trim().toLowerCase(Locale.ROOT);
                File file = File.createTempFile("source-", ".part", tempDir);
                boolean handedToWorker = false;
                try {
                    long count;
                    try (OutputStream sink = new FileOutputStream(file)) {
                        try {
                            count = spoolBounded(response.body().byteStream(), sink, sourceLimit);
                        } catch (IOException error) {
                            if (request.thumbnail && error.getMessage() != null
                                && error.getMessage().contains("图片文件过大")) {
                                throw new IOException("图片较大，点开即可查看");
                            }
                            throw error;
                        }
                    }
                    ensureLive(request);
                    if (count == 0) throw new IOException("图片数据为空，请重试");
                    if (count <= MAX_CACHE_ENTRY_BYTES) {
                        byte[] bytes = Files.readAllBytes(file.toPath());
                        Bytes result = new Bytes(bytes, mime);
                        request.page.sources.put(originalUrl, result);
                        return result;
                    }
                    Bytes result = new Bytes(file, mime);
                    request.page.sources.put(originalUrl, result);
                    handedToWorker = true;
                    return result;
                } finally {
                    // Failed downloads and small cached sources do not leave temp files.
                    if (!handedToWorker) file.delete();
                }
            } finally { request.call = null; }
        }
        throw new IOException("图片跳转过多，请返回网页查看");
    }

    static long spoolBounded(InputStream input, OutputStream output, long limit) throws IOException {
        byte[] buffer = new byte[32 * 1024];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted()) throw new IOException(CANCELLED);
            if (total + count > limit) throw new IOException("图片文件过大，当前设备无法处理");
            output.write(buffer, 0, count);
            total += count;
        }
        return total;
    }

    /** Credentials are recomputed for each redirect; observed auth never crosses origins. */
    static Map<String, String> headersFor(String targetUrl, String originalUrl, String pageUrl,
                                         Map<String, String> captured, String userAgent, String cookie) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("User-Agent", userAgent);
        headers.put("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
        boolean sameOrigin = equalOrigins(targetUrl, originalUrl);
        if (captured != null && sameOrigin) {
            for (Map.Entry<String, String> entry : captured.entrySet()) headers.put(entry.getKey(), entry.getValue());
        } else {
            String referer = defaultReferer(targetUrl, pageUrl);
            if (!referer.isEmpty()) headers.put("Referer", referer);
        }
        if (cookie != null && !cookie.isEmpty()) headers.put("Cookie", cookie);
        return headers;
    }

    private static boolean equalOrigins(String first, String second) {
        String left = OriginHeaderStore.originOf(first);
        return left != null && left.equals(OriginHeaderStore.originOf(second));
    }

    private static String defaultReferer(String targetUrl, String sourcePage) {
        if (!isHttpUrl(sourcePage)) return "";
        if (sourcePage.startsWith("https:") && targetUrl.startsWith("http:")) return "";
        if (equalOrigins(targetUrl, sourcePage)) {
            int hash = sourcePage.indexOf('#');
            return hash < 0 ? sourcePage : sourcePage.substring(0, hash);
        }
        String origin = OriginHeaderStore.originOf(sourcePage);
        return origin == null ? "" : origin + "/";
    }

    private Bytes readFromPage(Work request) throws Exception {
        main.post(() -> {
            if (!isLive(request)) { request.transferReady.countDown(); return; }
            String script = "(function(){try{var s=window[" + JSONObject.quote(key)
                + "];return JSON.stringify(s?s.start(" + JSONObject.quote(request.imageId) + ","
                + JSONObject.quote(request.requestId) + "," + (request.thumbnail ? MAX_THUMB_SOURCE_BYTES : MAX_SOURCE_BYTES)
                + "):{error:'图片已失效，请重新扫描'});}catch(e){return JSON.stringify({error:'图片读取失败'})}})()";
            try { webView.evaluateJavascript(script, result -> {
                if (!isLive(request)) return;
                try {
                    JSONObject value = decode(result);
                    if (value.has("error")) {
                        request.transferError = value.optString("error");
                        request.transferReady.countDown();
                    } else pollPage(request);
                } catch (Exception ignored) {
                    request.transferError = "图片读取失败，请重试";
                    request.transferReady.countDown();
                }
            }); } catch (RuntimeException ignored) {
                request.transferError = "网页暂时无法读取图片，请重试";
                request.transferReady.countDown();
            }
        });
        long transferTimeout = request.thumbnail ? THUMB_TIMEOUT_MS : request.original ? LOAD_TIMEOUT_MS : PREVIEW_TIMEOUT_MS;
        if (!request.transferReady.await(transferTimeout - 1000, TimeUnit.MILLISECONDS)) throw new IOException("图片读取超时，请重试");
        ensureLive(request);
        if (request.transferred == null) {
            String message = request.transferError == null ? "图片读取失败，请重试" : request.transferError;
            if (request.thumbnail && message.contains("图片文件过大")) message = "图片较大，点开即可查看";
            throw new IOException(message);
        }
        return request.transferred;
    }

    private void pollPage(Work request) {
        if (!isLive(request)) return;
        request.poll = () -> {
            if (!isLive(request)) return;
            String script = "(function(){try{var s=window[" + JSONObject.quote(key)
                + "];return JSON.stringify(s?s.read(" + JSONObject.quote(request.requestId)
                + "):{error:'图片已失效，请重新扫描'});}catch(e){return JSON.stringify({error:'图片读取失败'})}})()";
            try { webView.evaluateJavascript(script, result -> {
                if (!isLive(request)) return;
                boolean keepPolling = false;
                boolean waiting = false;
                try {
                    JSONObject payload = decode(result);
                    if (payload.optBoolean("pending", false)) {
                        keepPolling = true;
                        waiting = true;
                    } else if (payload.has("error")) {
                        request.transferError = payload.optString("error");
                    } else if (payload.has("chunk")) {
                        String chunk = payload.optString("chunk");
                        String mime = payload.optString("mimeType");
                        if (!mime.startsWith("image/") || mime.length() > 96
                            || chunk.isEmpty() || chunk.length() > (PAGE_CHUNK_BYTES / 3) * 4 + 8) {
                            throw new IOException("网页图片数据无效");
                        }
                        byte[] bytes = Base64.decode(chunk, Base64.DEFAULT);
                        if (bytes.length == 0 || bytes.length > PAGE_CHUNK_BYTES
                            || request.transferBytes + bytes.length > (request.thumbnail ? MAX_THUMB_SOURCE_BYTES : MAX_SOURCE_BYTES)) {
                            throw new IOException("图片文件过大，当前设备无法处理");
                        }
                        if (request.transferMime == null) request.transferMime = mime;
                        if (!request.transferMime.equals(mime)) throw new IOException("图片格式发生变化，请重试");
                        if (request.transferFile == null) request.transferFile = File.createTempFile("page-", ".part", tempDir);
                        try (OutputStream sink = new FileOutputStream(request.transferFile, true)) {
                            sink.write(bytes);
                        }
                        request.transferBytes += bytes.length;
                        keepPolling = true;
                    } else if (payload.optBoolean("done", false)) {
                        if (request.transferFile == null || request.transferBytes <= 0
                            || request.transferBytes != payload.optLong("byteLength", -1)
                            || !request.transferMime.equals(payload.optString("mimeType"))) {
                            throw new IOException("网页图片数据不完整，请重试");
                        }
                        request.transferred = new Bytes(request.transferFile, request.transferMime);
                    } else {
                        throw new IOException("网页图片读取失败，请重试");
                    }
                } catch (Exception error) {
                    request.transferError = error.getMessage() == null ? "网页内存图片无法读取，请重新扫描" : error.getMessage();
                }
                if (keepPolling) {
                    main.postDelayed(request.poll, waiting ? 14 : 5);
                } else {
                    request.transferReady.countDown();
                }
            }); } catch (RuntimeException ignored) {
                request.transferError = "网页暂时无法读取图片，请重试";
                request.transferReady.countDown();
            }
        };
        main.postDelayed(request.poll, 40);
    }

    private static final class ImageInfo {
        final String mime;
        final int width;
        final int height;
        ImageInfo(String mime, int width, int height) {
            this.mime = mime;
            this.width = width;
            this.height = height;
        }
    }

    private static BitmapFactory.Options imageBounds(Bytes source) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        if (source.value != null) BitmapFactory.decodeByteArray(source.value, 0, source.value.length, bounds);
        else BitmapFactory.decodeFile(source.file.getAbsolutePath(), bounds);
        return bounds;
    }

    private static ImageInfo imageInfo(Bytes source) throws IOException {
        if ("image/svg+xml".equals(source.mime)) {
            byte[] prefix = new byte[2048];
            int count;
            try (InputStream input = source.value != null
                ? new java.io.ByteArrayInputStream(source.value) : new FileInputStream(source.file)) {
                count = input.read(prefix);
            }
            if (count <= 0 || !new String(prefix, 0, count, StandardCharsets.UTF_8)
                    .toLowerCase(Locale.ROOT).contains("<svg")) {
                throw new IOException("图片格式无法识别");
            }
            return new ImageInfo("image/svg+xml", 0, 0);
        }
        BitmapFactory.Options bounds = imageBounds(source);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outMimeType == null) {
            throw new IOException("图片格式暂不支持，请返回网页查看");
        }
        // Dimensions are checked before multiplication or decoding to prevent overflow.
        if (bounds.outWidth > 200_000 || bounds.outHeight > 200_000) {
            throw new IOException("图片尺寸超出设备解码能力");
        }
        return new ImageInfo(bounds.outMimeType.toLowerCase(Locale.ROOT), bounds.outWidth, bounds.outHeight);
    }

    private static String imageExtension(String mime) {
        switch (mime) {
            case "image/png": return "png";
            case "image/webp": return "webp";
            case "image/gif": return "gif";
            case "image/avif": return "avif";
            case "image/bmp": return "bmp";
            case "image/svg+xml": return "svg";
            default: return "jpg";
        }
    }

    /** Export original encoded bytes as a private file URI; never copy a large original into JS. */
    private File prepareOriginal(Bytes source, String mime) throws IOException {
        File file = File.createTempFile("export-", "." + imageExtension(mime), tempDir);
        if (source.canMove() && source.file.renameTo(file)) return file;
        try (InputStream input = source.value != null
            ? new java.io.ByteArrayInputStream(source.value) : new FileInputStream(source.file);
             OutputStream output = new FileOutputStream(file)) {
            spoolBounded(input, output, MAX_SOURCE_BYTES);
            return file;
        } catch (Exception error) {
            file.delete();
            throw error;
        }
    }

    /**
     * Decode only enough pixels for the screen, then adapt the output budget.
     * The encoded source may be large, but only a bounded WebP crosses the JS bridge.
     */
    static Encoded encode(Bytes source, boolean thumbnail) throws IOException {
        ImageInfo info = imageInfo(source);
        if ("image/svg+xml".equals(info.mime)) {
            int limit = thumbnail ? 128 * 1024 : MAX_DISPLAY_BYTES;
            if (source.size() > limit) throw new IOException("该矢量图片过于复杂，暂无法生成预览");
            byte[] svg = source.value != null ? source.value : Files.readAllBytes(source.file.toPath());
            return new Encoded(svg, info.mime, 0, 0, false);
        }
        int edge = thumbnail ? 320 : 2560;
        long pixels = thumbnail ? 102_400L : 2_560_000L;
        if (!thumbnail && info.width <= edge && info.height <= edge
            && (long) info.width * info.height <= pixels && source.size() <= MAX_DISPLAY_BYTES) {
            byte[] raw = source.value != null ? source.value : Files.readAllBytes(source.file.toPath());
            return new Encoded(raw, info.mime, info.width, info.height, false);
        }

        int sample = sampleSize(info.width, info.height, edge, pixels);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap = source.value != null
            ? BitmapFactory.decodeByteArray(source.value, 0, source.value.length, options)
            : BitmapFactory.decodeFile(source.file.getAbsolutePath(), options);
        if (bitmap == null) throw new IOException("图片解码失败，请重试");
        Bitmap scaled = bitmap;
        try {
            double ratio = Math.min(1.0, Math.min((double) edge / bitmap.getWidth(), (double) edge / bitmap.getHeight()));
            ratio = Math.min(ratio, Math.sqrt((double) pixels / ((long) bitmap.getWidth() * bitmap.getHeight())));
            if (ratio < 1.0) {
                scaled = Bitmap.createScaledBitmap(bitmap, Math.max(1, (int) Math.round(bitmap.getWidth() * ratio)),
                    Math.max(1, (int) Math.round(bitmap.getHeight() * ratio)), true);
            }
            int budget = thumbnail ? 128 * 1024 : MAX_DISPLAY_BYTES;
            int[] qualities = thumbnail ? new int[] {78, 58, 42} : new int[] {90, 75, 58, 42};
            for (int quality : qualities) {
                ByteArrayOutputStream encoded = new ByteArrayOutputStream(Math.min(budget, 8192));
                if (!scaled.compress(Bitmap.CompressFormat.WEBP, quality, encoded)) {
                    throw new IOException("图片解码失败，请重试");
                }
                if (encoded.size() <= budget) {
                    return new Encoded(encoded.toByteArray(), "image/webp", scaled.getWidth(), scaled.getHeight(), true);
                }
                // Dense images are reduced further instead of rejected for the transfer budget.
                Bitmap smaller = Bitmap.createScaledBitmap(scaled, Math.max(1, (int) (scaled.getWidth() * 0.74)),
                    Math.max(1, (int) (scaled.getHeight() * 0.74)), true);
                if (scaled != bitmap) scaled.recycle();
                scaled = smaller;
            }
            throw new IOException("图片无法生成适合设备的预览");
        } finally {
            if (scaled != bitmap) scaled.recycle();
            bitmap.recycle();
        }
    }

    /** Pure, testable decode budget: do not ever allocate the source's full raster. */
    static int sampleSize(int width, int height, int maxEdge, long maxPixels) {
        int sample = 1;
        while (width / sample > maxEdge || height / sample > maxEdge
                || (long) (width / sample) * (height / sample) > maxPixels) {
            if (sample >= 1 << 20) throw new IllegalArgumentException("image dimensions unsupported");
            sample *= 2;
        }
        return sample;
    }

    void cancel(String documentId, String requestId) {
        if (documentId != null && page != null && !documentId.equals(page.id)) return;
        Scan scan = pendingScan;
        if (scan != null && (requestId == null || requestId.equals(scan.requestId))) {
            pendingScan = null;
            main.removeCallbacks(scan.timeout);
            scan.failure.accept(CANCELLED);
        }
        for (Work request : new ArrayList<>(work.values())) {
            if (requestId == null || requestId.equals(request.requestId)) cancelWork(request, CANCELLED);
        }
        if (page != null) {
            page.release(requestId);
            if (requestId != null && requestId.equals(page.activeImageScan)) {
                // Closing image mode releases the page's 12MB heap / 40MB disk LRU.
                // Reopening can build a fresh cache without keeping it during browsing.
                page.sources.evict();
                page.activeImageScan = null;
            }
        }
    }

    private void cancelWork(Work request, String message) {
        if (!request.cancelled.compareAndSet(false, true)) return;
        if (request.call != null) request.call.cancel();
        if (request.future != null) request.future.cancel(true);
        if (request.future instanceof Runnable) workers.remove((Runnable) request.future);
        request.transferReady.countDown();
        // Incomplete page-owned image bytes never survive a cancellation.
        if (request.transferFile != null) request.transferFile.delete();
        if (!closed && "page".equals(request.image.optString("transport"))) {
            try {
                webView.evaluateJavascript("(function(){var s=window[" + JSONObject.quote(key)
                    + "];if(s)s.stop(" + JSONObject.quote(request.requestId) + ")})()", null);
            } catch (RuntimeException ignored) {}
        }
        complete(request, null, message);
    }

    private boolean isLive(Work request) {
        return !closed && page == request.page && !request.cancelled.get() && !request.settled.get();
    }

    private void ensureLive(Work request) throws IOException {
        if (!isLive(request) || Thread.currentThread().isInterrupted()) throw new IOException(CANCELLED);
    }

    private void complete(Work request, JSONObject result, String error) {
        if (!request.settled.compareAndSet(false, true)) return;
        work.remove(request.requestId);
        main.removeCallbacks(request.timeout);
        if (request.poll != null) main.removeCallbacks(request.poll);
        request.transferred = null;
        if (error != null || closed || page != request.page || request.cancelled.get()) {
            request.page.release(request.requestId);
            if (request.transferFile != null) request.transferFile.delete();
            request.failure.accept(error == null ? CANCELLED : error);
        } else request.success.accept(result);
    }

    private static JSONObject decode(String result) throws Exception {
        Object decoded = new JSONTokener(result == null ? "null" : result).nextValue();
        if (!(decoded instanceof String)) throw new IOException("invalid result");
        return new JSONObject((String) decoded);
    }

    private static boolean validCandidate(JSONObject item, String scanId) {
        if (item == null || !item.optString("id").startsWith(scanId + "-")) return false;
        String source = item.optString("sourceUrl");
        String transport = item.optString("transport");
        if (!isHttpUrl(item.optString("pageUrl"))) return false;
        if ("http".equals(transport)) return source.length() <= 8192 && isHttpUrl(source);
        return "page".equals(transport) && ("data:".equals(source) || source.startsWith("blob:") && source.length() <= 8192);
    }

    private static boolean validRequestId(String requestId) {
        return requestId != null && !requestId.isEmpty() && requestId.length() <= 128;
    }

    private static boolean isHttpUrl(String url) {
        if (url == null) return false;
        HttpUrl parsed = HttpUrl.parse(url);
        return parsed != null && parsed.username().isEmpty() && parsed.password().isEmpty();
    }

    static byte[] readBounded(InputStream input, int maxBytes) throws IOException {
        ByteArrayOutputStream result = new ByteArrayOutputStream(Math.min(maxBytes, 8192));
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (result.size() + count > maxBytes) throw new IOException("内容超过允许读取大小");
            result.write(buffer, 0, count);
        }
        return result.toByteArray();
    }

    void close() { close(true); }

    void close(boolean removeBindings) {
        if (closed) return;
        closed = true;
        cancel(null, null);
        if (page != null) page.dispose();
        workers.shutdownNow();
        if (removeBindings) try {
            webView.evaluateJavascript("(function(){var s=window[" + JSONObject.quote(key)
                + "];if(s)s.cancel();delete window[" + JSONObject.quote(key) + "]})()", null);
        } catch (RuntimeException ignored) {}
        page = null;
    }
}
