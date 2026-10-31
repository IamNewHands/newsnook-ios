package com.aizeek.newsnook;

import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.os.RemoteException;
import android.system.Os;
import android.system.OsConstants;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * One untrusted PDF per isolated process. Receives only an immutable, read-only PDF FD and
 * a JPEG pipe FD; it never opens app paths, content providers, WebView or network sessions.
 */
public final class BrowserAgentPdfService extends Service {
    static final int RENDER = 1;
    static final int CANCEL = 2;
    static final int RESULT = 3;
    static final int ERROR = 4;
    static final String JOB_ID = "jobId";
    static final long JOB_TIMEOUT_MS = 12_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> bindings = new HashSet<>();
    private final Runnable watchdog = this::terminateProcess;
    private ExecutorService worker;
    private volatile boolean disposed;
    private boolean isolated;
    private String ownerJob;
    private IBinder owner;
    private IBinder.DeathRecipient ownerDied;

    @Override public void onCreate() {
        super.onCreate();
        // Do not run a PDF parser (or kill a process) if a manifest/build accidentally removes isolation.
        isolated = Process.myUid() != getApplicationInfo().uid;
        if (!isolated) { stopSelf(); return; }
        worker = Executors.newSingleThreadExecutor(runnable -> new Thread(runnable, "NewsNookPdfPage"));
        main.postDelayed(watchdog, JOB_TIMEOUT_MS);
    }

    @Override public IBinder onBind(Intent intent) {
        String id = intent == null ? null : intent.getStringExtra(JOB_ID);
        if (!isolated || disposed || !validJobId(id)) return null;
        bindings.add(id);
        // Each explicit Intent has a unique action, so an old unbind/cancel is tied to its own job.
        return new Messenger(new Handler(Looper.getMainLooper(), message -> {
            handle(id, message); return true;
        })).getBinder();
    }

