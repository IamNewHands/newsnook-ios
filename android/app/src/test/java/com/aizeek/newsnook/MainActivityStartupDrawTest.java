package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.Context;
import android.os.Looper;
import android.view.ViewTreeObserver;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import com.getcapacitor.WebViewListener;
import java.lang.reflect.Field;
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
public class MainActivityStartupDrawTest {
    public static class StartupActivity extends MainActivity {
        int drawnReports;
        int recreations;
        boolean failNextReport;

        // Initialize the real AppCompat lifecycle while excluding Capacitor's
        // renderer message infrastructure, which requires an Android device.
        @Override protected void load() {}
        @Override public void reportFullyDrawn() {
            if (failNextReport) {
                failNextReport = false;
                throw new IllegalStateException("framework report temporarily unavailable");
            }
            drawnReports++;
        }
        @Override public void recreate() { recreations++; }
    }

    private static final class StartupWebView extends WebView {
        final List<VisualStateCallback> visualCallbacks = new ArrayList<>();
        final List<Runnable> animationCallbacks = new ArrayList<>();
        boolean attached = true;
        boolean shown = true;
        boolean retired;
        boolean failNextVisualRequest;
        int callsAfterRetirement;

        StartupWebView(Context context) {
            super(context);
            // WebView delegates layout to its renderer; the host test has no renderer.
            // Give the real View bounds explicitly so the visibility guard stays meaningful.
            setLeft(0);
            setTop(0);
            setRight(320);
            setBottom(640);
            assertEquals(320, getWidth());
            assertEquals(640, getHeight());
        }

        @Override public boolean isAttachedToWindow() { return attached; }
        @Override public boolean isShown() { return shown; }
        @Override public int getWindowVisibility() { return android.view.View.VISIBLE; }
        @Override public String getUrl() { return "https://localhost/"; }
        @Override public void evaluateJavascript(String script, ValueCallback<String> callback) {
            if (retired) callsAfterRetirement++;
        }
        @Override public void postOnAnimation(Runnable action) { animationCallbacks.add(action); }
        @Override public void postVisualStateCallback(long requestId, VisualStateCallback callback) {
            if (retired) callsAfterRetirement++;
            if (failNextVisualRequest) {
                failNextVisualRequest = false;
                throw new IllegalStateException("visual request temporarily unavailable");
            }
            visualCallbacks.add(callback);
        }
        @Override public void destroy() {
            super.destroy();
            retired = true;
            attached = false;
        }
    }

    private static final class Launch {
        final StartupActivity activity = Robolectric.buildActivity(StartupActivity.class).create().start().get();
        final StartupWebView webView = new StartupWebView(activity);
        final WebViewListener listener;

        Launch() throws Exception {
            listener = (WebViewListener) field(activity, "mainWebViewListener");
            listener.onPageStarted(webView);
            activity.onResume();
            Shadows.shadowOf(Looper.getMainLooper()).idle();
        }

        void commitAndSignal() {
            listener.onPageCommitVisible(webView, "https://localhost/");
            activity.notifyFirstUiPaintFromConsole();
        }

        void visualReady() {
            assertFalse("native must request a visual-state acknowledgement", webView.visualCallbacks.isEmpty());
            webView.visualCallbacks.get(webView.visualCallbacks.size() - 1).onComplete(0);
        }

        void draw() {
            webView.getViewTreeObserver().dispatchOnDraw();
            Shadows.shadowOf(Looper.getMainLooper()).idle();
        }
    }

    private static Object field(Object instance, String name) throws Exception {
        Field field = MainActivity.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(instance);
    }

    @Test public void documentCommitAndJsFrameDoNotReportBeforeNativeVisualStateAndDraw() throws Exception {
        Launch launch = new Launch();
        launch.commitAndSignal();
        assertEquals("a JS callback is not a native WebView draw", 0, launch.activity.drawnReports);
        launch.draw();
        assertEquals("draws before the visual acknowledgement cannot finish startup", 0, launch.activity.drawnReports);
        launch.visualReady();
        assertEquals("visual acknowledgement promises the next draw; it is not the draw", 0, launch.activity.drawnReports);
        launch.draw();
        assertEquals(1, launch.activity.drawnReports);
        launch.activity.notifyFirstUiPaintFromConsole();
        launch.draw();
        assertEquals("duplicate transports and draws report only once", 1, launch.activity.drawnReports);
    }

    @Test public void osReportBelongsToTheDrawingFrameWhileReadinessWaitsForDrawCompletion() throws Exception {
        Launch launch = new Launch();
        launch.commitAndSignal();
        launch.visualReady();
        assertEquals(0, launch.activity.drawnReports);
        launch.webView.getViewTreeObserver().dispatchOnDraw();
        // AndroidX ends TTFD at the frame containing or following this call.
        // Posting the OS call after this frame can select a later user-input frame.
        assertEquals("OS reporting must belong to this verified content draw", 1, launch.activity.drawnReports);
        assertEquals("the external readiness marker must still wait for draw completion", false,
            field(launch.activity, "fullyDrawnReported"));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(true, field(launch.activity, "fullyDrawnReported"));
        assertEquals(1, launch.activity.drawnReports);
    }

    @Test public void hiddenOrDetachedWebViewCannotFinishStartup() throws Exception {
        Launch launch = new Launch();
        launch.commitAndSignal();
        launch.visualReady();
        launch.webView.shown = false;
        launch.draw();
        assertEquals(0, launch.activity.drawnReports);
        launch.webView.shown = true;
        launch.webView.attached = false;
        launch.draw();
        assertEquals(0, launch.activity.drawnReports);
        launch.webView.attached = true;
        launch.draw();
        assertEquals(1, launch.activity.drawnReports);
    }

