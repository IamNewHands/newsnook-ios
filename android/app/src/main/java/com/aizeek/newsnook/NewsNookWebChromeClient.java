package com.aizeek.newsnook;

import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Retain Capacitor's WebChromeClient (file chooser, JS dialogs and permissions)
 * while making HTML5 video fullscreen work in the MAIN WebView. Linux.do post
 * iframe players live in this WebView, not in the media-sniffer's live WebView.
 */
final class NewsNookWebChromeClient extends BridgeWebChromeClient {
    private final OriginVideoFullscreen fullscreen;
    private final android.content.Context context;

    NewsNookWebChromeClient(Bridge bridge, androidx.appcompat.app.AppCompatActivity activity) {
        super(bridge);
        context = activity;
        View content = activity.findViewById(android.R.id.content);
        if (!(content instanceof FrameLayout)) {
            throw new IllegalStateException("Activity content must host fullscreen video");
        }
        FrameLayout host = (FrameLayout) content;
        BrowserFullscreenHost window = (BrowserFullscreenHost) activity;
        fullscreen = new OriginVideoFullscreen(activity, host, window::setVideoFullscreen);
    }

    @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
        if (message.message().startsWith("__NNSTART ")) {
            if (BuildConfig.DEBUG || BuildConfig.STARTUP_BENCHMARK) {
                android.util.Log.i("NewsNookStartup", message.message() + " elapsed=" + android.os.SystemClock.elapsedRealtime() + "ms");
            }
            // The frame signal must originate from the packaged Capacitor main
            // document, not an arbitrary article, browser tab or embedded iframe.
            String source = message.sourceId();
            if (message.message().startsWith("__NNSTART first-ui-frame web=")
                    && source != null && source.startsWith("https://localhost/")
                    && context instanceof MainActivity) {
                ((MainActivity) context).notifyFirstUiPaintFromConsole();
            }
            return true;
        }
        return BrowserHostPlugin.isPrivacyModeEnabled(context) || super.onConsoleMessage(message);
    }

    @Override
    public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
        fullscreen.onShowCustomView(view, callback);
    }

    @Override
    public void onHideCustomView() {
        fullscreen.onHideCustomView();
    }

    void release() {
        onHideCustomView();
    }
}
