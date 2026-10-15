package com.aizeek.newsnook;

import static com.aizeek.newsnook.LinuxDoLoginNavigation.Action.*;
import static org.junit.Assert.assertEquals;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class LinuxDoLoginNavigationTest {
    @Test public void officialLoginStaysInFirstPartyWebView() {
        assertEquals(ALLOW_FIRST_PARTY, LinuxDoLoginNavigation.decide("https://linux.do/login", true));
        assertEquals(ALLOW_FIRST_PARTY, LinuxDoLoginNavigation.decide("https://connect.linux.do/", true));
        assertEquals(ALLOW_FIRST_PARTY, LinuxDoLoginNavigation.decide("https://linux.do/session/current.json", false));
        assertEquals(ALLOW_FIRST_PARTY, LinuxDoLoginNavigation.decide("https://linux.do/auth/github/callback", true));
    }

    @Test public void knownSocialButtonsHandoffBeforeEnteringEmbeddedOAuth() {
        for (String provider : new String[] {"google_oauth2", "github", "apple", "discord", "facebook", "oidc"}) {
            assertEquals(provider, HANDOFF_TO_SYSTEM_AUTH,
                LinuxDoLoginNavigation.decide("https://linux.do/auth/" + provider + "?origin=%2F", true));
        }
        assertEquals(HANDOFF_TO_SYSTEM_AUTH,
            LinuxDoLoginNavigation.decide("https://accounts.google.com/o/oauth2/v2/auth?client_id=test", true));
        assertEquals(HANDOFF_TO_SYSTEM_AUTH,
            LinuxDoLoginNavigation.decide("https://github.com/login/oauth/authorize", true));
    }

    @Test public void cloudflareOtpAndOtherVerificationDoNotHandoff() {
        assertEquals(ALLOW_FIRST_PARTY,
            LinuxDoLoginNavigation.decide("https://linux.do/auth/github", false));
        assertEquals(BLOCK,
            LinuxDoLoginNavigation.decide("https://accounts.google.com/o/oauth2/v2/auth", false));
    }

    @Test public void arbitraryThirdPartyAndLookalikeDomainsStayBlocked() {
        for (String url : new String[] {
            "https://evil.example/", "https://linux.do.evil.example/login",
            "https://accounts.google.com.evil.example/", "https://user@linux.do/auth/google_oauth2",
            "https://user%40linux.do@evil.example/", "http://github.com/login/oauth/authorize",
            "https://github.com:444/login/oauth/authorize", "javascript:alert(1)",
            "intent://accounts.google.com/", "https://login.linux.do.evil.example/",
            "https://linux.do/auth/logout", "https://linux.do/auth/../../phishing"
        }) {
            LinuxDoLoginNavigation.Action action = LinuxDoLoginNavigation.decide(url, true);
            if (url.contains("/auth/logout") || url.contains("/auth/../")) {
                // A first-party URL may load, but it must never launch external OAuth.
                assertEquals(url, ALLOW_FIRST_PARTY, action);
            } else {
                assertEquals(url, BLOCK, action);
            }
        }
    }
}
