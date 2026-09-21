package com.aizeek.newsnook;

import android.app.Dialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import android.util.Base64;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSink;
import org.json.JSONObject;

/**
 * Linux.do first-party browser session.
 *
 * The embedded WebView is used only for Cloudflare verification and login. Normal
 * community UI stays in React and calls Discourse JSON APIs. CookieManager remains
 * the single browser-session source; no cookie is persisted by this plugin.
 */
@CapacitorPlugin(name = "LinuxDoSession")
public class LinuxDoSessionPlugin extends Plugin {

    private static final String ORIGIN = "https://linux.do";
    private static final String LOGIN_URL = "https://linux.do/login";
    private static final String SESSION_URL = "https://linux.do/session/current.json";
    private static final String OTP_CSRF_URL = ORIGIN + "/session/csrf.json?newsnook_otp_csrf=1";
    private static final long OTP_EXCHANGE_TIMEOUT_MILLIS = 2L * 60L * 1000L;
    private static final String SESSION_CACHE_PREFS = "linuxdo_session_cache";
    private static final String PREF_LAST_USER = "last_user";

    private Dialog dialog;
    private WebView sessionWebView;
    private volatile PluginCall pendingCall;
    private volatile PluginCall pendingUserApiCall;
    private volatile LinuxDoUserApiAuth.Credential pendingOtpCredential;
    private final AtomicBoolean probing = new AtomicBoolean(false);
    private final AtomicBoolean exchangingOtp = new AtomicBoolean(false);
    private final ConcurrentHashMap<String, UploadSession> uploadSessions = new ConcurrentHashMap<>();
    private volatile String verifiedUserAgent = "";
    private volatile boolean finishing;
    private LinuxDoUserApiAuth userApiAuth;

    private static final class UploadSession {
        final File file;
        final String fileName;
        final String mimeType;
        long bytesWritten;

        UploadSession(File file, String fileName, String mimeType) {
            this.file = file;
            this.fileName = fileName;
            this.mimeType = mimeType;
        }
    }

    private final class UploadProgressRequestBody extends RequestBody {
        private final String uploadId;
        private final UploadSession session;
        private final MediaType mediaType;

        UploadProgressRequestBody(String uploadId, UploadSession session) {
            this.uploadId = uploadId;
            this.session = session;
            this.mediaType = MediaType.parse(session.mimeType);
        }

        @Override
        public MediaType contentType() {
            return mediaType;
        }

        @Override
        public long contentLength() {
            return session.file.length();
        }

