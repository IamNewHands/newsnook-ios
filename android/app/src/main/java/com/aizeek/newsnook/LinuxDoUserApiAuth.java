package com.aizeek.newsnook;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import okhttp3.Request;
import org.json.JSONObject;

/**
 * Discourse delegated User API Key authentication for Linux.do.
 *
 * This intentionally uses the canonical browser flow (/user-api-key/new):
 * the system browser owns the Linux.do session, so GitHub/Google and any other
 * site-enabled login provider work without copying browser cookies into NewsNook.
 * Linux.do redirects the encrypted credential back to an app-only deep link.
 */
final class LinuxDoUserApiAuth {
    static final String ORIGIN = "https://linux.do";
    static final String CLIENT_ID_PREFIX = "newsnook-android-v1-";
    static final String APPLICATION_NAME = "NewsNook";
    static final String SCOPES = "write";
    static final String AUTH_MODE = "user-api-key";
    static final String AUTH_REDIRECT = "newsnook://linuxdo-auth/callback";

    private static final String PREFS = "linuxdo_user_api_auth";
    private static final String PREF_CREDENTIAL = "credential";
    private static final String PREF_CLIENT_ID = "client_id";
    private static final String PREF_PENDING_NONCE = "pending_nonce";
    private static final String PREF_PENDING_STARTED_AT = "pending_started_at";
    private static final String RSA_ALIAS = "newsnook_linuxdo_user_api_rsa_v1";
    private static final String AES_ALIAS = "newsnook_linuxdo_user_api_aes_v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final long AUTH_MAX_AGE_MILLIS = 15L * 60L * 1000L;
    private static final SecureRandom RANDOM = new SecureRandom();

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
    private final AtomicBoolean authenticating = new AtomicBoolean(false);
    private volatile AuthCallback activeCallback;
    private volatile String pendingNonce = "";
    private volatile Credential cachedCredential;

    LinuxDoUserApiAuth(Context context) {
        this.context = context.getApplicationContext();
        restorePendingAuth();
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
        activeCallback = null;
    }

    void authenticate(Activity activity, AuthCallback callback) {
        // A process may have been killed while the browser was open. In that case
        // there is no live JS promise to preserve, so a new explicit login attempt
        // is allowed to replace the persisted pending nonce immediately.
        if (authenticating.get() && activeCallback == null) clearPendingAuth();
        if (!authenticating.compareAndSet(false, true)) {
            callback.onFailure("LINUXDO_USER_API_BUSY", "已有 Linux.do 第三方登录正在进行");
            return;
        }

        try {
            String nonce = randomHex(16);
            pendingNonce = nonce;
            activeCallback = callback;
            preferences()
                .edit()
                .putString(PREF_PENDING_NONCE, nonce)
                .putLong(PREF_PENDING_STARTED_AT, System.currentTimeMillis())
                .commit();

            Uri authorizationUri = Uri.parse(ORIGIN + "/user-api-key/new")
                .buildUpon()
                .appendQueryParameter("scopes", SCOPES)
                .appendQueryParameter("client_id", clientId())
                .appendQueryParameter("nonce", nonce)
                .appendQueryParameter("auth_redirect", AUTH_REDIRECT)
                .appendQueryParameter("application_name", APPLICATION_NAME)
                .appendQueryParameter("public_key", publicKeyPem())
                .appendQueryParameter("padding", "oaep")
                .build();

            if (!openSystemBrowser(activity, authorizationUri.toString())) {
                finishFailure(callback, "LINUXDO_USER_API_BROWSER", "无法打开系统浏览器，请检查默认浏览器是否可用");
                return;
            }

            callback.onPending(authorizationUri.toString(), (int) (AUTH_MAX_AGE_MILLIS / 1000L));
        } catch (Exception error) {
            finishFailure(callback, "LINUXDO_USER_API_CRYPTO", "无法准备 Linux.do 安全授权");
        }
    }

    void cancel() {
        AuthCallback callback = activeCallback;
        clearPendingAuth();
        if (callback != null) callback.onFailure("LINUXDO_USER_API_CANCELLED", "已取消 Linux.do 登录");
    }

