package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.appcompat.app.AppCompatActivity;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class SessionClientInitializationTest {
    private static Field clientField(Class<?> type) throws Exception {
        Field field = type.getDeclaredField("identityClient");
        field.setAccessible(true);
        return field;
    }

    @Test public void registeringSitePluginsDoesNotInitializeTheirHttpClients() throws Exception {
        assertNull("ordinary Home startup must not initialize Zhihu TLS",
            clientField(ZhihuSessionPlugin.class).get(new ZhihuSessionPlugin()));
        assertNull("ordinary Home startup must not initialize Linux.do TLS",
            clientField(LinuxDoSessionPlugin.class).get(new LinuxDoSessionPlugin()));
    }

    @Test public void concurrentFirstUsesShareOneClientWithExistingRequestSettings() throws Exception {
        OkHttpClient zhihu = firstClientFromConcurrentCalls(new ZhihuSessionPlugin(), ZhihuSessionPlugin.class);
        assertEquals(10_000, zhihu.connectTimeoutMillis());
        assertEquals(15_000, zhihu.readTimeoutMillis());
        assertFalse(zhihu.followRedirects());
        assertFalse(zhihu.followSslRedirects());

        OkHttpClient linuxDo = firstClientFromConcurrentCalls(new LinuxDoSessionPlugin(), LinuxDoSessionPlugin.class);
        assertEquals(15_000, linuxDo.connectTimeoutMillis());
        assertEquals(30_000, linuxDo.readTimeoutMillis());
        assertEquals(120_000, linuxDo.writeTimeoutMillis());
        assertFalse(linuxDo.followRedirects());
        assertFalse(linuxDo.followSslRedirects());
    }

    private static OkHttpClient firstClientFromConcurrentCalls(Object plugin, Class<?> type) throws Exception {
        Method getter = type.getDeclaredMethod("identityClient");
        getter.setAccessible(true);
        ExecutorService threads = Executors.newFixedThreadPool(4);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<OkHttpClient>> calls = new ArrayList<>();
        try {
            for (int i = 0; i < 4; i++) calls.add(threads.submit(() -> {
                assertTrue(start.await(5, TimeUnit.SECONDS));
                return (OkHttpClient) getter.invoke(plugin);
            }));
            start.countDown();
            OkHttpClient first = calls.get(0).get(10, TimeUnit.SECONDS);
            for (Future<OkHttpClient> call : calls) assertSame(first, call.get(10, TimeUnit.SECONDS));
            assertSame(first, clientField(type).get(plugin));
            return first;
        } finally {
            threads.shutdownNow();
        }
    }

    @Test public void destroyingUnusedZhihuPluginDoesNotCreateAClientToCancelIt() throws Exception {
        ZhihuSessionPlugin plugin = new ZhihuSessionPlugin();
        plugin.handleOnDestroy();
        assertNull(clientField(ZhihuSessionPlugin.class).get(plugin));
    }

    @Test public void destroyingUnusedLinuxDoPluginDoesNotCreateAClient() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        LinuxDoSessionPlugin plugin = new LinuxDoSessionPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
            @Override public Context getContext() { return RuntimeEnvironment.getApplication(); }
        };
        plugin.handleOnDestroy();
        assertNull(clientField(LinuxDoSessionPlugin.class).get(plugin));
    }
}
