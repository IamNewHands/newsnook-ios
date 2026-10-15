package com.aizeek.newsnook;

import android.content.Context;
import android.graphics.Rect;
import android.util.AttributeSet;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.CapacitorWebView;
import java.util.IdentityHashMap;
import java.util.Map;

/** Keep Chromium's selection handles while the reader supplies its own toolbar. */
public class NewsNookWebView extends CapacitorWebView {
    public NewsNookWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(new SelectionCallback(this, callback));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(callback instanceof SelectionCallback ? callback : new SelectionCallback(this, callback), type);
    }

    static final class SelectionCallback extends ActionMode.Callback2 {
        private final WebView webView;
        private final ActionMode.Callback delegate;
        private final Map<MenuItem, Boolean> originalVisibility = new IdentityHashMap<>();
        private Boolean readingSelection;
        private boolean destroyed;
        private int queryGeneration;

        SelectionCallback(WebView webView, ActionMode.Callback delegate) {
            this.webView = webView;
            this.delegate = delegate;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            if (!delegate.onCreateActionMode(mode, menu)) return false;
            // Defer the system menu until JS decides whether this is a reader selection.
            hideMenu(menu);
            querySelection(mode);
            return true;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            restoreMenu();
            boolean changed = delegate.onPrepareActionMode(mode, menu);
            boolean suppress = !Boolean.FALSE.equals(readingSelection);
            if (suppress) hideMenu(menu);
            querySelection(mode);
            return suppress || changed;
        }

        private void hideMenu(Menu menu) {
            for (int index = 0; index < menu.size(); index++) {
                MenuItem item = menu.getItem(index);
                originalVisibility.put(item, item.isVisible());
                item.setVisible(false);
            }
        }

        private void restoreMenu() {
            for (Map.Entry<MenuItem, Boolean> entry : originalVisibility.entrySet()) {
                entry.getKey().setVisible(entry.getValue());
            }
            originalVisibility.clear();
        }

        private void querySelection(ActionMode mode) {
            int generation = ++queryGeneration;
            webView.evaluateJavascript(
                "(function(){return !window.dispatchEvent(new Event('newsnook:wiki-selection',{cancelable:true}));})()",
                result -> {
                    if (destroyed || generation != queryGeneration) return;
                    boolean owned = "true".equals(result);
                    if (readingSelection != null && readingSelection == owned) return;
                    readingSelection = owned;
                    // Do not finish: Chromium clears the selection and its handles on destruction.
                    mode.invalidate();
                }
            );
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            return delegate.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            destroyed = true;
            originalVisibility.clear();
            delegate.onDestroyActionMode(mode);
        }

        @Override
        public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
            if (delegate instanceof ActionMode.Callback2) {
                ((ActionMode.Callback2) delegate).onGetContentRect(mode, view, outRect);
            } else {
                super.onGetContentRect(mode, view, outRect);
            }
        }
    }
}
