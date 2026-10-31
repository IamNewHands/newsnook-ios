package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class BergamotInitializationTest {
    private static final class LocalPlugin extends BergamotTranslationPlugin {
        @Override public Context getContext() { return RuntimeEnvironment.getApplication(); }
    }

    private static final class StateCall extends PluginCall {
        JSObject resolved;
        StateCall() {
            super(null, "BergamotTranslation", "state-test", "getEngineState", new JSObject());
        }
        @Override public void resolve(JSObject result) { resolved = result; }
    }

    private static Object field(Object plugin, String name) throws Exception {
        Field field = BergamotTranslationPlugin.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(plugin);
    }

    @Test public void pluginRegistrationDoesNotAttemptToLoadNativeLibrariesOrDownloadClient() throws Exception {
        LocalPlugin plugin = new LocalPlugin();
        plugin.load();
        // Host JVM has no Android Bergamot library: an eager attempt populates the
        // diagnostic error before the reader has requested any translation feature.
        assertNull("Home launch must not try to load the optional native engine", field(plugin, "nativeLoadError"));
        assertEquals(false, field(plugin, "nativeLoaded"));
        assertNull("model-download TLS must wait for a download", field(plugin, "httpClient"));
    }

    @Test public void firstCapabilityQueryStillReportsActualNativeAvailabilityAndStableErrors() throws Exception {
        LocalPlugin plugin = new LocalPlugin();
        plugin.load();
        StateCall first = new StateCall();
        plugin.getEngineState(first);
        assertNotNull(first.resolved);
        assertFalse("the host JVM has no Android Bergamot native library", first.resolved.getBoolean("engineReady", true));
        assertFalse(first.resolved.getString("engineError", "").isEmpty());
        StateCall second = new StateCall();
        plugin.getEngineState(second);
        assertEquals(first.resolved.toString(), second.resolved.toString());
        assertNull("checking engine availability must not create a download client", field(plugin, "httpClient"));
    }
}
