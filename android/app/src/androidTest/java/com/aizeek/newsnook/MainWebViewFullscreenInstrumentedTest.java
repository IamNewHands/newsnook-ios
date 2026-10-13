package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.Intent;
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
