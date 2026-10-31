package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.app.Service;
import java.time.Duration;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserAgentForegroundServiceTest {
    @Test public void notificationPauseRevokesRunAndReleasesCpuLock() {
        Context app = RuntimeEnvironment.getApplication();
        int[] paused = {0};
        BrowserAgentForegroundService.acquire(app, () -> paused[0]++);
        var controller = Robolectric.buildService(BrowserAgentForegroundService.class).create();
        var service = controller.get();
        try {
            assertEquals(Service.START_NOT_STICKY, service.onStartCommand(new Intent(), 0, 1));
            PowerManager.WakeLock lock = org.robolectric.shadows.ShadowPowerManager.getLatestWakeLock();
            assertTrue(lock.isHeld());
            assertNotNull(Shadows.shadowOf(service).getLastForegroundNotification());
            service.onStartCommand(new Intent().setAction(BrowserAgentForegroundService.PAUSE), 0, 2);
            assertEquals(1, paused[0]);
            assertTrue(Shadows.shadowOf(service).isStoppedBySelf());
            controller.destroy();
            assertFalse(lock.isHeld());
            assertEquals(1, paused[0]);
        } finally { BrowserAgentForegroundService.release(app); }
    }

    @Test public void timeoutPausesRatherThanLeavingAnUnprotectedRun() {
        Context app = RuntimeEnvironment.getApplication();
        int[] paused = {0};
        BrowserAgentForegroundService.acquire(app, () -> paused[0]++);
        var controller = Robolectric.buildService(BrowserAgentForegroundService.class).create();
        try {
            controller.get().onStartCommand(new Intent(), 0, 1);
            Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMillis(BrowserAgentForegroundService.MAX_RUN_MS));
            assertEquals(1, paused[0]);
            assertTrue(Shadows.shadowOf(controller.get()).isStoppedBySelf());
        } finally { BrowserAgentForegroundService.release(app); controller.destroy(); }
    }

    @Test public void destructionOfRetiredServiceCannotPauseNewRun() {
        Context app = RuntimeEnvironment.getApplication();
        int[] paused = {0};
        BrowserAgentForegroundService.acquire(app, () -> {});
        var old = Robolectric.buildService(BrowserAgentForegroundService.class).create();
        old.get().onStartCommand(new Intent(), 0, 1);
        BrowserAgentForegroundService.release(app);
        BrowserAgentForegroundService.acquire(app, () -> paused[0]++);
        try {
            old.destroy();
            assertEquals(0, paused[0]);
        } finally { BrowserAgentForegroundService.release(app); }
    }

    @Test public void processRecreationWithoutOwnerDoesNotRestartAutomation() {
        Context app = RuntimeEnvironment.getApplication();
        BrowserAgentForegroundService.release(app);
        var controller = Robolectric.buildService(BrowserAgentForegroundService.class).create();
        try {
            assertEquals(Service.START_NOT_STICKY, controller.get().onStartCommand(null, 0, 1));
            assertTrue(Shadows.shadowOf(controller.get()).isStoppedBySelf());
        } finally { controller.destroy(); }
    }
}
