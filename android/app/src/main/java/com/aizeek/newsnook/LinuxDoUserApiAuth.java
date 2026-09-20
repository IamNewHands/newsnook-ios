package com.aizeek.newsnook;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

final class LinuxDoUserApiAuth {
    static final String ORIGIN = "https://linux.do";
    static final String CLIENT_ID_PREFIX = "newsnook-android-v1-";
    static final String APPLICATION_NAME = "NewsNook";
    static final String SCOPES = "write";
    static final String AUTH_MODE = "user-api-key";

    private static final String PREFS = "linuxdo_user_api_auth";
    private static final String PREF_CREDENTIAL = "credential";
    private static final String PREF_CLIENT_ID = "client_id";
    private static final String RSA_ALIAS = "newsnook_linuxdo_user_api_rsa_v1";
    private static final String AES_ALIAS = "newsnook_linuxdo_user_api_aes_v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final SecureRandom RANDOM = new SecureRandom();

    interface BrowserContext {
        void apply(Request.Builder builder);
    }

    interface AuthCallback {
        void onPending(String verificationUrl, int expiresInSeconds);
        void onSuccess(Credential credential);
        void onFailure(String code, String message);
    }

    static final class Credential {
        final String key;
        final String clientId;
        final int apiVersion;
        final String expiresAt;

        Credential(String key, String clientId, int apiVersion, String expiresAt) {
            this.key = key;
            this.clientId = clientId;
            this.apiVersion = apiVersion;
            this.expiresAt = expiresAt == null ? "" : expiresAt;
        }

        boolean expired() {
            if (expiresAt.isEmpty()) return false;
            Date expires = parseIso8601(expiresAt);
            return expires == null || expires.getTime() <= System.currentTimeMillis();
        }

        JSONObject toJson() throws Exception {
            JSONObject value = new JSONObject();
            value.put("key", key);
            value.put("clientId", clientId);
            value.put("apiVersion", apiVersion);
            if (!expiresAt.isEmpty()) value.put("expiresAt", expiresAt);
            return value;
        }

        static Credential fromJson(JSONObject value) {
            String key = value.optString("key", "");
            String clientId = value.optString("clientId", "");
            int apiVersion = value.optInt("apiVersion", 0);
            String expiresAt = value.optString("expiresAt", "");
            if (key.isEmpty() || clientId.isEmpty() || apiVersion <= 0) return null;
            return new Credential(key, clientId, apiVersion, expiresAt);
        }
    }

    private final Context context;
    private final OkHttpClient client;
    private final BrowserContext browserContext;
    private final ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(1);
    private final AtomicBoolean authenticating = new AtomicBoolean(false);
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private volatile ScheduledFuture<?> pollFuture;
    private volatile long authDeadlineMillis;
    private volatile String pendingDeviceCode = "";
    private volatile String pendingNonce = "";
    private volatile AuthCallback activeCallback;
    private volatile Credential cachedCredential;

    LinuxDoUserApiAuth(Context context, OkHttpClient client, BrowserContext browserContext) {
        this.context = context.getApplicationContext();
        this.client = client;
        this.browserContext = browserContext;
        scheduler.setRemoveOnCancelPolicy(true);
    }

    boolean isAuthenticating() {
        return authenticating.get();
    }

    Credential credential() {
        Credential cached = cachedCredential;
        if (cached != null && !cached.expired()) return cached;
        try {
            String encrypted = preferences().getString(PREF_CREDENTIAL, "");
            if (encrypted == null || encrypted.isEmpty()) return null;
            Credential credential = Credential.fromJson(new JSONObject(decryptStored(encrypted)));
            if (credential == null || credential.expired()) {
                clearCredential();
                return null;
            }
            cachedCredential = credential;
            return credential;
        } catch (Exception ignored) {
            clearCredential();
            return null;
        }
    }

    boolean hasValidCredential() {
        return credential() != null;
    }

    void applyHeaders(Request.Builder builder) {
        Credential credential = credential();
        if (credential == null) return;
        builder.header("User-Api-Key", credential.key);
        builder.header("User-Api-Client-Id", credential.clientId);
    }

    void clearCredential() {
        cachedCredential = null;
        preferences().edit().remove(PREF_CREDENTIAL).apply();
    }

    void destroy() {
        cancel();
        scheduler.shutdownNow();
    }

    void authenticate(Activity activity, AuthCallback callback) {
        if (!authenticating.compareAndSet(false, true)) {
            callback.onFailure("LINUXDO_USER_API_BUSY", "已有 Linux.do 系统浏览器登录正在进行");
            return;
        }
        cancelled.set(false);
        activeCallback = callback;

        beginDeviceAuthorization(activity, callback);
    }

