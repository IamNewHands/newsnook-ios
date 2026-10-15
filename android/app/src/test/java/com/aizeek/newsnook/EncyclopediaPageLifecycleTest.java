package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.view.ViewGroup;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class EncyclopediaPageLifecycleTest {
    private static class Call extends PluginCall {
        String error;
        boolean resolved;
        Call(String method, String id) {
            super(null, "EncyclopediaPage", id, method, new JSObject().put("id", id).put("url", "https://baike.baidu.com/item/test"));
        }
        @Override public void reject(String message) { error = message; }
        @Override public void resolve() { resolved = true; }
    }

    @Test public void cancellationRemovesOnlyItsOwnBrowserTask() {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        EncyclopediaPagePlugin plugin = new EncyclopediaPagePlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
            @Override public Context getContext() { return activity; }
        };
        ViewGroup content = activity.findViewById(android.R.id.content);
        int initial = content.getChildCount();
        Call first = new Call("read", "first");
        plugin.read(first);
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
        assertNull(first.error);
        assertEquals(initial + 1, content.getChildCount());
        Call unrelated = new Call("cancel", "other");
        plugin.cancel(unrelated);
        assertNull(first.error);
        assertEquals(initial + 1, content.getChildCount());
        plugin.cancel(new Call("cancel", "first"));
        assertEquals("百科查询已取消", first.error);
        assertEquals(initial, content.getChildCount());
        plugin.handleOnDestroy();
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
        activity.finish();
    }
}
