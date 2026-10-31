package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real provider integration. Run only on the workflow's new, disposable emulator. */
@RunWith(AndroidJUnit4.class)
public class BrowserAgentWebViewTest {
    private static final String MAIN = "https://agent-main.test/index.html";
    private static final String CHILD = "https://agent-child.test/form.html";
    private static final String RUN = "device-agent-run";
    private ActivityScenario<MainActivity> scenario;
    private WebView view;
    private FrameLayout overlay;
    private BrowserAgentRuntime runtime;
    private BrowserAgentInput input;
    private final AtomicBoolean alive = new AtomicBoolean(true);

    @Before public void setUp() throws Exception {
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.content.pm.PackageInfo provider = WebViewCompat.getCurrentWebViewPackage(context);
        String providerName = provider == null ? "missing provider" : provider.packageName + "/" + provider.versionName;
        assertTrue("This gate requires DOCUMENT_START_SCRIPT; provider=" + providerName,
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT));
        assertTrue("This gate requires WEB_MESSAGE_LISTENER; provider=" + providerName,
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
        String source;
        try (InputStream asset = context.getAssets().open("browser-agent.js"); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[4096]; int count;
            while ((count = asset.read(chunk)) != -1) bytes.write(chunk, 0, count);
            source = bytes.toString(StandardCharsets.UTF_8.name());
        }
        CountDownLatch loaded = new CountDownLatch(1), drawn = new CountDownLatch(1);
        scenario = ActivityScenario.launch(MainActivity.class);
        scenario.onActivity(activity -> {
            overlay = new FrameLayout(activity);
            view = new WebView(activity);
            view.getSettings().setJavaScriptEnabled(true);
            view.getSettings().setAllowFileAccess(false);
            view.getSettings().setAllowContentAccess(false);
            view.getSettings().setSupportZoom(false);
            view.setWebChromeClient(new WebChromeClient());
            runtime = new BrowserAgentRuntime(view, source, alive::get);
            input = new BrowserAgentInput(view);
            view.setWebViewClient(new WebViewClient() {
                @Override public void onPageStarted(WebView web, String url, android.graphics.Bitmap favicon) { runtime.onPageStarted(url); }
                @Override public void onPageFinished(WebView web, String url) { if (MAIN.equals(url)) loaded.countDown(); }
                @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    String html = MAIN.equals(url) ? mainHtml() : CHILD.equals(url) ? childHtml() : "";
                    // Every request from this test WebView is handled locally, including unknown URLs.
                    return new WebResourceResponse("text/html", "UTF-8", html.isEmpty() ? 404 : 200,
                        html.isEmpty() ? "Not Found" : "OK", Collections.singletonMap("Cache-Control", "no-store"),
                        new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                }
            });
            view.getViewTreeObserver().addOnDrawListener(drawn::countDown);
            overlay.addView(view, new FrameLayout.LayoutParams(-1, -1));
            activity.addContentView(overlay, new ViewGroup.LayoutParams(-1, -1));
            view.loadUrl(MAIN);
        });
        assertTrue("the local fixture must load", loaded.await(15, TimeUnit.SECONDS));
        awaitTrue("window.fixtureReady === true && innerWidth > 0 && innerHeight > 0");
        assertTrue("the provider must draw the visible WebView", drawn.await(10, TimeUnit.SECONDS));
    }

    @After public void tearDown() {
        alive.set(false);
        if (scenario != null) {
            scenario.onActivity(activity -> {
                if (input != null) input.cancel(true);
                if (runtime != null) runtime.close(true);
                if (overlay != null && overlay.getParent() instanceof ViewGroup)
                    ((ViewGroup) overlay.getParent()).removeView(overlay);
                if (view != null) view.destroy();
            });
            scenario.close();
        }
    }

