package com.aizeek.newsnook;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import androidx.core.content.FileProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

/** Device-local file capabilities. Page JavaScript never receives a filesystem path or URI. */
final class BrowserAgentFiles {
    interface Host {
        Activity getActivity();
        boolean isDocumentLive(int tabId, String documentId);
        void onEvent(JSONObject event);
        void launchChooser(String requestId, Intent intent);
        default boolean isPrivateTab(int tabId) { return false; }
    }

    private static final String PREFS = "newsnook_browser_agent_files";
    private static final int MAX_FILES = 80;
    private static final int MAX_SELECTION = 12;
    static final int MAX_TEXT_BYTES = 256 * 1024;
    private static final long MAX_DOWNLOAD_BYTES = 256L * 1024 * 1024;
    private static final long READ_TIMEOUT_MS = 15_000;
    private static final long ARM_TIMEOUT_MS = 15_000;
    private static final long UPLOAD_CLICK_WINDOW_MS = 2_000;
    // Decoders can outlive a cancelled callback; do not start another visual decode until they release resources.
    private static final Semaphore VISUAL_READER = new Semaphore(1);
    private static final String CANCELLED = "文件操作已取消";
    private static final String STALE = "网页已变化，请重新选择文件";

    private final Context context;
    private final Host host;
    private final SharedPreferences preferences;
    private final DownloadManager downloads;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(3, 3, 30, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(12), runnable -> new Thread(runnable, "NewsNookAgentFiles"),
        new ThreadPoolExecutor.AbortPolicy());
    private final OkHttpClient client = new OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(5, TimeUnit.MINUTES).build();
    private final Map<String, Entry> entries = new LinkedHashMap<>();
    private final Map<String, ReadWork> reads = new LinkedHashMap<>();
    private final Map<String, NativeDownload> nativeDownloads = new LinkedHashMap<>();
    private final AtomicBoolean refreshing = new AtomicBoolean();
    private final Runnable poll = this::refreshDownloads;
    private final Runnable armExpiry = this::clearArmed;
    private boolean receiverRegistered;
    private volatile boolean closed;
    private Chooser chooser;
    private Armed armed;

    private static final class Entry {
        String id, name, mime, source, status, transport, runId, documentId, error = "";
        String ownedPath = "";
        Uri uri;
        int tabId;
        long size = -1, bytes, downloadId = -1, createdAt, updatedAt;
        boolean persisted, privateTab, persistableGrant;
    }

    private static final class FileFailure extends IOException {
        FileFailure(String message) { super(message); }
        FileFailure(String message, Throwable cause) { super(message, cause); }
    }

    private static final class Armed {
        final int tabId;
        final String documentId, runId;
        final List<Entry> files;
        final UploadTarget target;
        long expiresAt;
        boolean clickAuthorized;
        Armed(int tabId, String documentId, String runId, List<Entry> files, UploadTarget target) {
            this.tabId = tabId; this.documentId = documentId; this.runId = runId; this.files = files;
            this.target = target; expiresAt = SystemClock.elapsedRealtime() + ARM_TIMEOUT_MS;
        }
        boolean matches(int tab, String document, String run) {
            return tab == tabId && documentId.equals(document) && runId.equals(run);
        }
    }

    private static final class UploadTarget {
        final String frameId, frameDocumentId, snapshot;
        final int id;
        UploadTarget(JSONObject args) throws IOException {
            frameId = args.optString("frameId", "main"); frameDocumentId = args.optString("frameDocumentId");
            snapshot = args.optString("snapshot");
            double number = args.optDouble("id", -1);
            if (!validId(frameId) || !validId(frameDocumentId) || !validId(snapshot)
                    || number < 0 || number >= 160 || number != Math.floor(number) || Double.isNaN(number))
                throw new FileFailure("请先观察并指定需要上传的文件输入框");
            id = (int) number;
        }
        boolean matches(JSONObject args) {
            return args != null && frameId.equals(args.optString("frameId", "main"))
                && frameDocumentId.equals(args.optString("frameDocumentId")) && snapshot.equals(args.optString("snapshot"))
                && args.optDouble("id", -1) == id;
        }
    }

    private static final class Chooser {
        int tabId;
        String documentId, runId, id;
        String[] accepted;
        boolean multiple, privateTab, armedUpload;
        UploadTarget target;
        final AtomicBoolean settled = new AtomicBoolean();
        Consumer<JSONObject> success;
        Consumer<String> failure;
        ValueCallback<Uri[]> pageCallback;
        Future<?> future;
    }

    private static final class ReadWork {
        int tabId;
        String documentId, runId, id;
        final AtomicBoolean settled = new AtomicBoolean();
        Consumer<JSONObject> success;
        Consumer<String> failure;
        Future<?> future;
        volatile InputStream input;
        volatile File staging;
        volatile BrowserAgentPdfClient pdf;
        volatile boolean cancelling;
        Runnable timeout;
    }

