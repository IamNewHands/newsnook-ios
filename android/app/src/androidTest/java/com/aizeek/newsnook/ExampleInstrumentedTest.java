package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Instrumented test, which will execute on an Android device.
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    @Test
    public void useAppContext() throws Exception {
        // Context of the app under test.
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        // Test APK names follow <applicationId>.test across both cloudDebug and
        // release; do not hard-code the release ID for a debug-only test.
        String instrumentationPackage = InstrumentationRegistry.getInstrumentation().getContext().getPackageName();
        assertTrue(instrumentationPackage.endsWith(".test"));
        assertEquals(instrumentationPackage.substring(0, instrumentationPackage.length() - 5),
            appContext.getPackageName());
    }
}
