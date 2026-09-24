package com.aizeek.newsnook;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import android.app.Activity;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class LinuxDoBrowserSessionRecoveryTest {
    @Test public void navigationWithoutSuccessfulProbeNeverReportsReady() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        LinuxDoBrowserSessionRecovery recovery = new LinuxDoBrowserSessionRecovery();
        List<JSObject> results = new ArrayList<>();
        recovery.prepare(activity, results::add);
        assertEquals(0, results.size());
        shadowOf(Looper.getMainLooper()).idleFor(16, TimeUnit.SECONDS);
        assertEquals(1, results.size());
        assertFalse(results.get(0).optBoolean("ready"));
        assertFalse(results.get(0).has("csrf"));
        recovery.cancel();
        assertEquals(1, results.size());
    }

    @Test public void concurrentPreparationsShareTheSameBoundedAttempt() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        LinuxDoBrowserSessionRecovery recovery = new LinuxDoBrowserSessionRecovery();
        List<JSObject> results = new ArrayList<>();
        recovery.prepare(activity, results::add);
        recovery.prepare(activity, results::add);
        recovery.cancel();
        assertEquals(2, results.size());
        assertFalse(results.get(0).optBoolean("ready"));
        shadowOf(Looper.getMainLooper()).idleFor(16, TimeUnit.SECONDS);
        assertEquals(2, results.size());
    }

    @Test public void failedAttemptHasCooldownRatherThanOpeningPagesRepeatedly() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        LinuxDoBrowserSessionRecovery recovery = new LinuxDoBrowserSessionRecovery();
        List<JSObject> results = new ArrayList<>();
        recovery.prepare(activity, results::add);
        recovery.cancel();
        recovery.prepare(activity, results::add);
        assertEquals(2, results.size());
        assertEquals("cooldown", results.get(1).optString("reason"));
    }

    @Test public void aReadyDocumentOnlyHandlesTheReadSyncEndpointsAndCancelsPendingRequests() throws Exception {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        LinuxDoBrowserSessionRecovery recovery = new LinuxDoBrowserSessionRecovery();
        List<JSObject> results = new ArrayList<>();
        recovery.prepare(activity, results::add);
        java.lang.reflect.Field prepared = LinuxDoBrowserSessionRecovery.class.getDeclaredField("prepared");
        prepared.setAccessible(true);
        JSObject identity = new JSObject();
        identity.put("ready", true); identity.put("userId", 9); identity.put("username", "test-reader"); identity.put("csrf", "fixture-token");
        prepared.set(recovery, identity);
        assertTrue(recovery.canRequest("https://linux.do/topics/timings"));
        assertTrue(recovery.canRequest("https://linux.do/session/csrf.json"));
        assertFalse(recovery.canRequest("https://linux.do.evil.example/topics/timings"));
        assertFalse(recovery.canRequest("https://linux.do/posts.json"));
        assertFalse(recovery.canRequest("https://someone@linux.do/topics/timings"));
        assertFalse(recovery.canRequest("https://linux.do/topics/timings?next=external"));
        List<JSObject> responses = new ArrayList<>();
        recovery.request("https://linux.do/topics/timings", "POST", new JSObject(), "", responses::add);
        assertEquals(0, responses.size());
        recovery.cancel();
        assertEquals(1, responses.size());
        assertTrue(responses.get(0).has("error"));
        assertFalse(recovery.canRequest("https://linux.do/topics/timings"));
        shadowOf(Looper.getMainLooper()).idleFor(180, TimeUnit.SECONDS);
        assertEquals(1, responses.size());
    }

    @Test public void missingActivityCannotStartARecovery() {
        LinuxDoBrowserSessionRecovery recovery = new LinuxDoBrowserSessionRecovery();
        List<JSObject> results = new ArrayList<>();
        recovery.prepare(null, results::add);
        assertEquals(1, results.size());
        assertFalse(results.get(0).optBoolean("ready"));
    }
}
