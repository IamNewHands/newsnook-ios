package com.aizeek.newsnook;

import android.app.Activity;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * An ordinary first-party page visit after a confirmed API challenge.
 * The site initializes its own browser state. This class never automates a
 * CAPTCHA, fabricates clearance, or exposes a JavaScriptInterface to remote HTML.
 * Recovered CSRF/timings requests stay in this very document, rather than moving
 * its token back into the synthetic transport which failed originally.
 */
final class LinuxDoBrowserSessionRecovery {
    private static final String ORIGIN = "https://linux.do";
    private static final long TIMEOUT_MS = 15_000L;
    private static final long COOLDOWN_MS = 30_000L;
    private static final long IDLE_MS = 120_000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Consumer<JSObject>> waiters = new ArrayList<>();
    private final Map<String, PendingRequest> requests = new HashMap<>();
    private WebView view;
    private JSObject prepared;
    private Runnable poll;
    private Runnable timeout;
    private Runnable idle;
    private long lastAttempt = -COOLDOWN_MS;

    private static final class PendingRequest {
        final Consumer<JSObject> completed;
        Runnable poll;
        Runnable timeout;
        PendingRequest(Consumer<JSObject> completed) { this.completed = completed; }
    }

    void prepare(Activity activity, Consumer<JSObject> completed) {
        if (activity == null || activity.isFinishing()) { completed.accept(unavailable("activity")); return; }
        if (view != null && prepared != null) { touch(); completed.accept(prepared); return; }
        if (view != null) { waiters.add(completed); return; }
        long now = SystemClock.elapsedRealtime();
        if (now - lastAttempt < COOLDOWN_MS) { completed.accept(unavailable("cooldown")); return; }
        lastAttempt = now;
        waiters.add(completed);
        try {
            final String script = asset(activity, "linuxdo-session-probe.js");
            WebView browser = new WebView(activity);
            view = browser;
            WebSettings settings = browser.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setSupportMultipleWindows(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView ignored, WebResourceRequest request) {
                    if (!request.isForMainFrame()) return false;
                    Uri target = request.getUrl();
                    return !"https".equals(target.getScheme()) || !"linux.do".equalsIgnoreCase(target.getHost());
                }
            });
            poll = new Runnable() {
                @Override public void run() {
                    if (view != browser || prepared != null) return;
                    browser.evaluateJavascript(script + "\nJSON.stringify(window.__newsnookSessionProbe || null);", encoded -> {
                        if (view != browser || prepared != null) return;
                        try {
                            JSONObject data = decode(encoded);
                            if (data != null && !data.optBoolean("pending", false)) {
                                JSObject result = new JSObject();
                                boolean ready = data.optBoolean("ready", false) && data.optInt("userId", 0) > 0
                                    && !data.optString("username", "").isEmpty() && !data.optString("csrf", "").isEmpty();
                                result.put("ready", ready);
                                if (ready) {
                                    result.put("username", data.getString("username"));
                                    result.put("userId", data.getInt("userId"));
                                    result.put("csrf", data.getString("csrf"));
                                    CookieManager.getInstance().flush();
                                    prepared = result;
                                } else {
                                    result.put("reason", "needs-verification");
                                    result.put("phase", data.optString("phase", "session"));
                                    result.put("status", data.optInt("status", 0));
                                }
                                finishPreparation(result, ready);
                                return;
                            }
                        } catch (Exception ignored) { /* Navigation/JS not ready yet. */ }
                        handler.postDelayed(this, 250L);
                    });
                }
            };
            timeout = () -> finishPreparation(unavailable("needs-verification"), false);
            handler.postDelayed(timeout, TIMEOUT_MS);
            browser.loadUrl(ORIGIN + "/");
            handler.postDelayed(poll, 250L);
        } catch (Exception ignored) { finishPreparation(unavailable("unavailable"), false); }
    }

    boolean canRequest(String url) {
        if (view == null || prepared == null) return false;
        try {
            Uri target = Uri.parse(url);
            String path = target.getPath();
            return "https".equals(target.getScheme()) && "linux.do".equalsIgnoreCase(target.getHost())
                && target.getUserInfo() == null && (target.getPort() == -1 || target.getPort() == 443)
                && target.getQuery() == null && target.getFragment() == null
                && ("/topics/timings".equals(path) || "/session/csrf".equals(path) || "/session/csrf.json".equals(path));
        } catch (Exception ignored) { return false; }
    }

    void request(String url, String method, JSONObject headers, String body, Consumer<JSObject> completed) {
        WebView browser = view;
        if (!canRequest(url) || browser == null) { completed.accept(requestError("Browser session not ready")); return; }
        touch();
        String id = UUID.randomUUID().toString();
        PendingRequest pending = new PendingRequest(completed);
        requests.put(id, pending);
        try {
            JSONObject input = new JSONObject();
            input.put("id", id); input.put("url", url); input.put("method", method);
            input.put("headers", headers); input.put("body", body);
            final String key = JSONObject.quote(id);
            browser.evaluateJavascript(asset(browser.getContext(), "linuxdo-session-request.js")
                + "\nwindow.__newsnookFirstPartyRequest(" + input + ");", null);
            pending.poll = new Runnable() {
                @Override public void run() {
                    if (requests.get(id) != pending || view != browser) return;
                    browser.evaluateJavascript("JSON.stringify(window.__newsnookFirstPartyResults && window.__newsnookFirstPartyResults[" + key + "] || null)", encoded -> {
                        if (requests.get(id) != pending || view != browser) return;
                        try {
                            JSONObject result = decode(encoded);
                            if (result != null && !result.optBoolean("pending", false)) {
                                browser.evaluateJavascript("delete window.__newsnookFirstPartyResults[" + key + "];", null);
                                JSObject response = new JSObject();
                                if (result.has("error")) response.put("error", "Linux.do 浏览器请求失败");
                                else {
                                    response.put("status", result.optInt("status", 0));
                                    response.put("data", result.optString("data", ""));
                                    response.put("headers", result.optJSONObject("headers"));
                                    response.put("responseUrl", result.optString("responseUrl", ""));
                                }
                                finishRequest(id, response);
                                return;
                            }
                        } catch (Exception ignored) { /* A navigating document may not have a result yet. */ }
                        handler.postDelayed(this, 100L);
                    });
                }
            };
            pending.timeout = () -> finishRequest(id, requestError("Linux.do 浏览器请求超时"));
            handler.postDelayed(pending.timeout, 35_000L);
            handler.postDelayed(pending.poll, 100L);
        } catch (Exception ignored) { finishRequest(id, requestError("Linux.do 浏览器请求无法启动")); }
    }

    void cancel() { finishPreparation(unavailable("cancelled"), false); }

    private void finishRequest(String id, JSObject result) {
        PendingRequest pending = requests.remove(id);
        if (pending == null) return;
        if (pending.poll != null) handler.removeCallbacks(pending.poll);
        if (pending.timeout != null) handler.removeCallbacks(pending.timeout);
        if (prepared != null) touch();
        pending.completed.accept(result);
    }

    private void finishPreparation(JSObject result, boolean keepReadyDocument) {
        if (poll != null) handler.removeCallbacks(poll);
        if (timeout != null) handler.removeCallbacks(timeout);
        poll = null; timeout = null;
        if (keepReadyDocument) touch();
        else {
            if (idle != null) handler.removeCallbacks(idle);
            idle = null; prepared = null;
            WebView previous = view;
            view = null;
            for (String id : new ArrayList<>(requests.keySet())) finishRequest(id, requestError("Linux.do 浏览器会话已结束"));
            if (previous != null) { previous.stopLoading(); previous.setWebViewClient(null); previous.destroy(); }
        }
        List<Consumer<JSObject>> callbacks = new ArrayList<>(waiters);
        waiters.clear();
        for (Consumer<JSObject> callback : callbacks) callback.accept(result);
    }

    private void touch() {
        if (idle != null) handler.removeCallbacks(idle);
        idle = this::cancel;
        handler.postDelayed(idle, IDLE_MS);
    }

    private static JSONObject decode(String encoded) throws Exception {
        Object decoded = new JSONTokener(encoded == null ? "null" : encoded).nextValue();
        return decoded instanceof String && !"null".equals(decoded) ? new JSONObject((String) decoded) : null;
    }

    private static String asset(android.content.Context context, String name) throws Exception {
        try (InputStream stream = context.getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            for (int count; (count = stream.read(buffer)) != -1;) output.write(buffer, 0, count);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static JSObject requestError(String message) { JSObject result = new JSObject(); result.put("error", message); return result; }
    private static JSObject unavailable(String reason) { JSObject result = new JSObject(); result.put("ready", false); result.put("reason", reason); return result; }
}
