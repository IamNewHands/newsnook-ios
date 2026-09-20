package com.aizeek.newsnook;

import android.app.Dialog;
import android.content.Intent;
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

    private Dialog dialog;
    private WebView sessionWebView;
    private volatile PluginCall pendingCall;
    private volatile PluginCall pendingUserApiCall;
    private final AtomicBoolean probing = new AtomicBoolean(false);
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
        if (userApiAuth.isAuthenticating() || pendingUserApiCall != null) {
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
                resolveUserApiSnapshot(call, credential);
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
        call.resolve();
    }

    @PluginMethod
    public void clearUserApiKey(PluginCall call) {
        userApiAuth.cancel();
        LinuxDoUserApiAuth.Credential credential = userApiAuth.credential();
        if (credential == null) {
            userApiAuth.clearCredential();
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
                call.resolve();
            }

            @Override
            public void onResponse(Call ignored, Response response) throws IOException {
                try (ResponseBody body = response.body()) {
                    // Best-effort remote revoke. Local logout must always succeed.
                } finally {
                    userApiAuth.clearCredential();
                    call.resolve();
                }
            }
        });
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        if (pendingCall != null || dialog != null) {
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
        if (credential != null) {
            resolveUserApiSnapshot(call, credential);
            return;
        }
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
            Uri requestUri = Uri.parse(url);
            String requestPath = requestUri.getPath() == null ? "" : requestUri.getPath();
            boolean firstPartySessionRequest = requestPath.equals("/session") || requestPath.equals("/session.json") || requestPath.equals("/session/csrf.json");
            if (!firstPartySessionRequest) userApiAuth.applyHeaders(builder);

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
                performUpload(session, call, cookie, userAgent, "");
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
                    performUpload(session, call, cookie, userAgent, csrf);
                }
            });
        });
    }

    private void performUpload(
        UploadSession session,
        PluginCall call,
        String cookie,
        String userAgent,
        String csrf
    ) {
        RequestBody fileBody = RequestBody.create(session.file, MediaType.parse(session.mimeType));
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
        if (pendingCall == null || getActivity().isFinishing()) {
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
        title.setText("Linux.do · 登录与安全验证");
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
        FrameLayout.LayoutParams doneParams = new FrameLayout.LayoutParams(dp(66), dp(36), Gravity.CENTER_VERTICAL | Gravity.END);
        doneParams.rightMargin = dp(12);
        chrome.addView(done, doneParams);

        TextView hint = new TextView(getActivity());
        hint.setText("如出现 Cloudflare 验证，请在此页自行完成；验证与登录完成后点“完成”。");
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
        cookieManager.setAcceptThirdPartyCookies(webView, false);
        verifiedUserAgent = empty(settings.getUserAgentString());

        root.addView(webView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request != null ? request.getUrl() : null;
                String target = uri != null ? uri.toString() : "";
                if (isAllowedUrl(target)) return false;
                Toast.makeText(getActivity(), "已阻止跳出 Linux.do 第一方域名", Toast.LENGTH_SHORT).show();
                return true;
            }
        });

        close.setOnClickListener(v -> cancelPending());
        done.setOnClickListener(v -> collectSnapshot(pendingCall, true));
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
            if (!finishing && pendingCall != null) cancelPending();
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

    private void resolveUserApiSnapshot(PluginCall call, LinuxDoUserApiAuth.Credential credential) {
        Request.Builder builder = new Request.Builder()
            .url(SESSION_URL)
            .header("Accept", "application/json, text/plain, */*")
            .header("X-Requested-With", "XMLHttpRequest");
        String cookie = empty(CookieManager.getInstance().getCookie(ORIGIN));
        String userAgent = currentUserAgent();
        if (!cookie.isEmpty()) builder.header("Cookie", cookie);
        if (!userAgent.isEmpty()) builder.header("User-Agent", userAgent);
        userApiAuth.applyHeaders(builder);

        identityClient.newCall(builder.build()).enqueue(new Callback() {
            @Override
            public void onFailure(Call ignored, IOException error) {
                if (pendingUserApiCall != call) return;
                pendingUserApiCall = null;
                call.reject("已授权，但暂时无法读取 Linux.do 用户信息", "LINUXDO_USER_API_IDENTITY");
            }

            @Override
            public void onResponse(Call ignored, Response response) throws IOException {
                syncResponseCookies(response);
                JSONObject user = null;
                String text = "";
                try (ResponseBody body = response.body()) {
                    text = body != null ? body.string() : "";
                    if (response.isSuccessful() && !text.isEmpty()) {
                        JSONObject root = new JSONObject(text);
                        user = root.optJSONObject("current_user");
                    }
                } catch (Exception ignoredParse) {
                    user = null;
                }
                if (pendingUserApiCall != call) return;
                if (user == null) {
                    pendingUserApiCall = null;
                    call.reject("Linux.do 安全授权已完成，但身份验证失败", "LINUXDO_USER_API_IDENTITY");
                    return;
                }

                JSObject result = new JSObject();
                result.put("authenticated", true);
                result.put("authMode", LinuxDoUserApiAuth.AUTH_MODE);
                result.put("apiVersion", credential.apiVersion);
                if (!credential.expiresAt.isEmpty()) result.put("expiresAt", credential.expiresAt);
                result.put("userAgent", userAgent);
                result.put("currentUser", userObject(user));
                pendingUserApiCall = null;
                call.resolve(result);
            }
        });
    }

    private JSObject userObject(JSONObject user) {
        JSObject current = new JSObject();
        current.put("id", user.optInt("id", 0));
        current.put("username", user.optString("username", ""));
        current.put("name", user.optString("name", ""));
        current.put("avatarTemplate", avatarUrl(user.optString("avatar_template", "")));
        current.put("trustLevel", user.optInt("trust_level", 0));
        current.put("unreadNotifications", user.optInt("unread_notifications", 0));
        return current;
    }

    private void collectSnapshot(PluginCall call, boolean finishDialog) {
        if (call == null) return;
        if (!probing.compareAndSet(false, true)) return;

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
                    probing.set(false);
                    getActivity().runOnUiThread(() ->
                        resolveSnapshot(call, finishDialog, cookie, userAgent, null)
                    );
                }

                @Override
                public void onResponse(Call ignored, Response response) throws IOException {
                    JSONObject user = null;
                    try (ResponseBody body = response.body()) {
                        String text = body != null ? body.string() : "";
                        if (response.isSuccessful() && !text.isEmpty()) {
                            JSONObject root = new JSONObject(text);
                            JSONObject current = root.optJSONObject("current_user");
                            if (current == null && root.has("user")) current = root.optJSONObject("user");
                            user = current;
                        }
                    } catch (Exception ignoredParse) {
                        user = null;
                    }
                    JSONObject finalUser = user;
                    probing.set(false);
                    getActivity().runOnUiThread(() ->
                        resolveSnapshot(call, finishDialog, cookie, userAgent, finalUser)
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
        JSObject result = new JSObject();
        result.put("authenticated", user != null);
        result.put("authMode", user != null ? "browser-session" : "none");
        result.put("userAgent", userAgent);
        if (user != null) result.put("currentUser", userObject(user));

        call.resolve(result);
        if (finishDialog && call == pendingCall) {
            finishing = true;
            pendingCall = null;
            if (dialog != null) dialog.dismiss();
            finishing = false;
        }
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
        if (dialog != null) dialog.dismiss();
    }

    private void rejectPending(String code, String message) {
        PluginCall call = pendingCall;
        pendingCall = null;
        if (call != null) call.reject(message, code);
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