    /**
     * Consume newsnook://linuxdo-auth/callback?payload=... from the system browser.
     * Returns true only for the dedicated Linux.do auth callback.
     *
     * The pending nonce is persisted so a browser round-trip can survive Android
     * process death. If the original Capacitor promise no longer exists, the
     * credential is still persisted and the next snapshot restores the session.
     */
    boolean handleRedirect(Uri uri) {
        if (!isAuthRedirect(uri)) return false;

        String error = empty(uri.getQueryParameter("error"));
        if (!error.isEmpty()) {
            AuthCallback callback = activeCallback;
            String message =
                "access_denied".equalsIgnoreCase(error)
                    ? "你已取消或拒绝 Linux.do 授权"
                    : "Linux.do 第三方登录失败：" + error;
            clearPendingAuth();
            if (callback != null) callback.onFailure("LINUXDO_USER_API_DENIED", message);
            return true;
        }

        String payload = empty(uri.getQueryParameter("payload"));
        if (payload.isEmpty()) {
            AuthCallback callback = activeCallback;
            clearPendingAuth();
            if (callback != null) {
                callback.onFailure("LINUXDO_USER_API_PROTOCOL", "Linux.do 未返回安全授权凭据");
            }
            return true;
        }

        try {
            String nonce = pendingNonce();
            if (nonce.isEmpty()) throw new SecurityException("missing pending nonce");
            Credential credential = decryptCredential(payload, nonce, clientId());
            persistCredential(credential);

            AuthCallback callback = activeCallback;
            clearPendingAuth();
            if (callback != null) callback.onSuccess(credential);
        } catch (Exception errorValue) {
            AuthCallback callback = activeCallback;
            clearPendingAuth();
            if (callback != null) {
                callback.onFailure("LINUXDO_USER_API_PROTOCOL", "Linux.do 授权回流校验失败，请重新登录");
            }
        }
        return true;
    }

    private void restorePendingAuth() {
        SharedPreferences prefs = preferences();
        String nonce = empty(prefs.getString(PREF_PENDING_NONCE, ""));
        long startedAt = prefs.getLong(PREF_PENDING_STARTED_AT, 0L);
        if (nonce.isEmpty() || startedAt <= 0L || System.currentTimeMillis() - startedAt > AUTH_MAX_AGE_MILLIS) {
            prefs.edit().remove(PREF_PENDING_NONCE).remove(PREF_PENDING_STARTED_AT).apply();
            return;
        }
        pendingNonce = nonce;
        authenticating.set(true);
    }

    private String pendingNonce() {
        if (!pendingNonce.isEmpty()) return pendingNonce;
        String stored = empty(preferences().getString(PREF_PENDING_NONCE, ""));
        long startedAt = preferences().getLong(PREF_PENDING_STARTED_AT, 0L);
        if (stored.isEmpty() || startedAt <= 0L || System.currentTimeMillis() - startedAt > AUTH_MAX_AGE_MILLIS) {
            return "";
        }
        pendingNonce = stored;
        return stored;
    }

    private void clearPendingAuth() {
        pendingNonce = "";
        activeCallback = null;
        authenticating.set(false);
        preferences().edit().remove(PREF_PENDING_NONCE).remove(PREF_PENDING_STARTED_AT).apply();
    }

    private void finishFailure(AuthCallback callback, String code, String message) {
        clearPendingAuth();
        callback.onFailure(code, message);
    }

    private Credential decryptCredential(String encryptedPayload, String expectedNonce, String clientId)
        throws Exception {
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
        if (key.isEmpty() || api <= 0) throw new SecurityException("invalid credential payload");
        return new Credential(key, clientId, api, expiresAt);
    }

    private void persistCredential(Credential credential) throws Exception {
        String encrypted = encryptStored(credential.toJson().toString());
        preferences().edit().putString(PREF_CREDENTIAL, encrypted).commit();
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
        return Base64.encodeToString(iv, Base64.NO_WRAP)
            + "."
            + Base64.encodeToString(encrypted, Base64.NO_WRAP);
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
        SharedPreferences prefs = preferences();
        String existing = prefs.getString(PREF_CLIENT_ID, "");
        if (existing != null && !existing.isEmpty()) return existing;
        String created = CLIENT_ID_PREFIX + randomHex(16);
        prefs.edit().putString(PREF_CLIENT_ID, created).commit();
        return created;
    }

    private SharedPreferences preferences() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean isAuthRedirect(Uri uri) {
        if (uri == null) return false;
        return "newsnook".equalsIgnoreCase(uri.getScheme())
            && "linuxdo-auth".equalsIgnoreCase(uri.getHost())
            && "/callback".equals(uri.getPath());
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
                // Try the next representation.
            }
        }
        return null;
    }

    private static String empty(String value) {
        return value == null ? "" : value;
    }
}
