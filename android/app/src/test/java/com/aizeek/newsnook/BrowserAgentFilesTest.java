package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.CookieManager;
import android.util.Base64;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.RandomAccessFile;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowContentResolver;
import org.robolectric.shadows.ShadowDownloadManager;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserAgentFilesTest {
    private Context context;
    private BrowserAgentFiles files;
    private FixtureHost host;
    private FixtureProvider provider;
    private final List<JSONObject> results = new ArrayList<>();
    private final List<String> errors = new ArrayList<>();

    private static final class FixtureHost implements BrowserAgentFiles.Host {
        boolean live = true;
        boolean privateTab;
        Intent launched;
        String chooserId;
        final List<JSONObject> events = new ArrayList<>();
        @Override public Activity getActivity() { return null; }
        @Override public boolean isDocumentLive(int tabId, String documentId) {
            return live && tabId == 7 && "doc-one".equals(documentId);
        }
        @Override public boolean isPrivateTab(int tabId) { return privateTab; }
        @Override public void onEvent(JSONObject event) { events.add(event); }
        @Override public void launchChooser(String requestId, Intent intent) {
            chooserId = requestId;
            launched = intent;
        }
    }

    public static final class FixtureProvider extends ContentProvider {
        final java.util.Map<String, File> bodies = new java.util.HashMap<>();
        final java.util.Map<String, String> types = new java.util.HashMap<>();
        volatile CountDownLatch readStarted, releaseRead;
        @Override public boolean onCreate() { return true; }
        @Override public String getType(Uri uri) { return types.get(uri.getLastPathSegment()); }
        @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
            File file = bodies.get(uri.getLastPathSegment());
            MatrixCursor cursor = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            if (file != null) cursor.addRow(new Object[] {uri.getLastPathSegment(), file.length()});
            return cursor;
        }
        @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws java.io.FileNotFoundException {
            File file = bodies.get(uri.getLastPathSegment());
            if (file == null) throw new java.io.FileNotFoundException();
            CountDownLatch started = readStarted, release = releaseRead;
            if (started != null && release != null) {
                started.countDown();
                try { if (!release.await(5, TimeUnit.SECONDS)) throw new java.io.FileNotFoundException(); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new java.io.FileNotFoundException(); }
            }
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        }
        @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
        @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
        @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
    }

    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences("newsnook_browser_agent_files", Context.MODE_PRIVATE).edit().clear().commit();
        host = new FixtureHost();
        provider = new FixtureProvider();
        ProviderInfo info = new ProviderInfo();
        info.authority = "agent.fixture.files";
        info.exported = true;
        provider.attachInfo(context, info);
        ShadowContentResolver.registerProviderInternal(info.authority, provider);
        files = new BrowserAgentFiles(context, host);
    }

    @After public void tearDown() { files.close(); }

    private Uri document(String name, String mime, byte[] body) throws Exception {
        File file = new File(context.getCacheDir(), "fixture-" + name);
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(body); }
        provider.bodies.put(name, file);
        provider.types.put(name, mime);
        Uri uri = Uri.parse("content://agent.fixture.files/" + name);
        context.grantUriPermission(context.getPackageName(), uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return uri;
    }

    private void choose(JSONObject options) {
        try {
            JSONObject defaults = uploadTarget();
            for (String key : new String[] {"frameId", "frameDocumentId", "snapshot", "id"})
                if (!options.has(key)) options.put(key, defaults.get(key));
        } catch (org.json.JSONException error) { throw new AssertionError(error); }
        files.chooseFiles(7, "doc-one", "run-one", "choose-one", options, results::add, errors::add);
    }

    private static JSONObject uploadTarget() {
        try { return new JSONObject().put("frameId", "main").put("frameDocumentId", "frame-doc-one")
            .put("snapshot", "snapshot-one").put("id", 4); }
        catch (org.json.JSONException error) { throw new AssertionError(error); }
    }

    private void selected(Uri... uris) {
        Intent data = new Intent().addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (uris.length == 1) data.setData(uris[0]);
        else if (uris.length > 1) {
            ClipData clip = new ClipData("files", new String[] {"application/octet-stream"}, new ClipData.Item(uris[0]));
            for (int i = 1; i < uris.length; i++) clip.addItem(new ClipData.Item(uris[i]));
            data.setClipData(clip);
        }
        files.handleChooserResult(host.chooserId, Activity.RESULT_OK, data);
    }

    private static WebChromeClient.FileChooserParams params(int mode, String... accepted) {
        return new WebChromeClient.FileChooserParams() {
            @Override public int getMode() { return mode; }
            @Override public String[] getAcceptTypes() { return accepted; }
            @Override public boolean isCaptureEnabled() { return false; }
            @Override public CharSequence getTitle() { return null; }
            @Override public String getFilenameHint() { return null; }
            @Override public Intent createIntent() { return new Intent(Intent.ACTION_GET_CONTENT); }
        };
    }

    private static void await(BooleanSupplier ready) throws Exception {
        // Robolectric advances System.nanoTime() while draining its paused looper.
        // Use a real sleep/poll budget, otherwise virtual time can expire while a
        // cancelled Windows file stream is still closing on its worker thread.
        for (int attempt = 0; attempt < 1000 && !ready.getAsBoolean(); attempt++) {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            Thread.sleep(5);
        }
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertTrue("asynchronous file operation must settle", ready.getAsBoolean());
    }

    @Test public void selectedFilesAreRegisteredAndDeliveredOnlyToTheArmedDocumentOnce() throws Exception {
        Uri one = document("one.json", "application/json", "{\"ok\":true}".getBytes(StandardCharsets.UTF_8));
        Uri two = document("two.csv", "text/csv", "a,b\n1,2".getBytes(StandardCharsets.UTF_8));
        choose(new JSONObject().put("multiple", true));
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, host.launched.getAction());
        assertTrue(host.launched.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false));
        selected(one, two);
        await(() -> !results.isEmpty() || !errors.isEmpty());
        assertTrue(errors.toString(), errors.isEmpty());
        assertEquals(2, results.get(0).getJSONArray("files").length());
        assertFalse(results.get(0).toString().contains("content://"));
        List<Uri[]> delivered = new ArrayList<>();
        assertFalse(files.supplyArmedFiles(7, "doc-one", "other-run", params(1), delivered::add));
        files.authorizeUploadClick(7, "doc-one", "run-one", uploadTarget());
        assertTrue(files.supplyArmedFiles(7, "doc-one", "run-one", params(1), delivered::add));
        await(() -> !delivered.isEmpty());
        assertArrayEquals(new Uri[] {one, two}, delivered.get(0));
        assertFalse(files.supplyArmedFiles(7, "doc-one", "run-one", params(1), delivered::add));
        assertEquals(1, delivered.size());
    }

    @Test public void aFileSelectionCannotBeConsumedBeforeAMatchingNativeClick() throws Exception {
        choose(new JSONObject());
        selected(document("selected.txt", "text/plain", new byte[] {65}));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        List<Uri[]> delivered = new ArrayList<>();
        assertTrue(files.supplyArmedFiles(7, "doc-one", "run-one", params(0), delivered::add));
        await(() -> !delivered.isEmpty());
        assertNull("an unrelated page chooser cannot claim unconsumed selected files", delivered.get(0));
    }

    @Test public void aDifferentElementFrameDocumentOrSnapshotCannotClaimSelectedFiles() throws Exception {
        choose(new JSONObject()); selected(document("bound.txt", "text/plain", new byte[] {65}));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        String fileId = results.get(0).getJSONArray("files").getJSONObject(0).getString("fileId");
        for (String changed : new String[] {"id", "frameId", "frameDocumentId", "snapshot"}) {
            choose(new JSONObject().put("fileIds", new JSONArray().put(fileId)));
            JSONObject other = uploadTarget().put(changed, "id".equals(changed) ? 5 : "other");
            try {
                files.authorizeUploadClick(7, "doc-one", "run-one", other);
                fail("changed " + changed + " must invalidate upload selection");
            } catch (IllegalStateException expected) { assertTrue(expected.getMessage().contains("上传目标")); }
            assertFalse(files.supplyArmedFiles(7, "doc-one", "run-one", params(0), ignored -> fail("mismatch cannot deliver URIs")));
        }
        assertTrue(errors.toString(), errors.isEmpty());
    }

    @Test public void selectionAndAuthorizedClickWindowsExpireWithoutUploadingLater() throws Exception {
        choose(new JSONObject()); selected(document("expiring.txt", "text/plain", new byte[] {65}));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        String fileId = results.get(0).getJSONArray("files").getJSONObject(0).getString("fileId");
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(16, TimeUnit.SECONDS);
        assertFalse(files.supplyArmedFiles(7, "doc-one", "run-one", params(0), ignored -> fail()));
        choose(new JSONObject().put("fileIds", new JSONArray().put(fileId)));
        files.authorizeUploadClick(7, "doc-one", "run-one", uploadTarget());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(2100, TimeUnit.MILLISECONDS);
        assertFalse(files.supplyArmedFiles(7, "doc-one", "run-one", params(0), ignored -> fail()));
    }

    @Test public void disarmingAlsoCancelsAnAutomaticUploadWhoseProviderIsStillOpening() throws Exception {
        choose(new JSONObject()); selected(document("waiting.txt", "text/plain", new byte[] {65}));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        provider.readStarted = new CountDownLatch(1); provider.releaseRead = new CountDownLatch(1);
        files.authorizeUploadClick(7, "doc-one", "run-one", uploadTarget());
        List<Uri[]> delivered = new ArrayList<>();
        assertTrue(files.supplyArmedFiles(7, "doc-one", "run-one", params(0), delivered::add));
        assertTrue(provider.readStarted.await(5, TimeUnit.SECONDS));
        files.disarmRun("run-one");
        provider.releaseRead.countDown();
        await(() -> !delivered.isEmpty());
        assertEquals(1, delivered.size());
        assertNull(delivered.get(0));
    }

    @Test public void navigationCancelsARealPageChooserAndIgnoresItsLateResult() throws Exception {
        List<Uri[]> delivered = new ArrayList<>();
        assertTrue(files.onShowFileChooser(7, "doc-one", "run-one", params(0), delivered::add));
        String retiredId = host.chooserId;
        files.cancelDocument(7, "doc-one");
        assertEquals(1, delivered.size());
        assertNull(delivered.get(0));
        files.handleChooserResult(retiredId, Activity.RESULT_OK,
            new Intent().setData(document("late.txt", "text/plain", new byte[] {65})));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, delivered.size());
        assertEquals(0, files.list("run-one").getJSONArray("files").length());
    }

    @Test public void brokenPageCallbackCannotInterruptChooserCancellation() {
        int[] calls = {0};
        files.onShowFileChooser(7, "doc-one", "run-one", params(0), ignored -> {
            calls[0]++;
            throw new IllegalStateException("retired web renderer");
        });
        files.cancelDocument(7, "doc-one");
        assertEquals(1, calls[0]);
        choose(new JSONObject());
        assertEquals("choose-one", host.chooserId);
    }

    @Test public void cancellationSettlesOnceWithoutArmingAnyUpload() throws Exception {
        choose(new JSONObject());
        String id = host.chooserId;
        files.handleChooserResult(id, Activity.RESULT_CANCELED, null);
        files.handleChooserResult(id, Activity.RESULT_CANCELED, null);
        assertEquals(1, results.size());
        assertTrue(results.get(0).getBoolean("cancelled"));
        assertFalse(files.supplyArmedFiles(7, "doc-one", "run-one", params(0), ignored -> fail()));
    }

    @Test public void aChangedDocumentCannotReceiveAnAgentPickerResult() throws Exception {
        Uri file = document("late.txt", "text/plain", new byte[] {65});
        choose(new JSONObject());
        host.live = false;
        selected(file);
        await(() -> !results.isEmpty() || !errors.isEmpty());
        assertTrue(results.isEmpty());
        assertTrue(errors.get(0).contains("变化"));
    }

    @Test public void ownAppPrivateUrisCannotBeRegisteredThroughAnUntrustedPicker() throws Exception {
        choose(new JSONObject());
        selected(Uri.parse("content://" + context.getPackageName() + ".fileprovider/private/secrets"));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        assertTrue(results.isEmpty());
        assertEquals(0, files.list("run-one").getJSONArray("files").length());
    }

    @Test public void textReadUsesTheRegisteredCapabilityAndRejectsBinaryAndOversizedStreams() throws Exception {
        String text = "{\"标题\":\"离线资料\"}";
        choose(new JSONObject());
        selected(document("data.json", "application/json", text.getBytes(StandardCharsets.UTF_8)));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        String id = results.get(0).getJSONArray("files").getJSONObject(0).getString("fileId");
        results.clear();
        files.readFile(7, "doc-one", "run-one", "read-one", new JSONObject().put("fileId", id), results::add, errors::add);
        await(() -> !results.isEmpty() || !errors.isEmpty());
        assertTrue(errors.toString(), errors.isEmpty());
        assertEquals(text, results.get(0).getString("text"));
        assertFalse(results.get(0).getBoolean("truncated"));
        try {
            BrowserAgentFiles.readTextBounded(new ByteArrayInputStream(new byte[] {65, 0, 66}), 100);
            fail("binary content cannot masquerade as plain text");
        } catch (IOException expected) { assertTrue(expected.getMessage().contains("二进制")); }
        try {
            BrowserAgentFiles.readTextBounded(new ByteArrayInputStream(new byte[33]), 32);
            fail("size limit must stop the stream");
        } catch (IOException expected) { assertTrue(expected.getMessage().contains("超过")); }
    }

    @Test public void pendingDownloadIdsSurviveRecreationAndFailureIsNeverReportedAsReady() throws Exception {
        JSONObject started = files.enqueueDownload(7, "doc-one", "run-one", "https://files.example/report.csv",
            "fixture-agent", "attachment; filename=report.csv", "text/csv", 9);
        String fileId = started.getString("fileId");
        long downloadId = started.getLong("downloadId");
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        ShadowDownloadManager.ShadowRequest request = Shadows.shadowOf(Shadows.shadowOf(manager).getRequest(downloadId));
        request.setStatus(DownloadManager.STATUS_PAUSED);
        request.setTotalSize(9);
        files.refreshDownloads();
        await(() -> hasStatus(fileId, "paused"));
        files.close();
        files = new BrowserAgentFiles(context, host);
        JSONObject restored = files.list("run-one").getJSONArray("files").getJSONObject(0);
        assertEquals(fileId, restored.getString("fileId"));
        assertEquals(downloadId, restored.getLong("downloadId"));
        assertNotEquals("ready", restored.getString("status"));
        request.setStatus(DownloadManager.STATUS_FAILED);
        files.refreshDownloads();
        await(() -> hasStatus(fileId, "failed"));
        assertFalse(host.events.stream().anyMatch(event -> "download_completed".equals(event.optString("event"))));
    }

    @Test public void cancellingADownloadRemovesTheSystemTaskAndForgettingKeepsSelectedDocuments() throws Exception {
        JSONObject started = files.enqueueDownload(7, "doc-one", "run-one", "https://files.example/report.csv",
            "fixture-agent", "attachment; filename=report.csv", "text/csv", 9);
        String downloadFileId = started.getString("fileId");
        long downloadId = started.getLong("downloadId");
        assertEquals("cancelled", files.cancelFile(downloadFileId).getString("status"));
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        assertNull(Shadows.shadowOf(manager).getRequest(downloadId));
        choose(new JSONObject());
        Uri selected = document("keep.txt", "text/plain", new byte[] {65});
        selected(selected);
        await(() -> !results.isEmpty() || !errors.isEmpty());
        String fileId = results.get(0).getJSONArray("files").getJSONObject(0).getString("fileId");
        assertTrue(files.forgetFile(fileId).getBoolean("forgotten"));
        try (java.io.InputStream input = context.getContentResolver().openInputStream(selected)) {
            assertEquals(65, input.read());
        }
    }

    private boolean hasStatus(String fileId, String status) {
        JSONArray registered = files.list("run-one").optJSONArray("files");
        for (int i = 0; i < registered.length(); i++) {
            JSONObject entry = registered.optJSONObject(i);
            if (fileId.equals(entry.optString("fileId")) && status.equals(entry.optString("status"))) return true;
        }
        return false;
    }

    @Test public void nativeDownloadRedirectsDropOriginalCredentialsAndRejectHttpsDowngrade() {
        assertTrue(BrowserAgentFiles.isAllowedRedirect("https://one.example/export", "https://two.example/file"));
        assertFalse(BrowserAgentFiles.isAllowedRedirect("https://one.example/export", "http://two.example/file"));
        assertFalse(BrowserAgentFiles.isAllowedRedirect("https://one.example/export", "file:///tmp/file"));
        assertFalse(BrowserAgentFiles.isAllowedRedirect("https://one.example/export", "https://user:pass@two.example/file"));
    }

    @Test public void privateSelectionsDoNotBecomePersistentFileHistory() throws Exception {
        host.privateTab = true;
        choose(new JSONObject());
        selected(document("private.txt", "text/plain", new byte[] {65}));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        assertEquals(1, results.get(0).getJSONArray("files").length());
        assertEquals(0, files.list("").getJSONArray("files").length());
        assertEquals(0, files.list("other-run").getJSONArray("files").length());
        files.close();
        files = new BrowserAgentFiles(context, host);
        assertEquals(0, files.list("").getJSONArray("files").length());
    }

    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void imageReadReturnsActualBoundedJpegPixelsWithoutExposingAPath() throws Exception {
        Bitmap source = Bitmap.createBitmap(4000, 2000, Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream encoded = new ByteArrayOutputStream();
        try { source.eraseColor(Color.BLUE); assertTrue(source.compress(Bitmap.CompressFormat.PNG, 100, encoded)); }
        finally { source.recycle(); }
        choose(new JSONObject());
        selected(document("chart.png", "image/png", encoded.toByteArray()));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        String fileId = results.get(0).getJSONArray("files").getJSONObject(0).getString("fileId");
        results.clear();
        files.readFile(7, "doc-one", "run-one", "read-image", new JSONObject().put("fileId", fileId), results::add, errors::add);
        await(() -> !results.isEmpty() || !errors.isEmpty());
        assertTrue(errors.toString(), errors.isEmpty());
        JSONObject result = results.get(0);
        assertEquals("image/jpeg", result.getString("mime"));
        assertEquals("image/png", result.getString("sourceMime"));
        assertEquals(fileId, result.getString("fileId"));
        assertFalse(result.toString().contains("content://"));
        assertFalse(result.toString().contains(context.getCacheDir().getAbsolutePath()));
        byte[] jpeg = Base64.decode(result.getString("image"), Base64.NO_WRAP);
        assertTrue(jpeg.length <= 1024 * 1024);
        Bitmap observed = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
        assertNotNull(observed);
        try {
            assertEquals(result.getInt("width"), observed.getWidth());
            assertEquals(result.getInt("height"), observed.getHeight());
            assertTrue(observed.getWidth() <= 1600 && observed.getHeight() <= 1600);
            assertTrue((long) observed.getWidth() * observed.getHeight() <= 1_920_000);
            assertTrue(observed.getWidth() > observed.getHeight());
            int pixel = observed.getPixel(observed.getWidth() / 2, observed.getHeight() / 2);
            assertTrue(Color.blue(pixel) > 220 && Color.red(pixel) < 30);
        } finally { observed.recycle(); }
        assertRenderStagingEmpty();
    }

    @Test public void visualReadRejectsAnOversizedSourceBeforeDecoding() throws Exception {
        Uri uri = document("too-large.png", "image/png", new byte[] {1});
        try (RandomAccessFile file = new RandomAccessFile(provider.bodies.get("too-large.png"), "rw")) {
            file.setLength(33L * 1024 * 1024);
        }
        choose(new JSONObject()); selected(uri);
        await(() -> !results.isEmpty() || !errors.isEmpty());
        String fileId = results.get(0).getJSONArray("files").getJSONObject(0).getString("fileId");
        results.clear();
        files.readFile(7, "doc-one", "run-one", "large-image", new JSONObject().put("fileId", fileId), results::add, errors::add);
        await(() -> !results.isEmpty() || !errors.isEmpty());
        assertTrue(results.isEmpty());
        assertTrue(errors.toString(), errors.get(0).contains("32 MB"));
        assertRenderStagingEmpty();
    }

    @Test public void cancelledVisualReadCannotDeliverALateImageAndReleasesStaging() throws Exception {
        choose(new JSONObject()); selected(document("slow.png", "image/png", new byte[] {1, 2, 3}));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        String fileId = results.get(0).getJSONArray("files").getJSONObject(0).getString("fileId");
        results.clear();
        provider.readStarted = new CountDownLatch(1); provider.releaseRead = new CountDownLatch(1);
        files.readFile(7, "doc-one", "run-one", "slow-image", new JSONObject().put("fileId", fileId), results::add, errors::add);
        assertTrue(provider.readStarted.await(5, TimeUnit.SECONDS));
        files.cancelDocument(7, "doc-one");
        provider.releaseRead.countDown();
        await(() -> !errors.isEmpty());
        assertTrue(results.isEmpty());
        assertEquals(1, errors.size());
        await(() -> renderStagingCount() == 0);
        assertTrue(results.isEmpty());
    }

    private int renderStagingCount() {
        File[] staging = new File(context.getCacheDir(), "browser-agent-render").listFiles();
        return staging == null ? 0 : staging.length;
    }

    private void assertRenderStagingEmpty() { assertEquals(0, renderStagingCount()); }

    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void highEntropyImageLowersJpegQualityToKeepTheActualTransportBudget() throws Exception {
        int width = 1600, height = 1200;
        Bitmap source = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        int[] pixels = new int[width * height];
        java.util.Random random = new java.util.Random(1281);
        for (int i = 0; i < pixels.length; i++) pixels[i] = 0xff000000 | random.nextInt(0x1000000);
        source.setPixels(pixels, 0, width, 0, 0, width, height);
        ByteArrayOutputStream encoded = new ByteArrayOutputStream();
        try {
            assertTrue(source.compress(Bitmap.CompressFormat.JPEG, 85, encoded));
            assertTrue("fixture must exercise JPEG overflow", encoded.size() > 1024 * 1024);
            encoded.reset();
            assertTrue(source.compress(Bitmap.CompressFormat.PNG, 100, encoded));
        } finally { source.recycle(); }
        choose(new JSONObject()); selected(document("noise.png", "image/png", encoded.toByteArray()));
        await(() -> !results.isEmpty() || !errors.isEmpty());
        String fileId = results.get(0).getJSONArray("files").getJSONObject(0).getString("fileId");
        results.clear();
        files.readFile(7, "doc-one", "run-one", "noise-image", new JSONObject().put("fileId", fileId), results::add, errors::add);
        await(() -> !results.isEmpty() || !errors.isEmpty());
        assertTrue(errors.toString(), errors.isEmpty());
        byte[] jpeg = Base64.decode(results.get(0).getString("image"), Base64.NO_WRAP);
        assertTrue(jpeg.length <= 1024 * 1024);
        Bitmap decoded = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
        assertNotNull(decoded);
        try { assertEquals(width, decoded.getWidth()); assertEquals(height, decoded.getHeight()); }
        finally { decoded.recycle(); }
        assertRenderStagingEmpty();
    }

    private static final class HttpFixture implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0);
        volatile String received = "";
        final Thread thread;
        HttpFixture(String response) throws IOException {
            thread = new Thread(() -> {
                try (Socket socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                    StringBuilder headers = new StringBuilder(); String line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) headers.append(line).append('\n');
                    received = headers.toString();
                    socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
                    socket.getOutputStream().flush();
                } catch (IOException ignored) {}
            }, "AgentFileFixture");
            thread.setDaemon(true); thread.start();
        }
        String url(String hostname) { return "http://" + hostname + ":" + server.getLocalPort() + "/export"; }
        @Override public void close() throws Exception { server.close(); thread.join(1000); }
    }

    @Test public void authenticatedDownloadRecomputesCookiesAfterCrossOriginRedirectAndProducesReadableText() throws Exception {
        try (HttpFixture target = new HttpFixture("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\nConnection: close\r\n\r\nreport")) {
            try (HttpFixture source = new HttpFixture("HTTP/1.1 302 Found\r\nLocation: " + target.url("localhost")
                    + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")) {
                CookieManager.getInstance().setCookie(source.url("127.0.0.1"), "origin_secret=fixture");
                JSONObject started = files.enqueueDownload(7, "doc-one", "run-one", source.url("127.0.0.1"),
                    "fixture-agent", "attachment; filename=report.txt", "text/plain", 6);
                assertEquals("native-http", started.getString("transport"));
                String id = started.getString("fileId");
                await(() -> hasStatus(id, "ready") || hasStatus(id, "failed"));
                assertTrue(host.events.toString(), hasStatus(id, "ready"));
                assertTrue(source.received.contains("origin_secret=fixture"));
                assertFalse(target.received.contains("origin_secret=fixture"));
                files.readFile(7, "doc-one", "run-one", "read-downloaded", new JSONObject().put("fileId", id), results::add, errors::add);
                await(() -> !results.isEmpty() || !errors.isEmpty());
                assertTrue(errors.toString(), errors.isEmpty());
                assertEquals("report", results.get(0).getString("text"));
            }
        }
    }
}
