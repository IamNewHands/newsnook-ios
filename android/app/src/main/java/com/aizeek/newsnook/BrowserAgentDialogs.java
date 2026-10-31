package com.aizeek.newsnook;

import android.app.Activity;
import android.app.AlertDialog;
import android.text.InputFilter;
import android.text.InputType;
import android.widget.EditText;
import java.net.URI;
import java.util.function.Consumer;

/** One browser-owned JavaScript dialog. Page text never decides the user's answer. */
final class BrowserAgentDialogs {
    private Entry active;

    private final class Entry {
        final int tabId;
        final String documentId;
        final Consumer<String> confirm;
        final Runnable cancel;
        final Runnable completed;
        AlertDialog dialog;
        boolean settled;

        Entry(int tabId, String documentId, Consumer<String> confirm, Runnable cancel, Runnable completed) {
            this.tabId = tabId;
            this.documentId = documentId;
            this.confirm = confirm;
            this.cancel = cancel;
            this.completed = completed;
        }

        void settle(boolean accepted, String value, boolean rendererAvailable) {
            if (settled) return;
            settled = true;
            if (active == this) active = null;
            try {
                if (rendererAvailable) {
                    if (accepted) confirm.accept(value); else cancel.run();
                }
            } catch (RuntimeException ignored) {
                // Navigation or renderer retirement can invalidate the callback during dismissal.
            } finally {
                try { if (dialog != null && dialog.isShowing()) dialog.dismiss(); }
                finally { completed.run(); }
            }
        }
    }

    boolean isShowing() { return active != null && !active.settled; }

    void show(Activity activity, int tabId, String documentId, String url, String message,
              String kind, String defaultValue, Runnable beforeShow, Consumer<String> confirm,
              Runnable cancel, Runnable completed) {
        close(true);
        Entry entry = new Entry(tabId, documentId, confirm, cancel, completed);
        active = entry;
        try {
            AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setTitle("网页" + ("prompt".equals(kind) ? "输入" : "确认") + " · " + origin(url))
                .setMessage(bounded(message, 8_000));
            EditText input;
            if ("prompt".equals(kind)) {
                input = new EditText(activity);
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
                input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(4_000)});
                input.setText(bounded(defaultValue, 4_000));
                builder.setView(input);
            } else input = null;
            builder.setPositiveButton("确认", (dialog, which) -> entry.settle(true,
                input == null ? "" : input.getText().toString(), true));
            builder.setNegativeButton("取消", (dialog, which) -> entry.settle(false, "", true));
            entry.dialog = builder.create();
            entry.dialog.setOnCancelListener(ignored -> entry.settle(false, "", true));
            entry.dialog.setOnDismissListener(ignored -> entry.settle(false, "", true));
            beforeShow.run();
            if (!entry.settled) entry.dialog.show();
        } catch (RuntimeException error) {
            entry.settle(false, "", true);
        }
    }

    void cancelDocument(int tabId, String documentId, boolean rendererAvailable) {
        Entry entry = active;
        if (entry != null && entry.tabId == tabId && entry.documentId.equals(documentId))
            entry.settle(false, "", rendererAvailable);
    }

    void close(boolean rendererAvailable) {
        Entry entry = active;
        if (entry != null) entry.settle(false, "", rendererAvailable);
    }

    private static String bounded(String value, int max) {
        return value == null ? "" : value.substring(0, Math.min(max, value.length()));
    }

    private static String origin(String url) {
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme(), host = uri.getHost();
            if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && host != null)
                return scheme + "://" + host + (uri.getPort() < 0 ? "" : ":" + uri.getPort());
        } catch (Exception ignored) { }
        return "此网页";
    }
}
