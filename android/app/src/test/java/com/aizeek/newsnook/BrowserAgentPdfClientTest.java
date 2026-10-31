package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Binder;
import android.os.Looper;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

/** Exercises client failure/cancellation without claiming to emulate Android's isolated process. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserAgentPdfClientTest {
    private FixtureContext context;
    private BrowserAgentPdfClient client;
    private File source;
    private ExecutorService worker;

    private static final class FixtureContext extends ContextWrapper {
        ServiceConnection connection;
        Intent intent;
        String instance;
        int binds, unbinds;
        boolean permitted = true;
        FixtureContext(Context base) { super(base); }
        @Override public Context getApplicationContext() { return this; }
        @Override public boolean bindService(Intent value, ServiceConnection callback, int flags) {
            intent = value; connection = callback; binds++; return permitted;
        }
        @Override public boolean bindIsolatedService(Intent value, int flags, String name, Executor executor,
                                                      ServiceConnection callback) {
            instance = name; return bindService(value, callback, flags);
        }
        @Override public void unbindService(ServiceConnection callback) {
            assertSame(connection, callback); unbinds++;
        }
    }

    @Before public void setUp() throws Exception {
        context = new FixtureContext(RuntimeEnvironment.getApplication());
        client = new BrowserAgentPdfClient(context, 0);
        source = File.createTempFile("pdf-client-", ".pdf", context.getCacheDir());
        try (FileOutputStream output = new FileOutputStream(source)) { output.write(new byte[] {'%', 'P', 'D', 'F'}); }
        worker = Executors.newSingleThreadExecutor();
    }

    @After public void tearDown() throws Exception {
        if (client != null) client.cancel();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        if (worker != null) { worker.shutdownNow(); worker.awaitTermination(2, TimeUnit.SECONDS); }
        if (source != null) source.delete();
    }

    @Test public void cancellingBeforeServiceConnectionUnbindsOnceAndSettlesTheWaitingRead() throws Exception {
        Future<String> outcome = readFailure();
        await(() -> context.binds == 1);
        assertNotNull(context.instance);
        assertTrue(context.instance.length() > 20);
        client.cancel(); client.cancel();
        await(outcome::isDone);
        assertTrue(outcome.get(), outcome.get().contains("取消"));
        assertEquals(1, context.unbinds);
        // A queued callback after unbind cannot resurrect a cancelled render or send its FDs.
        context.connection.onServiceConnected(context.intent.getComponent(), new Binder());
        context.connection.onServiceDisconnected(context.intent.getComponent());
        assertEquals(1, context.binds);
        assertEquals(1, context.unbinds);
    }

    @Test @Config(sdk = 28) public void olderAndroidUsesTheSamePrivateServiceWithoutAnUnavailableApi() throws Exception {
        Future<String> outcome = readFailure();
        await(() -> context.binds == 1);
        assertNull(context.instance);
        assertEquals("com.aizeek.newsnook.BrowserAgentPdfService", context.intent.getComponent().getClassName());
        client.cancel(); await(outcome::isDone);
        assertTrue(outcome.get().contains("取消"));
        assertEquals(1, context.unbinds);
    }

    @Test public void unexpectedServiceDeathWakesTheReaderAndDoesNotRebindAnAbandonedJob() throws Exception {
        Future<String> outcome = readFailure();
        await(() -> context.binds == 1);
        context.connection.onServiceDisconnected(new ComponentName(context, BrowserAgentPdfService.class));
        await(outcome::isDone);
        assertTrue(outcome.get(), outcome.get().contains("中断"));
        assertEquals(1, context.unbinds);
        assertEquals(1, context.binds);
    }

    @Test public void deniedBindingFailsWithoutWaitingForTheOuterFileTimeout() throws Exception {
        context.permitted = false;
        Future<String> outcome = readFailure();
        await(outcome::isDone);
        assertTrue(outcome.get(), outcome.get().contains("隔离"));
        assertEquals(1, context.binds);
        // Android requires the failed binding registration to be released as well.
        assertEquals(1, context.unbinds);
    }

    @Test public void pipePayloadMustMatchItsBoundedDeclaredLength() throws Exception {
        byte[] body = {1, 2, 3, 4};
        assertArrayEquals(body, BrowserAgentPdfClient.readPayload(new ByteArrayInputStream(body), body.length, () -> {}));
        for (int size : new int[] {0, -1, BrowserAgentFilePreview.MAX_JPEG_BYTES + 1, 3, 5}) {
            try {
                BrowserAgentPdfClient.readPayload(new ByteArrayInputStream(body), size, () -> {});
                fail("Invalid/truncated/oversized output must be rejected: " + size);
            } catch (IOException expected) { assertFalse(expected.getMessage().isEmpty()); }
        }
    }

    @Test public void replyMetadataCannotOverrideTheRequestedPageOrPixelBudget() throws Exception {
        Bundle valid = metadata(300, 400, 0, 2, 1024);
        BrowserAgentPdfClient.validateMetadata(valid, 0);
        for (Bundle invalid : new Bundle[] {
                metadata(1601, 1, 0, 2, 1024), metadata(1600, 1600, 0, 2, 1024),
                metadata(0, 400, 0, 2, 1024), metadata(300, 400, 1, 2, 1024),
                metadata(300, 400, 0, 0, 1024), metadata(300, 400, 0, 2, 2 * 1024 * 1024)
        }) {
            try { BrowserAgentPdfClient.validateMetadata(invalid, 0); fail("Untrusted IPC metadata was accepted"); }
            catch (IOException expected) { assertFalse(expected.getMessage().isEmpty()); }
        }
    }

    private Future<String> readFailure() {
        return worker.submit(() -> {
            try { client.render(source, () -> {}); return "unexpected success"; }
            catch (IOException expected) { return expected.getMessage(); }
        });
    }

    private static Bundle metadata(int width, int height, int page, int pages, int size) {
        Bundle value = new Bundle(); value.putInt("width", width); value.putInt("height", height);
        value.putInt("page", page); value.putInt("pageCount", pages); value.putInt("size", size); return value;
    }

    private static void await(BooleanSupplier ready) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (!ready.getAsBoolean() && System.nanoTime() < end) {
            Shadows.shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(5);
        }
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertTrue("Asynchronous client operation did not settle", ready.getAsBoolean());
    }
}
