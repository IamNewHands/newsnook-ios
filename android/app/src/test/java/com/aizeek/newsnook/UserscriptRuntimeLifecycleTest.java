package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.webkit.WebView;
import java.lang.reflect.Field;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class UserscriptRuntimeLifecycleTest {
    @Test public void closedRuntimeCannotReinstallIntoAReleasedTab() throws Exception {
        WebView view = new WebView(RuntimeEnvironment.getApplication());
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        runtime.close();
        assertFalse(runtime.install());
        view.destroy();
    }

    @Test public void closeCancelsDependenciesAndDownloadsNotInTheGmRequestMap() throws Exception {
        WebView view = new WebView(RuntimeEnvironment.getApplication());
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        Field clientField = UserscriptRuntime.class.getDeclaredField("client");
        clientField.setAccessible(true);
        OkHttpClient client = (OkHttpClient) clientField.get(runtime);
        AtomicReference<Exception> failure = new AtomicReference<>();
        try (ServerSocket server = new ServerSocket(0)) {
            server.setSoTimeout(5000);
            Call call = client.newCall(new Request.Builder().url("http://127.0.0.1:" + server.getLocalPort() + "/dependency").build());
            Thread worker = new Thread(() -> {
                try (Response ignored = call.execute()) { }
                catch (Exception error) { failure.set(error); }
            }, "UserscriptDependencyTest");
            worker.start();
            try (Socket connection = server.accept()) {
                runtime.close();
                assertTrue("all runtime-owned calls must be cancelled, including synchronous @require/download calls", call.isCanceled());
            } finally {
                call.cancel();
                worker.join(5000);
                runtime.close();
                view.destroy();
            }
            assertFalse("the cancelled resource download must not outlive the tab", worker.isAlive());
            assertNotNull(failure.get());
        }
    }
}