    @Test public void splashTimeoutReleasesOnlyTheSplashWithoutClaimingDocumentReady() throws Exception {
        Launch launch = new Launch();
        ((Runnable) field(launch.activity, "releaseLaunchSplash")).run();
        launch.activity.notifyFirstUiPaintFromConsole();
        launch.draw();
        assertEquals("splash recovery must not invent a committed document", false,
            field(launch.activity, "webContentReady"));
        assertEquals(0, launch.activity.drawnReports);
        assertTrue(launch.webView.visualCallbacks.isEmpty());
        launch.listener.onPageCommitVisible(launch.webView, "https://localhost/");
        launch.visualReady();
        launch.draw();
        assertEquals(1, launch.activity.drawnReports);
    }

    @Test public void newNavigationInvalidatesTheOldVisualAcknowledgement() throws Exception {
        Launch launch = new Launch();
        launch.commitAndSignal();
        WebView.VisualStateCallback stale = launch.webView.visualCallbacks.get(0);
        launch.listener.onPageStarted(launch.webView);
        stale.onComplete(0);
        launch.draw();
        assertEquals(0, launch.activity.drawnReports);
        launch.commitAndSignal();
        launch.visualReady();
        launch.draw();
        assertEquals(1, launch.activity.drawnReports);
    }

    @Test public void pausingAfterDrawCancelsPostedReadinessWithoutRepeatingTheOsReport() throws Exception {
        Launch launch = new Launch();
        launch.commitAndSignal();
        launch.visualReady();
        launch.webView.getViewTreeObserver().dispatchOnDraw();
        launch.activity.onPause();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("the OS signal was attached to the already-started draw", 1, launch.activity.drawnReports);
        assertEquals("pausing must cancel the stale ready confirmation", false,
            field(launch.activity, "fullyDrawnReported"));
        launch.activity.onResume();
        launch.visualReady();
        launch.draw();
        assertEquals(1, launch.activity.drawnReports);
    }

    @Test public void retiredRendererCannotReportOrReceiveDelayedStartupWork() throws Exception {
        Launch launch = new Launch();
        launch.commitAndSignal();
        WebView.VisualStateCallback stale = launch.webView.visualCallbacks.get(0);
        launch.visualReady();
        ViewTreeObserver oldObserver = launch.webView.getViewTreeObserver();
        oldObserver.dispatchOnDraw();
        assertTrue(launch.listener.onRenderProcessGone(launch.webView, new RenderProcessGoneDetail() {
            @Override public boolean didCrash() { return true; }
            @Override public int rendererPriorityAtExit() { return WebView.RENDERER_PRIORITY_BOUND; }
        }));
        stale.onComplete(0);
        if (oldObserver.isAlive()) oldObserver.dispatchOnDraw();
        for (Runnable callback : launch.webView.animationCallbacks) callback.run();
        launch.activity.notifyFirstUiPaintFromConsole();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("retirement must not send any additional OS report", 1, launch.activity.drawnReports);
        assertEquals("the retired frame must not publish readiness", false,
            field(launch.activity, "fullyDrawnReported"));
        assertEquals(0, launch.webView.callsAfterRetirement);
        assertEquals(1, launch.activity.recreations);
    }

    @Test public void failedVisualRequestDoesNotLatchStartupAsPendingOrComplete() throws Exception {
        Launch launch = new Launch();
        launch.webView.failNextVisualRequest = true;
        launch.commitAndSignal();
        launch.draw();
        assertEquals(0, launch.activity.drawnReports);
        assertTrue(launch.webView.visualCallbacks.isEmpty());
        launch.activity.notifyFirstUiPaintFromConsole();
        launch.visualReady();
        launch.draw();
        assertEquals(1, launch.activity.drawnReports);
    }

    @Test public void failedFrameworkReportRetriesOnResumeWithoutClaimingReady() throws Exception {
        Launch launch = new Launch();
        launch.activity.failNextReport = true;
        launch.commitAndSignal();
        launch.visualReady();
        launch.draw();
        assertEquals(0, launch.activity.drawnReports);
        assertNull(launch.webView.getContentDescription());
        launch.activity.onPause();
        launch.activity.onResume();
        launch.visualReady();
        launch.draw();
        assertEquals(1, launch.activity.drawnReports);
    }

    @Test public void activityDestructionInvalidatesQueuedReadinessAfterTheOsFrameSignal() throws Exception {
        Launch launch = new Launch();
        launch.commitAndSignal();
        launch.visualReady();
        launch.webView.getViewTreeObserver().dispatchOnDraw();
        launch.activity.onDestroy();
        launch.activity.notifyFirstUiPaintFromConsole();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, launch.activity.drawnReports);
        assertEquals(false, field(launch.activity, "fullyDrawnReported"));
    }

    @Test public void productionLaunchDoesNotExposeATechnicalAccessibilityLabel() throws Exception {
        if (BuildConfig.STARTUP_BENCHMARK) return;
        Launch launch = new Launch();
        launch.commitAndSignal();
        launch.visualReady();
        launch.draw();
        assertNull(launch.webView.getContentDescription());
        assertNull(launch.activity.findViewById(android.R.id.content).getContentDescription());
    }
}
