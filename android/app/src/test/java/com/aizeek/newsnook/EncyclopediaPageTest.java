package com.aizeek.newsnook;

import static org.junit.Assert.*;
import org.junit.Test;

public class EncyclopediaPageTest {
    @Test public void ignoresResultsFromAReplacedNavigation() {
        String first = "https://baike.baidu.com/item/first";
        String second = "https://baike.baidu.com/item/second";
        assertTrue(EncyclopediaPagePlugin.acceptsProbe(2, 2, first, first, first));
        assertFalse(EncyclopediaPagePlugin.acceptsProbe(2, 3, first, first, second));
        assertFalse(EncyclopediaPagePlugin.acceptsProbe(2, 2, first, first, second));
        assertFalse(EncyclopediaPagePlugin.acceptsProbe(2, 2, first, second, first));
    }

    @Test public void verificationRecoveryWaitsForACompletedHomepage() {
        assertFalse(EncyclopediaPagePlugin.shouldReturnToItem("https://baike.baidu.com/", "loading", false));
        assertFalse(EncyclopediaPagePlugin.shouldReturnToItem("https://baike.baidu.com/", "unsupported", false));
        assertTrue(EncyclopediaPagePlugin.shouldReturnToItem("https://baike.baidu.com/", "unsupported", true));
        assertFalse(EncyclopediaPagePlugin.shouldReturnToItem("https://wappass.baidu.com/", "unsupported", true));
        assertFalse(EncyclopediaPagePlugin.shouldReturnToItem("https://baike.baidu.com/search", "unsupported", true));
    }
    @Test public void requestsDesktopLayoutUsingTheInstalledChromiumVersion() {
        String ua = EncyclopediaPagePlugin.desktopUserAgent("Mozilla/5.0 (Linux; Android 17; sdk_gphone16k_x86_64 Build/CP31; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36");
        assertFalse(ua.contains("Android"));
        assertFalse(ua.contains("Mobile"));
        assertFalse(ua.contains("; wv"));
        assertFalse(ua.contains("Version/4.0"));
        assertTrue(ua.contains("Chrome/150.0.7871.181"));
        assertTrue(ua.contains("(KHTML, like Gecko)"));
    }
    @Test public void onlyBaiduItemUrlsCanStartARead() {
        assertTrue(EncyclopediaPagePlugin.isItemUrl("https://baike.baidu.com/item/星星/5683398"));
        assertFalse(EncyclopediaPagePlugin.isItemUrl("https://evil.test/item/x"));
        assertFalse(EncyclopediaPagePlugin.isItemUrl("https://baike.baidu.com.evil.test/item/x"));
        assertFalse(EncyclopediaPagePlugin.isItemUrl("https://user@baike.baidu.com/item/x"));
        assertFalse(EncyclopediaPagePlugin.isItemUrl("http://baike.baidu.com/item/x"));
        assertFalse(EncyclopediaPagePlugin.isItemUrl("https://baike.baidu.com:444/item/x"));
        assertFalse(EncyclopediaPagePlugin.isItemUrl("https://baike.baidu.com/"));
    }

    @Test public void browserNavigationAllowsOfficialVerificationOnly() {
        assertTrue(EncyclopediaPagePlugin.allowsNavigation("https://baike.baidu.com/item/x/1"));
        assertTrue(EncyclopediaPagePlugin.allowsNavigation("https://wappass.baidu.com/static/captcha/tuxing.html"));
        assertFalse(EncyclopediaPagePlugin.allowsNavigation("https://example.test/"));
        assertFalse(EncyclopediaPagePlugin.allowsNavigation("intent://open-app"));
        assertFalse(EncyclopediaPagePlugin.allowsNavigation("file:///sdcard/private"));
        assertFalse(EncyclopediaPagePlugin.allowsNavigation("javascript:alert(1)"));
    }
}