    void cancel() {
        cancelled.set(true);
        AuthCallback callback = activeCallback;
        activeCallback = null;
        ScheduledFuture<?> current = pollFuture;
        if (current != null) current.cancel(true);
        pollFuture = null;
        pendingDeviceCode = "";
        pendingNonce = "";
        boolean wasAuthenticating = authenticating.getAndSet(false);
        if (wasAuthenticating && callback != null) callback.onFailure("LINUXDO_USER_API_CANCELLED", "已取消 Linux.do 登录");
    }

    private void beginDeviceAuthorization(Activity activity, AuthCallback callback) {
        try {
            String nonce = randomHex(16);
            String publicKey = publicKeyPem();
            String clientId = clientId();
            JSONObject requestJson = new JSONObject();
            requestJson.put("nonce", nonce);
            requestJson.put("scopes", SCOPES);
            requestJson.put("client_id", clientId);
            requestJson.put("application_name", APPLICATION_NAME);
            requestJson.put("public_key", publicKey);
            requestJson.put("padding", "oaep");
            RequestBody requestBody = RequestBody.create(
                requestJson.toString(),
                MediaType.parse("application/json; charset=UTF-8")
            );

            Request.Builder builder = new Request.Builder()
                .url(ORIGIN + "/user-api-key/device.json")
                .post(requestBody)
                .header("Accept", "application/json")
                .header("X-Requested-With", "XMLHttpRequest");
            browserContext.apply(builder);
            Request request = builder.build();

            client.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException error) {
                    finishFailure(callback, "LINUXDO_USER_API_NETWORK", "无法建立 Linux.do 安全授权");
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    String text;
                    try (ResponseBody body = response.body()) {
                        text = body != null ? body.string() : "";
                    }
                    if (cancelled.get()) {
                        finishFailure(callback, "LINUXDO_USER_API_CANCELLED", "已取消 Linux.do 登录");
                        return;
                    }
                    if (!response.isSuccessful()) {
                        if (looksLikeCloudflare(response, text)) {
                            finishFailure(callback, "LINUXDO_USER_API_BROWSER_VERIFICATION_REQUIRED", "Linux.do 要求先完成 Cloudflare 浏览器验证");
                        } else if (isUnsupportedDeviceFlow(response, text)) {
                            finishFailure(callback, "LINUXDO_USER_API_UNSUPPORTED", "Linux.do 当前未开放 App 安全授权");
                        } else {
                            finishFailure(callback, "LINUXDO_USER_API_HTTP", apiError(text, "Linux.do 拒绝了 App 授权请求"));
                        }
                        return;
                    }

                    try {
                        JSONObject json = new JSONObject(text);
                        String deviceCode = json.optString("device_code", "");
                        String verificationUrl = json.optString("verification_uri_with_request", "");
                        int expiresIn = json.optInt("expires_in", 600);
                        int interval = Math.max(1, json.optInt("interval", 5));
                        if (deviceCode.isEmpty() || verificationUrl.isEmpty()) {
                            finishFailure(callback, "LINUXDO_USER_API_PROTOCOL", "Linux.do 返回了无效的授权信息");
                            return;
                        }

                        pendingDeviceCode = deviceCode;
                        pendingNonce = nonce;
                        authDeadlineMillis = System.currentTimeMillis() + Math.max(30, expiresIn) * 1000L;

                        activity.runOnUiThread(() -> {
                            if (!openSystemBrowser(activity, verificationUrl)) {
                                finishFailure(callback, "LINUXDO_USER_API_BROWSER", "无法打开系统浏览器，请检查默认浏览器是否可用");
                                return;
                            }
                            callback.onPending(verificationUrl, expiresIn);
                            if (authenticating.get()) startPolling(callback, interval);
                        });
                    } catch (Exception error) {
                        finishFailure(callback, "LINUXDO_USER_API_PROTOCOL", "无法解析 Linux.do 授权信息");
                    }
                }
            });
        } catch (Exception error) {
            finishFailure(callback, "LINUXDO_USER_API_CRYPTO", "无法准备 Linux.do 安全授权");
        }
    }

    private void startPolling(AuthCallback callback, int intervalSeconds) {
        ScheduledFuture<?> existing = pollFuture;
        if (existing != null) existing.cancel(true);
        pollFuture = scheduler.scheduleWithFixedDelay(
            () -> pollOnce(callback),
            intervalSeconds,
            intervalSeconds,
            TimeUnit.SECONDS
        );
    }

    private void pollOnce(AuthCallback callback) {
        if (!authenticating.get() || cancelled.get()) return;
        if (System.currentTimeMillis() >= authDeadlineMillis) {
            finishFailure(callback, "LINUXDO_USER_API_EXPIRED", "Linux.do 登录授权已过期，请重新登录");
            return;
        }

        String deviceCode = pendingDeviceCode;
        if (deviceCode.isEmpty()) return;

        JSONObject pollJson = new JSONObject();
        try {
            pollJson.put("device_code", deviceCode);
        } catch (Exception error) {
            finishFailure(callback, "LINUXDO_USER_API_PROTOCOL", "无法准备 Linux.do 授权轮询");
            return;
        }
        RequestBody pollBody = RequestBody.create(
            pollJson.toString(),
            MediaType.parse("application/json; charset=UTF-8")
        );
        Request.Builder builder = new Request.Builder()
            .url(ORIGIN + "/user-api-key/device/poll.json")
            .post(pollBody)
            .header("Accept", "application/json")
            .header("X-Requested-With", "XMLHttpRequest");
        browserContext.apply(builder);
        Request request = builder.build();

        try (Response response = client.newCall(request).execute()) {
            String text;
            try (ResponseBody body = response.body()) {
                text = body != null ? body.string() : "";
            }
            if (!response.isSuccessful()) {
                if (looksLikeCloudflare(response, text)) {
                    finishFailure(callback, "LINUXDO_USER_API_BROWSER_VERIFICATION_REQUIRED", "Linux.do 要求先完成 Cloudflare 浏览器验证");
                }
                return;
            }

            JSONObject json = new JSONObject(text);
            String status = json.optString("status", "");
            if ("authorization_pending".equals(status)) return;
            if ("access_denied".equals(status)) {
                finishFailure(callback, "LINUXDO_USER_API_DENIED", "你已拒绝 Linux.do 授权");
                return;
            }
            if ("expired_token".equals(status)) {
                finishFailure(callback, "LINUXDO_USER_API_EXPIRED", "Linux.do 登录授权已过期，请重新登录");
                return;
            }
            if (!"authorized".equals(status)) return;

            String payload = json.optString("payload", "");
            if (payload.isEmpty()) {
                finishFailure(callback, "LINUXDO_USER_API_PROTOCOL", "Linux.do 未返回安全凭据");
                return;
            }

            Credential credential = decryptCredential(payload, pendingNonce, clientId());
            persistCredential(credential);
            finishSuccess(callback, credential);
        } catch (Exception ignored) {
            // Transient poll failures are retried until the server-provided expiry.
        }
    }

    private Credential decryptCredential(String encryptedPayload, String expectedNonce, String clientId) throws Exception {
        byte[] encrypted = Base64.decode(encryptedPayload, Base64.DEFAULT);
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        java.security.PrivateKey privateKey = (java.security.PrivateKey) store.getKey(RSA_ALIAS, null);
        if (privateKey == null) throw new IllegalStateException("missing private key");

        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-1AndMGF1Padding");
        cipher.init(Cipher.DECRYPT_MODE, privateKey);
        JSONObject json = new JSONObject(new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));

        String nonce = json.optString("nonce", "");
        if (expectedNonce.isEmpty() || !constantTimeEquals(expectedNonce, nonce)) {
            throw new SecurityException("nonce mismatch");
        }
        String key = json.optString("key", "");
        int api = json.optInt("api", 0);
        String expiresAt = json.optString("expires_at", "");
        if (key.isEmpty() || api < 4) throw new SecurityException("invalid credential payload");
        return new Credential(key, clientId, api, expiresAt);
    }

    private void persistCredential(Credential credential) throws Exception {
        String encrypted = encryptStored(credential.toJson().toString());
        preferences().edit().putString(PREF_CREDENTIAL, encrypted).apply();
        cachedCredential = credential;
    }

    private String publicKeyPem() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (!store.containsAlias(RSA_ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KEYSTORE);
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                RSA_ALIAS,
                KeyProperties.PURPOSE_DECRYPT
            )
                .setKeySize(2048)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .setDigests(KeyProperties.DIGEST_SHA1, KeyProperties.DIGEST_SHA256)
                .build();
            generator.initialize(spec);
            generator.generateKeyPair();
            store.load(null);
        }
        Certificate certificate = store.getCertificate(RSA_ALIAS);
        PublicKey publicKey = certificate != null ? certificate.getPublicKey() : null;
        if (publicKey == null) throw new IllegalStateException("missing public key");

        String base64 = Base64.encodeToString(publicKey.getEncoded(), Base64.NO_WRAP);
        StringBuilder pem = new StringBuilder("-----BEGIN PUBLIC KEY-----\n");
        for (int offset = 0; offset < base64.length(); offset += 64) {
            pem.append(base64, offset, Math.min(offset + 64, base64.length())).append('\n');
        }
        pem.append("-----END PUBLIC KEY-----\n");
        return pem.toString();
    }

    private String encryptStored(String plaintext) throws Exception {
        SecretKey key = getOrCreateAesKey();
        byte[] iv = new byte[12];
        RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decryptStored(String encoded) throws Exception {
        String[] parts = encoded.split("\\.", 2);
        if (parts.length != 2) throw new IllegalArgumentException("invalid credential");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateAesKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private SecretKey getOrCreateAesKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        java.security.Key existing = store.getKey(AES_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(
                AES_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    private String clientId() {
        SharedPreferences preferences = preferences();
        String existing = preferences.getString(PREF_CLIENT_ID, "");
        if (existing != null && !existing.isEmpty()) return existing;
        String created = CLIENT_ID_PREFIX + randomHex(16);
        preferences.edit().putString(PREF_CLIENT_ID, created).commit();
        return created;
    }

    private SharedPreferences preferences() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean openSystemBrowser(Activity activity, String url) {
        try {
            Uri uri = Uri.parse(url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return false;
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            activity.startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void finishSuccess(AuthCallback callback, Credential credential) {
        if (!authenticating.getAndSet(false)) return;
        ScheduledFuture<?> current = pollFuture;
        if (current != null) current.cancel(false);
        pollFuture = null;
        pendingDeviceCode = "";
        pendingNonce = "";
        activeCallback = null;
        callback.onSuccess(credential);
    }

    private void finishFailure(AuthCallback callback, String code, String message) {
        if (!authenticating.getAndSet(false)) return;
        ScheduledFuture<?> current = pollFuture;
        if (current != null) current.cancel(false);
        pollFuture = null;
        pendingDeviceCode = "";
        pendingNonce = "";
        activeCallback = null;
        callback.onFailure(code, message);
    }

    private static boolean isUnsupportedDeviceFlow(Response response, String body) {
        int status = response.code();
        if (status == 404 || status == 405 || status == 501) return true;
        if (status != 403) return false;
        String lower = body == null ? "" : body.toLowerCase();
        return lower.contains("user api") && (lower.contains("disabled") || lower.contains("invalid access"));
    }

    private static boolean looksLikeCloudflare(Response response, String body) {
        if (response.code() != 403) return false;
        String mitigated = response.header("cf-mitigated", "");
        if ("challenge".equalsIgnoreCase(mitigated)) return true;
        String server = response.header("server", "");
        String lower = body == null ? "" : body.toLowerCase();
        return "cloudflare".equalsIgnoreCase(server)
            && (lower.contains("challenge-platform") || lower.contains("just a moment") || lower.contains("cf-chl"));
    }

    private static String apiError(String body, String fallback) {
        try {
            JSONObject json = new JSONObject(body);
            org.json.JSONArray errors = json.optJSONArray("errors");
            if (errors != null && errors.length() > 0) return errors.optString(0, fallback);
            String error = json.optString("error", "");
            return error.isEmpty() ? fallback : error;
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static boolean constantTimeEquals(String left, String right) {
        byte[] a = left.getBytes(StandardCharsets.UTF_8);
        byte[] b = right.getBytes(StandardCharsets.UTF_8);
        if (a.length != b.length) return false;
        int diff = 0;
        for (int i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }

    private static String randomHex(int bytes) {
        byte[] value = new byte[bytes];
        RANDOM.nextBytes(value);
        StringBuilder builder = new StringBuilder(bytes * 2);
        for (byte item : value) builder.append(String.format("%02x", item & 0xff));
        return builder.toString();
    }

    private static Date parseIso8601(String value) {
        String[] patterns = {
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
        };
        for (String pattern : patterns) {
            try {
                SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
                format.setLenient(false);
                format.setTimeZone(TimeZone.getTimeZone("UTC"));
                return format.parse(value);
            } catch (Exception ignored) {
                // Try the next ISO-8601 representation.
            }
        }
        return null;
    }

    private static int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(value == null ? "" : value.trim());
        } catch (Exception ignored) {
            return fallback;
        }
    }
}
