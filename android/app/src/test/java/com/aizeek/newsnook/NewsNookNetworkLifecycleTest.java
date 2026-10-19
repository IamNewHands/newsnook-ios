package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Looper;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowConnectivityManager;
import org.robolectric.shadows.ShadowNetwork;
import org.robolectric.shadows.ShadowNetworkCapabilities;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class NewsNookNetworkLifecycleTest {
    private AppCompatActivity activity;
    private ConnectivityManager manager;
    private ShadowConnectivityManager shadow;
    private TestPlugin plugin;

    private final class TestPlugin extends NewsNookNetworkPlugin {
        final List<JSObject> events = new ArrayList<>();
        @Override public Context getContext() { return activity; }
        @Override protected void notifyListeners(String name, JSObject event) {
            assertEquals("networkStatusChange", name);
            events.add(event);
        }
        void resume() { handleOnResume(); }
        void pause() { handleOnPause(); }
        void destroy() { handleOnDestroy(); }
    }

    private static final class StatusCall extends PluginCall {
        JSObject result;
        String error;
        StatusCall() { super(null, "Network", "status", "getStatus", new JSObject()); }
        @Override public void resolve(JSObject result) { this.result = result; }
        @Override public void reject(String error) { this.error = error; }
    }

    @Before public void setUp() {
        activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        manager = (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
        shadow = Shadows.shadowOf(manager);
        plugin = new TestPlugin();
        plugin.load();
    }

    @After public void tearDown() {
        plugin.destroy();
        for (ConnectivityManager.NetworkCallback callback : new ArrayList<>(shadow.getNetworkCallbacks())) {
            manager.unregisterNetworkCallback(callback);
        }
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        activity.finish();
    }

    private ConnectivityManager.NetworkCallback callback() {
        assertEquals("one callback belongs to the resumed plugin", 1, shadow.getNetworkCallbacks().size());
        return shadow.getNetworkCallbacks().iterator().next();
    }

    private NetworkCapabilities validatedWifi() {
        NetworkCapabilities capabilities = ShadowNetworkCapabilities.newInstance();
        ShadowNetworkCapabilities network = Shadows.shadowOf(capabilities);
        network.addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        network.addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        network.addTransportType(NetworkCapabilities.TRANSPORT_WIFI);
        return capabilities;
    }

    @Test public void destroyWithoutPauseUnregistersTheSystemCallback() {
        plugin.resume();
        callback();
        plugin.destroy();
        assertTrue("renderer recovery destroys the Bridge before Activity pause", shadow.getNetworkCallbacks().isEmpty());
    }

    @Test public void lateConnectivityThreadCallbacksCannotCrashOrNotifyAfterDestroy() throws Exception {
        plugin.resume();
        ConnectivityManager.NetworkCallback retired = callback();
        plugin.destroy();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread connectivityThread = new Thread(() -> {
            try {
                retired.onCapabilitiesChanged(ShadowNetwork.newInstance(71), new NetworkCapabilities());
                retired.onLost(ShadowNetwork.newInstance(71));
            } catch (Throwable error) { failure.set(error); }
        }, "ConnectivityThread-regression");
        connectivityThread.start();
        connectivityThread.join(2000);
        assertFalse(connectivityThread.isAlive());
        assertNull("late callbacks must not dereference the upstream cleared listener", failure.get());
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertTrue(plugin.events.isEmpty());
    }

    @Test public void queuedAndRetiredCallbacksCannotPublishIntoAResumedSession() {
        plugin.resume();
        ConnectivityManager.NetworkCallback retired = callback();
        retired.onLost(ShadowNetwork.newInstance(72));
        plugin.events.clear();
        plugin.pause();
        plugin.resume();
        ConnectivityManager.NetworkCallback current = callback();
        retired.onCapabilitiesChanged(ShadowNetwork.newInstance(72), new NetworkCapabilities());
        retired.onLost(ShadowNetwork.newInstance(72));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertTrue("callbacks from the previous registration are stale even after resume", plugin.events.isEmpty());
        current.onLost(ShadowNetwork.newInstance(73));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, plugin.events.size());
        assertFalse(plugin.events.get(0).getBoolean("connected", true));
        assertEquals("none", plugin.events.get(0).getString("connectionType"));
    }

    @Test public void repeatedLifecycleCallsAreIdempotent() {
        plugin.resume();
        ConnectivityManager.NetworkCallback first = callback();
        plugin.resume();
        assertSame(first, callback());
        plugin.pause();
        plugin.pause();
        assertTrue(shadow.getNetworkCallbacks().isEmpty());
        plugin.resume();
        callback();
        plugin.destroy();
        plugin.destroy();
        plugin.resume();
        assertTrue("destroyed plugins must never monitor again", shadow.getNetworkCallbacks().isEmpty());
    }

    @Test public void resumingAfterNetworkLossPublishesOfflineStatus() {
        Network active = manager.getActiveNetwork();
        shadow.setNetworkCapabilities(active, validatedWifi());
        plugin.resume();
        plugin.pause();
        shadow.setActiveNetworkInfo(null);
        plugin.resume();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("no default-network callback is guaranteed when resuming offline", 1, plugin.events.size());
        assertFalse(plugin.events.get(0).getBoolean("connected", true));
        assertEquals("none", plugin.events.get(0).getString("connectionType"));
    }

    @Test public void liveStatusAndEventsKeepTheCapacitorNetworkContract() {
        Network active = manager.getActiveNetwork();
        assertNotNull(active);
        NetworkCapabilities capabilities = validatedWifi();
        shadow.setNetworkCapabilities(active, capabilities);
        StatusCall call = new StatusCall();
        plugin.getStatus(call);
        assertNull(call.error);
        assertTrue(call.result.getBoolean("connected", false));
        assertEquals("wifi", call.result.getString("connectionType"));
        plugin.resume();
        callback().onCapabilitiesChanged(active, capabilities);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, plugin.events.size());
        assertTrue(plugin.events.get(0).getBoolean("connected", false));
        assertEquals("wifi", plugin.events.get(0).getString("connectionType"));
    }
}