    @Test public void documentStartRoutesCrossOriginFramesAndPreservesClosedShadowMode() throws Exception {
        JSONObject observation = observe();
        assertTrue(observation.getJSONObject("capabilities").getBoolean("crossOriginFrames"));
        assertNotNull("document-start capture finds an imperative closed root", element(observation, "Closed action"));
        assertNotNull("ordinary open roots are included", element(observation, "Open action"));
        assertEquals(Boolean.TRUE, evaluate("document.getElementById('closed-host').shadowRoot === null"));
        assertEquals("the page's same-origin policy must remain enforced", Boolean.TRUE, evaluate(
            "(function(){try{return !document.querySelector('iframe').contentWindow.document}catch(e){return true}})()"));
        JSONObject child = frame(observation, CHILD);
        assertNotNull("the cross-origin frame is observed through its own native-bound port", child);
        assertEquals("https://agent-child.test", child.getString("origin"));
        JSONObject target = element(child, "Cross-frame value"); assertNotNull(target);
        JSONObject action = new JSONObject().put("action", "type").put("snapshot", child.getString("snapshot"))
            .put("id", target.getInt("id")).put("text", "frame route verified");
        JSONObject result = frameAction(child, action);
        assertTrue(result.toString(), result.optBoolean("ok"));
        JSONObject updated = frame(observe(), CHILD); assertNotNull(updated);
        assertEquals("frame route verified", element(updated, "Cross-frame value").getString("value"));
    }

