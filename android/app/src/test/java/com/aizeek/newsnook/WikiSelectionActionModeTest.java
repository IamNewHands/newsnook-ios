package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.app.Activity;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.LayoutInflater;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.appcompat.view.menu.MenuBuilder;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class WikiSelectionActionModeTest {
    private final Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
    private final List<ValueCallback<String>> replies = new ArrayList<>();
    private final WebView webView = new WebView(activity) {
        @Override public void evaluateJavascript(String script, ValueCallback<String> reply) {
            replies.add(reply);
        }
    };
    private int destroyed;
    private final ActionMode.Callback2 delegate = new ActionMode.Callback2() {
        @Override public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            menu.add(0, 1, 0, "Copy");
            menu.add(0, 2, 1, "Paste").setVisible(false);
            return true;
        }
        @Override public boolean onPrepareActionMode(ActionMode mode, Menu menu) { return false; }
        @Override public boolean onActionItemClicked(ActionMode mode, MenuItem item) { return true; }
        @Override public void onDestroyActionMode(ActionMode mode) { destroyed++; }
        @Override public void onGetContentRect(ActionMode mode, View view, Rect rect) { rect.set(10, 20, 30, 40); }
    };
    private final NewsNookWebView.SelectionCallback callback = new NewsNookWebView.SelectionCallback(webView, delegate);
    private final Menu menu = new MenuBuilder(activity);
    private int invalidations;
    private final ActionMode mode = new ActionMode() {
        @Override public void setTitle(CharSequence title) {}
        @Override public void setTitle(int title) {}
        @Override public void setSubtitle(CharSequence subtitle) {}
        @Override public void setSubtitle(int subtitle) {}
        @Override public void setCustomView(View view) {}
        @Override public void invalidate() { invalidations++; callback.onPrepareActionMode(this, menu); }
        @Override public void finish() { callback.onDestroyActionMode(this); }
        @Override public Menu getMenu() { return menu; }
        @Override public CharSequence getTitle() { return ""; }
        @Override public CharSequence getSubtitle() { return ""; }
        @Override public View getCustomView() { return null; }
        @Override public MenuInflater getMenuInflater() { return new MenuInflater(activity); }
    };

    @Test public void editingAndDisabledWikiRestoreOriginalMenuVisibility() {
        assertTrue(callback.onCreateActionMode(mode, menu));
        assertFalse(menu.hasVisibleItems());
        replies.get(0).onReceiveValue("false");
        assertNotNull("native menu entries must survive the asynchronous eligibility check", menu.findItem(1));
        assertTrue(menu.findItem(1).isVisible());
        assertFalse("do not reveal actions originally unavailable", menu.findItem(2).isVisible());
        assertEquals(0, destroyed);
    }

    @Test public void readerMenuStaysHiddenAcrossInvalidationWithoutDestroyingSelection() {
        assertTrue(callback.onCreateActionMode(mode, menu));
        replies.get(0).onReceiveValue("true");
        assertFalse(menu.hasVisibleItems());
        mode.invalidate();
        assertFalse(menu.hasVisibleItems());
        replies.get(replies.size() - 1).onReceiveValue("true");
        assertEquals("same eligibility must not cause an invalidate loop", 2, invalidations);
        assertEquals("finishing the native mode would clear Chromium's selection handles", 0, destroyed);
        Rect rect = new Rect();
        callback.onGetContentRect(mode, webView, rect);
        assertEquals(new Rect(10, 20, 30, 40), rect);
    }

    @Test public void delayedReplyCannotResurrectDestroyedSelection() {
        callback.onCreateActionMode(mode, menu);
        mode.finish();
        replies.get(0).onReceiveValue("true");
        assertEquals(0, invalidations);
        assertEquals(1, destroyed);
    }

    @Test public void capacitorLayoutUsesSelectionAwareWebView() {
        View root = LayoutInflater.from(activity).inflate(R.layout.capacitor_bridge_layout_main, null);
        assertTrue(root.findViewById(R.id.webview) instanceof NewsNookWebView);
    }
}
