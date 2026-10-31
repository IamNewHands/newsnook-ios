package com.aizeek.newsnook;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.os.RemoteException;
import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** A single cancellable PDF capability. Call render off the UI thread; cancel is thread-safe. */
final class BrowserAgentPdfClient {
    private static final Semaphore LEGACY_PROCESS = new Semaphore(1);
    private final Context context;
    private final int page;
    private final String id = "pdf_" + UUID.randomUUID().toString().replace("-", "");
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Messenger reply = new Messenger(new Handler(Looper.getMainLooper(), this::receive));
    private final Object lock = new Object();
    private final CountDownLatch metadataReady = new CountDownLatch(1);
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean cleanupComplete = new AtomicBoolean();
    private final AtomicBoolean legacyHeld = new AtomicBoolean();
    private final AtomicBoolean binderDead = new AtomicBoolean();
    private volatile IOException failure;
    private volatile Bundle metadata;
    private volatile IBinder remoteBinder;
    private volatile boolean requestSent;
    private volatile int workerUid = -1, workerPid = -1;
    private Messenger remote;
    private boolean bindingRegistered, cleaned;
    private ParcelFileDescriptor input, outputWriter;
    private InputStream outputReader;

    private final IBinder.DeathRecipient death = () -> {
        binderDead.set(true);
        fail("PDF 隔离进程已中断，请重试");
        releaseLegacyIfSafe();
    };

    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) { connected(binder); }
        @Override public void onServiceDisconnected(ComponentName name) {
            fail("PDF 隔离进程已中断，请重试"); releaseLegacyIfSafe();
        }
        @Override public void onBindingDied(ComponentName name) {
            fail("PDF 隔离服务连接已中断，请重试"); releaseLegacyIfSafe();
        }
        @Override public void onNullBinding(ComponentName name) { fail("PDF 隔离服务无法启动，请重试"); }
    };

    BrowserAgentPdfClient(Context context, int page) {
        this.context = context.getApplicationContext(); this.page = page;
    }

    JSONObject render(File source, BrowserAgentFilePreview.Check check) throws IOException {
        if (Looper.myLooper() == Looper.getMainLooper()) throw new IOException("PDF 预览必须在工作线程执行");
        if (!started.compareAndSet(false, true)) throw new IOException("PDF 预览请求不能重复执行");
        try {
            ensureOpen(); check.check();
            if (Build.VERSION.SDK_INT < 29) {
                if (!LEGACY_PROCESS.tryAcquire(BrowserAgentPdfService.JOB_TIMEOUT_MS, TimeUnit.MILLISECONDS))
                    throw new BrowserAgentFilePreview.PreviewFailure("上次 PDF 隔离进程仍在结束，请重试");
                legacyHeld.set(true); ensureOpen();
            }
            prepareDescriptors(source);
            main.post(this::bind);
            if (!metadataReady.await(BrowserAgentPdfService.JOB_TIMEOUT_MS + 1000, TimeUnit.MILLISECONDS))
                throw new BrowserAgentFilePreview.PreviewFailure("PDF 隔离预览超时，请重试");
            ensureOpen(); check.check();
            Bundle result = metadata;
            validateMetadata(result, page);
            InputStream reader;
            synchronized (lock) { reader = outputReader; }
            if (reader == null) { ensureOpen(); throw new IOException("PDF 图片通道已关闭"); }
            byte[] jpeg = readPayload(reader, result.getInt("size"), () -> { ensureOpen(); check.check(); });
            validateJpegDimensions(jpeg, result.getInt("width"), result.getInt("height"));
            ensureOpen(); check.check();
            JSONObject value = new BrowserAgentFilePreview.EncodedImage(jpeg, jpeg.length,
                result.getInt("width"), result.getInt("height")).toJson();
            put(value, "page", page); put(value, "pageCount", result.getInt("pageCount"));
            return value;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new BrowserAgentFilePreview.PreviewFailure("PDF 预览已取消", error);
        } finally {
            finish(null);
            releaseLegacyIfSafe();
        }
    }

    private void prepareDescriptors(File source) throws IOException {
        ParcelFileDescriptor pdf = null;
        ParcelFileDescriptor[] pipe = null;
        try {
            if (source.length() <= 0 || source.length() > BrowserAgentFilePreview.MAX_INPUT_BYTES)
                throw new BrowserAgentFilePreview.PreviewFailure("PDF 文件为空或超过 32 MB 预览上限");
            pdf = ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY);
            pipe = ParcelFileDescriptor.createReliablePipe();
            synchronized (lock) {
                ensureOpen();
                input = pdf; outputWriter = pipe[1];
                outputReader = new ParcelFileDescriptor.AutoCloseInputStream(pipe[0]);
                pdf = null; pipe = null;
            }
        } finally {
            close(pdf);
            if (pipe != null) { close(pipe[0]); close(pipe[1]); }
        }
    }

    private void bind() {
        if (closed.get()) return;
        Intent intent = new Intent(context, BrowserAgentPdfService.class)
            .setAction("com.aizeek.newsnook.PDF." + id).putExtra(BrowserAgentPdfService.JOB_ID, id);
        bindingRegistered = true;
        try {
            boolean accepted;
            if (Build.VERSION.SDK_INT >= 29)
                accepted = context.bindIsolatedService(intent, Context.BIND_AUTO_CREATE, id, main::post, connection);
            else accepted = context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
            if (!accepted) fail("无法连接 PDF 隔离服务，请重试");
        } catch (RuntimeException error) { fail("无法连接 PDF 隔离服务，请重试"); }
    }

    private void connected(IBinder binder) {
        if (closed.get()) { cleanup(); return; }
        ParcelFileDescriptor pdf = null, writer = null;
        try {
            synchronized (lock) {
                ensureOpen();
                remoteBinder = binder; binder.linkToDeath(death, 0); remote = new Messenger(binder);
                Message message = Message.obtain(null, BrowserAgentPdfService.RENDER);
                Bundle request = new Bundle(); request.putString(BrowserAgentPdfService.JOB_ID, id);
                request.putInt("page", page); request.putParcelable("input", input);
                request.putParcelable("output", outputWriter); message.setData(request); message.replyTo = reply;
                remote.send(message);
                requestSent = true;
                // Binder has duplicated the descriptors for the isolated recipient before send returns.
                pdf = input; input = null; writer = outputWriter; outputWriter = null;
            }
        } catch (Exception error) { fail("PDF 隔离服务连接已中断，请重试"); }
        finally { close(pdf); close(writer); }
    }

    private boolean receive(Message message) {
        if (closed.get()) return true;
        try {
            // sendingUid is supplied by Messenger/Binder, never read from a service-controlled Bundle.
            if (message.sendingUid <= 0 || message.sendingUid == Process.myUid()
                    || message.sendingUid == context.getApplicationInfo().uid) {
                fail("PDF 服务未处于独立隔离进程，已停止预览"); return true;
            }
            Bundle result = message.getData();
            if (!id.equals(result.getString(BrowserAgentPdfService.JOB_ID))) return true;
            if (message.what == BrowserAgentPdfService.ERROR) {
                String error = result.getString("error", "PDF 无法预览");
                fail(error.length() <= 160 ? error : "PDF 无法预览");
            } else if (message.what == BrowserAgentPdfService.RESULT && metadata == null) {
                validateMetadata(result, page);
                workerUid = message.sendingUid; workerPid = result.getInt("workerPid", -1);
                metadata = result; metadataReady.countDown();
            }
        } catch (Exception error) { fail("PDF 隔离进程返回了无效预览数据"); }
        return true;
    }

    void cancel() { fail("PDF 预览已取消"); }
    int workerUid() { return workerUid; }
    int workerPid() { return workerPid; }

    private void ensureOpen() throws IOException {
        IOException error = failure;
        if (error != null) throw error;
        if (closed.get() || Thread.currentThread().isInterrupted())
            throw new BrowserAgentFilePreview.PreviewFailure("PDF 预览已取消");
    }

    private void fail(String message) { finish(new BrowserAgentFilePreview.PreviewFailure(message)); }

    private void finish(IOException error) {
        ParcelFileDescriptor pdf, writer;
        InputStream reader;
        synchronized (lock) {
            if (!closed.compareAndSet(false, true)) return;
            if (error != null) failure = error;
            pdf = input; input = null; writer = outputWriter; outputWriter = null;
            reader = outputReader; outputReader = null;
        }
        metadataReady.countDown();
        close(pdf); close(writer); close(reader);
        if (Looper.myLooper() == Looper.getMainLooper()) cleanup();
        else main.post(this::cleanup);
    }

    /** Main thread only. Unregister even an unsuccessful bind to release framework connection state. */
    private void cleanup() {
        if (cleaned) return;
        cleaned = true;
        if (requestSent && remote != null) {
            Message message = Message.obtain(null, BrowserAgentPdfService.CANCEL);
            Bundle data = new Bundle(); data.putString(BrowserAgentPdfService.JOB_ID, id); message.setData(data);
            try { remote.send(message); } catch (RemoteException ignored) {}
        }
        remote = null;
        if (bindingRegistered) {
            bindingRegistered = false;
            try { context.unbindService(connection); } catch (IllegalArgumentException | SecurityException ignored) {}
        }
        cleanupComplete.set(true);
        if (!legacyHeld.get() || !requestSent) unlinkDeath();
        releaseLegacyIfSafe();
    }

    private void releaseLegacyIfSafe() {
        // An old CANCEL/onUnbind must never kill a newer pre-29 job in the shared service process.
        // If the old process does not die promptly, subsequent reads time out instead of reusing it.
        IBinder binder = remoteBinder;
        if (!cleanupComplete.get() || requestSent && !binderDead.get() && (binder == null || binder.isBinderAlive())) return;
        if (legacyHeld.compareAndSet(true, false)) { unlinkDeath(); LEGACY_PROCESS.release(); }
    }

    private void unlinkDeath() {
        IBinder binder = remoteBinder;
        if (binder != null) try { binder.unlinkToDeath(death, 0); } catch (RuntimeException ignored) {}
    }

    static void validateMetadata(Bundle value, int page) throws IOException {
        if (value == null) throw new IOException("PDF 隔离预览缺少结果");
        int width = value.getInt("width"), height = value.getInt("height"), size = value.getInt("size");
        if (width <= 0 || height <= 0 || width > BrowserAgentFilePreview.MAX_EDGE
                || height > BrowserAgentFilePreview.MAX_EDGE || (long) width * height > BrowserAgentFilePreview.MAX_PIXELS
                || value.getInt("page", -1) != page || value.getInt("pageCount") <= page
                || size <= 0 || size > BrowserAgentFilePreview.MAX_JPEG_BYTES)
            throw new IOException("PDF 隔离预览超过页码、像素或字节范围");
    }

    static byte[] readPayload(InputStream input, int size, BrowserAgentFilePreview.Check check) throws IOException {
        if (size <= 0 || size > BrowserAgentFilePreview.MAX_JPEG_BYTES)
            throw new IOException("PDF 图片超过 1 MB 预览上限");
        byte[] bytes = new byte[size]; int position = 0;
        while (position < size) {
            check.check();
            int count = input.read(bytes, position, Math.min(32 * 1024, size - position));
            if (count < 0) throw new IOException("PDF 图片传输中断，请重试");
            if (count == 0) continue;
            position += count;
        }
        check.check();
        if (input.read() != -1) throw new IOException("PDF 图片超过声明的字节上限");
        check.check(); return bytes;
    }

    /** Inspect bounded JPEG headers without bringing PDF/native decoding back into the app process. */
    static void validateJpegDimensions(byte[] bytes, int width, int height) throws IOException {
        if (bytes.length < 4 || (bytes[0] & 255) != 255 || (bytes[1] & 255) != 216
                || (bytes[bytes.length - 2] & 255) != 255 || (bytes[bytes.length - 1] & 255) != 217)
            throw new IOException("PDF 隔离预览并非完整 JPEG 图片");
        int offset = 2;
        while (offset + 3 < bytes.length) {
            if ((bytes[offset++] & 255) != 255) break;
            while (offset < bytes.length && (bytes[offset] & 255) == 255) offset++;
            if (offset >= bytes.length) break;
            int marker = bytes[offset++] & 255;
            if (marker == 218 || marker == 217) break;
            if (marker == 1 || marker >= 208 && marker <= 215) continue;
            if (offset + 2 > bytes.length) break;
            int length = (bytes[offset] & 255) * 256 + (bytes[offset + 1] & 255);
            if (length < 2 || length > bytes.length - offset) break;
            boolean frame = marker >= 192 && marker <= 207 && marker != 196 && marker != 200 && marker != 204;
            if (frame) {
                if (length >= 8 && (bytes[offset + 3] & 255) * 256 + (bytes[offset + 4] & 255) == height
                        && (bytes[offset + 5] & 255) * 256 + (bytes[offset + 6] & 255) == width) return;
                break;
            }
            offset += length;
        }
        throw new IOException("PDF 图片实际尺寸与隔离预览结果不符");
    }

    private static void close(Closeable value) { if (value != null) try { value.close(); } catch (IOException ignored) {} }
    private static void put(JSONObject value, String key, Object item) {
        try { value.put(key, item); } catch (org.json.JSONException ignored) {}
    }
}