        @Override
        public void writeTo(BufferedSink sink) throws IOException {
            long total = Math.max(1L, contentLength());
            long sent = 0L;
            int lastPercent = -1;
            long lastNotifyAt = 0L;
            byte[] buffer = new byte[64 * 1024];
            try (FileInputStream input = new FileInputStream(session.file)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    sink.write(buffer, 0, read);
                    sent += read;
                    int percent = (int) Math.min(100L, Math.round((sent * 100.0d) / total));
                    long now = System.currentTimeMillis();
                    if (percent == 100 || percent != lastPercent && (percent - lastPercent >= 1 || now - lastNotifyAt >= 160L)) {
                        notifyUploadProgress(uploadId, sent, total);
                        lastPercent = percent;
                        lastNotifyAt = now;
                    }
                }
            }
        }
    }

    private void notifyUploadProgress(String uploadId, long sentBytes, long totalBytes) {
        JSObject event = new JSObject();
        event.put("uploadId", uploadId);
        event.put("sentBytes", sentBytes);
        event.put("totalBytes", totalBytes);
        event.put("progress", totalBytes > 0L ? Math.min(1.0d, sentBytes / (double) totalBytes) : 0.0d);
        notifyListeners("linuxDoUploadProgress", event);
    }

    private final OkHttpClient identityClient = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build();

    @Override
    public void load() {
        super.load();
        if (getBridge() != null && getBridge().getWebView() != null) {
            verifiedUserAgent = empty(getBridge().getWebView().getSettings().getUserAgentString());
        }
        userApiAuth = new LinuxDoUserApiAuth(getContext());
        Intent launchIntent = getActivity() != null ? getActivity().getIntent() : null;
        if (launchIntent != null && launchIntent.getData() != null) {
            userApiAuth.handleRedirect(launchIntent.getData());
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null || intent.getData() == null || userApiAuth == null) return;
        userApiAuth.handleRedirect(intent.getData());
    }

    @PluginMethod
    public void authenticateUserApiKey(PluginCall call) {
        if (userApiAuth.isAuthenticating() || pendingUserApiCall != null || pendingCall != null || dialog != null) {
            call.reject("已有 Linux.do 系统浏览器登录正在进行", "LINUXDO_USER_API_BUSY");
            return;
        }
        pendingUserApiCall = call;
        userApiAuth.authenticate(getActivity(), new LinuxDoUserApiAuth.AuthCallback() {
            @Override
            public void onPending(String verificationUrl, int expiresInSeconds) {
                // Keep the Capacitor call pending until authorization succeeds or fails.
            }

            @Override
            public void onSuccess(LinuxDoUserApiAuth.Credential credential) {
                redeemUserApiSession(call, credential);
            }

            @Override
            public void onFailure(String code, String message) {
                if (pendingUserApiCall != call) return;
                pendingUserApiCall = null;
                call.reject(message, code);
            }
        });
    }

    @PluginMethod
    public void cancelUserApiKeyAuth(PluginCall call) {
        userApiAuth.cancel();
        PluginCall pending = pendingUserApiCall;
        if (pending != null) {
            pendingUserApiCall = null;
            pendingOtpCredential = null;
            exchangingOtp.set(false);
            userApiAuth.clearCredential();
            pending.reject("已取消 Linux.do 登录", "LINUXDO_USER_API_CANCELLED");
        }
        getActivity().runOnUiThread(() -> {
            if (dialog != null) dialog.dismiss();
        });
        call.resolve();
    }

    @PluginMethod
    public void clearUserApiKey(PluginCall call) {
        userApiAuth.cancel();
        LinuxDoUserApiAuth.Credential credential = userApiAuth.credential();
        if (credential == null) {
            userApiAuth.clearCredential();
            clearCachedSessionUser();
            call.resolve();
            return;
        }

        Request.Builder builder = new Request.Builder()
            .url(ORIGIN + "/user-api-key/revoke")
            .post(RequestBody.create("", MediaType.parse("application/x-www-form-urlencoded; charset=UTF-8")))
            .header("Accept", "application/json")
            .header("User-Api-Key", credential.key)
            .header("User-Api-Client-Id", credential.clientId);
        String cookie = empty(CookieManager.getInstance().getCookie(ORIGIN));
        String userAgent = currentUserAgent();
        if (!cookie.isEmpty()) builder.header("Cookie", cookie);
        if (!userAgent.isEmpty()) builder.header("User-Agent", userAgent);

        identityClient.newCall(builder.build()).enqueue(new Callback() {
            @Override
            public void onFailure(Call ignored, IOException error) {
                userApiAuth.clearCredential();
                clearCachedSessionUser();
                call.resolve();
            }

            @Override
            public void onResponse(Call ignored, Response response) throws IOException {
                try (ResponseBody body = response.body()) {
                    // Best-effort remote revoke. Local logout must always succeed.
                } finally {
                    userApiAuth.clearCredential();
                    clearCachedSessionUser();
                    call.resolve();
                }
            }
        });
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        if (pendingCall != null || pendingUserApiCall != null || dialog != null) {
            call.reject("已有 Linux.do 验证窗口正在进行", "LINUXDO_SESSION_BUSY");
            return;
        }

        String initialUrl = call.getString("url", LOGIN_URL);
        if (!isAllowedUrl(initialUrl)) {
            call.reject("只允许打开 linux.do 第一方 HTTPS 页面", "LINUXDO_SESSION_URL");
            return;
        }

        pendingCall = call;
        finishing = false;
        getActivity().runOnUiThread(() -> openDialog(initialUrl));
    }

    @PluginMethod
    public void snapshot(PluginCall call) {
        LinuxDoUserApiAuth.Credential credential = userApiAuth.credential();
        if (credential != null && credential.hasUsableOneTimePassword()) {
            pendingUserApiCall = call;
            redeemUserApiSession(call, credential);
            return;
        }
        if (credential != null) userApiAuth.clearCredential();
        collectSnapshot(call, false);
    }

    @PluginMethod
    public void browserSnapshot(PluginCall call) {
        collectSnapshot(call, false);
    }

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url", "");
        String method = call.getString("method", "GET").toUpperCase();
        String body = call.getString("body", "");
        JSObject requestHeaders = call.getObject("headers", new JSObject());

        if (!isApiAllowedUrl(url)) {
            call.reject("只允许请求 linux.do 主站 HTTPS API", "LINUXDO_REQUEST_URL");
            return;
        }
        if (!method.equals("GET") && !method.equals("POST") && !method.equals("PUT") && !method.equals("DELETE")) {
            call.reject("不支持的请求方法", "LINUXDO_REQUEST_METHOD");
            return;
        }

        getActivity().runOnUiThread(() -> {
            CookieManager manager = CookieManager.getInstance();
            String cookie = empty(manager.getCookie(ORIGIN));
            String userAgent = currentUserAgent();

            Request.Builder builder = new Request.Builder().url(url);
            java.util.Iterator<String> keys = requestHeaders.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if ("Cookie".equalsIgnoreCase(key) || "User-Agent".equalsIgnoreCase(key)) continue;
                String value = requestHeaders.optString(key, "");
                if (!value.isEmpty()) builder.header(key, value);
            }
            if (!cookie.isEmpty()) builder.header("Cookie", cookie);
            if (!userAgent.isEmpty()) builder.header("User-Agent", userAgent);
            if (method.equals("GET")) {
                builder.get();
            } else {
                String contentType = requestHeaders.optString("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
                RequestBody requestBody = RequestBody.create(body, MediaType.parse(contentType));
                if (method.equals("POST")) builder.post(requestBody);
                else if (method.equals("PUT")) builder.put(requestBody);
                else builder.delete(requestBody);
            }

            identityClient.newCall(builder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call ignored, IOException error) {
                    call.reject("Linux.do 网络请求失败", "LINUXDO_REQUEST_NETWORK");
                }

                @Override
                public void onResponse(Call ignored, Response response) throws IOException {
                    syncResponseCookies(response);
                    try (ResponseBody responseBody = response.body()) {
                        JSObject result = new JSObject();
                        result.put("status", response.code());
                        result.put("data", responseBody != null ? responseBody.string() : "");
                        JSObject headers = new JSObject();
                        for (String name : response.headers().names()) {
                            if ("Set-Cookie".equalsIgnoreCase(name) || "Set-Cookie2".equalsIgnoreCase(name)) continue;
                            headers.put(name, response.header(name, ""));
                        }
                        result.put("headers", headers);
                        call.resolve(result);
                    }
                }
            });
        });
    }

    @PluginMethod
    public void beginUpload(PluginCall call) {
        String fileName = new File(call.getString("fileName", "upload.bin")).getName();
        String mimeType = call.getString("mimeType", "application/octet-stream");
        try {
            File file = File.createTempFile("linuxdo-upload-", ".tmp", getContext().getCacheDir());
            String uploadId = UUID.randomUUID().toString();
            uploadSessions.put(uploadId, new UploadSession(file, fileName, mimeType));
            JSObject result = new JSObject();
            result.put("uploadId", uploadId);
            call.resolve(result);
        } catch (IOException error) {
            call.reject("无法创建上传临时文件", "LINUXDO_UPLOAD_PREPARE");
        }
    }

    @PluginMethod
    public void appendUploadChunk(PluginCall call) {
        String uploadId = call.getString("uploadId", "");
        String base64 = call.getString("base64", "");
        UploadSession session = uploadSessions.get(uploadId);
        if (session == null) {
            call.reject("上传会话已失效", "LINUXDO_UPLOAD_SESSION");
            return;
        }
        if (base64.isEmpty()) {
            call.reject("上传分块为空", "LINUXDO_UPLOAD_CHUNK");
            return;
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            cleanupUpload(uploadId);
            call.reject("文件分块编码无效", "LINUXDO_UPLOAD_BASE64");
            return;
        }

        if (session.bytesWritten + bytes.length > 256L * 1024L * 1024L) {
            cleanupUpload(uploadId);
            call.reject("单个附件超过 256 MB", "LINUXDO_UPLOAD_TOO_LARGE");
            return;
        }

        try (FileOutputStream output = new FileOutputStream(session.file, true)) {
            output.write(bytes);
            session.bytesWritten += bytes.length;
            JSObject result = new JSObject();
            result.put("bytesWritten", session.bytesWritten);
            call.resolve(result);
        } catch (IOException error) {
            cleanupUpload(uploadId);
            call.reject("写入上传临时文件失败", "LINUXDO_UPLOAD_WRITE");
        }
    }

    @PluginMethod
    public void finishUpload(PluginCall call) {
        String uploadId = call.getString("uploadId", "");
        UploadSession session = uploadSessions.remove(uploadId);
        if (session == null || session.bytesWritten <= 0 || !session.file.exists()) {
            if (session != null) session.file.delete();
            call.reject("上传会话已失效", "LINUXDO_UPLOAD_SESSION");
            return;
        }

        getActivity().runOnUiThread(() -> {
            CookieManager manager = CookieManager.getInstance();
            String cookie = empty(manager.getCookie(ORIGIN));
            String userAgent = currentUserAgent();

            if (userApiAuth.hasValidCredential()) {
                performUpload(uploadId, session, call, cookie, userAgent, "");
                return;
            }

            Request.Builder csrfBuilder = new Request.Builder()
                .url(ORIGIN + "/session/csrf.json")
                .header("Accept", "application/json");
            if (!cookie.isEmpty()) csrfBuilder.header("Cookie", cookie);
            if (!userAgent.isEmpty()) csrfBuilder.header("User-Agent", userAgent);

            identityClient.newCall(csrfBuilder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call ignored, IOException error) {
                    session.file.delete();
                    call.reject("无法建立上传会话", "LINUXDO_UPLOAD_CSRF");
                }

                @Override
                public void onResponse(Call ignored, Response response) throws IOException {
                    String csrf = "";
                    try (ResponseBody body = response.body()) {
                        String text = body != null ? body.string() : "";
                        if (response.isSuccessful() && !text.isEmpty()) {
                            csrf = new JSONObject(text).optString("csrf", "");
                        }
                    } catch (Exception ignoredParse) {
                        csrf = "";
                    }
                    if (csrf.isEmpty()) {
                        session.file.delete();
                        call.reject("无法获取 CSRF Token", "LINUXDO_UPLOAD_CSRF");
                        return;
                    }
                    performUpload(uploadId, session, call, cookie, userAgent, csrf);
                }
            });
        });
    }

    private void performUpload(
        String uploadId,
        UploadSession session,
        PluginCall call,
        String cookie,
        String userAgent,
        String csrf
    ) {
        RequestBody fileBody = new UploadProgressRequestBody(uploadId, session);
        MultipartBody multipart = new MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("upload_type", "composer")
            .addFormDataPart("file", session.fileName, fileBody)
            .build();

        Request.Builder uploadBuilder = new Request.Builder()
            .url(ORIGIN + "/uploads.json")
            .post(multipart)
            .header("Accept", "application/json")
            .header("X-Requested-With", "XMLHttpRequest");
        if (!csrf.isEmpty()) uploadBuilder.header("X-CSRF-Token", csrf);
        if (!cookie.isEmpty()) uploadBuilder.header("Cookie", cookie);
        if (!userAgent.isEmpty()) uploadBuilder.header("User-Agent", userAgent);
        userApiAuth.applyHeaders(uploadBuilder);

        identityClient.newCall(uploadBuilder.build()).enqueue(new Callback() {
            @Override
            public void onFailure(Call ignoredUpload, IOException error) {
                session.file.delete();
                call.reject("上传失败", "LINUXDO_UPLOAD_NETWORK");
            }

            @Override
            public void onResponse(Call ignoredUpload, Response uploadResponse) throws IOException {
                syncResponseCookies(uploadResponse);
                try (ResponseBody body = uploadResponse.body()) {
                    String text = body != null ? body.string() : "";
                    if (!uploadResponse.isSuccessful()) {
                        call.reject(text.isEmpty() ? "上传失败" : text, "LINUXDO_UPLOAD_HTTP");
                        return;
                    }
                    JSObject result = JSObject.fromJSONObject(new JSONObject(text));
                    call.resolve(result);
                } catch (Exception error) {
                    call.reject("无法解析上传结果", "LINUXDO_UPLOAD_PARSE");
                } finally {
                    session.file.delete();
                }
            }
        });
    }

    @PluginMethod
    public void cancelUpload(PluginCall call) {
        cleanupUpload(call.getString("uploadId", ""));
        call.resolve();
    }

    private void cleanupUpload(String uploadId) {
        UploadSession session = uploadSessions.remove(uploadId);
        if (session != null && session.file.exists()) session.file.delete();
    }

    @PluginMethod
    public void clearBrowserSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                clearLinuxDoCookies();
                clearCachedSessionUser();
                verifiedUserAgent = "";
                CookieManager.getInstance().flush();
                call.resolve();
            } catch (Exception error) {
                call.reject("清理 Linux.do 会话失败", "LINUXDO_SESSION_CLEAR");
            }
        });
    }

    private String currentUserAgent() {
        if (sessionWebView != null) {
            String current = empty(sessionWebView.getSettings().getUserAgentString());
            if (!current.isEmpty()) {
                verifiedUserAgent = current;
                return current;
            }
        }
        if (!verifiedUserAgent.isEmpty()) return verifiedUserAgent;
        if (getBridge() != null && getBridge().getWebView() != null) {
            return empty(getBridge().getWebView().getSettings().getUserAgentString());
        }
        return "";
    }

    private void syncResponseCookies(Response response) {
        java.util.List<String> values = response.headers("Set-Cookie");
        if (values.isEmpty()) return;
        getActivity().runOnUiThread(() -> {
            CookieManager manager = CookieManager.getInstance();
            for (String value : values) manager.setCookie(ORIGIN, value);
            manager.flush();
        });
    }

    private boolean isApiAllowedUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && "linux.do".equalsIgnoreCase(uri.getHost());
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isAllowedUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(value);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme())
                && host != null
                && (host.equalsIgnoreCase("linux.do") || host.toLowerCase().endsWith(".linux.do"));
        } catch (Exception ignored) {
            return false;
        }
    }

    private void openDialog(String initialUrl) {
        boolean otpExchange = pendingUserApiCall != null && pendingOtpCredential != null;
        if ((pendingCall == null && !otpExchange) || getActivity().isFinishing()) {
            rejectPending("LINUXDO_SESSION_UNAVAILABLE", "当前 Activity 无法打开 Linux.do 验证页");
            return;
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);

        Dialog nextDialog = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar);
        LinearLayout root = new LinearLayout(getActivity());
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(14, 15, 18));

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });

        FrameLayout chrome = new FrameLayout(getActivity());
        chrome.setBackgroundColor(Color.rgb(20, 22, 26));
        LinearLayout.LayoutParams chromeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(56)
        );
        root.addView(chrome, chromeParams);

        TextView title = new TextView(getActivity());
        title.setText(otpExchange ? "Linux.do · 正在建立安全会话" : "Linux.do · 登录与安全验证");
        title.setTextSize(15f);
        title.setTextColor(Color.rgb(238, 239, 242));
        title.setGravity(Gravity.CENTER);
        title.setPadding(dp(58), 0, dp(88), 0);
        chrome.addView(title, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        TextView close = circleButton("×");
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(38), dp(38), Gravity.CENTER_VERTICAL | Gravity.START);
        closeParams.leftMargin = dp(12);
        chrome.addView(close, closeParams);

        TextView done = new TextView(getActivity());
        done.setText("完成");
        done.setTextSize(13f);
        done.setTextColor(Color.WHITE);
        done.setGravity(Gravity.CENTER);
        GradientDrawable doneBg = new GradientDrawable();
        doneBg.setColor(Color.rgb(198, 70, 52));
        doneBg.setCornerRadius(dp(18));
        done.setBackground(doneBg);
        done.setVisibility(otpExchange ? View.GONE : View.VISIBLE);
        FrameLayout.LayoutParams doneParams = new FrameLayout.LayoutParams(dp(66), dp(36), Gravity.CENTER_VERTICAL | Gravity.END);
        doneParams.rightMargin = dp(12);
        chrome.addView(done, doneParams);

        TextView hint = new TextView(getActivity());
        hint.setText(
            otpExchange
                ? "正在把浏览器授权兑换为 App 会话；如出现 Cloudflare 验证，请在此页完成。"
                : "请在 Linux.do 官方页面完成账号密码、人机或二次验证，登录后点“完成”。"
        );
        hint.setTextSize(11.5f);
        hint.setTextColor(Color.rgb(166, 171, 181));
        hint.setGravity(Gravity.CENTER_VERTICAL);
        hint.setPadding(dp(16), dp(7), dp(16), dp(7));
        hint.setBackgroundColor(Color.rgb(25, 27, 32));
        root.addView(hint, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        WebView webView = new WebView(getActivity());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // hCaptcha is hosted in a third-party iframe on the official login page.
        // Keep third-party cookies disabled for the OTP bridge, but allow them for
        // an explicit interactive login so the challenge can complete reliably.
        cookieManager.setAcceptThirdPartyCookies(webView, !otpExchange);
        verifiedUserAgent = empty(settings.getUserAgentString());

        root.addView(webView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request != null && !request.isForMainFrame()) return false;
                Uri uri = request != null ? request.getUrl() : null;
                String target = uri != null ? uri.toString() : "";
                if (isAllowedUrl(target)) return false;
                Toast.makeText(getActivity(), "已阻止跳出 Linux.do 第一方域名", Toast.LENGTH_SHORT).show();
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (otpExchange) {
                    handleOtpPageFinished(view, url);
                } else {
                    Uri uri = Uri.parse(url);
                    if (
                        "/session/current.json".equals(uri.getPath())
                            && "1".equals(uri.getQueryParameter("newsnook_snapshot"))
                    ) {
                        collectWebViewSnapshot(view, pendingCall, true);
                    }
                }
            }
        });

        close.setOnClickListener(v -> cancelPending());
        done.setOnClickListener(v -> {
            if (sessionWebView != null) {
                sessionWebView.loadUrl(SESSION_URL + "?newsnook_snapshot=1");
            }
        });
        nextDialog.setOnKeyListener((ignored, keyCode, event) -> {
            if (keyCode != KeyEvent.KEYCODE_BACK || event.getAction() != KeyEvent.ACTION_UP) return false;
            if (webView.canGoBack()) webView.goBack();
            else cancelPending();
            return true;
        });
        nextDialog.setOnCancelListener(ignored -> cancelPending());
        nextDialog.setOnDismissListener(ignored -> {
            destroyWebView();
            dialog = null;
            if (!finishing && (pendingCall != null || pendingUserApiCall != null)) cancelPending();
        });

        nextDialog.setContentView(root);
        Window window = nextDialog.getWindow();
        if (window != null) {
            WindowCompat.setDecorFitsSystemWindows(window, false);
            window.setStatusBarColor(Color.rgb(14, 15, 18));
            window.setNavigationBarColor(Color.rgb(14, 15, 18));
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }

        dialog = nextDialog;
        sessionWebView = webView;
        nextDialog.show();
        if (window != null) window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        ViewCompat.requestApplyInsets(root);
        webView.loadUrl(initialUrl);
        if (otpExchange) {
            PluginCall otpCall = pendingUserApiCall;
            webView.postDelayed(() -> {
                if (
                    otpCall == null
                        || pendingUserApiCall != otpCall
                        || pendingOtpCredential == null
                        || sessionWebView != webView
                ) {
                    return;
                }
                pendingUserApiCall = null;
                pendingOtpCredential = null;
                exchangingOtp.set(false);
                userApiAuth.clearCredential();
                otpCall.reject(
                    "Linux.do 安全会话建立超时，请重新授权；若出现 Cloudflare 验证请先完成验证",
                    "LINUXDO_USER_API_OTP_TIMEOUT"
                );
                finishDialog();
            }, OTP_EXCHANGE_TIMEOUT_MILLIS);
        }
    }

    private TextView circleButton(String text) {
        TextView view = new TextView(getActivity());
        view.setText(text);
        view.setTextSize(25f);
        view.setTextColor(Color.rgb(214, 217, 224));
        view.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.rgb(39, 42, 49));
        bg.setShape(GradientDrawable.OVAL);
        view.setBackground(bg);
        return view;
    }

    private void redeemUserApiSession(PluginCall call, LinuxDoUserApiAuth.Credential credential) {
        if (!credential.hasUsableOneTimePassword()) {
            pendingUserApiCall = null;
            userApiAuth.clearCredential();
            call.reject("Linux.do 授权未返回可用的一次性登录凭据，请重新登录", "LINUXDO_USER_API_OTP");
            return;
        }
        pendingOtpCredential = credential;
        exchangingOtp.set(false);
        // A visible WebView navigation sends an HTML-oriented Accept header. Discourse's
        // extensionless /session/csrf route therefore renders its HTML not-found page,
        // which leaves the exchange waiting forever. Use the explicit JSON route for
        // the interactive bridge; this also survives a Cloudflare challenge redirect
        // because the .json suffix keeps the response format deterministic.
        getActivity().runOnUiThread(() -> openDialog(OTP_CSRF_URL));
    }

    private void handleOtpPageFinished(WebView view, String value) {
        PluginCall call = pendingUserApiCall;
        LinuxDoUserApiAuth.Credential credential = pendingOtpCredential;
        if (call == null || credential == null || value == null) return;

        Uri uri;
        try {
            uri = Uri.parse(value);
        } catch (Exception ignored) {
            return;
        }
        if (!"linux.do".equalsIgnoreCase(uri.getHost())) return;
        String path = empty(uri.getPath());
        if (path.equals("/session/current.json") && "1".equals(uri.getQueryParameter("newsnook_otp"))) {
            CookieManager.getInstance().flush();
            view.postDelayed(() -> collectWebViewSnapshot(view, call, true), 250L);
            return;
        }
        if ((!path.equals("/session/csrf") && !path.equals("/session/csrf.json")) || exchangingOtp.get()) {
            return;
        }

        view.evaluateJavascript(
            "(function(){try{return JSON.parse(document.body.innerText).csrf||''}catch(e){return ''}})()",
            encoded -> {
                String csrf = "";
                try {
                    Object decoded = new org.json.JSONTokener(encoded).nextValue();
                    if (decoded instanceof String) csrf = ((String) decoded).trim();
                } catch (Exception ignored) {
                    csrf = "";
                }
                if (csrf.isEmpty()) {
                    // A Cloudflare interstitial is expected to be non-JSON. Leave it
                    // visible so the user can complete the challenge; on success the
                    // same .json URL reloads and this handler runs again. The watchdog
                    // installed by openDialog prevents a permanent spinner.
                    return;
                }
                if (!exchangingOtp.compareAndSet(false, true)) return;

                String script = "(function(){"
                    + "var target='/session/otp/" + credential.oneTimePassword + "';"
                    + "fetch(target,{method:'POST',credentials:'include',redirect:'follow',"
                    + "headers:{'Accept':'application/json, text/javascript, */*; q=0.01',"
                    + "'X-CSRF-Token':" + JSONObject.quote(csrf)
                    + ",'X-Requested-With':'XMLHttpRequest'}})"
                    + ".then(function(response){location.replace('/session/current.json?newsnook_otp=1&status='+encodeURIComponent(String(response.status)))})"
                    + ".catch(function(){location.replace('/session/current.json?newsnook_otp=1&status=0')});"
                    + "})()";
                view.evaluateJavascript(script, ignored -> {});
            }
        );
    }

    private void collectWebViewSnapshot(WebView view, PluginCall call, boolean finishDialog) {
        if (view == null || call == null) return;
        view.evaluateJavascript("document.body ? document.body.innerText : ''", encoded -> {
            JSONObject user = null;
            try {
                Object decoded = new org.json.JSONTokener(encoded).nextValue();
                String text = decoded instanceof String ? (String) decoded : "";
                if (!text.isEmpty()) {
                    JSONObject root = new JSONObject(text);
                    user = root.optJSONObject("current_user");
                    if (user == null && root.has("user")) user = root.optJSONObject("user");
                }
            } catch (Exception ignored) {
                user = null;
            }
            JSONObject finalUser = user;
            if (finalUser == null && finishDialog && call != pendingUserApiCall) clearCachedSessionUser();
            String cookie = empty(CookieManager.getInstance().getCookie(ORIGIN));
            String userAgent = currentUserAgent();
            resolveSnapshot(call, finishDialog, cookie, userAgent, finalUser);
        });
    }

    private void burnUserApiCredential(LinuxDoUserApiAuth.Credential credential) {
        userApiAuth.clearCredential();
        Request request = new Request.Builder()
            .url(ORIGIN + "/user-api-key/revoke")
            .post(RequestBody.create("", MediaType.parse("application/x-www-form-urlencoded; charset=UTF-8")))
            .header("Accept", "application/json")
            .header("User-Api-Key", credential.key)
            .header("User-Api-Client-Id", credential.clientId)
            .build();
        identityClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call ignored, IOException error) {
                // The one-time-password scope cannot access normal APIs. Local removal is sufficient.
            }

            @Override
            public void onResponse(Call ignored, Response response) throws IOException {
                try (ResponseBody body = response.body()) {
                    // Best-effort remote revoke; the browser session is already independent of this key.
                }
            }
        });
    }

    private SharedPreferences sessionCachePreferences() {
        return getContext().getSharedPreferences(SESSION_CACHE_PREFS, 0);
    }

    private void cacheSessionUser(JSONObject user) {
        if (user == null) return;
        try {
            JSONObject cached = new JSONObject();
            cached.put("id", user.optInt("id", 0));
            cached.put("username", user.optString("username", ""));
            cached.put("name", user.optString("name", ""));
            cached.put("avatar_template", user.optString("avatar_template", ""));
            cached.put("trust_level", user.optInt("trust_level", 0));
            cached.put("unread_notifications", user.optInt("unread_notifications", 0));
            if (user.has("can_use_templates")) cached.put("can_use_templates", user.optBoolean("can_use_templates", false));
            sessionCachePreferences().edit().putString(PREF_LAST_USER, cached.toString()).apply();
        } catch (Exception ignored) {
            // Session hints are best-effort and never replace the server as authority.
        }
    }

    private JSONObject cachedSessionUser() {
        String value = sessionCachePreferences().getString(PREF_LAST_USER, "");
        if (value == null || value.isEmpty()) return null;
        try {
            JSONObject user = new JSONObject(value);
            return user.optString("username", "").isEmpty() ? null : user;
        } catch (Exception ignored) {
            clearCachedSessionUser();
            return null;
        }
    }

    private void clearCachedSessionUser() {
        sessionCachePreferences().edit().remove(PREF_LAST_USER).apply();
    }

    private JSObject userObject(JSONObject user) {
        JSObject current = new JSObject();
        current.put("id", user.optInt("id", 0));
        current.put("username", user.optString("username", ""));
        current.put("name", user.optString("name", ""));
        current.put("avatarTemplate", avatarUrl(user.optString("avatar_template", "")));
        current.put("trustLevel", user.optInt("trust_level", 0));
        current.put("unreadNotifications", user.optInt("unread_notifications", 0));
        if (user.has("can_use_templates")) current.put("canUseTemplates", user.optBoolean("can_use_templates", false));
        return current;
    }

    private void collectSnapshot(PluginCall call, boolean finishDialog) {
        if (call == null) return;
        if (!probing.compareAndSet(false, true)) {
            JSONObject cached = cachedSessionUser();
            getActivity().runOnUiThread(() ->
                resolveSnapshot(call, finishDialog, "", currentUserAgent(), cached)
            );
            return;
        }

        getActivity().runOnUiThread(() -> {
            CookieManager manager = CookieManager.getInstance();
            String cookie = empty(manager.getCookie(ORIGIN));
            String userAgent = currentUserAgent();

            Request.Builder builder = new Request.Builder()
                .url(SESSION_URL)
                .header("Accept", "application/json, text/plain, */*")
                .header("X-Requested-With", "XMLHttpRequest");
            if (!cookie.isEmpty()) builder.header("Cookie", cookie);
            if (!userAgent.isEmpty()) builder.header("User-Agent", userAgent);

            identityClient.newCall(builder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call ignored, IOException error) {
                    JSONObject cached = cachedSessionUser();
                    probing.set(false);
                    getActivity().runOnUiThread(() ->
                        resolveSnapshot(call, finishDialog, cookie, userAgent, cached)
                    );
                }

                @Override
                public void onResponse(Call ignored, Response response) throws IOException {
                    syncResponseCookies(response);
                    JSONObject user = null;
                    boolean definitiveLogout = response.code() == 401;
                    boolean parsed = false;
                    try (ResponseBody body = response.body()) {
                        String text = body != null ? body.string() : "";
                        if (response.isSuccessful() && !text.isEmpty()) {
                            JSONObject root = new JSONObject(text);
                            parsed = true;
                            JSONObject current = root.optJSONObject("current_user");
                            if (current == null && root.has("user")) current = root.optJSONObject("user");
                            user = current;
                            if (user == null && (root.has("current_user") || root.has("user"))) {
                                definitiveLogout = true;
                            }
                        }
                    } catch (Exception ignoredParse) {
                        user = null;
                    }

                    JSONObject finalUser = user;
                    if (finalUser == null) {
                        if (definitiveLogout) {
                            clearCachedSessionUser();
                        } else if (!parsed || !response.isSuccessful()) {
                            finalUser = cachedSessionUser();
                        }
                    }
                    JSONObject resolvedUser = finalUser;
                    probing.set(false);
                    getActivity().runOnUiThread(() ->
                        resolveSnapshot(call, finishDialog, cookie, userAgent, resolvedUser)
                    );
                }
            });
        });
    }

    private void resolveSnapshot(
        PluginCall call,
        boolean finishDialog,
        String cookie,
        String userAgent,
        JSONObject user
    ) {
        boolean userApiExchange = call == pendingUserApiCall;
        LinuxDoUserApiAuth.Credential credential = pendingOtpCredential;
        if (user != null) cacheSessionUser(user);
        if (userApiExchange && user == null) {
            pendingUserApiCall = null;
            pendingOtpCredential = null;
            exchangingOtp.set(false);
            userApiAuth.clearCredential();
            call.reject("Linux.do 授权已完成，但一次性会话兑换失败，请重试", "LINUXDO_USER_API_OTP");
            finishDialog();
            return;
        }

        JSObject result = new JSObject();
        result.put("authenticated", user != null);
        result.put("authMode", user != null ? "browser-session" : "none");
        result.put("userAgent", userAgent);
        if (user != null) result.put("currentUser", userObject(user));

        if (userApiExchange) {
            pendingUserApiCall = null;
            pendingOtpCredential = null;
            exchangingOtp.set(false);
            if (credential != null) burnUserApiCredential(credential);
            call.resolve(result);
            finishDialog();
        } else if (finishDialog && call == pendingCall) {
            pendingCall = null;
            call.resolve(result);
            finishDialog();
        } else {
            call.resolve(result);
        }
    }

    private void finishDialog() {
        finishing = true;
        if (dialog != null) dialog.dismiss();
        finishing = false;
    }

    private static String avatarUrl(String template) {
        if (template == null || template.isEmpty()) return "";
        return ORIGIN + template.replace("{size}", "96");
    }

    private void clearLinuxDoCookies() {
        CookieManager manager = CookieManager.getInstance();
        String header = manager.getCookie(ORIGIN);
        if (header == null || header.isEmpty()) return;
        String[] parts = header.split(";");
        for (String part : parts) {
            int eq = part.indexOf('=');
            if (eq <= 0) continue;
            String name = part.substring(0, eq).trim();
            manager.setCookie(ORIGIN, name + "=; Max-Age=0; Path=/; Secure");
            manager.setCookie(ORIGIN, name + "=; Max-Age=0; Path=/; Domain=.linux.do; Secure");
        }
    }

    private void cancelPending() {
        if (pendingCall != null) {
            pendingCall.reject("已取消 Linux.do 登录/验证", "LINUXDO_SESSION_CANCELLED");
            pendingCall = null;
        }
        if (pendingUserApiCall != null) {
            pendingUserApiCall.reject("已取消 Linux.do 登录", "LINUXDO_USER_API_CANCELLED");
            pendingUserApiCall = null;
            pendingOtpCredential = null;
            exchangingOtp.set(false);
            userApiAuth.cancel();
            userApiAuth.clearCredential();
        }
        if (dialog != null) dialog.dismiss();
    }

    private void rejectPending(String code, String message) {
        PluginCall call = pendingCall;
        pendingCall = null;
        if (call != null) call.reject(message, code);
        PluginCall userApiCall = pendingUserApiCall;
        pendingUserApiCall = null;
        pendingOtpCredential = null;
        exchangingOtp.set(false);
        if (userApiCall != null) userApiCall.reject(message, code);
    }

    private void destroyWebView() {
        WebView view = sessionWebView;
        sessionWebView = null;
        if (view == null) return;
        view.stopLoading();
        view.setWebViewClient(null);
        view.loadUrl("about:blank");
        view.removeAllViews();
        view.destroy();
        exchangingOtp.set(false);
    }

    private static String empty(String value) {
        return value == null ? "" : value;
    }

    private int dp(int value) {
        float density = getActivity().getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    @Override
    protected void handleOnDestroy() {
        if (userApiAuth != null) userApiAuth.destroy();
        for (String uploadId : uploadSessions.keySet()) cleanupUpload(uploadId);
        getActivity().runOnUiThread(() -> {
            if (pendingCall != null) {
                pendingCall.reject("应用正在关闭", "LINUXDO_SESSION_DESTROYED");
                pendingCall = null;
            }
            if (pendingUserApiCall != null) {
                pendingUserApiCall.reject("应用正在关闭", "LINUXDO_USER_API_CANCELLED");
                pendingUserApiCall = null;
            }
            if (dialog != null) dialog.dismiss();
            destroyWebView();
            dialog = null;
        });
        super.handleOnDestroy();
    }
}
