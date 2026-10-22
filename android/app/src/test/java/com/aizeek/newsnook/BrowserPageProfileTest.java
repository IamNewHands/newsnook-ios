package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.webkit.WebView;
import androidx.webkit.UserAgentMetadata;
import java.util.Collections;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class BrowserPageProfileTest {
    private static final String SYSTEM = "Mozilla/5.0 (Linux; Android 17; Pixel 9 Build/BP; wv) "
        + "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36";

    private UserAgentMetadata metadata() {
        return new UserAgentMetadata.Builder()
            .setBrandVersionList(Collections.singletonList(new UserAgentMetadata.BrandVersion.Builder()
                .setBrand("Android WebView").setMajorVersion("150").setFullVersion("150.0.7871.181").build()))
            .setFullVersion("150.0.7871.181").setPlatform("Android").setPlatformVersion("17")
            .setArchitecture("arm").setModel("Pixel 9").setMobile(true).setBitness(64).setWow64(false).build();
    }

    @Test public void mobileAndDesktopAgentsKeepTheInstalledEngineVersion() {
        String android = BrowserPageProfile.resolveUserAgent("android", SYSTEM, "");
        assertTrue(android.contains("Android 17"));
        assertTrue(android.contains("Chrome/150.0.7871.181"));
        assertFalse(android.contains("; wv"));
        assertFalse(android.contains("Version/4.0"));
        String desktop = BrowserPageProfile.resolveUserAgent("desktop", SYSTEM, "");
        assertTrue(desktop.contains("X11; Linux x86_64"));
        assertTrue(desktop.contains("Chrome/150.0.7871.181"));
        assertFalse(desktop.contains("Android"));
        assertFalse(desktop.contains("Mobile"));
        assertEquals(SYSTEM, BrowserPageProfile.resolveUserAgent("system", SYSTEM, ""));
    }

    @Test public void desktopHintsNoLongerAdvertiseAndroidOrMobile() {
        UserAgentMetadata original = metadata();
        UserAgentMetadata desktop = BrowserPageProfile.resolveMetadata("desktop", original,
            BrowserPageProfile.resolveUserAgent("desktop", SYSTEM, ""));
        assertEquals("Linux", desktop.getPlatform());
        assertEquals("", desktop.getPlatformVersion());
        assertFalse(desktop.isMobile());
        assertEquals("", desktop.getModel());
        assertEquals("x86", desktop.getArchitecture());
        assertEquals(64, desktop.getBitness());
        assertEquals("Google Chrome", desktop.getBrandVersionList().get(0).getBrand());
        assertEquals("150.0.7871.181", desktop.getBrandVersionList().get(0).getFullVersion());
        assertTrue(original.isMobile());
        assertEquals("Android WebView", original.getBrandVersionList().get(0).getBrand());
        assertSame(original, BrowserPageProfile.resolveMetadata("system", original, SYSTEM));
    }

    @Test public void iosCompatibilityChoiceHasAnIphoneIdentityAndCanRestoreAndroid() {
        String ios = BrowserPageProfile.resolveUserAgent("ios", SYSTEM, "");
        assertTrue(ios.contains("iPhone"));
        assertTrue(ios.contains("Version/26.0"));
        assertFalse(ios.contains("Chrome/"));
        UserAgentMetadata original = metadata();
        UserAgentMetadata hints = BrowserPageProfile.resolveMetadata("ios", original, ios);
        assertEquals("iOS", hints.getPlatform());
        assertTrue(hints.isMobile());
        assertEquals("iPhone", hints.getModel());
        UserAgentMetadata android = BrowserPageProfile.resolveMetadata("android", original,
            BrowserPageProfile.resolveUserAgent("android", SYSTEM, ""));
        assertEquals("Android", android.getPlatform());
        assertEquals("Pixel 9", android.getModel());
        assertTrue(android.isMobile());
        assertEquals("150.0.7871.181", android.getFullVersion());
    }

    @Test public void customAgentIsExactAndDoesNotRetainThePreviousPresetPlatform() {
        String custom = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CustomBrowser/1";
        assertEquals(custom, BrowserPageProfile.resolveUserAgent("custom", SYSTEM, custom));
        UserAgentMetadata hints = BrowserPageProfile.resolveMetadata("custom", metadata(), custom);
        assertEquals("Windows", hints.getPlatform());
        assertFalse(hints.isMobile());
        assertEquals("", hints.getModel());
        assertEquals("", hints.getPlatformVersion());
    }

    @Test public void returningToSystemRestoresItsOriginalUaAndKeepsPinchZoomAvailable() {
        WebView view = new WebView(RuntimeEnvironment.getApplication());
        view.getSettings().setUserAgentString(SYSTEM);
        BrowserPageProfile profile = new BrowserPageProfile(view);
        profile.apply("desktop", "");
        assertTrue(view.getSettings().getUseWideViewPort());
        assertTrue(view.getSettings().getLoadWithOverviewMode());
        assertTrue(view.getSettings().getBuiltInZoomControls());
        assertFalse(view.getSettings().getDisplayZoomControls());
        profile.apply("ios", "");
        assertTrue(view.getSettings().getUserAgentString().contains("iPhone"));
        profile.apply("system", "");
        assertEquals(SYSTEM, view.getSettings().getUserAgentString());
        profile.close(true);
        view.destroy();
    }
}
