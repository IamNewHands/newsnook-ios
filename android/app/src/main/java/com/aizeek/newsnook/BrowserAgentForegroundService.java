package com.aizeek.newsnook;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/** A foreground, memory-only lease for a user-started browser task; never restarts a lost run. */
public final class BrowserAgentForegroundService extends Service {
    private static final String CHANNEL = "newsnook_browser_agent";
    static final String PAUSE = "com.aizeek.newsnook.PAUSE_BROWSER_AGENT";
    private static final int NOTIFICATION = 0x4e4147;
    static final long MAX_RUN_MS = 60 * 60 * 1000L;
    private static Runnable pauseOwner;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private Runnable ownedRun;
    private final Runnable timeout = this::pauseTask;

    static void acquire(Context context, Runnable pause) {
        pauseOwner = pause;
        try { ContextCompat.startForegroundService(context, new Intent(context, BrowserAgentForegroundService.class)); }
        catch (RuntimeException error) { pauseOwner = null; throw error; }
    }

    static void release(Context context) {
        pauseOwner = null;
        context.stopService(new Intent(context, BrowserAgentForegroundService.class));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            new NotificationChannel(CHANNEL, "浏览器智能助手", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent pause = PendingIntent.getService(this, 0, new Intent(this, BrowserAgentForegroundService.class)
            .setAction(PAUSE), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        ServiceCompat.startForeground(this, NOTIFICATION, new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_search).setContentTitle("浏览器助手正在执行任务")
            .setContentText("息屏后继续运行；需要确认时请返回应用")
            .setContentIntent(open).setOngoing(true).setSilent(true)
            .addAction(android.R.drawable.ic_media_pause, "暂停", pause).build(),
            Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0);
        if (pauseOwner == null || intent != null && PAUSE.equals(intent.getAction())) {
            pauseTask(); return START_NOT_STICKY;
        }
        ownedRun = pauseOwner;
        handler.removeCallbacks(timeout);
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "newsnook:browser-agent");
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(MAX_RUN_MS);
        handler.postDelayed(timeout, MAX_RUN_MS);
        return START_NOT_STICKY;
    }

    private void pauseTask() {
        Runnable owner = pauseOwner;
        pauseOwner = null;
        try { if (owner != null) owner.run(); }
        finally { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }
    }

    @Override public void onDestroy() {
        handler.removeCallbacks(timeout);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        // Unexpected service destruction must also revoke browser execution.
        Runnable owner = pauseOwner == ownedRun ? pauseOwner : null;
        if (owner != null) pauseOwner = null;
        if (owner != null) owner.run();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