    @Test public void nativeCanvasInputIsTrustedAndCancellationEndsThePointerStream() throws Exception {
        JSONObject area = (JSONObject) evaluate("(function(){var r=document.getElementById('board').getBoundingClientRect();"
            + "return {x:r.left,y:r.top,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()");
        AtomicReference<Rect> bounds = new AtomicReference<>();
        onMain(() -> bounds.set(new Rect(0, 0, view.getWidth(), view.getHeight())));
        double sx = bounds.get().width() / area.getDouble("viewportWidth"), sy = bounds.get().height() / area.getDouble("viewportHeight");
        double left = area.getDouble("x") * sx, top = area.getDouble("y") * sy;
        double width = area.getDouble("width") * sx, height = area.getDouble("height") * sy;
        JSONArray contacts = new JSONArray()
            .put(contact(0, left + width * .25, top + height * .3, left + width * .65, top + height * .65))
            .put(contact(3, left + width * .75, top + height * .7, left + width * .35, top + height * .35));
        perform(new JSONObject().put("kind", "touch").put("contacts", contacts), bounds.get());
        awaitTrue("window.recorded.filter(function(e){return e.type==='pointerup'}).length === 2");
        JSONArray recorded = (JSONArray) evaluate("window.recorded");
        java.util.Set<Integer> pointers = new java.util.HashSet<>();
        for (int index = 0; index < recorded.length(); index++) {
            JSONObject event = recorded.getJSONObject(index);
            assertTrue("native Canvas events must pass through the real browser input pipeline", event.getBoolean("trusted"));
            if ("pointerdown".equals(event.getString("type"))) pointers.add(event.getInt("pointerId"));
        }
        assertEquals("two independently moving contacts reach Canvas", 2, pointers.size());
        assertEquals(Boolean.TRUE, evaluate("window.recorded.some(function(e){return e.type==='pointermove'})"));
        evaluate("window.recorded=[]");
        JSONObject drag = new JSONObject().put("kind", "drag").put("durationMs", 800).put("points", new JSONArray()
            .put(new JSONObject().put("x", left + width * .2).put("y", top + height * .45))
            .put(new JSONObject().put("x", left + width * .8).put("y", top + height * .55)));
        AtomicBoolean allowed = new AtomicBoolean(true), succeeded = new AtomicBoolean(false);
        AtomicReference<String> inputError = new AtomicReference<>();
        CountDownLatch cancelled = new CountDownLatch(1);
        onMain(() -> {
            input.perform(drag, bounds.get(), allowed::get, () -> succeeded.set(true), inputError::set);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                allowed.set(false); input.cancel(true); cancelled.countDown();
            }, 120);
        });
        assertTrue(cancelled.await(3, TimeUnit.SECONDS));
        assertNull(inputError.get());
        awaitTrue("window.recorded.some(function(e){return e.type==='pointercancel'})");
        int afterCancel = ((JSONArray) evaluate("window.recorded")).length();
        SystemClock.sleep(1_000); // Longer than the cancelled stream's remaining scheduled samples.
        assertFalse(succeeded.get());
        assertEquals(afterCancel, ((JSONArray) evaluate("window.recorded")).length());
        assertEquals(Boolean.TRUE, evaluate("window.recorded.every(function(e){return e.trusted && e.type!=='pointerup'})"));
    }

    private JSONObject observe() throws Exception {
        AtomicReference<JSONObject> result = new AtomicReference<>(); AtomicReference<String> error = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        onMain(() -> runtime.observe(RUN, "observe-" + UUID.randomUUID(), 1,
            value -> { result.set(value); done.countDown(); }, value -> { error.set(value); done.countDown(); }));
        assertTrue("frame observation must settle", done.await(12, TimeUnit.SECONDS));
        assertNull(error.get()); assertNotNull(result.get()); return result.get();
    }

    private JSONObject frameAction(JSONObject frame, JSONObject args) throws Exception {
        AtomicReference<JSONObject> result = new AtomicReference<>(); AtomicReference<String> error = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        onMain(() -> runtime.executeFrame(RUN, "action-" + UUID.randomUUID(), frame.optString("frameId"), frame.optString("documentId"), args,
            value -> { result.set(value); done.countDown(); }, value -> { error.set(value); done.countDown(); }));
        assertTrue(done.await(12, TimeUnit.SECONDS)); assertNull(error.get()); assertNotNull(result.get()); return result.get();
    }

    private void perform(JSONObject gesture, Rect bounds) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> error = new AtomicReference<>();
        onMain(() -> input.perform(gesture, bounds, alive::get, done::countDown, value -> { error.set(value); done.countDown(); }));
        assertTrue(done.await(5, TimeUnit.SECONDS)); assertNull(error.get());
    }

    private Object evaluate(String expression) throws Exception {
        AtomicReference<String> encoded = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        onMain(() -> view.evaluateJavascript(expression, value -> { encoded.set(value); done.countDown(); }));
        assertTrue("fixture JavaScript must respond", done.await(5, TimeUnit.SECONDS));
        return new JSONTokener(encoded.get()).nextValue();
    }

    private void awaitTrue(String expression) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 10_000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (Boolean.TRUE.equals(evaluate(expression))) return;
            SystemClock.sleep(50);
        }
        fail("fixture condition timed out: " + expression);
    }

    private static void onMain(Runnable action) { InstrumentationRegistry.getInstrumentation().runOnMainSync(action); }
    private static JSONObject contact(int id, double x1, double y1, double x2, double y2) throws Exception {
        return new JSONObject().put("id", id).put("points", new JSONArray()
            .put(new JSONObject().put("x", x1).put("y", y1).put("timeMs", 0))
            .put(new JSONObject().put("x", x2).put("y", y2).put("timeMs", 320)));
    }
    private static JSONObject element(JSONObject observation, String text) {
        JSONArray elements = observation.optJSONArray("elements");
        for (int index = 0; elements != null && index < elements.length(); index++) {
            JSONObject element = elements.optJSONObject(index);
            if (element != null && text.equals(element.optString("text"))) return element;
        }
        return null;
    }
    private static JSONObject frame(JSONObject observation, String url) {
        JSONArray frames = observation.optJSONArray("frames");
        for (int index = 0; frames != null && index < frames.length(); index++) {
            JSONObject frame = frames.optJSONObject(index);
            if (frame != null && url.equals(frame.optString("url"))) return frame;
        }
        return null;
    }
    private static String childHtml() {
        return "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<label>Cross-frame value<input aria-label='Cross-frame value'></label>";
    }
    private static String mainHtml() {
        return "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1,user-scalable=no'>"
            + "<title>Local Agent fixture</title><style>body{margin:0;padding:12px;font:16px sans-serif}"
            + "iframe{display:block;width:100%;height:64px;border:0;margin:8px 0}"
            + "canvas{display:block;width:100%;height:180px;max-height:35vh;touch-action:none;background:#eee}</style>"
            + "<div id='open-host'></div><div id='closed-host'></div><iframe src='" + CHILD + "'></iframe>"
            + "<canvas id='board' width='600' height='300' aria-label='Canvas gesture board'></canvas><script>"
            + "document.getElementById('open-host').attachShadow({mode:'open'}).innerHTML='<button>Open action</button>';"
            + "document.getElementById('closed-host').attachShadow({mode:'closed'}).innerHTML='<button>Closed action</button>';"
            + "window.recorded=[];var c=document.getElementById('board'),ctx=c.getContext('2d');"
            + "['pointerdown','pointermove','pointerup','pointercancel'].forEach(function(type){c.addEventListener(type,function(e){"
            + "recorded.push({type:e.type,trusted:e.isTrusted,pointerId:e.pointerId});"
            + "if(e.type==='pointerdown')c.setPointerCapture(e.pointerId);"
            + "ctx.fillStyle='#164e63';ctx.fillRect(e.offsetX*600/c.clientWidth,e.offsetY*300/c.clientHeight,8,8);e.preventDefault();})});"
            + "window.addEventListener('load',function(){window.fixtureReady=true});</script>";
    }
}
