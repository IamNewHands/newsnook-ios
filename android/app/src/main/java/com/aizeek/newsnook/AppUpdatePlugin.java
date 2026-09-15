package com.aizeek.newsnook;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.net.URI;

/**
 * 从受信任更新源下载 APK（系统 DownloadManager + 通知栏进度），校验后调起安装。
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private Long activeDownloadId = null;
    private String activeFileName = null;
    private String activeExpectedSha256 = null;
    private Long activeExpectedSize = null;
    private BroadcastReceiver downloadReceiver = null;

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            result.put("value", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            result.put("value", true);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Context context = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.getPackageName())
            );
        } else {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        String rawSha256 = call.getString("sha256");
        Long expectedSize = call.getLong("size");
        String expectedSha256 = rawSha256 == null ? null : AppUpdateIntegrity.normalizeSha256(rawSha256);
        if (url == null || url.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("缺少 url 或 fileName");
            return;
        }
        if (!isAllowedDownloadUrl(url)) {
            call.reject("不允许的下载地址");
            return;
        }
        if (fileName.contains("..") || fileName.contains("/") || fileName.contains("\\")) {
            call.reject("非法 fileName");
            return;
        }
        if (rawSha256 != null && expectedSha256 == null) {
            call.reject("非法 sha256");
            return;
        }
        if (expectedSize != null && expectedSize <= 0) {
            call.reject("非法 size");
            return;
        }

        if (activeDownloadId != null && isDownloadInProgress(activeDownloadId)) {
            JSObject result = new JSObject();
            result.put("downloadId", activeDownloadId);
            call.resolve(result);
            return;
        }

        ensureReceiverRegistered();

        Context context = getContext();
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("DownloadManager 不可用");
            return;
        }

        // 覆盖同名残留，避免解析到旧包
        File destination = destinationFile(fileName);
        if (destination != null && destination.exists()) {
            //noinspection ResultOfMethodCallIgnored
            destination.delete();
        }

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("有所闻 · 正在下载更新");
        request.setDescription(fileName);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName);
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(true);

        long downloadId = manager.enqueue(request);
        activeDownloadId = downloadId;
        activeFileName = fileName;
        activeExpectedSha256 = expectedSha256;
        activeExpectedSize = expectedSize;

        JSObject result = new JSObject();
        result.put("downloadId", downloadId);
        call.resolve(result);
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        Long downloadId = call.getLong("downloadId");
        if (downloadId == null) {
            call.reject("缺少 downloadId");
            return;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("DownloadManager 不可用");
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                JSObject result = new JSObject();
                result.put("status", "unknown");
                call.resolve(result);
                return;
            }

            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int statusCode = statusIndex >= 0 ? cursor.getInt(statusIndex) : -1;

            JSObject result = new JSObject();
            result.put("status", mapStatus(statusCode));
            File apk = resolveDownloadedFile(downloadId);
            if (apk != null) {
                result.put("localUri", Uri.fromFile(apk).toString());
            }
            call.resolve(result);
        }
    }

    @PluginMethod
    public void installDownloaded(PluginCall call) {
        Long downloadId = call.getLong("downloadId");
        if (downloadId == null) {
            call.reject("缺少 downloadId");
            return;
        }
        try {
            File apk = resolveDownloadedFile(downloadId);
            if (apk == null || !apk.exists()) {
                call.reject("安装包不存在");
                return;
            }
            AppUpdateIntegrity.VerificationResult verification = AppUpdateIntegrity.verify(
                apk,
                activeExpectedSha256,
                activeExpectedSize
            );
            if (!verification.valid) {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                clearActiveIfMatch(downloadId);
                call.reject(verification.message);
                return;
            }
            installApk(apk);
            clearActiveIfMatch(downloadId);
            call.resolve();
        } catch (Exception error) {
            call.reject("安装失败: " + error.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        unregisterReceiverQuietly();
        super.handleOnDestroy();
    }

    private static String mapStatus(int statusCode) {
        switch (statusCode) {
            case DownloadManager.STATUS_PENDING:
                return "pending";
            case DownloadManager.STATUS_RUNNING:
            case DownloadManager.STATUS_PAUSED:
                return "running";
            case DownloadManager.STATUS_SUCCESSFUL:
                return "successful";
            case DownloadManager.STATUS_FAILED:
                return "failed";
            default:
                return "unknown";
        }
    }

    private boolean isDownloadInProgress(long downloadId) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return false;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) return false;
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            if (statusIndex < 0) return false;
            int status = cursor.getInt(statusIndex);
            return status == DownloadManager.STATUS_PENDING
                || status == DownloadManager.STATUS_RUNNING
                || status == DownloadManager.STATUS_PAUSED;
        }
    }

    private static boolean isAllowedDownloadUrl(String url) {
        try {
            URI uri = URI.create(url);
            String scheme = uri.getScheme();
            if (scheme == null || !scheme.equalsIgnoreCase("https")) return false;
            String host = uri.getHost();
            if (host == null) return false;
            String lower = host.toLowerCase();
            return lower.equals("news-update.aizeek.com")
                || lower.equals("github.com")
                || lower.endsWith(".github.com")
                || lower.equals("objects.githubusercontent.com")
                || lower.endsWith(".githubusercontent.com");
        } catch (Exception ignored) {
            return false;
        }
    }

    private void ensureReceiverRegistered() {
        if (downloadReceiver != null) return;
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
                long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (activeDownloadId == null || completedId != activeDownloadId) return;
                handleDownloadComplete(completedId);
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // 系统 DownloadManager 完成广播需 EXPORTED 才能收到
            getContext().registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(downloadReceiver, filter);
        }
    }

    private void handleDownloadComplete(long downloadId) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            emitFailed(downloadId, "download", "DownloadManager 不可用");
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                emitFailed(downloadId, "download", "找不到下载记录");
                return;
            }
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);
            int status = statusIndex >= 0 ? cursor.getInt(statusIndex) : -1;
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                int reason = reasonIndex >= 0 ? cursor.getInt(reasonIndex) : -1;
                emitFailed(downloadId, "download", "下载失败 (" + reason + ")");
                return;
            }
        }

        File apk = resolveDownloadedFile(downloadId);
        if (apk == null || !apk.exists()) {
            emitFailed(downloadId, "download", "安装包不存在");
            return;
        }

        AppUpdateIntegrity.VerificationResult verification = AppUpdateIntegrity.verify(
            apk,
            activeExpectedSha256,
            activeExpectedSize
        );
        if (!verification.valid) {
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
            emitFailed(downloadId, "download", verification.message);
            return;
        }

        try {
            installApk(apk);
            JSObject payload = new JSObject();
            payload.put("downloadId", downloadId);
            notifyListeners("downloadComplete", payload);
        } catch (Exception error) {
            emitFailed(
                downloadId,
                "install",
                error.getMessage() != null ? ("安装失败: " + error.getMessage()) : "安装失败"
            );
        } finally {
            clearActiveIfMatch(downloadId);
        }
    }

    private void emitFailed(long downloadId, String kind, String message) {
        clearActiveIfMatch(downloadId);
        JSObject payload = new JSObject();
        payload.put("downloadId", downloadId);
        payload.put("kind", kind);
        payload.put("message", message != null ? message : "下载失败");
        notifyListeners("downloadFailed", payload);
    }

    private void clearActiveIfMatch(long downloadId) {
        if (activeDownloadId != null && activeDownloadId == downloadId) {
            activeDownloadId = null;
            activeFileName = null;
            activeExpectedSha256 = null;
            activeExpectedSize = null;
        }
    }

    /** 与 setDestinationInExternalFilesDir(..., DIRECTORY_DOWNLOADS, fileName) 对齐 */
    private File destinationFile(String fileName) {
        if (fileName == null || fileName.isEmpty()) return null;
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) return null;
        return new File(dir, fileName);
    }

    private File resolveDownloadedFile(long downloadId) {
        if (activeFileName != null) {
            File byName = destinationFile(activeFileName);
            if (byName != null && byName.exists()) return byName;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return null;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            int localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
            if (localUriIndex < 0) return null;
            String localUri = cursor.getString(localUriIndex);
            if (localUri == null || localUri.isEmpty()) return null;
            Uri uri = Uri.parse(localUri);
            if ("file".equalsIgnoreCase(uri.getScheme()) && uri.getPath() != null) {
                File file = new File(uri.getPath());
                if (file.exists()) return file;
            }
        }
        return null;
    }

    private void installApk(File apk) {
        Context context = getContext();
        Uri contentUri = FileProvider.getUriForFile(
            context,
            context.getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private void unregisterReceiverQuietly() {
        if (downloadReceiver == null) return;
        try {
            getContext().unregisterReceiver(downloadReceiver);
        } catch (Exception ignored) {
            // already unregistered
        }
        downloadReceiver = null;
    }
}
