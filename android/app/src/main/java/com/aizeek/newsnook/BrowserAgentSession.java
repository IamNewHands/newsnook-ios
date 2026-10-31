package com.aizeek.newsnook;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.BiConsumer;

/** UI-thread ownership of one agent run. A stopped generation can never enqueue work again. */
final class BrowserAgentSession {
    private String runId = "";
    private String state = "stopped";
    private int tabId = -1;
    private long generation;
    private final Map<String, Request> pending = new LinkedHashMap<>();
    private final Set<String> usedIds = new LinkedHashSet<>();

    String runId() { return runId; }
    String state() { return state; }
    int tabId() { return tabId; }
    boolean isRunning() { return "running".equals(state); }

    void start(String id, int tab) {
        requireId(id);
        if (!"stopped".equals(state)) {
            if (runId.equals(id) && tabId == tab && isRunning()) return;
            throw new IllegalStateException("请先停止当前任务");
        }
        invalidate("任务已结束");
        runId = id;
        tabId = tab;
        state = "running";
        usedIds.clear();
    }

    void pause(String id) {
        requireOwner(id);
        if ("stopped".equals(state)) return;
        state = "paused";
        invalidate("任务已暂停");
    }

    void resume(String id, int tab) {
        requireOwner(id);
        if ("stopped".equals(state)) throw new IllegalStateException("任务已停止，请重新开始");
        invalidate("请重新观察网页");
        tabId = tab;
        state = "running";
    }

    void stop(String id) {
        requireOwner(id);
        state = "stopped";
        invalidate("任务已停止");
    }

    void stopCurrent() {
        state = "stopped";
        invalidate("浏览器已关闭");
    }

    void moveToTab(int tab) {
        invalidate("标签页已切换，请重新观察");
        tabId = tab;
    }

    void transfer(Request request, int tab) {
        if (!request.isLive()) throw new IllegalStateException("任务已停止");
        tabId = tab;
    }

    void invalidate(String reason) {
        generation++;
        for (Request request : new ArrayList<>(pending.values())) request.fail(reason);
    }

    void requireOwner(String id) {
        if (id == null || id.isEmpty() || !runId.equals(id))
            throw new IllegalStateException("任务身份已失效");
    }

    Request begin(String id, String requestId, int tab, String document, Consumer<String> failure) {
        return begin(id, requestId, tab, document, (reason, dispatched) -> failure.accept(reason));
    }

    Request begin(String id, String requestId, int tab, String document, BiConsumer<String, Boolean> failure) {
        requireOwner(id);
        if (!isRunning() || tabId != tab) throw new IllegalStateException("任务已暂停或标签页已切换");
        requireId(requestId);
        if (usedIds.contains(requestId)) throw new IllegalArgumentException("操作编号已使用");
        if (!pending.isEmpty()) throw new IllegalStateException("上一步操作尚未完成");
        if (usedIds.size() >= 4096) throw new IllegalStateException("任务步骤已达上限，请重新开始");
        usedIds.add(requestId);
        Request request = new Request(requestId, document, generation, failure);
        pending.put(requestId, request);
        return request;
    }

    private static void requireId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_.:-]{1,160}"))
            throw new IllegalArgumentException("无效的任务或操作编号");
    }

    final class Request {
        final String id;
        final String documentId;
        final String ownerRunId = runId;
        private final long issuedGeneration;
        private final BiConsumer<String, Boolean> failure;
        private boolean settled;
        private boolean dispatched;
        private Runnable cancellation;

        private Request(String id, String document, long issuedGeneration, BiConsumer<String, Boolean> failure) {
            this.id = id;
            documentId = document;
            this.issuedGeneration = issuedGeneration;
            this.failure = failure;
        }

        boolean isLive() {
            return !settled && generation == issuedGeneration && isRunning()
                && ownerRunId.equals(runId) && pending.get(id) == this;
        }

        void markDispatched() { if (isLive()) dispatched = true; }
        boolean wasDispatched() { return dispatched; }

        void onCancel(Runnable cancel) {
            if (settled) { cancel.run(); return; }
            Runnable previous = cancellation;
            cancellation = previous == null ? cancel : () -> { try { previous.run(); } finally { cancel.run(); } };
        }

        boolean complete() {
            if (!isLive()) return false;
            settled = true;
            pending.remove(id);
            cancellation = null;
            return true;
        }

        void fail(String message) {
            if (settled) return;
            settled = true;
            pending.remove(id);
            Runnable cancel = cancellation;
            cancellation = null;
            try { if (cancel != null) cancel.run(); }
            finally { failure.accept(message, dispatched); }
        }
    }
}
