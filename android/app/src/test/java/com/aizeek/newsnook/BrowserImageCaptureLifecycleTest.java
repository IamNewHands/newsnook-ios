package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Random;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserImageCaptureLifecycleTest {
    private static final String PAGE = "https://news.example/article?session=page";
    private static final class DeferredWebView extends WebView {
        ValueCallback<String> pending;
        String script = "";
        int reads;
        DeferredWebView(Context context) { super(context); }
        @Override public void evaluateJavascript(String source, ValueCallback<String> callback) {
            script = source;
            if (callback != null) { pending = callback; reads++; }
        }
    }

    private static String scanResult(String script, String pageUrl, String imageUrl) throws Exception {
        Matcher match = Pattern.compile("var scanId = \"([^\"]+)\"").matcher(script);
        assertTrue("scanner injects a fresh opaque scan generation", match.find());
        JSONArray images = new JSONArray();
        if (imageUrl != null) images.put(new JSONObject()
            .put("id", match.group(1) + "-0").put("sourceUrl", imageUrl).put("pageUrl", pageUrl)
            .put("alt", "fixture").put("width", 800).put("height", 600).put("content", true)
            .put("transport", "http").put("kinds", new JSONArray().put("img")));
        return JSONObject.quote(new JSONObject().put("pageUrl", pageUrl).put("items", images)
            .put("truncated", false).put("inaccessibleFrames", 0).toString());
    }

    @Test public void manualScanDoesNotInstallPageClickHooksOrStartAutomaticPolling() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        BrowserImageCapture capture = new BrowserImageCapture(view, 7, PAGE);
        List<JSONObject> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        try {
            assertEquals(0, view.reads);
            capture.scan("first", results::add, errors::add);
            assertEquals(1, view.reads);
            assertFalse(view.script.contains("addEventListener"));
            view.pending.onReceiveValue(scanResult(view.script, PAGE, "https://cdn.example/image.jpg?signature=kept"));
            assertEquals(1, results.size());
            JSONObject payload = results.get(0);
            assertEquals(7, payload.getInt("tabId"));
            assertFalse(payload.getString("documentId").isEmpty());
            assertEquals("first", payload.getString("requestId"));
            JSONObject image = payload.getJSONArray("items").getJSONObject(0);
            assertEquals("https://cdn.example/image.jpg?signature=kept", image.getString("sourceUrl"));
            assertEquals("https://news.example/", image.getJSONObject("requestHeaders").getString("Referer"));
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(10, TimeUnit.SECONDS);
            assertEquals("one user action causes exactly one metadata scan", 1, view.reads);
            assertTrue(errors.isEmpty());
        } finally { capture.close(); view.destroy(); }
    }

    @Test public void sameUrlReloadRejectsRetiredScanAndCreatesANewDocumentGeneration() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        BrowserImageCapture capture = new BrowserImageCapture(view, 7, PAGE);
        List<JSONObject> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        try {
            capture.scan("before", results::add, errors::add);
            view.pending.onReceiveValue(scanResult(view.script, PAGE, "https://cdn.example/one.jpg"));
            String originalDocument = results.get(0).getString("documentId");
            capture.scan("pending-old", results::add, errors::add);
            ValueCallback<String> retired = view.pending;
            String retiredScript = view.script;
            capture.onPageStarted(PAGE);
            retired.onReceiveValue(scanResult(retiredScript, PAGE, "https://cdn.example/stale.jpg"));
            assertEquals(1, results.size());
            assertEquals("图片读取已取消", errors.get(0));
            capture.scan("after", results::add, errors::add);
            view.pending.onReceiveValue(scanResult(view.script, PAGE, "https://cdn.example/new.jpg"));
            assertEquals(2, results.size());
            assertNotEquals(originalDocument, results.get(1).getString("documentId"));
            List<String> imageErrors = new ArrayList<>();
            capture.load(originalDocument, "stale-load", "old-image", false, false, results::add, imageErrors::add);
            assertEquals("网页已变化，请重新扫描", imageErrors.get(0));
        } finally { capture.close(); view.destroy(); }
    }

    @Test public void timeoutAndRendererGoneAlwaysSettleAndIgnoreLateScanCallbacks() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        BrowserImageCapture capture = new BrowserImageCapture(view, 2, PAGE);
        List<JSONObject> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        capture.scan("slow", results::add, errors::add);
        ValueCallback<String> slow = view.pending;
        String slowScript = view.script;
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(7, TimeUnit.SECONDS);
        assertEquals(1, errors.size());
        assertTrue(errors.get(0).contains("超时"));
        slow.onReceiveValue(scanResult(slowScript, PAGE, "https://cdn.example/late.jpg"));
        assertTrue(results.isEmpty());
        capture.scan("closing", results::add, errors::add);
        ValueCallback<String> closing = view.pending;
        String closingScript = view.script;
        int reads = view.reads;
        capture.close(false);
        closing.onReceiveValue(scanResult(closingScript, PAGE, "https://cdn.example/closed.jpg"));
        capture.scan("after-close", results::add, errors::add);
        assertEquals(reads, view.reads);
        assertTrue(results.isEmpty());
        assertTrue(errors.contains("图片读取已取消"));
        assertTrue(errors.contains("网页已关闭"));
        view.destroy();
    }

    @Test public void explicitCancellationMatchesRequestAndDocumentIdentity() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        BrowserImageCapture capture = new BrowserImageCapture(view, 2, PAGE);
        List<JSONObject> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        try {
            capture.scan("keep", results::add, errors::add);
            capture.cancel("other-document", null);
            capture.cancel(null, "other-request");
            assertTrue(errors.isEmpty());
            view.pending.onReceiveValue(scanResult(view.script, PAGE, null));
            assertEquals(1, results.size());
            capture.scan("cancel", results::add, errors::add);
            ValueCallback<String> retired = view.pending;
            String retiredScript = view.script;
            capture.cancel(results.get(0).getString("documentId"), "cancel");
            retired.onReceiveValue(scanResult(retiredScript, PAGE, "https://cdn.example/late.jpg"));
            assertEquals(1, results.size());
            assertEquals(1, errors.size());
        } finally { capture.close(); view.destroy(); }
    }

    @Test public void redirectHeadersKeepObservedContextButNeverLeakAuthorizationAcrossOrigins() {
        Map<String, String> captured = new LinkedHashMap<>();
        captured.put("referer", PAGE);
        captured.put("user-agent", "Original Tab UA");
        captured.put("authorization", "Bearer fixture");
        Map<String, String> initial = BrowserImageCapture.headersFor("https://cdn.example/image.jpg",
            "https://cdn.example/image.jpg", PAGE, captured, "Fallback UA", "cdnCookie=one");
        assertEquals(PAGE, initial.get("referer"));
        assertEquals("Original Tab UA", initial.get("user-agent"));
        assertEquals("Bearer fixture", initial.get("authorization"));
        assertEquals("cdnCookie=one", initial.get("Cookie"));
        Map<String, String> redirected = BrowserImageCapture.headersFor("https://other.example/image.jpg",
            "https://cdn.example/image.jpg", PAGE, captured, "Fallback UA", "targetCookie=two");
        assertFalse(redirected.containsKey("authorization"));
        assertEquals("targetCookie=two", redirected.get("Cookie"));
        assertEquals("https://news.example/", redirected.get("Referer"));
        assertFalse(redirected.values().contains(PAGE));
        Map<String, String> noReferrer = BrowserImageCapture.headersFor("https://cdn.example/image.jpg",
            "https://cdn.example/image.jpg", PAGE, new LinkedHashMap<>(), "Tab UA", null);
        assertFalse("an observed no-referrer image remains no-referrer", noReferrer.containsKey("Referer"));
    }

    @Test public void displayReadsReuseSourceBytesAlreadyDownloadedForThumbnails() {
        BrowserImageCapture.SourceCache cache = new BrowserImageCapture.SourceCache();
        cache.put("https://cdn.example/one.jpg", new BrowserImageCapture.Bytes(new byte[5 * 1024 * 1024], "image/jpeg"));
        cache.put("https://cdn.example/two.jpg", new BrowserImageCapture.Bytes(new byte[5 * 1024 * 1024], "image/jpeg"));
        BrowserImageCapture.Bytes active = cache.get("https://cdn.example/one.jpg");
        assertNotNull("a second read of the same url is served from memory", active);
        active.release();
        cache.put("https://cdn.example/three.jpg", new BrowserImageCapture.Bytes(new byte[5 * 1024 * 1024], "image/jpeg"));
        assertNull("the memory budget evicts the least recently USED source", cache.get("https://cdn.example/two.jpg"));
        BrowserImageCapture.Bytes one = cache.get("https://cdn.example/one.jpg");
        BrowserImageCapture.Bytes three = cache.get("https://cdn.example/three.jpg");
        assertNotNull(one); assertNotNull(three);
        one.release(); three.release();
        BrowserImageCapture.SourceCache page = new BrowserImageCapture.SourceCache();
        for (int index = 0; index < 25; index++)
            page.put("https://cdn.example/p" + index + ".jpg", new BrowserImageCapture.Bytes(new byte[1024], "image/jpeg"));
        assertNull("the entry budget evicts the oldest sources first", page.get("https://cdn.example/p0.jpg"));
        assertNotNull(page.get("https://cdn.example/p24.jpg"));
    }

    @Test public void sampledDecodeRespectsPixelBudgetBeforeAllocatingBitmap() {
        assertEquals(1, BrowserImageCapture.sampleSize(800, 600, 2560, 2_560_000L));
        for (int[] dimensions : new int[][] {{9000, 9000}, {100000, 40000}, {200000, 200000}, {600, 200000}}) {
            int sample = BrowserImageCapture.sampleSize(dimensions[0], dimensions[1], 2560, 2_560_000L);
            assertTrue(sample > 1);
            assertTrue(dimensions[0] / sample <= 2560);
            assertTrue(dimensions[1] / sample <= 2560);
            assertTrue((long) (dimensions[0] / sample) * (dimensions[1] / sample) <= 2_560_000L);
        }
    }

    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    @Test public void sevenMegabytePngDecodesToBoundedPreviewWithoutRejectingSource() throws Exception {
        // Generate the high-entropy >6MB original in this test; do not commit a huge binary fixture.
        File source = File.createTempFile("browser-original-", ".png", RuntimeEnvironment.getApplication().getCacheDir());
        Bitmap image = Bitmap.createBitmap(1700, 1700, Bitmap.Config.ARGB_8888);
        int[] pixels = new int[1700 * 1700];
        Random random = new Random(51491);
        for (int index = 0; index < pixels.length; index++) pixels[index] = 0xff000000 | random.nextInt(0x1000000);
        image.setPixels(pixels, 0, 1700, 0, 0, 1700, 1700);
        try {
            try (FileOutputStream output = new FileOutputStream(source)) {
                assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, output));
            }
            assertTrue("source must reproduce the original >6MB bug", source.length() > 6L * 1024 * 1024);
            Method method = BrowserImageCapture.class.getDeclaredMethod("encode", BrowserImageCapture.Bytes.class, boolean.class);
            method.setAccessible(true);
            Object result = method.invoke(null, new BrowserImageCapture.Bytes(source, "image/png"), false);
            Field value = result.getClass().getDeclaredField("value");
            Field width = result.getClass().getDeclaredField("width");
            Field height = result.getClass().getDeclaredField("height");
            value.setAccessible(true); width.setAccessible(true); height.setAccessible(true);
            assertTrue("only a bounded preview crosses the bridge", ((byte[]) value.get(result)).length <= 2 * 1024 * 1024);
            assertTrue((int) width.get(result) <= 2560);
            assertTrue((int) height.get(result) <= 2560);
        } finally {
            image.recycle();
            source.delete();
        }
    }

    @Test public void oversizedSixMegabyteSourceCanBeStreamedWithoutHeapBuffer() throws Exception {
        final long[] written = {0};
        OutputStream sink = new OutputStream() {
            @Override public void write(int value) { written[0]++; }
            @Override public void write(byte[] bytes, int offset, int length) { written[0] += length; }
        };
        InputStream generated = new InputStream() {
            int remaining = 7 * 1024 * 1024 + 123;
            @Override public int read() { if (remaining == 0) return -1; remaining--; return 0x31; }
            @Override public int read(byte[] dest, int offset, int length) {
                if (remaining == 0) return -1;
                int chunk = Math.min(remaining, length);
                Arrays.fill(dest, offset, offset + chunk, (byte) 0x31);
                remaining -= chunk;
                return chunk;
            }
        };
        long count = BrowserImageCapture.spoolBounded(generated, sink, 128L * 1024 * 1024);
        assertTrue(count > 6L * 1024 * 1024);
        assertEquals(count, written[0]);
        try {
            BrowserImageCapture.spoolBounded(new ByteArrayInputStream(new byte[8193]), sink, 8192);
            fail("oversized streams must still reject at the protective source budget");
        } catch (IOException expected) { assertTrue(expected.getMessage().contains("过大")); }
    }

    @Test public void diskSourceCacheEvictsFilesButKeepsBorrowedSourcesAlive() throws Exception {
        File directory = RuntimeEnvironment.getApplication().getCacheDir();
        BrowserImageCapture.SourceCache cache = new BrowserImageCapture.SourceCache();
        File[] files = new File[3];
        BrowserImageCapture.Bytes borrowed = null;
        try {
            for (int index = 0; index < files.length; index++) {
                files[index] = File.createTempFile("browser-large-", ".jpg", directory);
                try (FileOutputStream output = new FileOutputStream(files[index])) {
                    byte[] block = new byte[16 * 1024];
                    for (int n = 0; n < 15 * 1024 * 1024 / block.length; n++) output.write(block);
                }
                BrowserImageCapture.Bytes bytes = new BrowserImageCapture.Bytes(files[index], "image/jpeg");
                cache.put("large-" + index, bytes);
                bytes.release();
                if (index == 0) borrowed = cache.get("large-0");
            }
            assertNull(cache.get("large-0"));
            assertTrue("borrowed file must survive LRU eviction", files[0].exists());
            BrowserImageCapture.Bytes second = cache.get("large-1");
            BrowserImageCapture.Bytes third = cache.get("large-2");
            assertNotNull(second); assertNotNull(third);
            second.release(); third.release();
            cache.discard("large-1");
            assertFalse("explicit export can transfer source ownership without making another disk copy", files[1].exists());
        } finally {
            if (borrowed != null) borrowed.release();
            cache.clear();
        }
        for (File file : files) assertFalse("cache and borrowed references must be released", file.exists());
    }

    @Test public void boundedReaderRejectsAnOversizedStreamBeforeReturningBytes() throws Exception {
        assertArrayEquals(new byte[] {1, 2, 3}, BrowserImageCapture.readBounded(new ByteArrayInputStream(new byte[] {1, 2, 3}), 3));
        try {
            BrowserImageCapture.readBounded(new ByteArrayInputStream(new byte[4]), 3);
            fail("overflow must reject");
        } catch (IOException expected) { assertTrue(expected.getMessage().contains("超过")); }
    }
}
