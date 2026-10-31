package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.pdf.PdfDocument;
import android.os.Environment;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Requires an Android device: Robolectric 4.14 has no PdfRenderer native bridge. */
@RunWith(AndroidJUnit4.class)
public class BrowserAgentFilesVisualTest {
    private FixtureContext context;
    private BrowserAgentFiles files;
    private File fixture;

    private static final class FixtureContext extends ContextWrapper {
        final String suffix = UUID.randomUUID().toString();
        FixtureContext(Context base) { super(base); }
        @Override public Context getApplicationContext() { return this; }
        @Override public SharedPreferences getSharedPreferences(String name, int mode) {
            return super.getSharedPreferences(name + "_" + suffix, mode);
        }
        @Override public File getCacheDir() {
            File directory = new File(super.getCacheDir(), "agent-test-" + suffix);
            directory.mkdirs(); return directory;
        }
        @Override public File getExternalFilesDir(String type) {
            File directory = new File(super.getExternalFilesDir(type), "agent-test-" + suffix);
            directory.mkdirs(); return directory;
        }
    }

    @Before public void setUp() throws Exception {
        context = new FixtureContext(InstrumentationRegistry.getInstrumentation().getTargetContext());
        File directory = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "browser-agent");
        assertTrue(directory.mkdirs() || directory.isDirectory());
        fixture = new File(directory, "pages.pdf");
        PdfDocument document = new PdfDocument();
        try (FileOutputStream output = new FileOutputStream(fixture)) {
            PdfDocument.Page first = document.startPage(new PdfDocument.PageInfo.Builder(300, 400, 1).create());
            first.getCanvas().drawColor(Color.RED); document.finishPage(first);
            PdfDocument.Page second = document.startPage(new PdfDocument.PageInfo.Builder(400, 300, 2).create());
            second.getCanvas().drawColor(Color.BLUE); document.finishPage(second);
            document.writeTo(output);
        } finally { document.close(); }
        JSONObject record = new JSONObject().put("fileId", "fixture-pdf").put("name", "pages.pdf")
            .put("mime", "application/pdf").put("status", "ready").put("source", "download")
            .put("transport", "native-http").put("ownedPath", fixture.getAbsolutePath())
            .put("size", fixture.length()).put("runId", "run-one").put("tabId", 7)
            .put("documentId", "doc-one").put("persistent", true);
        context.getSharedPreferences("newsnook_browser_agent_files", Context.MODE_PRIVATE).edit()
            .putString("registry", new JSONObject().put("version", 1).put("files", new JSONArray().put(record)).toString()).commit();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> files = new BrowserAgentFiles(context, new BrowserAgentFiles.Host() {
            @Override public Activity getActivity() { return null; }
            @Override public boolean isDocumentLive(int tabId, String documentId) { return tabId == 7 && "doc-one".equals(documentId); }
            @Override public void onEvent(JSONObject event) {}
            @Override public void launchChooser(String requestId, Intent intent) { throw new AssertionError("picker not expected"); }
        }));
    }

    @After public void tearDown() {
        if (files != null) InstrumentationRegistry.getInstrumentation().runOnMainSync(files::close);
        if (context != null) {
            context.getSharedPreferences("newsnook_browser_agent_files", Context.MODE_PRIVATE).edit().clear().commit();
            deleteFixture(context.getCacheDir());
            deleteFixture(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS));
        }
    }

    @Test public void pdfRendersOnlyTheRequestedPageWithActualPixelsAndPageCount() throws Exception {
        JSONObject result = read(new JSONObject().put("fileId", "fixture-pdf").put("page", 1), null);
        assertEquals(1, result.getInt("page"));
        assertEquals(2, result.getInt("pageCount"));
        assertEquals("application/pdf", result.getString("sourceMime"));
        assertEquals("image/jpeg", result.getString("mime"));
        assertTrue(result.getInt("width") > result.getInt("height"));
        assertTrue(result.getInt("width") <= 1600 && result.getInt("height") <= 1600);
        assertTrue((long) result.getInt("width") * result.getInt("height") <= 1_920_000);
        assertRenderedColor(result, Color.BLUE);
        assertNoStaging();
    }

    @Test public void pdfDefaultsToPageZeroAndRejectsAnOutOfRangePage() throws Exception {
        JSONObject first = read(new JSONObject().put("fileId", "fixture-pdf"), null);
        assertEquals(0, first.getInt("page"));
        assertRenderedColor(first, Color.RED);
        read(new JSONObject().put("fileId", "fixture-pdf").put("page", 2), "页码");
        assertNoStaging();
    }

    @Test public void pdfUsesARealIsolatedUidAndCancellationTerminatesItsBinderBeforeTheNextJob() throws Exception {
        String id = "pdf_" + UUID.randomUUID().toString().replace("-", "");
        Handler main = new Handler(Looper.getMainLooper());
        CountDownLatch connected = new CountDownLatch(1), died = new CountDownLatch(1), rendered = new CountDownLatch(1);
        AtomicReference<IBinder> binder = new AtomicReference<>();
        AtomicReference<Bundle> metadata = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        AtomicInteger senderUid = new AtomicInteger(-1);
        IBinder.DeathRecipient death = died::countDown;
        ServiceConnection connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder value) {
                binder.set(value);
                try { value.linkToDeath(death, 0); }
                catch (android.os.RemoteException failure) { error.set("Worker died before connecting"); }
                connected.countDown();
            }
            @Override public void onServiceDisconnected(ComponentName name) {}
            @Override public void onNullBinding(ComponentName name) {
                error.set("Isolated worker returned a null binder"); connected.countDown();
            }
        };
        Intent intent = new Intent(context, BrowserAgentPdfService.class)
            .setAction("com.aizeek.newsnook.PDF." + id).putExtra(BrowserAgentPdfService.JOB_ID, id);
        ParcelFileDescriptor input = null;
        ParcelFileDescriptor[] pipe = null;
        try {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                boolean accepted = Build.VERSION.SDK_INT >= 29
                    ? context.bindIsolatedService(intent, Context.BIND_AUTO_CREATE, id, main::post, connection)
                    : context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
                assertTrue("The manifest must provide an actual isolated service", accepted);
            });
            assertTrue("Isolated service connected", connected.await(10, TimeUnit.SECONDS));
            assertNull(error.get()); assertNotNull(binder.get());
            Messenger endpoint = new Messenger(binder.get());
            Messenger reply = new Messenger(new Handler(Looper.getMainLooper(), message -> {
                if (message.what == BrowserAgentPdfService.ERROR) error.set(message.getData().getString("error"));
                else if (message.what == BrowserAgentPdfService.RESULT) {
                    metadata.set(new Bundle(message.getData())); senderUid.set(message.sendingUid);
                }
                rendered.countDown(); return true;
            }));
            input = ParcelFileDescriptor.open(fixture, ParcelFileDescriptor.MODE_READ_ONLY);
            pipe = ParcelFileDescriptor.createReliablePipe();
            Bundle request = new Bundle(); request.putString(BrowserAgentPdfService.JOB_ID, id);
            request.putInt("page", 0); request.putParcelable("input", input); request.putParcelable("output", pipe[1]);
            Message message = Message.obtain(null, BrowserAgentPdfService.RENDER);
            message.setData(request); message.replyTo = reply; endpoint.send(message);
            input.close(); input = null; pipe[1].close();
            // Leave the output undrained; cancellation must work independently of data consumption.
            assertTrue("Actual PdfRenderer produced page metadata", rendered.await(12, TimeUnit.SECONDS));
            assertNull(error.get()); assertNotNull(metadata.get());
            assertTrue(senderUid.get() > 0); assertNotEquals(Process.myUid(), senderUid.get());
            int workerPid = metadata.get().getInt("workerPid");
            assertTrue(workerPid > 0); assertNotEquals(Process.myPid(), workerPid);
            if (Build.VERSION.SDK_INT >= 34) assertTrue(Process.isIsolatedUid(senderUid.get()));
            assertEquals(PackageManager.PERMISSION_DENIED,
                context.checkPermission(android.Manifest.permission.INTERNET, workerPid, senderUid.get()));
            Message cancel = Message.obtain(null, BrowserAgentPdfService.CANCEL);
            Bundle cancellation = new Bundle(); cancellation.putString(BrowserAgentPdfService.JOB_ID, id);
            cancel.setData(cancellation); endpoint.send(cancel);
            assertTrue("Cancellation must terminate the actual isolated process", died.await(5, TimeUnit.SECONDS));
            assertFalse(binder.get().isBinderAlive());
        } finally {
            if (input != null) input.close();
            if (pipe != null) { pipe[0].close(); pipe[1].close(); }
            IBinder value = binder.get();
            if (value != null) try { value.unlinkToDeath(death, 0); } catch (RuntimeException ignored) {}
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                try { context.unbindService(connection); } catch (IllegalArgumentException ignored) {}
            });
        }
        // Exercise the production client after cancellation, including the pre-29 serialized path.
        BrowserAgentPdfClient next = new BrowserAgentPdfClient(context, 0);
        try {
            JSONObject result = next.render(fixture, () -> {});
            assertRenderedColor(result, Color.RED);
            assertNotEquals(Process.myUid(), next.workerUid());
            assertNotEquals(Process.myPid(), next.workerPid());
        } finally { next.cancel(); }
    }

    private JSONObject read(JSONObject options, String expectedError) throws Exception {
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> files.readFile(7, "doc-one", "run-one",
            "read-" + UUID.randomUUID(), options, value -> { result.set(value); done.countDown(); },
            value -> { error.set(value); done.countDown(); }));
        assertTrue("file read settles within its timeout", done.await(20, TimeUnit.SECONDS));
        if (expectedError == null) { assertNull(error.get()); assertNotNull(result.get()); }
        else { assertNull(result.get()); assertTrue(error.get(), error.get() != null && error.get().contains(expectedError)); }
        return result.get();
    }

    private static void assertRenderedColor(JSONObject result, int expected) throws Exception {
        byte[] jpeg = Base64.decode(result.getString("image"), Base64.NO_WRAP);
        assertTrue(jpeg.length <= 1024 * 1024);
        Bitmap image = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
        assertNotNull(image);
        try {
            assertEquals(result.getInt("width"), image.getWidth());
            assertEquals(result.getInt("height"), image.getHeight());
            int pixel = image.getPixel(image.getWidth() / 2, image.getHeight() / 2);
            assertTrue(Math.abs(Color.red(pixel) - Color.red(expected)) < 20);
            assertTrue(Math.abs(Color.blue(pixel) - Color.blue(expected)) < 20);
        } finally { image.recycle(); }
    }

    private void assertNoStaging() {
        File[] entries = new File(context.getCacheDir(), "browser-agent-render").listFiles();
        assertTrue(entries == null || entries.length == 0);
    }

    private static void deleteFixture(File entry) {
        File[] children = entry.listFiles();
        if (children != null) for (File child : children) deleteFixture(child);
        entry.delete();
    }
}
