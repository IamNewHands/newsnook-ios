package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebView;
import java.lang.reflect.Field;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class UserscriptPrivacyStorageTest {
    @Test public void privateScriptValuesStayInsideTheirRuntime() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        String key = "privacy-isolation-" + UUID.randomUUID();
        SharedPreferences disk = context.getSharedPreferences("newsnook-userscript-storage", Context.MODE_PRIVATE);
        disk.edit().putString(key, "{\"ordinary\":true}").commit();
        WebView firstView = new WebView(context);
        WebView secondView = new WebView(context);
        UserscriptRuntime first = new UserscriptRuntime(context, firstView, true);
        UserscriptRuntime second = new UserscriptRuntime(context, secondView, true);
        UserscriptRuntime normal = new UserscriptRuntime(context, firstView, false);
        try {
            Field field = UserscriptRuntime.class.getDeclaredField("storage");
            field.setAccessible(true);
            SharedPreferences privateValues = (SharedPreferences) field.get(first);
            SharedPreferences secondPrivateValues = (SharedPreferences) field.get(second);
            SharedPreferences ordinaryValues = (SharedPreferences) field.get(normal);
            assertTrue(privateValues instanceof MemoryPreferences);
            assertNotSame(privateValues, secondPrivateValues);
            assertFalse("a private script must not import an ordinary GM value", privateValues.contains(key));
            privateValues.edit().putString(key, "{\"private\":true}").commit();
            assertFalse("another runtime cannot read private GM values", secondPrivateValues.contains(key));
            secondPrivateValues.edit().putString(key, "{\"otherRuntime\":true}").commit();
            assertEquals("{\"private\":true}", privateValues.getString(key, null));
            assertEquals("{\"ordinary\":true}", ordinaryValues.getString(key, null));
            assertEquals("{\"ordinary\":true}", disk.getString(key, null));
            privateValues.edit().remove(key).apply();
            secondPrivateValues.edit().remove(key).apply();
        } finally {
            first.close();
            second.close();
            normal.close();
            firstView.destroy();
            secondView.destroy();
            disk.edit().remove(key).commit();
        }
    }

    @Test public void memoryPreferencesDoNotMutateTheirInputSets() {
        MemoryPreferences values = new MemoryPreferences();
        java.util.Set<String> input = new java.util.HashSet<>();
        input.add("private");
        values.edit().putStringSet("selection", input).apply();
        input.add("ordinary");
        assertEquals(java.util.Collections.singleton("private"), values.getStringSet("selection", null));
        values.getStringSet("selection", null).clear();
        assertEquals(java.util.Collections.singleton("private"), values.getStringSet("selection", null));
        values.edit().clear().apply();
        assertTrue(values.getAll().isEmpty());
    }
}