    @Override public boolean onUnbind(Intent intent) {
        String id = intent == null ? null : intent.getStringExtra(JOB_ID);
        bindings.remove(id);
        if (id != null && id.equals(ownerJob) || ownerJob == null && bindings.isEmpty()) terminateProcess();
        return false;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        // This is a bound capability, never a restartable background job.
        stopSelf(startId); return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private void handle(String bindingId, Message message) {
        ParcelFileDescriptor input = null, output = null;
        try {
            Bundle data = message.getData();
            data.setClassLoader(ParcelFileDescriptor.class.getClassLoader());
            String id = data.getString(JOB_ID);
            if (message.what == RENDER) {
                input = data.getParcelable("input"); output = data.getParcelable("output");
            }
            if (disposed || !bindings.contains(bindingId) || message.sendingUid != getApplicationInfo().uid
                    || !bindingId.equals(id)) return;
            if (message.what == CANCEL) {
                if (ownerJob == null || id.equals(ownerJob)) terminateProcess();
                return;
            }
            if (message.what != RENDER || message.replyTo == null) return;
            if (ownerJob != null) { replyError(message.replyTo, id, "PDF 隔离进程仍在结束，请重试"); return; }
            ownerJob = id;
            int page = data.getInt("page", -1);
            if (input == null || output == null || page < 0 || input.getStatSize() <= 0
                    || input.getStatSize() > BrowserAgentFilePreview.MAX_INPUT_BYTES
                    || !OsConstants.S_ISREG(Os.fstat(input.getFileDescriptor()).st_mode)
                    || !OsConstants.S_ISFIFO(Os.fstat(output.getFileDescriptor()).st_mode)) {
                replyError(message.replyTo, id, "PDF 隔离预览参数或文件句柄无效"); return;
            }
            Os.lseek(input.getFileDescriptor(), 0, OsConstants.SEEK_SET);
            owner = message.replyTo.getBinder();
            ownerDied = () -> main.post(this::terminateProcess);
            owner.linkToDeath(ownerDied, 0);
            ParcelFileDescriptor pdf = input, jpeg = output;
            Messenger reply = message.replyTo;
            worker.execute(() -> renderAndSend(id, page, pdf, jpeg, reply));
            input = null; output = null; // Ownership transferred to the worker.
            main.removeCallbacks(watchdog); main.postDelayed(watchdog, JOB_TIMEOUT_MS);
        } catch (Exception error) {
            replyError(message.replyTo, bindingId, "无法启动 PDF 隔离预览，请重试");
        } finally { close(input); close(output); }
    }

    private void renderAndSend(String id, int page, ParcelFileDescriptor input,
                               ParcelFileDescriptor output, Messenger reply) {
        try {
            PdfPage rendered = renderPage(input, page);
            checkLive();
            Bundle result = new Bundle();
            result.putString(JOB_ID, id); result.putInt("width", rendered.image.width);
            result.putInt("height", rendered.image.height); result.putInt("size", rendered.image.size);
            result.putInt("page", page); result.putInt("pageCount", rendered.pageCount);
            result.putInt("workerPid", Process.myPid());
            Message message = Message.obtain(null, RESULT); message.setData(result);
            // Metadata arrives before writing, letting the parent drain the bounded pipe without deadlock.
            reply.send(message);
            try (OutputStream stream = new ParcelFileDescriptor.AutoCloseOutputStream(output)) {
                stream.write(rendered.image.bytes, 0, rendered.image.size);
            }
        } catch (BrowserAgentFilePreview.PreviewFailure error) {
            replyError(reply, id, error.getMessage());
        } catch (OutOfMemoryError error) {
            replyError(reply, id, "PDF 预览内存不足，请缩小文件后重试");
        } catch (Exception error) {
            replyError(reply, id, "PDF 无法预览，文件可能已损坏");
        } finally {
            // PFD.close is idempotent; renderPage/AutoCloseOutputStream may already own and close these.
            close(input); close(output);
        }
    }

    private static final class PdfPage {
        final BrowserAgentFilePreview.EncodedImage image;
        final int pageCount;
        PdfPage(BrowserAgentFilePreview.EncodedImage image, int pageCount) {
            this.image = image; this.pageCount = pageCount;
        }
    }

    /** All actual PdfRenderer calls are confined to this isolated service. */
    private PdfPage renderPage(ParcelFileDescriptor descriptor, int pageIndex) throws IOException {
        PdfRenderer renderer = null;
        try {
            checkLive();
            // PdfRenderer owns the seekable descriptor after successful construction.
            renderer = new PdfRenderer(descriptor);
            checkLive();
            int count = renderer.getPageCount();
            if (pageIndex >= count)
                throw new BrowserAgentFilePreview.PreviewFailure("PDF 页码超出范围，共 " + count + " 页（页码从 0 开始）");
            try (PdfRenderer.Page page = renderer.openPage(pageIndex)) {
                int width = page.getWidth(), height = page.getHeight();
                if (width <= 0 || height <= 0) throw new BrowserAgentFilePreview.PreviewFailure("PDF 页面尺寸无效");
                double scale = Math.min((double) BrowserAgentFilePreview.MAX_EDGE / width,
                    (double) BrowserAgentFilePreview.MAX_EDGE / height);
                scale = Math.min(scale, Math.sqrt(BrowserAgentFilePreview.MAX_PIXELS / ((double) width * height)));
                int outputWidth = Math.max(1, (int) Math.floor(width * scale));
                int outputHeight = Math.max(1, (int) Math.floor(height * scale));
                Bitmap image = Bitmap.createBitmap(outputWidth, outputHeight, Bitmap.Config.ARGB_8888);
                try {
                    BrowserAgentFilePreview.validateBitmap(image); image.eraseColor(Color.WHITE); checkLive();
                    page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    checkLive();
                    return new PdfPage(BrowserAgentFilePreview.encode(image, this::checkLive), count);
                } finally { image.recycle(); }
            }
        } catch (SecurityException error) {
            throw new BrowserAgentFilePreview.PreviewFailure("PDF 已加密或不允许预览，请提供可打开的 PDF", error);
        } finally {
            if (renderer != null) renderer.close();
            else close(descriptor);
        }
    }

    private void checkLive() throws IOException {
        if (disposed || Thread.currentThread().isInterrupted())
            throw new BrowserAgentFilePreview.PreviewFailure("PDF 预览已取消");
    }

    private void replyError(Messenger reply, String id, String error) {
        if (reply == null || disposed) return;
        Bundle data = new Bundle(); data.putString(JOB_ID, id); data.putString("error", error);
        Message message = Message.obtain(null, ERROR); message.setData(data);
        try { reply.send(message); } catch (RemoteException ignored) { main.post(this::terminateProcess); }
    }

    private void terminateProcess() {
        if (!isolated) return;
        disposed = true;
        // stopSelf/unbind alone cannot interrupt a stuck native renderer on the worker thread.
        // The main looper remains available to terminate only this permissionless process.
        Process.killProcess(Process.myPid());
    }

    @Override public void onDestroy() {
        main.removeCallbacks(watchdog);
        if (owner != null && ownerDied != null)
            try { owner.unlinkToDeath(ownerDied, 0); } catch (RuntimeException ignored) {}
        if (worker != null) worker.shutdownNow();
        if (ownerJob != null) terminateProcess();
        disposed = true;
        super.onDestroy();
    }

    static boolean validJobId(String id) { return id != null && id.matches("pdf_[a-f0-9]{32}"); }
    private static void close(ParcelFileDescriptor descriptor) {
        if (descriptor != null) try { descriptor.close(); } catch (IOException ignored) {}
    }
}
