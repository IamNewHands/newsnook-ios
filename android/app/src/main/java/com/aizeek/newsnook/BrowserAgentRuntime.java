package com.aizeek.newsnook;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Per-WebView, per-document frame ports. Page messages can only answer native-issued requests. */
final class BrowserAgentRuntime {
    static final String BRIDGE = "__newsNookAgentBridge";
    private static final int MAX_FRAMES = 48;
    private static final int MAX_MESSAGE = 2_000_000;
    private static final long TIMEOUT_MS = 8000;
    private final WebView view;
    private final String source;
    private final BooleanSupplier live;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Frame> frames = new LinkedHashMap<>();
    private final Map<String, Pending> pending = new LinkedHashMap<>();
    private final Set<Frame> unacknowledgedFrames = new LinkedHashSet<>();
    private ScriptHandler scriptHandler;
    private boolean frameBridge;
    private boolean closed;
    private String documentId = UUID.randomUUID().toString();
    private long visualEpoch;
    private String lastSnapshot = "";
    private Shot shot;
    private boolean nativeDialogPending;

    private static final class Frame {
        final String id, documentId, origin;
        final boolean main;
        final Object port;
        final Consumer<String> send;
        Frame(String id, String documentId, String origin, boolean main, Object port, Consumer<String> send) {
            this.id = id; this.documentId = documentId; this.origin = origin;
            this.main = main; this.port = port; this.send = send;
        }
    }

    private final class Pending {
        final String id = UUID.randomUUID().toString();
        final String document = documentId;
        final String parentId, runId, type;
        final Frame frame;
        final Consumer<JSONObject> success;
        final Consumer<String> failure;
        final Runnable timeout = () -> fail("网页操作超时，请重新观察");
        Pending(String parentId, String runId, String type, Frame frame, Consumer<JSONObject> success, Consumer<String> failure) {
            this.parentId = parentId; this.runId = runId; this.type = type; this.frame = frame;
            this.success = success; this.failure = failure;
            pending.put(id, this);
            if (!nativeDialogPending || !"cancel_ack".equals(type)) main.postDelayed(timeout, TIMEOUT_MS);
        }
        void finish(JSONObject result) {
            if (pending.remove(id) != this) return;
            main.removeCallbacks(timeout);
            if (frame != null) unacknowledgedFrames.remove(frame);
            if (!closed && live.getAsBoolean() && document.equals(documentId)) success.accept(result);
            else failure.accept("网页文档已变化，请重新观察");
        }
        void fail(String reason) {
            if (pending.remove(id) != this) return;
            main.removeCallbacks(timeout);
            failure.accept(reason);
        }
        void discard() { pending.remove(id); main.removeCallbacks(timeout); }
    }

    private static final class Shot {
        final String id = UUID.randomUUID().toString();
        final String document, snapshot;
        final long epoch;
        final int width, height, scrollX, scrollY;
        final Rect bounds;
        Shot(String document, String snapshot, long epoch, WebView view, Rect bounds) {
            this.document = document; this.snapshot = snapshot; this.epoch = epoch;
            width = view.getWidth(); height = view.getHeight(); scrollX = view.getScrollX(); scrollY = view.getScrollY();
            this.bounds = new Rect(bounds);
        }
    }

    BrowserAgentRuntime(WebView view, String source, BooleanSupplier live) {
        this(view, source, live, true);
    }

