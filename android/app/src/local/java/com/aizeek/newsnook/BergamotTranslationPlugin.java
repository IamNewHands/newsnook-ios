package com.aizeek.newsnook;

import android.Manifest;
import android.os.Build;
import android.os.SystemClock;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.OkHttpClient;
import org.json.JSONException;

/**
 * Bergamot / Marian 离线翻译 Capacitor 插件。
 * Web 层不接触 Marian 类型；模型按语对下载到私有目录。
 */
@CapacitorPlugin(
    name = "BergamotTranslation",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class BergamotTranslationPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private OkHttpClient httpClient;

    private BergamotModelStore store;
    private boolean nativeLoadAttempted;
    private volatile boolean nativeLoaded = false;
    private volatile String nativeLoadError = null;

    @Override
    public void load() {
        store = new BergamotModelStore(getContext());
    }

    private synchronized OkHttpClient httpClient() {
        if (httpClient == null) {
            httpClient = new OkHttpClient.Builder()
                .retryOnConnectionFailure(true)
                .build();
        }
        return httpClient;
    }

    /** Capability queries and translation still observe the real engine state. */
    private synchronized void ensureNativeLoaded() {
        if (nativeLoadAttempted) return;
        nativeLoadAttempted = true;
        try {
            System.loadLibrary("c++_shared");
        } catch (Throwable ignored) {
        }
        try {
            System.loadLibrary("bergamot_jni");
            nativeLoaded = true;
        } catch (Throwable error) {
            nativeLoaded = false;
            nativeLoadError = error instanceof UnsatisfiedLinkError
                ? explainNativeLoadError((UnsatisfiedLinkError) error)
                : (error.getMessage() == null ? "原生库加载失败" : error.getMessage());
        }
    }

    @PluginMethod
    public void getEngineState(PluginCall call) {
        call.resolve(engineStateObject());
    }

    @PluginMethod
    public void getModelState(PluginCall call) {
        BergamotModelCatalog.PairSpec pair = readPair(call);
        if (pair == null) return;
        call.resolve(modelStateObject(pair));
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        if (needsNotificationPermission()) {
            requestPermissionForAlias("notifications", call, "downloadModelPermsCallback");
            return;
        }
        beginDownloadModel(call);
    }

    @PermissionCallback
    private void downloadModelPermsCallback(PluginCall call) {
        beginDownloadModel(call);
    }

    private void beginDownloadModel(PluginCall call) {
        BergamotModelCatalog.PairSpec pair = readPair(call);
        if (pair == null) return;
        bridge.saveCall(call);

        ModelDownloadNotifier notifier = new ModelDownloadNotifier(
            getContext(),
            ModelDownloadNotifier.ID_BERGAMOT,
            "有所闻 · 正在下载 Bergamot 语对"
        );
        notifier.startIndeterminate("Firefox Translations 模型 · 约 40–50 MB");

        executor.execute(() -> {
            try {
                ensureNativeLoaded();
                store.download(pair, httpClient(), notifier::updateBytes);
                bridge.getActivity().runOnUiThread(() -> {
                    notifier.clear();
                    call.resolve(modelStateObject(pair));
                    bridge.releaseCall(call);
                });
            } catch (Exception error) {
                bridge.getActivity().runOnUiThread(() -> {
                    notifier.clear();
                    call.reject("Bergamot 模型下载失败：" + safeMessage(error), error);
                    bridge.releaseCall(call);
                });
            }
        });
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        BergamotModelCatalog.PairSpec pair = readPair(call);
        if (pair == null) return;
        executor.execute(() -> {
            try {
                ensureNativeLoaded();
                if (nativeLoaded && nativeEngineReady()) {
                    nativeUnload(pair.pairKey);
                }
                store.delete(pair);
                bridge.getActivity().runOnUiThread(() -> call.resolve(modelStateObject(pair)));
            } catch (Exception error) {
                bridge.getActivity().runOnUiThread(
                    () -> call.reject("Bergamot 模型删除失败：" + safeMessage(error), error)
                );
            }
        });
    }

    @PluginMethod
    public void translate(PluginCall call) {
        BergamotModelCatalog.PairSpec pair = readPair(call);
        if (pair == null) return;

        ensureNativeLoaded();
        if (!nativeLoaded) {
            call.reject(
                "ENGINE_NOT_BUILT：原生库未链接（" +
                    (nativeLoadError == null ? "missing libbergamot_jni" : nativeLoadError) +
                    "）。"
            );
            return;
        }
        if (!nativeEngineReady()) {
            call.reject(nativeEngineError());
            return;
        }
        if (!store.isReady(pair)) {
            call.reject("MODEL_NOT_DOWNLOADED：请先在翻译设置中下载该语对模型");
            return;
        }

        JSArray input = call.getArray("texts");
        if (input == null || input.length() == 0) {
            call.reject("缺少待翻译文本");
            return;
        }
        List<String> texts = new ArrayList<>();
        try {
            for (int index = 0; index < input.length(); index++) texts.add(input.getString(index));
        } catch (JSONException error) {
            call.reject("待翻译文本格式不正确", error);
            return;
        }

        bridge.saveCall(call);
        executor.execute(() -> {
            try {
                ensureLoaded(pair);
                String[] translated = nativeTranslate(pair.pairKey, texts.toArray(new String[0]));
                if (translated == null || translated.length != texts.size()) {
                    throw new IllegalStateException("引擎返回段落数量不匹配");
                }
                JSObject result = new JSObject();
                result.put("translations", new JSArray(translated));
                bridge.getActivity().runOnUiThread(() -> {
                    call.resolve(result);
                    bridge.releaseCall(call);
                });
            } catch (Exception error) {
                bridge.getActivity().runOnUiThread(() -> {
                    call.reject("Bergamot 离线翻译失败：" + safeMessage(error), error);
                    bridge.releaseCall(call);
                });
            }
        });
    }

    private void ensureLoaded(BergamotModelCatalog.PairSpec pair) {
        String yaml = store.buildConfigYaml(pair);
        int code = nativeLoad(pair.pairKey, yaml);
        if (code != 0) {
            throw new IllegalStateException("无法加载 Bergamot 模型（code=" + code + "）");
        }
    }

    private JSObject modelStateObject(BergamotModelCatalog.PairSpec pair) {
        JSObject result = engineStateObject();
        boolean modelReady = store.isReady(pair);
        result.put("ready", modelReady);
        result.put("modelKey", pair.source + "-" + pair.target);
        result.put("downloadedModels", new JSArray(store.downloadedPairKeys()));
        return result;
    }

    private JSObject engineStateObject() {
        ensureNativeLoaded();
        JSObject result = new JSObject();
        boolean engineReady = nativeLoaded && nativeEngineReady();
        result.put("engineReady", engineReady);
        if (!engineReady) {
            String error = nativeLoaded ? nativeEngineError() : nativeLoadError;
            result.put(
                "engineError",
                error == null || error.isEmpty()
                    ? "Bergamot 引擎未就绪"
                    : error
            );
        }
        return result;
    }

    private BergamotModelCatalog.PairSpec readPair(PluginCall call) {
        String source = BergamotModelCatalog.normalize(call.getString("sourceLanguage", ""));
        String target = BergamotModelCatalog.normalize(call.getString("targetLanguage", ""));
        if (source.isEmpty() || target.isEmpty()) {
            call.reject("缺少语言参数");
            return null;
        }
        if (source.equals(target)) {
            call.reject("原文语言与译文语言不能相同");
            return null;
        }
        BergamotModelCatalog.PairSpec pair = BergamotModelCatalog.find(source, target);
        if (pair == null) {
            call.reject("Bergamot 暂不支持该语对：" + source + "→" + target);
            return null;
        }
        return pair;
    }

    private boolean needsNotificationPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState("notifications") != PermissionState.GRANTED;
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        if (message == null || message.isEmpty()) return error.getClass().getSimpleName();
        return message.length() > 400 ? message.substring(0, 400) + "…" : message;
    }

    private String explainNativeLoadError(UnsatisfiedLinkError error) {
        String raw = error == null ? "" : String.valueOf(error.getMessage());
        String abis = TextUtils.join(", ", Build.SUPPORTED_ABIS);
        boolean arm64Capable = false;
        for (String abi : Build.SUPPORTED_ABIS) {
            if ("arm64-v8a".equals(abi)) {
                arm64Capable = true;
                break;
            }
        }
        if (raw.contains("libbergamot_jni.so") && !arm64Capable) {
            return "当前设备 ABI 不支持 Bergamot（仅编入 arm64-v8a；本机 ABI: " + abis + "）";
        }
        if (raw.contains("libbergamot_jni.so")) {
            return "未加载到 Bergamot 原生库。请确认安装的是最新 local APK（本机 ABI: " + abis + "）";
        }
        return raw == null || raw.isEmpty() ? "Bergamot 引擎未就绪" : raw;
    }

    private static native boolean nativeEngineReady();

    private static native String nativeEngineError();

    private static native int nativeLoad(String pairKey, String configYaml);

    private static native void nativeUnload(String pairKey);

    private static native String[] nativeTranslate(String pairKey, String[] texts);
}
