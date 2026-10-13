package com.aizeek.newsnook;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.content.Context;
import android.content.SharedPreferences;
import android.app.Dialog;
import android.os.Looper;
import org.json.JSONObject;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class LinuxDoAuthLifecycleTest {
    private static final String PREFS = "linuxdo_user_api_auth";
    private static final String PENDING_NONCE = "pending_nonce";
    private static final String PENDING_STARTED_AT = "pending_started_at";

    private static Field declaredField(Object target, String name) throws Exception {
        Class<?> type = target.getClass();
        while (type != null) {
            try {
                Field property = type.getDeclaredField(name);
                property.setAccessible(true);
                return property;
            } catch (NoSuchFieldException missing) {
                type = type.getSuperclass();
            }
        }
        throw new NoSuchFieldException(name);
    }

    private static void field(Object target, String name, Object value) throws Exception {
        declaredField(target, name).set(target, value);
    }

    private static Object field(Object target, String name) throws Exception {
        return declaredField(target, name).get(target);
    }

    private static final class TrackingCall extends PluginCall {
        String rejectedCode;
        int rejects;
        JSObject resolved;

        TrackingCall(String id) {
            super(null, "LinuxDoSession", id, "authenticateUserApiKey", new JSObject());
        }

        @Override public void reject(String message, String code) {
            rejectedCode = code;
            rejects++;
        }

        @Override public void resolve(JSObject result) {
            resolved = result;
        }
    }

    @Test public void restoredNonceRetainsCallbackValidationButNeverBlocksNewLogin() throws Exception {
        Context app = RuntimeEnvironment.getApplication();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, 0);
        prefs.edit().putString(PENDING_NONCE, "recovery-nonce")
            .putLong(PENDING_STARTED_AT, System.currentTimeMillis()).commit();
        LinuxDoUserApiAuth auth = new LinuxDoUserApiAuth(app);
        assertFalse("persisted nonce is not a live browser window", auth.isAuthenticating());
        assertEquals("recovery-nonce", field(auth, "pendingNonce"));
        assertEquals("recovery-nonce", prefs.getString(PENDING_NONCE, ""));
    }

    @Test public void expiredNonceIsDiscardedOnNextProcessStart() {
        Context app = RuntimeEnvironment.getApplication();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, 0);
        prefs.edit().putString(PENDING_NONCE, "expired-nonce")
            .putLong(PENDING_STARTED_AT, System.currentTimeMillis() - LinuxDoUserApiAuth.AUTH_MAX_AGE_MILLIS - 5_000L).commit();
        LinuxDoUserApiAuth auth = new LinuxDoUserApiAuth(app);
        assertFalse(auth.isAuthenticating());
        assertFalse(prefs.contains(PENDING_NONCE));
    }

    @Test public void closingExternalBrowserReleasesPendingCallAndDoesNotLeaveBusyState() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        Context app = activity.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, 0);
        prefs.edit().putString(PENDING_NONCE, "active-nonce")
            .putLong(PENDING_STARTED_AT, System.currentTimeMillis()).commit();
        LinuxDoUserApiAuth auth = new LinuxDoUserApiAuth(app);
        field(auth, "activeCallback", new LinuxDoUserApiAuth.AuthCallback() {
            @Override public void onPending(String url, int expires) {}
            @Override public void onSuccess(LinuxDoUserApiAuth.Credential credential) {}
            @Override public void onFailure(String code, String message) {}
        });
        ((AtomicBoolean) field(auth, "authenticating")).set(true);
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", auth);
        TrackingCall waiting = new TrackingCall("old");
        field(plugin, "pendingUserApiCall", waiting);
        plugin.handleOnPause();
        assertTrue((Boolean) field(plugin, "userApiBrowserBackgrounded"));
        plugin.handleOnResume();
        shadowOf(Looper.getMainLooper()).idleFor(500, TimeUnit.MILLISECONDS);
        assertEquals("LINUXDO_USER_API_CANCELLED", waiting.rejectedCode);
        assertEquals(1, waiting.rejects);
        assertNull(field(plugin, "pendingUserApiCall"));
        assertFalse(auth.isAuthenticating());
        assertFalse(prefs.contains(PENDING_NONCE));
    }

    @Test public void lateTimeoutOrCancelCannotReleaseNewerCall() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", new LinuxDoUserApiAuth(activity));
        TrackingCall old = new TrackingCall("old");
        TrackingCall current = new TrackingCall("new");
        field(plugin, "pendingUserApiCall", current);
        Method reject = LinuxDoSessionPlugin.class.getDeclaredMethod(
            "rejectUserApiCall", PluginCall.class, String.class, String.class);
        reject.setAccessible(true);
        reject.invoke(plugin, old, "LINUXDO_USER_API_TIMEOUT", "expired");
        assertSame(current, field(plugin, "pendingUserApiCall"));
        assertEquals(0, current.rejects);
        reject.invoke(plugin, current, "LINUXDO_USER_API_CANCELLED", "cancelled");
        assertNull(field(plugin, "pendingUserApiCall"));
        assertEquals(1, current.rejects);
    }

    @Test public void expiredInProcessAuthSettlesExactlyOnce() throws Exception {
        Context app = RuntimeEnvironment.getApplication();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, 0);
        prefs.edit().putString(PENDING_NONCE, "old-nonce")
            .putLong(PENDING_STARTED_AT, System.currentTimeMillis() - LinuxDoUserApiAuth.AUTH_MAX_AGE_MILLIS - 1000L).commit();
        LinuxDoUserApiAuth auth = new LinuxDoUserApiAuth(app);
        final int[] failures = { 0 };
        field(auth, "activeCallback", new LinuxDoUserApiAuth.AuthCallback() {
            @Override public void onPending(String url, int expires) {}
            @Override public void onSuccess(LinuxDoUserApiAuth.Credential credential) {}
            @Override public void onFailure(String code, String message) {
                assertEquals("LINUXDO_USER_API_TIMEOUT", code);
                failures[0]++;
            }
        });
        ((AtomicBoolean) field(auth, "authenticating")).set(true);
        assertFalse(auth.isAuthenticating());
        assertFalse(auth.isAuthenticating());
        assertEquals(1, failures[0]);
        assertFalse(prefs.contains(PENDING_NONCE));
    }

    @Test public void dismissedDialogWithoutOnDismissDoesNotKeepSessionBusy() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", new LinuxDoUserApiAuth(activity));
        TrackingCall pending = new TrackingCall("verification");
        field(plugin, "pendingCall", pending);
        field(plugin, "dialog", new Dialog(activity)); // Android already removed this window
        Method reconcile = LinuxDoSessionPlugin.class.getDeclaredMethod("releaseDismissedDialog");
        reconcile.setAccessible(true);
        reconcile.invoke(plugin);
        assertNull(field(plugin, "pendingCall"));
        assertNull(field(plugin, "dialog"));
        assertEquals("LINUXDO_SESSION_CANCELLED", pending.rejectedCode);
        assertEquals(1, pending.rejects);
    }

    @Test public void visibleDialogIsNotDiscardedByStaleWindowReconciliation() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", new LinuxDoUserApiAuth(activity));
        TrackingCall pending = new TrackingCall("active-verification");
        Dialog visible = new Dialog(activity);
        visible.show();
        field(plugin, "pendingCall", pending);
        field(plugin, "dialog", visible);
        Method reconcile = LinuxDoSessionPlugin.class.getDeclaredMethod("releaseDismissedDialog");
        reconcile.setAccessible(true);
        reconcile.invoke(plugin);
        assertSame(visible, field(plugin, "dialog"));
        assertSame(pending, field(plugin, "pendingCall"));
        assertEquals(0, pending.rejects);
        Method finish = LinuxDoSessionPlugin.class.getDeclaredMethod("finishDialog");
        finish.setAccessible(true);
        finish.invoke(plugin);
        assertNull(field(plugin, "dialog"));
    }

    @Test public void successfulRedirectIntoOtpExchangeSurvivesResume() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", new LinuxDoUserApiAuth(activity));
        TrackingCall pending = new TrackingCall("otp");
        field(plugin, "pendingUserApiCall", pending);
        field(plugin, "pendingOtpCredential", new LinuxDoUserApiAuth.Credential(
            "temporary-key", "client", 3, "", "abcd1234", System.currentTimeMillis()));
        field(plugin, "userApiBrowserBackgrounded", true);
        plugin.handleOnResume();
        shadowOf(Looper.getMainLooper()).idleFor(500, TimeUnit.MILLISECONDS);
        assertSame(pending, field(plugin, "pendingUserApiCall"));
        assertEquals(0, pending.rejects);
    }

    @Test public void socialLoginHandoffReleasesEmbeddedDialogBeforeStartingBrowserAuth() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", new LinuxDoUserApiAuth(activity));
        TrackingCall original = new TrackingCall("original-verification");
        Dialog embedded = new Dialog(activity);
        embedded.show();
        field(plugin, "pendingCall", original);
        field(plugin, "dialog", embedded);
        field(plugin, "verificationOnly", true);
        Method handoff = LinuxDoSessionPlugin.class.getDeclaredMethod(
            "handoffToSystemAuthentication", Dialog.class);
        handoff.setAccessible(true);
        handoff.invoke(plugin, embedded);
        assertNull("the embedded WebView must not retain the original request", field(plugin, "pendingCall"));
        assertNull("the embedded Dialog must not block the Custom Tab", field(plugin, "dialog"));
        assertFalse(embedded.isShowing());
        assertNotEquals("LINUXDO_SESSION_CANCELLED", original.rejectedCode);
        assertNotEquals("LINUXDO_USER_API_BUSY", original.rejectedCode);
        // Robolectric cannot emulate AndroidKeyStore/Chrome Custom Tabs end to end.
        // It either reaches a live browser wait or reports the platform crypto
        // initialization failure; it must never reject the original as BUSY.
        assertTrue(field(plugin, "pendingUserApiCall") == original || original.rejectedCode != null);
    }

    @Test public void browserOauthHandoffKeepsTheVerificationResultContract() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", new LinuxDoUserApiAuth(activity));
        TrackingCall verification = new TrackingCall("verify");
        field(plugin, "pendingUserApiCall", verification);
        field(plugin, "userApiChallengeHandoff", true);
        Method resolve = LinuxDoSessionPlugin.class.getDeclaredMethod(
            "resolveSnapshot", PluginCall.class, boolean.class, String.class, String.class, JSONObject.class);
        resolve.setAccessible(true);
        resolve.invoke(plugin, verification, true, "cookie", "userAgent",
            new JSONObject("{\"id\":33,\"username\":\"test-user\"}"));
        assertNotNull(verification.resolved);
        assertTrue(verification.resolved.optBoolean("completed"));
        assertFalse(verification.resolved.has("authenticated"));
        assertNull(field(plugin, "pendingUserApiCall"));
        assertFalse((Boolean) field(plugin, "userApiChallengeHandoff"));
    }

    @Test public void browserOauthHandoffKeepsTheAccountLoginResultContract() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", new LinuxDoUserApiAuth(activity));
        TrackingCall login = new TrackingCall("login");
        field(plugin, "pendingUserApiCall", login);
        field(plugin, "userApiChallengeHandoff", false);
        Method resolve = LinuxDoSessionPlugin.class.getDeclaredMethod(
            "resolveSnapshot", PluginCall.class, boolean.class, String.class, String.class, JSONObject.class);
        resolve.setAccessible(true);
        resolve.invoke(plugin, login, true, "cookie", "userAgent",
            new JSONObject("{\"id\":34,\"username\":\"test-user\"}"));
        assertNotNull(login.resolved);
        assertTrue(login.resolved.optBoolean("authenticated"));
        assertEquals("browser-session", login.resolved.optString("authMode"));
        assertFalse(login.resolved.has("completed"));
    }

    @Test public void resumingBeforeAnyExternalBrowserDoesNotCancelPendingAuth() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        field(plugin, "userApiAuth", new LinuxDoUserApiAuth(activity));
        TrackingCall waiting = new TrackingCall("pending");
        field(plugin, "pendingUserApiCall", waiting);
        plugin.handleOnResume();
        shadowOf(Looper.getMainLooper()).idleFor(500, TimeUnit.MILLISECONDS);
        assertSame(waiting, field(plugin, "pendingUserApiCall"));
        assertEquals(0, waiting.rejects);
    }
}
