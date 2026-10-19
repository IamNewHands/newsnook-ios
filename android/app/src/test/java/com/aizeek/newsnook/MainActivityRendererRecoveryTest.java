package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.Context;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.FrameLayout;
import com.getcapacitor.WebViewListener;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class MainActivityRendererRecoveryTest {
    public static class RecoveryActivity extends MainActivity {
        int recreations;

        @Override public void recreate() {
            recreations++;
        }
    }

    private static class TrackingWebView extends WebView {
        final List<Runnable> animationCallbacks = new ArrayList<>();
        int destroyCalls;
        int javascriptCalls;
        int callsAfterDestroy;
        boolean destroyed;

        TrackingWebView(Context context) {
            super(context);
        }

        @Override public void evaluateJavascript(String script, ValueCallback<String> callback) {
            if (destroyed) callsAfterDestroy++;
            javascriptCalls++;
        }

        @Override public void postOnAnimation(Runnable action) {
            animationCallbacks.add(action);
        }

        @Override public void removeAllViews() {
            if (destroyed) callsAfterDestroy++;
            super.removeAllViews();
        }

        @Override public void resumeTimers() {
            if (destroyed) callsAfterDestroy++;
            super.resumeTimers();
        }

        @Override public void destroy() {
            assertNull("remove the failed WebView from its parent before destroy", getParent());
            if (destroyed) callsAfterDestroy++;
            destroyCalls++;
            super.destroy();
            destroyed = true;
        }
    }

    private static WebViewListener listener(MainActivity activity) throws Exception {
        Field field = MainActivity.class.getDeclaredField("mainWebViewListener");
        field.setAccessible(true);
        return (WebViewListener) field.get(activity);
    }

    private static void injectInsets(MainActivity activity) throws Exception {
        Method method = MainActivity.class.getDeclaredMethod("injectNativeInsets");
        method.setAccessible(true);
        method.invoke(activity);
    }

    private static final RenderProcessGoneDetail CRASH = new RenderProcessGoneDetail() {
        @Override public boolean didCrash() { return true; }
        @Override public int rendererPriorityAtExit() { return WebView.RENDERER_PRIORITY_BOUND; }
    };

    @Test public void crashedMainViewIsDestroyedOnceAndActivityRecreatedWithoutClearingPreferences() throws Exception {
        // Do not create a real Capacitor Bridge: its native message infrastructure is
        // outside Robolectric. Exercise the Activity's real listener and disposal path.
        RecoveryActivity activity = Robolectric.buildActivity(RecoveryActivity.class).get();
        TrackingWebView webView = new TrackingWebView(activity);
        FrameLayout host = new FrameLayout(activity);
        host.addView(webView);
        WebViewListener listener = listener(activity);
        listener.onPageStarted(webView);
        activity.getSharedPreferences("main-renderer-recovery-test", Context.MODE_PRIVATE)
            .edit().putString("theme", "ink").putString("bookmark", "https://example.org").commit();

        assertTrue("the main renderer failure must be handled", listener.onRenderProcessGone(webView, CRASH));
        assertNull(webView.getParent());
        assertEquals(1, webView.destroyCalls);
        assertNull("BridgeActivity must not destroy the retired WebView again", activity.getBridge());
        assertEquals("recreation happens after the renderer callback returns", 0, activity.recreations);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, activity.recreations);
        assertEquals("ink", activity.getSharedPreferences("main-renderer-recovery-test", Context.MODE_PRIVATE)
            .getString("theme", null));
        assertEquals("https://example.org", activity.getSharedPreferences("main-renderer-recovery-test", Context.MODE_PRIVATE)
            .getString("bookmark", null));

        assertTrue(listener.onRenderProcessGone(webView, CRASH));
        activity.onDetachedFromWindow();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("duplicate callbacks must not recreate twice", 1, activity.recreations);
        assertEquals("detach must not destroy an already destroyed WebView", 1, webView.destroyCalls);
        assertEquals(0, webView.callsAfterDestroy);
    }

    @Test public void delayedInsetsAndVisibleCallbacksCannotTouchRetiredMainView() throws Exception {
        RecoveryActivity activity = Robolectric.buildActivity(RecoveryActivity.class).get();
        TrackingWebView webView = new TrackingWebView(activity);
        FrameLayout host = new FrameLayout(activity);
        host.addView(webView);
        WebViewListener listener = listener(activity);
        listener.onPageStarted(webView);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        int before = webView.javascriptCalls;
        injectInsets(activity);
        listener.onPageCommitVisible(webView, "https://localhost");

        assertTrue(listener.onRenderProcessGone(webView, CRASH));
        for (Runnable callback : new ArrayList<>(webView.animationCallbacks)) callback.run();
        listener.onPageStarted(webView);
        listener.onPageCommitVisible(webView, "https://localhost");
        injectInsets(activity);
        Shadows.shadowOf(Looper.getMainLooper()).idle();

        assertEquals("insets and native-visible work must be canceled or rejected", before, webView.javascriptCalls);
        assertEquals(0, webView.callsAfterDestroy);
        assertEquals(1, webView.destroyCalls);
    }

    @Test public void mainListenerDoesNotDisposeAnUnrelatedWebView() throws Exception {
        RecoveryActivity activity = Robolectric.buildActivity(RecoveryActivity.class).get();
        TrackingWebView main = new TrackingWebView(activity);
        TrackingWebView unrelated = new TrackingWebView(activity);
        WebViewListener listener = listener(activity);
        listener.onPageStarted(main);

        assertFalse("each WebView owner handles only its own instance", listener.onRenderProcessGone(unrelated, CRASH));
        assertEquals(0, main.destroyCalls);
        assertEquals(0, unrelated.destroyCalls);
        assertEquals(0, activity.recreations);
    }
}
