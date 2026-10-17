package com.aizeek.newsnook;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.capacitorjs.plugins.network.Network;
import com.capacitorjs.plugins.network.NetworkStatus;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Keeps Capacitor's Network API while owning callbacks across Bridge recreation. */
@CapacitorPlugin(name = "Network")
public class NewsNookNetworkPlugin extends Plugin {
    private static final String NETWORK_CHANGE_EVENT = "networkStatusChange";
    private final Handler callbackHandler = new Handler(Looper.getMainLooper());
    private ConnectivityManager manager;
    private Network statusReader;
    private ConnectivityManager.NetworkCallback activeCallback;
    private NetworkStatus prePauseStatus;
    private boolean paused = true;
    private volatile boolean destroyed;

    @Override public void load() {
        Context context = getContext().getApplicationContext();
        manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        // Reuse the upstream status interpretation only. Its monitoring callback
        // dereferences a listener cleared by destroy and must never be registered.
        statusReader = new Network(context);
        Log.d("NewsNookNetwork", "App network lifecycle adapter loaded");
    }

    @PluginMethod public void getStatus(PluginCall call) {
        if (destroyed || statusReader == null) { call.reject("网络监听已关闭"); return; }
        call.resolve(parseStatus(statusReader.getNetworkStatus()));
    }

    @Override protected void handleOnResume() {
        if (destroyed || !paused || statusReader == null) return;
        paused = false;
        ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onLost(android.net.Network network) { dispatch(this, true); }
            @Override public void onCapabilitiesChanged(android.net.Network network, NetworkCapabilities capabilities) {
                dispatch(this, false);
            }
        };
        activeCallback = callback;
        try {
            if (manager != null) manager.registerDefaultNetworkCallback(callback);
        } catch (RuntimeException error) {
            activeCallback = null;
            Log.w("NewsNookNetwork", "Could not register network monitoring", error);
        }
        NetworkStatus current = statusReader.getNetworkStatus();
        if (prePauseStatus != null && !current.connected
                && (prePauseStatus.connected || current.connectionType != prePauseStatus.connectionType)) {
            notifyListeners(NETWORK_CHANGE_EVENT, parseStatus(current));
        }
        prePauseStatus = null;
    }

    @Override protected void handleOnPause() {
        if (destroyed || paused) return;
        paused = true;
        prePauseStatus = statusReader.getNetworkStatus();
        stopMonitoring();
    }

    @Override protected void handleOnDestroy() {
        if (destroyed) return;
        destroyed = true;
        paused = true;
        prePauseStatus = null;
        // Renderer recovery may destroy the Bridge before Activity.onPause.
        stopMonitoring();
    }

    private void stopMonitoring() {
        ConnectivityManager.NetworkCallback retired = activeCallback;
        activeCallback = null;
        callbackHandler.removeCallbacksAndMessages(null);
        if (manager != null && retired != null) {
            try { manager.unregisterNetworkCallback(retired); }
            catch (IllegalArgumentException error) {
                Log.w("NewsNookNetwork", "Network callback was already unregistered", error);
            }
        }
    }

    private void dispatch(ConnectivityManager.NetworkCallback source, boolean lost) {
        if (destroyed) return;
        callbackHandler.post(() -> {
            // Callbacks can already be queued when unregister returns. A new
            // registration uses a new identity, so old callbacks stay retired.
            if (destroyed || paused || source != activeCallback) return;
            JSObject status = lost ? new JSObject().put("connected", false).put("connectionType", "none")
                : parseStatus(statusReader.getNetworkStatus());
            notifyListeners(NETWORK_CHANGE_EVENT, status);
        });
    }

    private JSObject parseStatus(NetworkStatus status) {
        return new JSObject().put("connected", status.connected)
            .put("connectionType", status.connectionType.getConnectionType());
    }
}