    private static final class NativeDownload {
        final Entry entry;
        final AtomicBoolean cancelled = new AtomicBoolean();
        volatile Call call;
        Future<?> future;
        NativeDownload(Entry entry) { this.entry = entry; }
    }

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ignored, Intent intent) {
            if (DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                synchronized (entries) {
                    for (Entry entry : entries.values()) {
                        if (entry.downloadId == id && id >= 0) { refreshDownloads(); return; }
                    }
                }
            }
        }
    };

    BrowserAgentFiles(Context context, Host host) {
        this.context = context.getApplicationContext();
        this.host = host;
        this.preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.downloads = (DownloadManager) this.context.getSystemService(Context.DOWNLOAD_SERVICE);
        clearRetiredPrivateFiles();
        clearRetiredRenderFiles();
        restore();
        try {
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            // The sender is DownloadProvider, a different UID. Only recorded IDs are ever queried.
            if (Build.VERSION.SDK_INT >= 33) this.context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            else this.context.registerReceiver(receiver, filter);
            receiverRegistered = true;
        } catch (RuntimeException ignored) {}
        refreshDownloads();
    }

    void chooseFiles(int tabId, String documentId, String runId, String requestId, JSONObject options,
                     Consumer<JSONObject> success, Consumer<String> failure) {
        if (closed) { failure.accept("浏览器已关闭"); return; }
        disarmRun(safe(runId));
        if (!validId(documentId) || !validId(requestId) || !validId(runId)
                || !host.isDocumentLive(tabId, documentId)) { failure.accept(STALE); return; }
        if (chooser != null) { failure.accept("请先完成当前文件选择"); return; }
        JSONObject args = options == null ? new JSONObject() : options;
        UploadTarget target;
        try { target = new UploadTarget(args); }
        catch (IOException error) { failure.accept(message(error, "上传目标无效，请重新观察")); return; }
        JSONArray fileIds = args.optJSONArray("fileIds");
        if (fileIds != null && fileIds.length() > 0) {
            try {
                if (fileIds.length() > MAX_SELECTION) throw new FileFailure("一次最多选择 12 个文件");
                List<Entry> selected = new ArrayList<>();
                synchronized (entries) {
                    for (int i = 0; i < fileIds.length(); i++) {
                        Entry entry = entries.get(fileIds.optString(i));
                        if (entry == null || !"ready".equals(entry.status)
                                || entry.privateTab && !entry.runId.equals(runId)) throw new FileFailure("文件不可用，请重新选择");
                        if (!selected.contains(entry)) selected.add(entry);
                    }
                }
                arm(new Armed(tabId, documentId, runId, selected, target));
                success.accept(selectionResult(selected, true, false));
            } catch (Exception error) { failure.accept(message(error, "文件不可用，请重新选择")); }
            return;
        }
        Chooser request = new Chooser();
        request.tabId = tabId; request.documentId = documentId; request.runId = runId; request.id = requestId;
        request.multiple = args.optBoolean("multiple", false);
        request.target = target;
        request.accepted = acceptedTypes(args.optJSONArray("acceptTypes"));
        request.privateTab = host.isPrivateTab(tabId);
        request.success = success; request.failure = failure;
        launch(request);
    }

    boolean onShowFileChooser(int tabId, String documentId, String runId,
                             WebChromeClient.FileChooserParams params, ValueCallback<Uri[]> callback) {
        if (supplyArmedFiles(tabId, documentId, runId, params, callback)) return true;
        if (closed || !host.isDocumentLive(tabId, documentId)) { deliverPage(callback, null); return true; }
        if (chooser != null) { deliverPage(callback, null); return true; }
        if (params.getMode() != WebChromeClient.FileChooserParams.MODE_OPEN
                && params.getMode() != WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            deliverPage(callback, null);
            emit("file_chooser_failed", tabId, documentId, runId, "", null, "当前仅支持选择已有文件");
            return true;
        }
        Chooser request = new Chooser();
        request.tabId = tabId; request.documentId = documentId; request.runId = safe(runId);
        request.id = "page-file-" + UUID.randomUUID(); request.pageCallback = callback;
        request.multiple = params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        request.accepted = params.getAcceptTypes(); request.privateTab = host.isPrivateTab(tabId);
        launch(request);
        return true;
    }

    /** Returns true only when this exact run/document owns a pending one-shot selection. */
    boolean supplyArmedFiles(int tabId, String documentId, String runId,
                             WebChromeClient.FileChooserParams params, ValueCallback<Uri[]> callback) {
        Armed selection = armed;
        if (selection == null || !selection.matches(tabId, documentId, safe(runId))) return false;
        clearArmed();
        if (!selection.clickAuthorized || SystemClock.elapsedRealtime() >= selection.expiresAt) {
            deliverPage(callback, null);
            emit("file_chooser_failed", tabId, documentId, runId, "", null, "上传目标尚未通过点击校验，请重新选择文件");
            return true;
        }
        if (closed || !host.isDocumentLive(tabId, documentId)) { deliverPage(callback, null); return true; }
        Chooser request = new Chooser();
        request.tabId = tabId; request.documentId = documentId; request.runId = safe(runId);
        request.id = "upload-" + UUID.randomUUID(); request.pageCallback = callback;
        request.armedUpload = true;
        request.multiple = params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        request.accepted = params.getAcceptTypes();
        if (chooser != null || params.getMode() != 0 && params.getMode() != 1) {
            deliverPage(callback, null); return true;
        }
        chooser = request;
        try {
            request.future = workers.submit(() -> {
                try {
                    if (!request.multiple && selection.files.size() != 1) throw new FileFailure("该上传位置只接受一个文件");
                    List<Uri> uris = new ArrayList<>();
                    for (Entry entry : selection.files) {
                        if (!"ready".equals(entry.status) || !accepts(entry.name, entry.mime, request.accepted))
                            throw new FileFailure("文件类型与网页要求不符，请重新选择");
                        try (InputStream input = open(entry)) { if (input == null) throw new FileFailure("文件已不可读取"); }
                        uris.add(uploadUri(entry));
                    }
                    main.post(() -> finishChooser(request, selection.files, uris.toArray(new Uri[0]), null, false));
                } catch (Exception error) {
                    main.post(() -> finishChooser(request, null, null, message(error, "文件已不可读取，请重新选择"), false));
                }
            });
        } catch (RejectedExecutionException error) { finishChooser(request, null, null, "文件任务繁忙，请稍后重试", false); }
        return true;
    }

    /** Called only after Host has validated this top-frame prepare_click and its native coordinates. */
    void authorizeUploadClick(int tabId, String documentId, String runId, JSONObject target) {
        Armed selection = armed;
        if (selection == null) return; // Ordinary link clicks do not carry an upload selection.
        if (!host.isDocumentLive(tabId, documentId) || !selection.matches(tabId, documentId, safe(runId)) || !selection.target.matches(target)
                || selection.clickAuthorized || SystemClock.elapsedRealtime() >= selection.expiresAt) {
            clearArmed();
            throw new IllegalStateException("上传目标已变化或选择已过期，请重新选择文件");
        }
        selection.clickAuthorized = true;
        selection.expiresAt = SystemClock.elapsedRealtime() + UPLOAD_CLICK_WINDOW_MS;
        main.removeCallbacks(armExpiry); main.postDelayed(armExpiry, UPLOAD_CLICK_WINDOW_MS);
    }

    void disarmRun(String runId) {
        if (armed != null && armed.runId.equals(runId)) clearArmed();
        Chooser pending = chooser;
        if (pending != null && pending.armedUpload && pending.runId.equals(runId)) {
            if (pending.future != null) pending.future.cancel(true);
            finishChooser(pending, null, null, CANCELLED, false);
        }
    }

    private void arm(Armed selection) {
        clearArmed(); armed = selection;
        main.postDelayed(armExpiry, ARM_TIMEOUT_MS);
    }

    private void clearArmed() { armed = null; main.removeCallbacks(armExpiry); }

    private void launch(Chooser request) {
        chooser = request;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        String[] types = normalizedAcceptTypes(request.accepted);
        intent.setType(types.length == 1 ? types[0] : "*/*");
        if (types.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, request.multiple);
        try {
            host.launchChooser(request.id, intent);
            emit("file_chooser_opened", request.tabId, request.documentId, request.runId, request.id, null, null);
        } catch (RuntimeException error) { finishChooser(request, null, null, "无法打开系统文件选择器", false); }
    }

    void handleChooserResult(String requestId, int resultCode, Intent data) {
        Chooser request = chooser;
        if (request == null || !request.id.equals(requestId) || request.settled.get() || request.future != null) return;
        if (resultCode != Activity.RESULT_OK || data == null) {
            finishChooser(request, new ArrayList<>(), null, null, true); return;
        }
        if (!host.isDocumentLive(request.tabId, request.documentId)) {
            finishChooser(request, null, null, STALE, false); return;
        }
        List<Uri> selected = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            if (clip.getItemCount() > MAX_SELECTION) { finishChooser(request, null, null, "一次最多选择 12 个文件", false); return; }
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null && !selected.contains(uri)) selected.add(uri);
            }
        } else if (data.getData() != null) selected.add(data.getData());
        if (selected.isEmpty() || !request.multiple && selected.size() != 1) {
            finishChooser(request, null, null, "文件选择结果与网页要求不符", false); return;
        }
        final int flags = data.getFlags();
        try {
            request.future = workers.submit(() -> {
                try {
                    List<Entry> registered = new ArrayList<>();
                    for (Uri uri : selected) registered.add(inspectSelected(uri, request, flags));
                    main.post(() -> finishChooser(request, registered, selected.toArray(new Uri[0]), null, false));
                } catch (Exception error) {
                    main.post(() -> finishChooser(request, null, null, message(error, "文件无法读取，请重新选择"), false));
                }
            });
        } catch (RejectedExecutionException error) { finishChooser(request, null, null, "文件任务繁忙，请稍后重试", false); }
    }

    private Entry inspectSelected(Uri uri, Chooser request, int flags) throws IOException {
        if (!"content".equals(uri.getScheme()) || uri.toString().length() > 8192)
            throw new FileFailure("请选择系统文件提供程序中的文件");
        String authority = safe(uri.getAuthority());
        ProviderInfo info = context.getPackageManager().resolveContentProvider(authority, 0);
        if (authority.equals(context.getPackageName() + ".fileprovider")
                || info != null && info.applicationInfo != null && context.getPackageName().equals(info.applicationInfo.packageName))
            throw new FileFailure("不能通过文件选择器读取应用私有数据");
        Entry entry = new Entry();
        entry.id = UUID.randomUUID().toString(); entry.uri = uri;
        entry.name = safeName(uri.getLastPathSegment()); entry.mime = cleanMime(context.getContentResolver().getType(uri));
        try (Cursor cursor = context.getContentResolver().query(uri,
                new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int name = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME), size = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (name >= 0 && !cursor.isNull(name)) entry.name = safeName(cursor.getString(name));
                if (size >= 0 && !cursor.isNull(size)) entry.size = cursor.getLong(size);
            }
        } catch (RuntimeException error) { throw new FileFailure("文件元信息无法读取，请重新选择", error); }
        if (entry.size > MAX_DOWNLOAD_BYTES) throw new FileFailure("所选文件超过 256 MB");
        entry.mime = inferredMime(entry.mime, entry.name);
        if (!accepts(entry.name, entry.mime, request.accepted)) throw new FileFailure("所选文件类型不符合要求");
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) throw new FileFailure("文件无法读取");
        }
        entry.tabId = request.tabId; entry.documentId = request.documentId; entry.runId = request.runId;
        entry.source = "selected"; entry.status = "ready"; entry.transport = "content-uri";
        entry.privateTab = request.privateTab; entry.createdAt = entry.updatedAt = System.currentTimeMillis();
        entry.persistableGrant = !entry.privateTab && !request.runId.isEmpty()
            && (flags & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0
            && (flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0;
        return entry;
    }

    private void finishChooser(Chooser request, List<Entry> selected, Uri[] uris, String error, boolean cancelled) {
        if (!request.settled.compareAndSet(false, true)) return;
        if (chooser == request) chooser = null;
        if (error == null && !cancelled && (closed || !host.isDocumentLive(request.tabId, request.documentId))) error = STALE;
        if (error == null && !cancelled && selected != null && !request.runId.isEmpty()) {
            synchronized (entries) {
                if (entries.size() + selected.stream().filter(entry -> !entries.containsKey(entry.id)).count() > MAX_FILES)
                    error = "文件记录已满，请先移除不需要的文件";
                else for (Entry entry : selected) entries.put(entry.id, entry);
            }
        }
        if (error == null && !cancelled) {
            if (selected != null) for (Entry entry : selected) if (entry.persistableGrant && !entry.persisted) {
                try {
                    context.getContentResolver().takePersistableUriPermission(entry.uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    entry.persisted = true;
                } catch (RuntimeException ignored) {}
            }
            persist();
            if (request.pageCallback != null) deliverPage(request.pageCallback, uris);
            else {
                arm(new Armed(request.tabId, request.documentId, request.runId, selected, request.target));
                request.success.accept(selectionResult(selected, true, false));
            }
            emit("file_chooser_completed", request.tabId, request.documentId, request.runId, request.id, null, null);
        } else {
            if (request.pageCallback != null) deliverPage(request.pageCallback, null);
            else if (cancelled) request.success.accept(selectionResult(new ArrayList<>(), false, true));
            else request.failure.accept(error);
            emit(cancelled ? "file_chooser_cancelled" : "file_chooser_failed", request.tabId, request.documentId,
                request.runId, request.id, null, error);
        }
    }

    private static void deliverPage(ValueCallback<Uri[]> callback, Uri[] result) {
        try { callback.onReceiveValue(result); }
        catch (RuntimeException ignored) { /* Retired WebView callbacks must not interrupt stop/close cleanup. */ }
    }

    JSONObject list(String runId) {
        refreshDownloads();
        JSONArray result = new JSONArray();
        synchronized (entries) {
            for (Entry entry : entries.values()) {
                if (entry.privateTab && (runId == null || runId.isEmpty() || !runId.equals(entry.runId))) continue;
                if (runId == null || runId.isEmpty() || runId.equals(entry.runId)) result.put(publicEntry(entry));
            }
        }
        return json("files", result, "capabilities", json("upload", true, "multiple", true,
            "httpGetDownload", true, "cookieDownload", true, "textRead", true, "imageRead", true, "pdfRead", true,
            "capture", false, "directorySelection", false, "maxSelection", MAX_SELECTION,
            "postDownload", false, "blobDownload", false, "partitionedCookieReplay", false,
            "nativeDownloadResumeAfterRestart", false, "maxTextBytes", MAX_TEXT_BYTES,
            "maxVisualInputBytes", BrowserAgentFilePreview.MAX_INPUT_BYTES,
            "maxPreviewEdge", BrowserAgentFilePreview.MAX_EDGE, "maxPreviewPixels", BrowserAgentFilePreview.MAX_PIXELS,
            "maxImageBytes", BrowserAgentFilePreview.MAX_JPEG_BYTES, "pdfPagesPerRead", 1, "pdfIsolatedProcess", true,
            "maxDownloadBytes", MAX_DOWNLOAD_BYTES));
    }

    void readFile(int tabId, String documentId, String runId, String requestId, JSONObject options,
                  Consumer<JSONObject> success, Consumer<String> failure) {
        if (closed || !host.isDocumentLive(tabId, documentId)) { failure.accept(STALE); return; }
        if (!validId(requestId) || reads.containsKey(requestId)) { failure.accept("文件读取请求无效或正在执行"); return; }
        JSONObject args = options == null ? new JSONObject() : options;
        Entry entry;
        synchronized (entries) { entry = entries.get(args.optString("fileId")); }
        if (entry == null || !"ready".equals(entry.status) || entry.privateTab && !entry.runId.equals(runId)) {
            failure.accept("文件尚未完成下载或已不可用"); return;
        }
        boolean visual = entry.mime.startsWith("image/") || "application/pdf".equals(entry.mime);
        if (!visual && !isText(entry.mime, entry.name)) {
            failure.accept("该文件格式暂不支持，当前可读取文本、JSON、CSV、图片与 PDF 单页"); return;
        }
        int limit = Math.max(1, Math.min(MAX_TEXT_BYTES, args.optInt("maxBytes", MAX_TEXT_BYTES)));
        if (visual && entry.size > BrowserAgentFilePreview.MAX_INPUT_BYTES) {
            failure.accept("视觉预览只支持 32 MB 以内的文件，请先缩小文件"); return;
        }
        if (!visual && entry.size > limit) { failure.accept("文件超过文本读取上限，请缩小文件后重试"); return; }
        double requestedPage = args.has("page") ? args.optDouble("page", Double.NaN) : 0;
        if ("application/pdf".equals(entry.mime) && (Double.isNaN(requestedPage) || requestedPage < 0
                || requestedPage > Integer.MAX_VALUE || requestedPage != Math.floor(requestedPage))) {
            failure.accept("PDF 页码必须是从 0 开始的整数"); return;
        }
        ReadWork work = new ReadWork();
        work.tabId = tabId; work.documentId = documentId; work.runId = safe(runId); work.id = requestId;
        work.success = success; work.failure = failure;
        work.timeout = () -> cancelRead(work, "文件读取超时，请重试");
        reads.put(requestId, work); main.postDelayed(work.timeout, READ_TIMEOUT_MS);
        try {
            work.future = workers.submit(() -> {
                try {
                    JSONObject result;
                    if (visual) result = renderFile(work, entry, (int) requestedPage);
                    else try (InputStream input = open(entry)) {
                        work.input = input;
                        ensureReadLive(work);
                        String text = readTextBounded(input, limit);
                        result = json("fileId", entry.id, "name", entry.name, "mime", entry.mime,
                            "text", text, "encoding", "utf-8", "truncated", false);
                    }
                    main.post(() -> completeRead(work, result, null));
                } catch (OutOfMemoryError error) {
                    main.post(() -> completeRead(work, null, "文件预览内存不足，请缩小文件后重试"));
                } catch (Exception error) {
                    main.post(() -> completeRead(work, null, message(error, "文件无法读取，请重新选择")));
                } finally { work.input = null; }
            });
        } catch (RejectedExecutionException error) { completeRead(work, null, "文件任务繁忙，请稍后重试"); }
    }

    private JSONObject renderFile(ReadWork work, Entry entry, int page) throws IOException, InterruptedException {
        VISUAL_READER.acquire();
        File staged = null;
        try {
            ensureReadLive(work);
            File directory = new File(context.getCacheDir(), "browser-agent-render");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new FileFailure("无法建立文件预览目录");
            staged = File.createTempFile("read-", ".data", directory);
            work.staging = staged;
            try (InputStream input = open(entry); FileOutputStream output = new FileOutputStream(staged)) {
                work.input = input;
                byte[] buffer = new byte[32 * 1024]; int count; long total = 0;
                ensureReadLive(work);
                while ((count = input.read(buffer)) != -1) {
                    ensureReadLive(work); total += count;
                    if (total > BrowserAgentFilePreview.MAX_INPUT_BYTES)
                        throw new FileFailure("视觉预览只支持 32 MB 以内的文件，请先缩小文件");
                    output.write(buffer, 0, count);
                }
            } finally { work.input = null; }
            ensureReadLive(work);
            // An owned, bounded, immutable copy supports seekable PDF input and avoids provider swaps between image passes.
            JSONObject result;
            if ("application/pdf".equals(entry.mime)) {
                BrowserAgentPdfClient pdf = new BrowserAgentPdfClient(context, page);
                work.pdf = pdf;
                try {
                    ensureReadLive(work);
                    result = pdf.render(staged, () -> ensureReadLive(work));
                } finally { pdf.cancel(); work.pdf = null; }
            } else result = BrowserAgentFilePreview.renderImage(staged, () -> ensureReadLive(work));
            ensureReadLive(work);
            put(result, "fileId", entry.id); put(result, "name", entry.name); put(result, "sourceMime", entry.mime);
            return result;
        } finally {
            if (staged != null) staged.delete();
            work.staging = null;
            VISUAL_READER.release();
        }
    }

    private void ensureReadLive(ReadWork work) throws IOException {
        if (closed || work.cancelling || work.settled.get() || Thread.currentThread().isInterrupted()) throw new FileFailure(CANCELLED);
    }

    private void completeRead(ReadWork work, JSONObject result, String error) {
        if (!work.settled.compareAndSet(false, true)) return;
        reads.remove(work.id); main.removeCallbacks(work.timeout);
        if (error != null) work.failure.accept(error);
        else if (closed || !host.isDocumentLive(work.tabId, work.documentId)) work.failure.accept(STALE);
        else work.success.accept(result);
    }

    private void cancelRead(ReadWork work, String reason) {
        work.cancelling = true;
        BrowserAgentPdfClient pdf = work.pdf;
        if (pdf != null) pdf.cancel();
        if (work.future != null) work.future.cancel(true);
        InputStream input = work.input;
        if (input != null) try { input.close(); } catch (IOException ignored) {}
        File staging = work.staging;
        if (staging != null) staging.delete();
        completeRead(work, null, reason);
    }

    JSONObject enqueueDownload(int tabId, String documentId, String runId, String url, String userAgent,
                               String disposition, String mime, long expectedSize) throws IOException {
        if (closed) throw new FileFailure("浏览器已关闭");
        HttpUrl target = httpUrl(url);
        if (target == null) throw new FileFailure("当前下载仅支持 HTTP(S) 文件；此网页导出方式暂不支持");
        if (expectedSize > MAX_DOWNLOAD_BYTES) throw new FileFailure("文件超过 256 MB 下载上限");
        synchronized (entries) {
            if (entries.size() >= MAX_FILES) throw new FileFailure("文件记录已满，请先移除不需要的文件");
            int active = 0;
            for (Entry entry : entries.values()) if (active(entry)) active++;
            if (active >= 6) throw new FileFailure("同时下载的文件过多，请稍后重试");
        }
        Entry entry = new Entry();
        entry.id = UUID.randomUUID().toString(); entry.tabId = tabId;
        entry.documentId = safe(documentId); entry.runId = safe(runId);
        entry.name = safeName(android.webkit.URLUtil.guessFileName(url, disposition, mime));
        entry.mime = inferredMime(cleanMime(mime), entry.name); entry.source = "download";
        entry.size = expectedSize; entry.status = "downloading"; entry.privateTab = host.isPrivateTab(tabId);
        entry.createdAt = entry.updatedAt = System.currentTimeMillis(); entry.persisted = !entry.privateTab;
        File destination = destination(entry);
        entry.ownedPath = destination.getAbsolutePath();
        String cookie = CookieManager.getInstance().getCookie(url);
        if (entry.privateTab || cookie != null && !cookie.isEmpty()) {
            entry.transport = "native-http";
            synchronized (entries) { entries.put(entry.id, entry); }
            NativeDownload work = new NativeDownload(entry);
            nativeDownloads.put(entry.id, work); persist();
            try { work.future = workers.submit(() -> downloadNative(work, target, safe(userAgent))); }
            catch (RejectedExecutionException error) {
                nativeDownloads.remove(entry.id); entry.status = "failed"; entry.error = "文件任务繁忙，请稍后重试"; persist();
                throw new FileFailure(entry.error);
            }
        } else {
            if (downloads == null) throw new FileFailure("系统下载服务不可用");
            entry.transport = "download-manager";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                .setTitle(entry.name).setDestinationUri(Uri.fromFile(destination))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (!safe(userAgent).isEmpty() && !userAgent.contains("\n") && !userAgent.contains("\r")) request.addRequestHeader("User-Agent", userAgent);
            try { entry.downloadId = downloads.enqueue(request); }
            catch (RuntimeException error) { throw new FileFailure("无法启动系统下载", error); }
            synchronized (entries) { entries.put(entry.id, entry); }
            persist(); schedulePoll();
        }
        emit("download_started", entry.tabId, entry.documentId, entry.runId, entry.id, entry, null);
        return publicEntry(entry);
    }

    private File destination(Entry entry) throws IOException {
        File base = entry.privateTab ? context.getCacheDir() : context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (base == null) throw new FileFailure("文件存储空间不可用");
        File directory = new File(base, entry.privateTab ? "browser-agent-private" : "browser-agent");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new FileFailure("无法建立文件存储目录");
        return new File(directory, entry.id + "-" + entry.name);
    }

    private void downloadNative(NativeDownload work, HttpUrl initial, String userAgent) {
        Entry entry = work.entry;
        File target = new File(entry.ownedPath), temporary = new File(entry.ownedPath + ".part");
        try {
            HttpUrl url = initial;
            for (int redirects = 0; redirects <= 5; redirects++) {
                ensureDownloadLive(work);
                Request.Builder request = new Request.Builder().url(url).get();
                if (!userAgent.isEmpty() && !userAgent.contains("\n") && !userAgent.contains("\r")) request.header("User-Agent", userAgent);
                // No observed Authorization/Referer is copied. Cookies are recomputed for each destination.
                String cookie = CookieManager.getInstance().getCookie(url.toString());
                if (cookie != null && !cookie.isEmpty()) request.header("Cookie", cookie);
                work.call = client.newCall(request.build());
                try (Response response = work.call.execute()) {
                    if (response.code() >= 300 && response.code() < 400) {
                        String location = response.header("Location");
                        HttpUrl next = location == null ? null : url.resolve(location);
                        if (next == null || !isAllowedRedirect(url.toString(), next.toString())) throw new FileFailure("下载跳转不可用");
                        url = next; continue;
                    }
                    if (!response.isSuccessful() || response.body() == null) throw new FileFailure("文件下载失败 HTTP " + response.code());
                    String actualMime = cleanMime(response.header("Content-Type"));
                    if ("text/html".equals(actualMime) && !"text/html".equals(entry.mime))
                        throw new FileFailure("下载返回了网页，可能需要重新登录或重新导出");
                    long length = response.body().contentLength();
                    if (length > MAX_DOWNLOAD_BYTES) throw new FileFailure("文件超过 256 MB 下载上限");
                    long count = 0, lastProgress = 0;
                    try (InputStream input = response.body().byteStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                        byte[] buffer = new byte[32 * 1024]; int size;
                        while ((size = input.read(buffer)) != -1) {
                            ensureDownloadLive(work);
                            count += size;
                            if (count > MAX_DOWNLOAD_BYTES) throw new FileFailure("文件超过 256 MB 下载上限");
                            output.write(buffer, 0, size);
                            long now = System.currentTimeMillis();
                            if (now - lastProgress >= 1000) {
                                long bytes = count; lastProgress = now;
                                main.post(() -> updateNativeProgress(work, bytes, length));
                            }
                        }
                        output.getFD().sync();
                    }
                    ensureDownloadLive(work);
                    if (length >= 0 && length != count) throw new FileFailure("文件下载不完整，请重新下载");
                    if (!temporary.renameTo(target)) throw new FileFailure("下载文件保存失败");
                    ensureDownloadLive(work);
                    long finalSize = count;
                    main.post(() -> finishNative(work, finalSize, actualMime, null));
                    return;
                } finally { work.call = null; }
            }
            throw new FileFailure("下载跳转过多");
        } catch (Exception error) {
            temporary.delete();
            if (closed || work.cancelled.get()) target.delete();
            main.post(() -> finishNative(work, 0, null, message(error, "文件下载失败，请重试")));
        }
    }

    private void updateNativeProgress(NativeDownload work, long bytes, long total) {
        if (closed || work.cancelled.get() || nativeDownloads.get(work.entry.id) != work) return;
        work.entry.bytes = bytes;
        if (total >= 0) work.entry.size = total;
        work.entry.updatedAt = System.currentTimeMillis();
        emit("download_progress", work.entry.tabId, work.entry.documentId, work.entry.runId, work.entry.id, work.entry, null);
    }

    private void finishNative(NativeDownload work, long bytes, String mime, String error) {
        if (nativeDownloads.get(work.entry.id) != work || work.cancelled.get()) return;
        nativeDownloads.remove(work.entry.id);
        Entry entry = work.entry;
        entry.updatedAt = System.currentTimeMillis();
        if (error == null) {
            entry.status = "ready"; entry.size = entry.bytes = bytes;
            entry.mime = inferredMime(cleanMime(mime), entry.name); entry.uri = Uri.fromFile(new File(entry.ownedPath));
        } else { entry.status = "failed"; entry.error = error; }
        persist();
        emit(error == null ? "download_completed" : "download_failed", entry.tabId, entry.documentId, entry.runId, entry.id, entry, error);
    }

    private void ensureDownloadLive(NativeDownload work) throws IOException {
        if (closed || work.cancelled.get() || Thread.currentThread().isInterrupted()) throw new FileFailure(CANCELLED);
    }

    void refreshDownloads() {
        if (closed || downloads == null || !refreshing.compareAndSet(false, true)) return;
        List<Entry> pending = new ArrayList<>();
        synchronized (entries) {
            for (Entry entry : entries.values()) if (entry.downloadId >= 0 && active(entry)) pending.add(entry);
        }
        if (pending.isEmpty()) { refreshing.set(false); return; }
        try {
            workers.execute(() -> {
                List<JSONObject> updates = new ArrayList<>();
                for (Entry entry : pending) {
                    if (closed) break;
                    try (Cursor cursor = downloads.query(new DownloadManager.Query().setFilterById(entry.downloadId))) {
                        if (cursor == null || !cursor.moveToFirst()) {
                            updates.add(json("fileId", entry.id, "status", "failed", "error", "下载记录已不可用")); continue;
                        }
                        int state = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        long bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        JSONObject update = json("fileId", entry.id, "status", downloadStatus(state), "bytes", bytes, "size", total);
                        if (bytes > MAX_DOWNLOAD_BYTES || total > MAX_DOWNLOAD_BYTES) {
                            downloads.remove(entry.downloadId); update.put("status", "failed").put("error", "文件超过 256 MB 下载上限");
                        } else if (state == DownloadManager.STATUS_SUCCESSFUL) {
                            Uri uri = downloads.getUriForDownloadedFile(entry.downloadId);
                            if (uri == null) throw new FileFailure("下载文件不可读取");
                            try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                                if (input == null) throw new FileFailure("下载文件不可读取");
                            }
                            update.put("uri", uri.toString());
                            String actualMime = cleanMime(downloads.getMimeTypeForDownloadedFile(entry.downloadId));
                            if ("text/html".equals(actualMime) && !"text/html".equals(entry.mime)) {
                                update.put("status", "failed").put("error", "下载返回了网页，请重新登录或重新导出");
                            } else update.put("mime", inferredMime(actualMime, entry.name));
                        } else if (state == DownloadManager.STATUS_FAILED) {
                            int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                            update.put("error", "系统下载失败（" + reason + "），请重试");
                        }
                        updates.add(update);
                    } catch (Exception error) {
                        updates.add(json("fileId", entry.id, "status", "failed", "error", message(error, "无法读取系统下载状态")));
                    }
                }
                main.post(() -> {
                    refreshing.set(false);
                    if (closed) return;
                    for (JSONObject update : updates) {
                        Entry entry;
                        synchronized (entries) { entry = entries.get(update.optString("fileId")); }
                        if (entry == null || !active(entry)) continue;
                        String previous = entry.status;
                        entry.status = update.optString("status", entry.status);
                        entry.bytes = update.optLong("bytes", entry.bytes); entry.size = update.optLong("size", entry.size);
                        entry.error = update.optString("error", ""); entry.updatedAt = System.currentTimeMillis();
                        if (update.has("uri")) entry.uri = Uri.parse(update.optString("uri"));
                        if (update.has("mime")) entry.mime = update.optString("mime");
                        String event = "ready".equals(entry.status) ? "download_completed" : "failed".equals(entry.status) ? "download_failed" : "download_progress";
                        emit(event, entry.tabId, entry.documentId, entry.runId, entry.id, entry, entry.error.isEmpty() ? null : entry.error);
                        if (!previous.equals(entry.status)) persist();
                    }
                    schedulePoll();
                });
            });
        } catch (RejectedExecutionException ignored) { refreshing.set(false); schedulePoll(); }
    }

    private void schedulePoll() {
        if (closed) return;
        main.removeCallbacks(poll);
        synchronized (entries) {
            for (Entry entry : entries.values()) if (entry.downloadId >= 0 && active(entry)) {
                main.postDelayed(poll, 1500); break;
            }
        }
    }

    JSONObject cancelFile(String fileId) {
        Entry entry;
        synchronized (entries) { entry = entries.get(fileId); }
        if (entry == null) return json("ok", false, "error", "文件记录不存在");
        if (!active(entry)) return publicEntry(entry);
        NativeDownload nativeWork = nativeDownloads.remove(entry.id);
        if (nativeWork != null) {
            nativeWork.cancelled.set(true);
            if (nativeWork.call != null) nativeWork.call.cancel();
            if (nativeWork.future != null) nativeWork.future.cancel(true);
        }
        if (entry.downloadId >= 0 && downloads != null) try { downloads.remove(entry.downloadId); } catch (RuntimeException ignored) {}
        entry.status = "cancelled"; entry.error = CANCELLED; entry.updatedAt = System.currentTimeMillis();
        if (!entry.ownedPath.isEmpty()) { new File(entry.ownedPath + ".part").delete(); new File(entry.ownedPath).delete(); }
        persist(); emit("download_cancelled", entry.tabId, entry.documentId, entry.runId, entry.id, entry, null);
        return publicEntry(entry);
    }

    /** Removes the capability; user-selected documents themselves are never deleted. */
    JSONObject forgetFile(String fileId) {
        Entry entry;
        synchronized (entries) { entry = entries.get(fileId); }
        if (entry == null) return json("ok", false, "error", "文件记录不存在");
        if (active(entry)) cancelFile(fileId);
        if (armed != null && armed.files.contains(entry)) clearArmed();
        synchronized (entries) { entries.remove(fileId); }
        // Keep completed user downloads intact; only this module's incomplete staging is disposable.
        if (!entry.ownedPath.isEmpty()) new File(entry.ownedPath + ".part").delete();
        if (entry.privateTab && !entry.ownedPath.isEmpty()) new File(entry.ownedPath).delete();
        persist();
        return json("ok", true, "fileId", fileId, "forgotten", true);
    }

    JSONObject cancelFile(String fileId, String runId) {
        synchronized (entries) {
            Entry entry = entries.get(fileId);
            if (entry != null && entry.privateTab && !entry.runId.equals(runId))
                return json("ok", false, "error", "文件不属于当前运行");
        }
        return cancelFile(fileId);
    }

    JSONObject forgetFile(String fileId, String runId) {
        synchronized (entries) {
            Entry entry = entries.get(fileId);
            if (entry != null && entry.privateTab && !entry.runId.equals(runId))
                return json("ok", false, "error", "文件不属于当前运行");
        }
        return forgetFile(fileId);
    }

    void cancelDocument(int tabId, String documentId) {
        if (armed != null && armed.tabId == tabId && armed.documentId.equals(documentId)) clearArmed();
        Chooser pending = chooser;
        if (pending != null && pending.tabId == tabId && pending.documentId.equals(documentId)) {
            if (pending.future != null) pending.future.cancel(true);
            finishChooser(pending, null, null, CANCELLED, false);
        }
        for (ReadWork work : new ArrayList<>(reads.values())) if (work.tabId == tabId && work.documentId.equals(documentId)) cancelRead(work, CANCELLED);
    }

    void cancelRun(String runId) {
        disarmRun(runId);
        Chooser pending = chooser;
        if (pending != null && pending.runId.equals(runId)) {
            if (pending.future != null) pending.future.cancel(true);
            finishChooser(pending, null, null, CANCELLED, false);
        }
        for (ReadWork work : new ArrayList<>(reads.values())) if (work.runId.equals(runId)) cancelRead(work, CANCELLED);
        List<String> ids = new ArrayList<>();
        synchronized (entries) { for (Entry entry : entries.values()) if (entry.runId.equals(runId) && active(entry)) ids.add(entry.id); }
        for (String id : ids) cancelFile(id);
    }

    private InputStream open(Entry entry) throws IOException {
        if (!entry.ownedPath.isEmpty()) {
            File file = new File(entry.ownedPath);
            if (!ownedFile(file)) throw new FileFailure("文件路径无效");
            return new FileInputStream(file);
        }
        if (entry.uri == null || !"content".equals(entry.uri.getScheme())) throw new FileFailure("文件授权已失效，请重新选择");
        InputStream input = context.getContentResolver().openInputStream(entry.uri);
        if (input == null) throw new FileFailure("文件无法读取");
        return input;
    }

    private Uri uploadUri(Entry entry) throws IOException {
        if (entry.ownedPath.isEmpty()) return entry.uri;
        File file = new File(entry.ownedPath);
        if (!ownedFile(file)) throw new FileFailure("文件路径无效");
        try { return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file); }
        catch (RuntimeException error) { throw new FileFailure("下载文件暂时无法上传", error); }
    }

    private boolean ownedFile(File file) throws IOException {
        String path = file.getCanonicalPath();
        File external = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return external != null && path.startsWith(new File(external, "browser-agent").getCanonicalPath() + File.separator)
            || path.startsWith(new File(context.getCacheDir(), "browser-agent-private").getCanonicalPath() + File.separator);
    }

    static String readTextBounded(InputStream input, int limit) throws IOException {
        if (input == null) throw new FileFailure("文件无法读取");
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 8192));
        byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted()) throw new FileFailure(CANCELLED);
            if (output.size() + count > limit) throw new FileFailure("文件超过文本读取上限");
            output.write(buffer, 0, count);
        }
        byte[] bytes = output.toByteArray();
        for (byte value : bytes) if (value >= 0 && value < 32 && value != 9 && value != 10 && value != 13)
            throw new FileFailure("该文件包含二进制数据，无法作为文本读取");
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            return text.startsWith("\uFEFF") ? text.substring(1) : text;
        } catch (CharacterCodingException error) { throw new FileFailure("文件不是 UTF-8 文本，请转换编码后重试", error); }
    }

    static String downloadStatus(int status) {
        if (status == DownloadManager.STATUS_SUCCESSFUL) return "ready";
        if (status == DownloadManager.STATUS_FAILED) return "failed";
        if (status == DownloadManager.STATUS_PAUSED) return "paused";
        return "downloading";
    }

    static boolean isAllowedRedirect(String from, String target) {
        HttpUrl original = httpUrl(from), next = httpUrl(target);
        return original != null && next != null && !("https".equals(original.scheme()) && "http".equals(next.scheme()));
    }

    private static HttpUrl httpUrl(String value) {
        HttpUrl url = value == null || value.length() > 8192 ? null : HttpUrl.parse(value);
        return url != null && url.username().isEmpty() && url.password().isEmpty() ? url : null;
    }

    private static boolean active(Entry entry) { return "downloading".equals(entry.status) || "paused".equals(entry.status); }
    private static boolean validId(String value) { return value != null && !value.isEmpty() && value.length() <= 128; }
    private static String safe(String value) { return value == null ? "" : value; }
    private static String message(Exception error, String fallback) {
        return (error instanceof FileFailure || error instanceof BrowserAgentFilePreview.PreviewFailure)
            && error.getMessage() != null ? error.getMessage() : fallback;
    }

    private static String safeName(String value) {
        String name = safe(value).replaceAll("[\\\\/\\x00-\\x1f\\x7f]", "_").trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "download";
        if (name.length() > 160) name = name.substring(0, 160);
        while (name.getBytes(StandardCharsets.UTF_8).length > 160)
            name = name.substring(0, name.offsetByCodePoints(name.length(), -1));
        return name;
    }

    private static String cleanMime(String mime) {
        String value = safe(mime).split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return value.matches("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+") ? value : "application/octet-stream";
    }

    private static String inferredMime(String mime, String name) {
        if (!"application/octet-stream".equals(mime)) return mime;
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "application/json";
        if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "text/csv";
        if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".log")) return "text/plain";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".bmp")) return "image/bmp";
        if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heif";
        if (lower.endsWith(".avif")) return "image/avif";
        return mime;
    }

    private static boolean isText(String mime, String name) {
        String type = inferredMime(mime, name);
        return type.startsWith("text/") || type.equals("application/json") || type.endsWith("+json")
            || type.equals("application/xml") || type.endsWith("+xml") || type.equals("application/x-ndjson")
            || type.equals("application/javascript");
    }

    private static String[] acceptedTypes(JSONArray values) {
        if (values == null) return new String[0];
        List<String> result = new ArrayList<>();
        for (int i = 0; i < Math.min(20, values.length()); i++) {
            String value = values.optString(i).trim().toLowerCase(Locale.ROOT);
            if (value.length() <= 128 && !value.isEmpty()) result.add(value);
        }
        return result.toArray(new String[0]);
    }

    private static String[] normalizedAcceptTypes(String[] accepted) {
        List<String> types = new ArrayList<>();
        if (accepted != null) for (String raw : accepted) {
            if (raw == null) continue;
            String value = raw.trim().toLowerCase(Locale.ROOT);
            if (value.matches("[a-z0-9!#$&^_.+*-]+/[a-z0-9!#$&^_.+*-]+") && !types.contains(value)) types.add(value);
        }
        return types.isEmpty() ? new String[] {"*/*"} : types.toArray(new String[0]);
    }

    private static boolean accepts(String name, String mime, String[] accepted) {
        if (accepted == null || accepted.length == 0) return true;
        boolean restriction = false;
        for (String raw : accepted) {
            if (raw == null || raw.trim().isEmpty()) continue;
            String type = raw.trim().toLowerCase(Locale.ROOT); restriction = true;
            if (type.equals("*/*") || type.equals(mime) || type.endsWith("/*") && mime.startsWith(type.substring(0, type.length() - 1))
                    || type.startsWith(".") && name.toLowerCase(Locale.ROOT).endsWith(type)) return true;
        }
        return !restriction;
    }

    private static JSONObject selectionResult(List<Entry> entries, boolean armed, boolean cancelled) {
        JSONArray files = new JSONArray();
        for (Entry entry : entries) files.put(publicEntry(entry));
        return json("files", files, "armed", armed, "cancelled", cancelled);
    }

    private static JSONObject publicEntry(Entry entry) {
        JSONObject result = json("fileId", entry.id, "name", entry.name, "mime", entry.mime, "size", entry.size,
            "bytesDownloaded", entry.bytes, "status", entry.status, "source", entry.source, "transport", entry.transport,
            "runId", entry.runId, "createdAt", entry.createdAt, "updatedAt", entry.updatedAt,
            "persistent", entry.persisted, "private", entry.privateTab);
        if (entry.downloadId >= 0) put(result, "downloadId", entry.downloadId);
        if (!entry.error.isEmpty()) put(result, "error", entry.error);
        return result;
    }

    private void persist() {
        JSONArray records = new JSONArray();
        synchronized (entries) {
            for (Entry entry : entries.values()) {
                if (entry.privateTab || !entry.persisted) continue;
                JSONObject record = publicEntry(entry);
                put(record, "uri", entry.uri == null ? "" : entry.uri.toString());
                put(record, "ownedPath", entry.ownedPath); put(record, "tabId", entry.tabId); put(record, "documentId", entry.documentId);
                records.put(record);
            }
        }
        preferences.edit().putString("registry", json("version", 1, "files", records).toString()).apply();
    }

    private void restore() {
        try {
            JSONObject stored = new JSONObject(preferences.getString("registry", "{}"));
            if (stored.optInt("version") != 1) return;
            JSONArray records = stored.optJSONArray("files");
            if (records == null) return;
            for (int i = 0; i < Math.min(MAX_FILES, records.length()); i++) {
                JSONObject item = records.optJSONObject(i);
                if (item == null || !validId(item.optString("fileId")) || item.optBoolean("private")) continue;
                Entry entry = new Entry();
                entry.id = item.optString("fileId"); entry.name = safeName(item.optString("name"));
                entry.mime = cleanMime(item.optString("mime")); entry.source = item.optString("source");
                entry.status = item.optString("status", "failed"); entry.transport = item.optString("transport");
                entry.size = item.optLong("size", -1); entry.bytes = item.optLong("bytesDownloaded");
                entry.runId = item.optString("runId"); entry.documentId = item.optString("documentId");
                entry.tabId = item.optInt("tabId", -1); entry.createdAt = item.optLong("createdAt");
                entry.updatedAt = item.optLong("updatedAt"); entry.downloadId = item.optLong("downloadId", -1);
                entry.error = item.optString("error"); entry.ownedPath = item.optString("ownedPath"); entry.persisted = true;
                String uri = item.optString("uri"); if (!uri.isEmpty()) entry.uri = Uri.parse(uri);
                if (!entry.ownedPath.isEmpty() && !ownedFile(new File(entry.ownedPath))) continue;
                if ("native-http".equals(entry.transport) && active(entry)) {
                    entry.status = "interrupted"; entry.error = "下载因应用退出而中断，请重新下载";
                    if (!entry.ownedPath.isEmpty()) new File(entry.ownedPath + ".part").delete();
                }
                entries.put(entry.id, entry);
            }
        } catch (Exception ignored) { /* A damaged registry must never grant access to arbitrary paths. */ }
    }

    private void clearRetiredPrivateFiles() {
        File directory = new File(context.getCacheDir(), "browser-agent-private");
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) if (file.isFile()) file.delete();
    }

    private void clearRetiredRenderFiles() {
        if (!VISUAL_READER.tryAcquire()) return;
        try {
            File[] staged = new File(context.getCacheDir(), "browser-agent-render").listFiles();
            if (staged != null) for (File file : staged) if (file.isFile()) file.delete();
        } finally { VISUAL_READER.release(); }
    }

    private void emit(String event, int tabId, String documentId, String runId, String requestId, Entry entry, String error) {
        if (closed) return;
        JSONObject payload = json("type", "file", "event", event, "tabId", tabId, "documentId", documentId,
            "runId", runId, "requestId", requestId);
        if (entry != null) put(payload, "file", publicEntry(entry));
        if (error != null) put(payload, "error", error);
        host.onEvent(payload);
    }

    private static JSONObject json(Object... fields) {
        JSONObject value = new JSONObject();
        for (int i = 0; i + 1 < fields.length; i += 2) put(value, (String) fields[i], fields[i + 1]);
        return value;
    }

    private static void put(JSONObject value, String key, Object item) {
        try { value.put(key, item == null ? JSONObject.NULL : item); }
        catch (org.json.JSONException ignored) {}
    }

    void close() {
        if (closed) return;
        closed = true; clearArmed(); main.removeCallbacks(poll);
        if (receiverRegistered) try { context.unregisterReceiver(receiver); } catch (RuntimeException ignored) {}
        Chooser pending = chooser;
        if (pending != null) {
            if (pending.future != null) pending.future.cancel(true);
            finishChooser(pending, null, null, CANCELLED, false);
        }
        for (ReadWork work : new ArrayList<>(reads.values())) cancelRead(work, CANCELLED);
        for (NativeDownload work : new ArrayList<>(nativeDownloads.values())) {
            work.cancelled.set(true);
            if (work.call != null) work.call.cancel();
            if (work.future != null) work.future.cancel(true);
            work.entry.status = "interrupted"; work.entry.error = "下载因浏览器关闭而中断，请重新下载";
            work.entry.updatedAt = System.currentTimeMillis();
        }
        nativeDownloads.clear();
        synchronized (entries) {
            for (Entry entry : entries.values()) if (entry.privateTab && !entry.ownedPath.isEmpty()) {
                new File(entry.ownedPath).delete(); new File(entry.ownedPath + ".part").delete();
            }
        }
        persist(); workers.shutdownNow(); client.connectionPool().evictAll();
    }
}
