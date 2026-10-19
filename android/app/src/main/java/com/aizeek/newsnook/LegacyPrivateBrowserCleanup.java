package com.aizeek.newsnook;

import android.app.ActivityManager;
import android.content.Context;
import android.system.Os;
import android.system.OsConstants;
import java.io.File;
import java.io.IOException;
import java.util.List;

/** Removes only storage left by the retired separate-process browser. */
final class LegacyPrivateBrowserCleanup {
    static final String DATA_SUFFIX = "newsnook_private_v1";
    static final String TEMP_DIRECTORY = "browser-private";
    private static final String PROCESS_SUFFIX = ":browser_private";

    private LegacyPrivateBrowserCleanup() {}

    static void sweep(Context context) {
        Thread cleanup = new Thread(() -> {
            if (hasLegacyProcess(context)) return;
            try {
                cleanupOwnedDirectories(context);
            } catch (IOException error) {
                android.util.Log.w("NewsNookBrowser", "Legacy private storage cleanup will be retried at startup");
            }
        }, "NewsNookLegacyPrivacyCleanup");
        cleanup.setDaemon(true);
        cleanup.start();
    }

    private static boolean hasLegacyProcess(Context context) {
        try {
            ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            List<ActivityManager.RunningAppProcessInfo> processes =
                manager == null ? null : manager.getRunningAppProcesses();
            if (processes == null) return true;
            String expected = context.getPackageName() + PROCESS_SUFFIX;
            for (ActivityManager.RunningAppProcessInfo process : processes)
                if (expected.equals(process.processName)) return true;
            return false;
        } catch (RuntimeException unavailable) {
            return true;
        }
    }

    /** Never clear the default WebView directory or an application-wide cache, files or preferences root. */
    static void cleanupOwnedDirectories(Context context) throws IOException {
        File data = new File(context.getApplicationInfo().dataDir).getCanonicalFile();
        for (String path : new String[] {
                "app_webview_" + DATA_SUFFIX,
                "cache/webview_" + DATA_SUFFIX,
                "cache/" + TEMP_DIRECTORY,
                "files/" + TEMP_DIRECTORY,
                "code_cache/" + TEMP_DIRECTORY
        }) {
            deleteOwnedTree(new File(data, path), data);
        }
    }

    private static void deleteOwnedTree(File entry, File data) throws IOException {
        try {
            android.system.StructStat stat = Os.lstat(entry.getAbsolutePath());
            if (OsConstants.S_ISLNK(stat.st_mode)) {
                if (!entry.delete()) throw new IOException("Could not delete legacy private storage link");
                return;
            }
        } catch (android.system.ErrnoException error) {
            if (error.errno == OsConstants.ENOENT) return;
            throw new IOException("Could not inspect legacy private storage", error);
        }
        File canonical = entry.getCanonicalFile();
        if (!canonical.getPath().startsWith(data.getPath() + File.separator))
            throw new IOException("Legacy private storage escaped application directory");
        if (entry.isDirectory()) {
            File[] children = entry.listFiles();
            if (children == null) throw new IOException("Could not enumerate legacy private storage");
            for (File child : children) deleteOwnedTree(child, data);
        }
        if (!entry.delete()) throw new IOException("Could not clear legacy private storage");
    }
}