    BrowserAgentRuntime(WebView view, String source, BooleanSupplier live, boolean install) {
        this.view = view; this.source = source; this.live = live;
        if (!install) return;
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                    && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.addWebMessageListener(view, BRIDGE, Collections.singleton("*"),
                    (web, message, origin, isMainFrame, reply) -> {
                        if (web != view || closed || !live.getAsBoolean()) return;
                        String data = message.getData();
                        receive(data, origin.toString(), isMainFrame, reply, reply::postMessage);
                    });
                try {
                    // This limited main-world bridge exposes no native command, file, or navigation API.
                    scriptHandler = WebViewCompat.addDocumentStartJavaScript(view,
                        source.replace("__ARGS__", json("action", "bootstrap").toString()), Collections.singleton("*"));
                    frameBridge = true;
                } catch (RuntimeException error) {
                    WebViewCompat.removeWebMessageListener(view, BRIDGE);
                }
            }
        } catch (RuntimeException ignored) { /* Old providers retain the explicit main-frame fallback. */ }
    }

    String documentId() { return documentId; }
    String snapshot() { return lastSnapshot; }
    boolean isMainFrame(String id) { Frame frame = frames.get(id); return "main".equals(id) || frame != null && frame.main; }

    JSONObject capabilities() {
        String provider = "";
        try {
            android.content.pm.PackageInfo info = WebViewCompat.getCurrentWebViewPackage(view.getContext());
            if (info != null) provider = info.packageName + "/" + info.versionName;
        } catch (RuntimeException ignored) { }
        return json("crossOriginFrames", frameBridge, "documentStart", frameBridge,
            "openShadowDom", true, "closedShadowDom", frameBridge ? "captured-at-document-start-only" : "unavailable",
            "isolatedWorld", false, "nativeGestures", true, "fileChooser", true, "downloads", true,
            "javascriptDialogs", "native-user-confirmation", "popupWindows", "user-gesture-tabs",
            "provider", provider, "maxFrames", MAX_FRAMES, "maxObservationCharacters", 4_000_000,
            "canvasVisualChangeDetection", false);
    }

    void onPageStarted(String url) {
        documentId = UUID.randomUUID().toString();
        lastSnapshot = "";
        frames.clear();
        unacknowledgedFrames.clear();
        invalidateVisual();
        for (Pending task : new ArrayList<>(pending.values())) {
            if ("cancel_ack".equals(task.type)) {
                // A replaced document can no longer receive messages through its retired object.
                task.discard(); task.success.accept(json("ok", true));
            } else task.fail("网页文档已变化，请重新观察");
        }
    }

    void invalidateVisual() { visualEpoch++; shot = null; }

    void receive(String payload, String origin, boolean isMainFrame, Object port, Consumer<String> sender) {
        if (closed || !live.getAsBoolean() || payload == null || payload.length() > MAX_MESSAGE) return;
        try {
            JSONObject message = new JSONObject(payload);
            String type = message.optString("type"), frameId = message.optString("frameId"), frameDocument = message.optString("documentId");
            if (!validId(frameId) || !validId(frameDocument)) return;
            if ("ready".equals(type)) {
                Frame known = frames.get(frameId);
                if (known != null && (known.port != port || !known.documentId.equals(frameDocument))) return;
                if (known != null) return;
                if (known == null && frames.size() >= MAX_FRAMES) return;
                Frame frame = new Frame(frameId, frameDocument, origin, isMainFrame, port, sender);
                if (isMainFrame) {
                    String expectedDocument = documentId;
                    view.evaluateJavascript("JSON.stringify({frameId:window.__newsNookAgentFrameId,documentId:window.__newsNookAgentDocumentId})", encoded -> {
                        if (closed || !live.getAsBoolean() || !expectedDocument.equals(documentId)) return;
                        try {
                            JSONObject identity = decode(encoded);
                            if (frameId.equals(identity.optString("frameId")) && frameDocument.equals(identity.optString("documentId"))) {
                                for (Frame old : new ArrayList<>(frames.values())) if (old.main && old != frame) frames.remove(old.id);
                                frames.put(frameId, frame);
                            }
                        } catch (Exception ignored) { }
                    });
                } else frames.put(frameId, frame);
                return;
            }
            Pending task = pending.get(message.optString("requestId"));
            if (task == null || task.frame == null || !task.type.equals(type) || task.frame.port != port
                    || !task.runId.equals(message.optString("runId")) || !task.frame.id.equals(frameId)
                    || !task.frame.documentId.equals(frameDocument) || !task.frame.origin.equals(origin)
                    || task.frame.main != isMainFrame || frames.get(frameId) != task.frame) return;
            JSONObject result = "cancel_ack".equals(type) ? json("ok", true) : message.optJSONObject("result");
            if (result == null) task.fail("网页返回的数据无效"); else task.finish(result);
        } catch (Exception ignored) { /* Website data is untrusted and cannot invoke native actions. */ }
    }

    void executeFrame(String runId, String parentId, String frameId, String frameDocumentId, JSONObject args,
                      Consumer<JSONObject> success, Consumer<String> failure) {
        executeFrame(runId, parentId, frameId, frameDocumentId, args, () -> {}, success, failure);
    }

    void executeFrame(String runId, String parentId, String frameId, String frameDocumentId, JSONObject args,
                      Runnable dispatched, Consumer<JSONObject> success, Consumer<String> failure) {
        if (closed || !live.getAsBoolean()) { failure.accept("网页已关闭"); return; }
        Frame frame = frameId == null || frameId.isEmpty() || "main".equals(frameId) ? mainFrame() : frames.get(frameId);
        if (frame == null && frameId != null && !frameId.isEmpty() && !"main".equals(frameId)) {
            failure.accept("网页框架已变化，请重新观察"); return;
        }
        if (frame != null && frameDocumentId != null && !frameDocumentId.isEmpty() && !frameDocumentId.equals(frame.documentId)) {
            failure.accept("网页框架文档已变化，请重新观察"); return;
        }
        Pending task = new Pending(parentId, runId, "result", frame, success, failure);
        try {
            dispatched.run();
            if (frame != null) {
                unacknowledgedFrames.add(frame);
                frame.send.accept(json("type", "command", "runId", runId, "requestId", task.id, "args", args).toString());
            }
            else view.evaluateJavascript(source.replace("__ARGS__", args.toString()), encoded -> {
                if (pending.get(task.id) != task) return;
                try { task.finish(decode(encoded)); }
                catch (Exception error) { task.fail("网页返回的数据无效"); }
            });
        } catch (RuntimeException error) { task.fail("无法向网页发送操作"); }
    }

    void observe(String runId, String parentId, int tabId, Consumer<JSONObject> success, Consumer<String> failure) {
        String expected = documentId;
        executeFrame(runId, parentId, "main", "", json("action", "observe"), top -> {
            if (!expected.equals(documentId)) { failure.accept("网页文档已变化，请重新观察"); return; }
            if (top.has("error") || !top.has("snapshot")) { failure.accept(top.optString("error", "无法观察网页")); return; }
            lastSnapshot = top.optString("snapshot");
            JSONArray observations = new JSONArray();
            Frame mainFrame = mainFrame();
            JSONObject mainObservation = copy(top);
            put(mainObservation, "frameId", mainFrame == null ? "main" : mainFrame.id);
            if (mainFrame != null) put(mainObservation, "documentId", mainFrame.documentId);
            put(top, "frameId", mainFrame == null ? "main" : mainFrame.id);
            put(top, "frameDocumentId", mainObservation.optString("documentId"));
            observations.put(mainObservation);
            List<Frame> children = new ArrayList<>();
            for (Frame frame : frames.values()) if (!frame.main) children.add(frame);
            put(top, "tabId", tabId); put(top, "documentId", documentId); put(top, "capabilities", capabilities());
            put(top, "frames", observations);
            if (children.isEmpty()) { success.accept(top); return; }
            int[] left = {children.size()};
            int[] bytes = {top.toString().length()};
            for (Frame frame : children) {
                executeFrame(runId, parentId, frame.id, frame.documentId, json("action", "observe"), result -> {
                    put(result, "frameId", frame.id); put(result, "documentId", frame.documentId); put(result, "origin", frame.origin);
                    int length = result.toString().length();
                    if (bytes[0] + length <= 4_000_000) { bytes[0] += length; observations.put(result); }
                    else observations.put(json("frameId", frame.id, "documentId", frame.documentId, "unavailable", true,
                        "error", "观察数据已达到限额，请用截图定位此框架"));
                    if (--left[0] == 0 && expected.equals(documentId)) success.accept(top);
                }, reason -> {
                    observations.put(json("frameId", frame.id, "documentId", frame.documentId, "unavailable", true, "error", reason));
                    if (--left[0] == 0 && expected.equals(documentId)) success.accept(top);
                });
            }
        }, failure);
    }

    void cancelRequest(String parentId) {
        for (Pending task : new ArrayList<>(pending.values())) if (task.parentId.equals(parentId)) task.discard();
    }

    void setNativeDialogPending(boolean value) {
        if (nativeDialogPending == value) return;
        nativeDialogPending = value;
        for (Pending task : pending.values()) if ("cancel_ack".equals(task.type)) {
            main.removeCallbacks(task.timeout);
            if (!value) main.postDelayed(task.timeout, TIMEOUT_MS);
        }
    }

    /** Acknowledges only after every live frame has crossed the renderer's ordered command barrier. */
    void cancelRun(String runId, Runnable success, Consumer<String> failure) {
        for (Pending task : new ArrayList<>(pending.values())) if (task.runId.equals(runId)) task.discard();
        if (closed || !live.getAsBoolean()) { success.run(); return; }
        List<Frame> targets = new ArrayList<>(unacknowledgedFrames);
        if (targets.isEmpty()) {
            Pending barrier = new Pending("barrier", runId, "cancel_ack", null, ignored -> success.run(), failure);
            try { view.evaluateJavascript("void 0", ignored -> barrier.finish(json("ok", true))); }
            catch (RuntimeException error) { barrier.fail("网页尚未确认停止，请重试"); }
            return;
        }
        int[] left = {targets.size()};
        boolean[] failed = {false};
        for (Frame frame : targets) {
            Pending barrier = new Pending("barrier", runId, "cancel_ack", frame,
                ignored -> { if (--left[0] == 0 && !failed[0]) success.run(); },
                reason -> { if (!failed[0]) { failed[0] = true; failure.accept(reason); } });
            try { frame.send.accept(json("type", "cancel", "runId", runId, "requestId", barrier.id).toString()); }
            catch (RuntimeException error) { barrier.fail("网页尚未确认停止，请重试"); }
        }
    }

    void resume(String runId) {
        for (Frame frame : frames.values()) {
            try { frame.send.accept(json("type", "resume", "runId", runId).toString()); }
            catch (RuntimeException ignored) { }
        }
        invalidateVisual();
    }

    void capture(String runId, String requestId, int tabId, String snapshot, Rect bounds, BooleanSupplier permitted,
                 Consumer<JSONObject> success, Consumer<String> failure) {
        if (snapshot == null || snapshot.isEmpty()) { failure.accept("请先观察网页"); return; }
        executeFrame(runId, requestId, "main", "", json("action", "validate", "snapshot", snapshot), observation -> {
            if (!observation.optBoolean("ok")) { failure.accept(observation.optString("error", "截图前无法确认网页画面")); return; }
            lastSnapshot = snapshot;
            String document = documentId;
            boolean[] settled = {false};
            Runnable draw = () -> {
                if (settled[0] || !permitted.getAsBoolean() || closed || !document.equals(documentId)) return;
                settled[0] = true;
                int width = view.getWidth(), height = view.getHeight();
                if (width <= 0 || height <= 0 || bounds.isEmpty()) { failure.accept("网页尚未显示"); return; }
                Bitmap bitmap = null;
                try {
                    float scale = Math.min(1f, 1000f / Math.max(width, height));
                    int outputWidth = Math.max(1, Math.round(width * scale)), outputHeight = Math.max(1, Math.round(height * scale));
                    bitmap = Bitmap.createBitmap(outputWidth, outputHeight, Bitmap.Config.RGB_565);
                    Canvas canvas = new Canvas(bitmap);
                    canvas.drawColor(Color.rgb(24, 24, 24));
                    canvas.scale(scale, scale);
                    canvas.clipRect(bounds);
                    view.draw(canvas);
                    ByteArrayOutputStream data = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 75, data);
                    Shot captured = new Shot(document, snapshot, visualEpoch, view, bounds);
                    shot = captured;
                    success.accept(json("image", android.util.Base64.encodeToString(data.toByteArray(), android.util.Base64.NO_WRAP),
                        "width", outputWidth, "height", outputHeight, "viewWidth", width, "viewHeight", height,
                        "shotId", captured.id, "snapshot", snapshot, "tabId", tabId, "documentId", document,
                        "visibleRect", json("left", bounds.left, "top", bounds.top, "right", bounds.right, "bottom", bounds.bottom),
                        "captureMethod", "webview-draw", "videoSurfaceIncluded", false));
                } catch (Exception error) { failure.accept("网页截图失败"); }
                finally { if (bitmap != null) bitmap.recycle(); }
            };
            // Drawing after this callback includes committed DOM, image, Canvas and WebGL updates.
            try {
                // Screen-off windows do not commit compositor frames. Draw the pre-rasterized
                // WebView directly after the observation response instead of waiting forever.
                if (view.getWindowVisibility() != android.view.View.VISIBLE) main.post(draw);
                else if (WebViewFeature.isFeatureSupported(WebViewFeature.VISUAL_STATE_CALLBACK)) {
                    WebViewCompat.postVisualStateCallback(view, 0, new WebViewCompat.VisualStateCallback() {
                        @Override public void onComplete(long requestId) { draw.run(); }
                    });
                    long deadline = android.os.SystemClock.uptimeMillis() + TIMEOUT_MS;
                    main.postDelayed(new Runnable() {
                        @Override public void run() {
                            if (settled[0] || closed || !document.equals(documentId) || !permitted.getAsBoolean()) return;
                            if (view.getWindowVisibility() != android.view.View.VISIBLE) draw.run();
                            else if (android.os.SystemClock.uptimeMillis() < deadline) main.postDelayed(this, 100);
                        }
                    }, 100);
                }
                else main.post(draw);
            } catch (RuntimeException error) { settled[0] = true; failure.accept("网页截图暂不可用"); }
        }, failure);
    }

    boolean validateShot(String shotId, Rect bounds) {
        Shot value = shot;
        return value != null && value.id.equals(shotId) && value.document.equals(documentId) && value.epoch == visualEpoch
            && value.width == view.getWidth() && value.height == view.getHeight()
            && value.scrollX == view.getScrollX() && value.scrollY == view.getScrollY() && value.bounds.equals(bounds);
    }

    String shotSnapshot() { return shot == null ? "" : shot.snapshot; }

    void close(boolean rendererAvailable) {
        if (closed) return;
        closed = true;
        invalidateVisual();
        frames.clear();
        unacknowledgedFrames.clear();
        for (Pending task : new ArrayList<>(pending.values())) {
            if ("cancel_ack".equals(task.type)) { task.discard(); task.success.accept(json("ok", true)); }
            else task.fail("网页已关闭");
        }
        if (rendererAvailable) {
            try { if (scriptHandler != null) scriptHandler.remove(); }
            catch (RuntimeException ignored) { }
            try { if (frameBridge) WebViewCompat.removeWebMessageListener(view, BRIDGE); }
            catch (RuntimeException ignored) { }
        }
        scriptHandler = null;
    }

    private Frame mainFrame() { for (Frame frame : frames.values()) if (frame.main) return frame; return null; }
    private static boolean validId(String value) { return value != null && value.matches("[A-Za-z0-9_.:-]{1,160}"); }
    static JSONObject json(Object... entries) {
        JSONObject object = new JSONObject();
        for (int i = 0; i < entries.length; i += 2) put(object, String.valueOf(entries[i]), entries[i + 1]);
        return object;
    }
    static void put(JSONObject object, String key, Object value) {
        try { object.put(key, value); } catch (org.json.JSONException error) { throw new IllegalArgumentException(error); }
    }
    private static JSONObject copy(JSONObject object) {
        try { return new JSONObject(object.toString()); } catch (org.json.JSONException error) { throw new IllegalArgumentException(error); }
    }
    private static JSONObject decode(String encoded) throws org.json.JSONException {
        if (encoded == null || encoded.length() > MAX_MESSAGE) throw new org.json.JSONException("invalid payload");
        Object decoded = new JSONTokener(encoded).nextValue();
        if (decoded instanceof JSONObject) return (JSONObject) decoded;
        return new JSONObject(String.valueOf(decoded));
    }
}
