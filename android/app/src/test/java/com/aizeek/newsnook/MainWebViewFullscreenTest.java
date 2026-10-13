package com.aizeek.newsnook;

import static org.junit.Assert.*;
import com.getcapacitor.BridgeWebChromeClient;
import java.lang.reflect.Field;
import org.junit.Test;

/** Capacitor's real Bridge registers WebView infrastructure Robolectric cannot emulate.
 * OriginVideoFullscreenTest exercises the actual view, orientation and Back behavior.
 * This test protects the main-WebView-to-Capacitor adapter contract. */
public class MainWebViewFullscreenTest {
    @Test public void fullscreenChromePreservesCapacitorsFullBrowserCapabilities() throws Exception {
        assertTrue("file chooser, JS dialogs and permission prompts must remain supported",
            BridgeWebChromeClient.class.isAssignableFrom(NewsNookWebChromeClient.class));
        Field chrome = MainActivity.class.getDeclaredField("mainWebChromeClient");
        assertEquals("the main Activity must own the lifetime of the Chrome adapter",
            NewsNookWebChromeClient.class, chrome.getType());
        assertNotNull(NewsNookWebChromeClient.class.getDeclaredMethod("release"));
    }
}
