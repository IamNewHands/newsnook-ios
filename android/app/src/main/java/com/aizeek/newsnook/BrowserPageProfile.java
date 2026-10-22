package com.aizeek.newsnook;

import android.content.Context;
import android.os.Build;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.ScriptHandler;
import androidx.webkit.UserAgentMetadata;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Keeps the request identity and desktop viewport in one reversible per-WebView policy. */
final class BrowserPageProfile {
    // Safari's documented compatibility UA freezes iOS at 18.6, independently of OS upgrades.
    private static final String IPHONE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) "
        + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
    private static final String RESTORE_VIEWPORT =
        "window.__newsnookDesktopViewport&&window.__newsnookDesktopViewport.restore()";
    private final WebView view;
    private final String systemUserAgent;
    private final UserAgentMetadata systemMetadata;
    private final String desktopScript;
    private ScriptHandler viewportHandler;
    private boolean desktop;
    private boolean closed;

    BrowserPageProfile(WebView view) {
        this.view = view;
        String original = view.getSettings().getUserAgentString();
        if (original == null || original.isEmpty()) original = WebSettings.getDefaultUserAgent(view.getContext());
        if (original == null || original.isEmpty()) original = "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE
            + ") AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36";
        systemUserAgent = original;
        UserAgentMetadata metadata = null;
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA))
                metadata = WebSettingsCompat.getUserAgentMetadata(view.getSettings());
        } catch (RuntimeException ignored) { }
        systemMetadata = metadata;
        desktopScript = readDesktopScript(view.getContext());
    }

    static String resolveUserAgent(String mode, String system, String custom) {
        if ("custom".equals(mode)) return custom;
        if ("ios".equals(mode)) return IPHONE_USER_AGENT;
        if ("system".equals(mode)) return system;
        String browser = system.replace("; wv", "").replace("Version/4.0 ", "");
        if ("desktop".equals(mode))
            return browser.replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)")
                .replace(" Mobile ", " ");
        return browser;
    }

    static UserAgentMetadata resolveMetadata(String mode, UserAgentMetadata system, String agent) {
        if ("system".equals(mode)) return system;
        UserAgentMetadata.Builder builder = new UserAgentMetadata.Builder(system);
        if ("android".equals(mode) || "desktop".equals(mode)) {
            List<UserAgentMetadata.BrandVersion> brands = new ArrayList<>();
            for (UserAgentMetadata.BrandVersion brand : system.getBrandVersionList()) {
                if (!brand.getBrand().equals("Android WebView")) brands.add(brand);
                else brands.add(new UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Google Chrome").setMajorVersion(brand.getMajorVersion())
                    .setFullVersion(brand.getFullVersion()).build());
            }
            builder.setBrandVersionList(brands);
        }
        if ("desktop".equals(mode)) {
            builder.setPlatform("Linux").setPlatformVersion("").setMobile(false)
                .setModel("").setArchitecture("x86").setBitness(64).setWow64(false);
        } else if ("android".equals(mode)) {
            builder.setPlatform("Android").setMobile(true);
        } else if ("ios".equals(mode)) {
            builder.setPlatform("iOS").setPlatformVersion("18.6").setMobile(true)
                .setModel("iPhone").setArchitecture("arm").setBitness(64).setWow64(false)
                .setBrandVersionList(Collections.singletonList(new UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Safari").setMajorVersion("26").setFullVersion("26.0").build()))
                .setFullVersion("26.0");
        } else {
            String platform = agent.contains("iPhone") || agent.contains("iPad") ? "iOS"
                : agent.contains("Android") ? "Android" : agent.contains("Windows") ? "Windows"
                : agent.contains("Macintosh") ? "macOS" : agent.contains("Linux") ? "Linux" : "";
            boolean mobile = agent.contains("Mobile") || agent.contains("iPhone") || agent.contains("Android");
            // Never carry over a prior preset's platform/model into a custom identity.
            builder.setPlatform(platform).setPlatformVersion("").setMobile(mobile)
                .setModel("").setArchitecture("").setBitness(0).setWow64(false);
        }
        return builder.build();
    }

    void apply(String mode, String custom) {
        if (closed) return;
        WebSettings settings = view.getSettings();
        boolean nextDesktop = "desktop".equals(mode);
        if (nextDesktop != desktop) {
            desktop = nextDesktop;
            if (viewportHandler != null) { viewportHandler.remove(); viewportHandler = null; }
            if (desktop) {
                try {
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
                        viewportHandler = WebViewCompat.addDocumentStartJavaScript(view, desktopScript, Collections.singleton("*"));
                } catch (RuntimeException ignored) { /* onPageStarted/Finished supports older providers. */ }
            } else view.evaluateJavascript(RESTORE_VIEWPORT, null);
        }
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        String agent = resolveUserAgent(mode, systemUserAgent, custom);
        if (systemMetadata != null) {
            UserAgentMetadata metadata = resolveMetadata(mode, systemMetadata, agent);
            if (!"system".equals(mode)) {
                try {
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA_FORM_FACTORS))
                        metadata = new UserAgentMetadata.Builder(metadata).setFormFactors(Collections.singletonList(
                            "desktop".equals(mode) ? "Desktop" : metadata.isMobile() ? "Mobile" : "Desktop")).build();
                } catch (RuntimeException ignored) { }
            }
            WebSettingsCompat.setUserAgentMetadata(settings, metadata);
        }
        if (!agent.equals(settings.getUserAgentString())) settings.setUserAgentString(agent);
    }

    void onPageStarted() {
        if (!closed && desktop && viewportHandler == null) view.evaluateJavascript(desktopScript, null);
    }

    void onPageFinished() {
        if (!closed && desktop) view.evaluateJavascript(desktopScript, null);
    }

    void close(boolean removeBindings) {
        closed = true;
        if (removeBindings && viewportHandler != null) {
            try { viewportHandler.remove(); } catch (RuntimeException ignored) { }
        }
        viewportHandler = null;
    }

    private static String readDesktopScript(Context context) {
        try (InputStream stream = context.getAssets().open("browser-desktop-viewport.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception error) { throw new IllegalStateException("无法加载桌面网页设置", error); }
    }
}
