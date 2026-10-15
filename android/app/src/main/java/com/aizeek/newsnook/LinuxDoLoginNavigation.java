package com.aizeek.newsnook;

import android.net.Uri;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Navigation policy for the interactive Linux.do login WebView.
 *
 * Google OAuth forbids embedded user agents; merely whitelisting accounts.google.com
 * would still break login. Provider navigation instead hands off to Discourse's
 * User API Key flow in a Custom Tab, returning an OTP to the app-owned session.
 */
final class LinuxDoLoginNavigation {
    enum Action { ALLOW_FIRST_PARTY, HANDOFF_TO_SYSTEM_AUTH, BLOCK }

    private static final Set<String> PROVIDERS = new HashSet<>(Arrays.asList(
        "google_oauth2", "google", "github", "apple", "facebook", "discord",
        "twitter", "twitter_oauth2", "microsoft", "openid_connect", "oidc",
        "oauth2_basic", "discourse_id", "amazon", "twitch"
    ));
    private static final Set<String> PROVIDER_HOSTS = new HashSet<>(Arrays.asList(
        "accounts.google.com", "github.com", "appleid.apple.com", "www.facebook.com",
        "facebook.com", "discord.com", "login.microsoftonline.com", "id.discourse.com",
        "api.twitter.com", "twitter.com", "x.com"
    ));

    private LinuxDoLoginNavigation() {}

    static Action decide(String rawUrl, boolean interactiveLogin) {
        if (rawUrl == null || rawUrl.isEmpty()) return Action.BLOCK;
        Uri uri;
        try {
            uri = Uri.parse(rawUrl);
        } catch (RuntimeException ignored) {
            return Action.BLOCK;
        }
        String authority = uri.getEncodedAuthority();
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || authority == null
            || authority.contains("@") || authority.toLowerCase(Locale.ROOT).contains("%40")
            || (uri.getPort() != -1 && uri.getPort() != 443)) return Action.BLOCK;
        host = host.toLowerCase(Locale.ROOT);
        boolean firstParty = host.equals("linux.do") || host.endsWith(".linux.do");
        if (firstParty) {
            if (interactiveLogin && host.equals("linux.do") && isProviderEntry(uri.getPath())) {
                return Action.HANDOFF_TO_SYSTEM_AUTH;
            }
            return Action.ALLOW_FIRST_PARTY;
        }
        if (interactiveLogin && PROVIDER_HOSTS.contains(host)) return Action.HANDOFF_TO_SYSTEM_AUTH;
        return Action.BLOCK;
    }

    private static boolean isProviderEntry(String path) {
        if (path == null) return false;
        String[] parts = path.toLowerCase(Locale.ROOT).split("/");
        return parts.length == 3 && parts[0].isEmpty() && "auth".equals(parts[1])
            && PROVIDERS.contains(parts[2]);
    }
}
