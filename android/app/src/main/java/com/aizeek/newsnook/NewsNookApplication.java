package com.aizeek.newsnook;

import android.app.Application;
import android.content.Context;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewOutcomeReceiver;
import androidx.webkit.WebViewStartUpConfig;
import androidx.webkit.WebViewStartUpResult;
import androidx.webkit.WebViewStartupException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Keep upgrade cleanup for storage owned by the retired private browser process. */
public final class NewsNookApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        if (Process.myUid() != getApplicationInfo().uid) return; // isolated PDF worker

        // WebView is required for our primary UI. Advance its background-only startup
        // during Activity creation, without waiting for a startup callback or blocking
        // the main thread with additional WebView UI initialization.
        ExecutorService background = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "NewsNookWebViewWarmup");
            thread.setDaemon(true);
            return thread;
        });
        try {
            WebViewStartUpConfig config = new WebViewStartUpConfig.Builder(background)
                .setShouldRunUiThreadStartUpTasks(false)
                .build();
            if (BuildConfig.DEBUG || BuildConfig.STARTUP_BENCHMARK) {
                Log.i("NewsNookStartup", "async-webview-start-requested elapsed=" + SystemClock.elapsedRealtime() + "ms");
            }
            WebViewCompat.startUpWebView(this, config,
                new WebViewOutcomeReceiver<WebViewStartUpResult, WebViewStartupException>() {
                    @Override public void onResult(@NonNull WebViewStartUpResult result) {
                        if (BuildConfig.DEBUG || BuildConfig.STARTUP_BENCHMARK) {
                            Log.i("NewsNookStartup", "async-webview-start-complete elapsed=" + SystemClock.elapsedRealtime() + "ms");
                            Log.i("NewsNookStartup", "webview-ui-startup-total=" + result.getTotalTimeInUiThreadMillis()
                                + "ms max-ui-task=" + result.getMaxTimePerTaskInUiThreadMillis() + "ms");
                        }
                        // Jetpack captures call sites that forced WebView startup to block
                        // the UI thread. Log stacks in Debug only for reproducible diagnosis.
                        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                            var locations = result.getUiThreadBlockingStartUpLocations();
                            if (locations != null) {
                                for (var location : locations) {
                                    Log.w("NewsNookStartup", "WebView UI-thread blocking call site", location.getStackInformation());
                                }
                            }
                        }
                        background.shutdown();
                    }
                    @Override public void onError(@NonNull WebViewStartupException error) {
                        Log.w("NewsNookStartup", "Async WebView startup unavailable; normal startup continues", error);
                        background.shutdown();
                    }
                });
        } catch (RuntimeException | LinkageError error) {
            Log.w("NewsNookStartup", "Async WebView startup not supported; using normal startup", error);
            background.shutdown();
        }
    }

    @Override protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        if (BuildConfig.DEBUG || BuildConfig.STARTUP_BENCHMARK) {
            android.util.Log.i("NewsNookStartup", "application-attachBaseContext elapsed=" + android.os.SystemClock.elapsedRealtime() + "ms");
        }
        // Permissionless PDF worker processes must not initialize application storage services.
        if (Process.myUid() == base.getApplicationInfo().uid) LegacyPrivateBrowserCleanup.sweep(base);
    }
}
