package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.Intent;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import android.content.pm.ActivityInfo;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs against an actual Android System WebView, not Robolectric's WebView stub. */
@RunWith(AndroidJUnit4.class)
public class MainWebViewFullscreenInstrumentedTest {
    @Test public void trustedHtmlClickRequestsBrowserFullscreenAndActuallyOpensNativeOverlay() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent launch = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(launch);
        instrumentation.waitForIdleSync();
        WebView webView = activity.getBridge().getWebView();
        assertNotNull(webView);
        int priorOrientation = activity.getRequestedOrientation();
        CountDownLatch initialized = new CountDownLatch(1);
        AtomicReference<String> setup = new AtomicReference<>();
        try {
            instrumentation.runOnMainSync(() -> webView.evaluateJavascript(
                "(function(){" +
                    "var layer=document.createElement('div');layer.id='__native_fullscreen_test__';" +
                    "layer.style.cssText='position:fixed;inset:0;z-index:2147483000;background:#151515';" +
                    "var button=document.createElement('button');button.id='__native_fullscreen_button__';" +
                    "button.textContent='Full screen';" +
                    "button.style.cssText='position:absolute;inset:0;width:100%;height:100%;';" +
                    "button.addEventListener('click',function(){" +
                    "layer.requestFullscreen().catch(function(e){document.title='fullscreen-error-'+e.name})" +
                    "});layer.appendChild(button);document.body.appendChild(layer);return 'ready'" +
                    "})()", value -> { setup.set(value); initialized.countDown(); }));
            assertTrue("the app must finish creating the test button", initialized.await(8, TimeUnit.SECONDS));
            assertEquals("\"ready\"", setup.get());
            int[] origin = new int[2];
            webView.getLocationOnScreen(origin);
            float centerX = origin[0] + webView.getWidth() / 2f;
            float centerY = origin[1] + webView.getHeight() / 2f;
            long downAt = SystemClock.uptimeMillis();
            MotionEvent down = MotionEvent.obtain(downAt, downAt, MotionEvent.ACTION_DOWN, centerX, centerY, 0);
            down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            instrumentation.sendPointerSync(down);
            down.recycle();
            MotionEvent up = MotionEvent.obtain(downAt, downAt + 60, MotionEvent.ACTION_UP, centerX, centerY, 0);
            up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            instrumentation.sendPointerSync(up);
            up.recycle();
            boolean reachedNativeFullscreen = false;
            for (int attempt = 0; attempt < 25; attempt++) {
                if (activity.getRequestedOrientation() == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE) {
                    reachedNativeFullscreen = true;
                    break;
                }
                SystemClock.sleep(120);
            }
            assertTrue("HTML requestFullscreen from a real touch must reach WebChromeClient", reachedNativeFullscreen);
            instrumentation.runOnMainSync(() -> {
                assertNotNull(webView.getWebChromeClient());
                webView.getWebChromeClient().onHideCustomView();
            });
            assertEquals(priorOrientation, activity.getRequestedOrientation());
        } finally {
            instrumentation.runOnMainSync(() -> {
                webView.evaluateJavascript("document.getElementById('__native_fullscreen_test__')?.remove()", null);
                activity.finish();
            });
        }
    }

    @Test public void nativeJavascriptFallbackEntersAndExitsImmersiveLandscape() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent launch = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(launch);
        instrumentation.waitForIdleSync();
        WebView page = activity.getBridge().getWebView();
        assertNotNull(page);
        int originalOrientation = activity.getRequestedOrientation();
        CountDownLatch invoked = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        try {
            instrumentation.runOnMainSync(() -> page.evaluateJavascript(
                "(function(){if(!window.NewsNookNative || !window.NewsNookNative.setEmbeddedVideoFullscreen)return 'missing';window.NewsNookNative.setEmbeddedVideoFullscreen(true);return 'called'})()",
                value -> {result.set(value); invoked.countDown();}));
            assertTrue(invoked.await(8, TimeUnit.SECONDS));
            assertEquals("\"called\"", result.get());
            boolean landscape = false;
            for (int attempt = 0; attempt < 25; attempt++) {
                if (activity.getRequestedOrientation() == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE) {
                    landscape = true;
                    break;
                }
                SystemClock.sleep(100);
            }
            assertTrue("fallback JS bridge must lock landscape orientation", landscape);
            instrumentation.runOnMainSync(() -> page.evaluateJavascript(
                "window.NewsNookNative.setEmbeddedVideoFullscreen(false)", null));
            boolean restored = false;
            for (int attempt = 0; attempt < 25; attempt++) {
                if (activity.getRequestedOrientation() == originalOrientation) {
                    restored = true;
                    break;
                }
                SystemClock.sleep(100);
            }
            assertTrue("fallback exit must restore original orientation", restored);
        } finally {
            instrumentation.runOnMainSync(() -> {
                page.evaluateJavascript("window.NewsNookNative?.setEmbeddedVideoFullscreen(false)", null);
                activity.finish();
            });
        }
    }

    @Test public void bilibiliStyleFullscreenRequestIsHostedByMainWebView() {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent launch = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(launch);
        assertNotNull(activity);
        instrumentation.waitForIdleSync();
        try {
            instrumentation.runOnMainSync(() -> {
                WebView page = activity.getBridge().getWebView();
                assertNotNull(page);
                WebChromeClient chrome = page.getWebChromeClient();
                assertTrue(chrome instanceof NewsNookWebChromeClient);
                assertTrue(chrome instanceof BridgeWebChromeClient);
                FrameLayout content = activity.findViewById(android.R.id.content);
                int count = content.getChildCount();
                int previous = activity.getRequestedOrientation();
                View video = new View(activity);
                AtomicInteger hidden = new AtomicInteger();
                chrome.onShowCustomView(video, hidden::incrementAndGet);
                assertEquals(count + 1, content.getChildCount());
                ViewGroup overlay = (ViewGroup) video.getParent();
                assertSame(content, overlay.getParent());
                assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, overlay.getLayoutParams().width);
                assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, overlay.getLayoutParams().height);
                assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
                    activity.getRequestedOrientation());
                chrome.onHideCustomView();
                assertEquals(count, content.getChildCount());
                assertEquals(previous, activity.getRequestedOrientation());
                assertNull(video.getParent());
                assertEquals(1, hidden.get());
            });
        } finally {
            instrumentation.runOnMainSync(activity::finish);
        }
    }
}
