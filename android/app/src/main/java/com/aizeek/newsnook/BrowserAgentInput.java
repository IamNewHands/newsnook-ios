package com.aizeek.newsnook;

import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** A cancellable, paced touchscreen stream sent only to the owned WebView. */
final class BrowserAgentInput {
    private final WebView view;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Run active;
    private Runnable keyRelease;
    private int heldKey;
    private long keyDownTime;
    private boolean dispatching;

    private static final class Sample {
        final long time;
        final int action;
        final float[] xy;
        final int[] ids;
        Sample(long time, int action, float... xy) {
            this.time = time; this.action = action; this.xy = xy;
            ids = new int[xy.length / 2];
            for (int i = 0; i < ids.length; i++) ids[i] = i;
        }
        Sample(long time, int action, int[] ids, float[] xy) { this.time = time; this.action = action; this.xy = xy; this.ids = ids; }
    }

    private static final class Run {
        final long downTime = SystemClock.uptimeMillis();
        final List<Sample> samples;
        final BooleanSupplier permitted;
        final Runnable success;
        final Consumer<String> failure;
        final Runnable dispatched;
        Sample last;
        Run(List<Sample> samples, BooleanSupplier permitted, Runnable dispatched, Runnable success, Consumer<String> failure) {
            this.samples = samples; this.permitted = permitted; this.dispatched = dispatched; this.success = success; this.failure = failure;
        }
    }

    BrowserAgentInput(WebView view) { this.view = view; }
    boolean isDispatching() { return dispatching; }
    boolean hasActiveInput() { return active != null || keyRelease != null; }

    void perform(JSONObject gesture, Rect bounds, BooleanSupplier permitted,
                 Runnable success, Consumer<String> failure) {
        perform(gesture, bounds, permitted, () -> {}, success, failure);
    }

    void perform(JSONObject gesture, Rect bounds, BooleanSupplier permitted,
                 Runnable dispatched, Runnable success, Consumer<String> failure) {
        if (active != null || keyRelease != null) { failure.accept("上一个输入尚未结束"); return; }
        final List<Sample> samples;
        try { samples = samples(gesture, bounds); }
        catch (IllegalArgumentException error) { failure.accept(error.getMessage()); return; }
        if (!permitted.getAsBoolean()) { failure.accept("任务已暂停或网页已变化"); return; }
        Run run = new Run(samples, permitted, dispatched, success, failure);
        active = run;
        view.requestFocus();
        deliver(run, 0);
        for (int index = 1; index < samples.size() && active == run; index++) {
            final int next = index;
            main.postAtTime(() -> deliver(run, next), run, run.downTime + samples.get(index).time);
        }
    }

    private void deliver(Run run, int index) {
        if (active != run) return;
        if (!run.permitted.getAsBoolean()) {
            cancel(true);
            run.failure.accept("任务已暂停或网页已变化");
            return;
        }
        Sample sample = run.samples.get(index);
        run.last = sample;
        boolean accepted;
        if (index == 0) run.dispatched.run();
        try { accepted = dispatch(run, sample.action, sample.ids, sample.xy); }
        catch (RuntimeException error) { accepted = false; }
        if (!accepted) {
            cancel(true);
            run.failure.accept("网页未接受触摸，请重新观察后重试");
            return;
        }
        if ((sample.action & MotionEvent.ACTION_MASK) == MotionEvent.ACTION_POINTER_UP) {
            int lifted = sample.action >> MotionEvent.ACTION_POINTER_INDEX_SHIFT;
            int[] ids = new int[sample.ids.length - 1];
            float[] xy = new float[ids.length * 2];
            for (int old = 0, next = 0; old < sample.ids.length; old++) if (old != lifted) {
                ids[next] = sample.ids[old]; xy[next * 2] = sample.xy[old * 2]; xy[next * 2 + 1] = sample.xy[old * 2 + 1]; next++;
            }
            run.last = new Sample(sample.time, MotionEvent.ACTION_MOVE, ids, xy);
        }
        if (index == run.samples.size() - 1) {
            active = null;
            main.removeCallbacksAndMessages(run);
            run.success.run();
        }
    }

    private boolean dispatch(Run run, int action, int[] ids, float[] xy) {
        int count = xy.length / 2;
        MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[count];
        MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[count];
        int lifted = (action & MotionEvent.ACTION_MASK) == MotionEvent.ACTION_POINTER_UP
            ? action >> MotionEvent.ACTION_POINTER_INDEX_SHIFT : -1;
        for (int i = 0; i < count; i++) {
            properties[i] = new MotionEvent.PointerProperties();
            properties[i].id = ids[i];
            properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coordinates[i] = new MotionEvent.PointerCoords();
            coordinates[i].x = xy[i * 2];
            coordinates[i].y = xy[i * 2 + 1];
            coordinates[i].pressure = action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL || lifted == i ? 0f : 1f;
            coordinates[i].size = 0.1f;
        }
        MotionEvent event = MotionEvent.obtain(run.downTime, SystemClock.uptimeMillis(), action, count,
            properties, coordinates, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        dispatching = true;
        try { return view.dispatchTouchEvent(event); }
        finally { dispatching = false; event.recycle(); }
    }

    void cancel(boolean sendCancel) {
        Runnable release = keyRelease;
        keyRelease = null;
        if (release != null) {
            main.removeCallbacks(release);
            if (sendCancel) try { dispatchKey(KeyEvent.ACTION_UP, KeyEvent.FLAG_CANCELED); }
            catch (RuntimeException ignored) { }
        }
        Run run = active;
        active = null;
        if (run == null) return;
        main.removeCallbacksAndMessages(run);
        if (sendCancel && run.last != null) {
            try { dispatch(run, MotionEvent.ACTION_CANCEL, run.last.ids, run.last.xy); }
            catch (RuntimeException ignored) { /* The renderer may already have exited. */ }
        }
    }

    void key(String name, BooleanSupplier permitted, Runnable success, Consumer<String> failure) {
        key(name, permitted, () -> {}, success, failure);
    }

    void key(String name, BooleanSupplier permitted, Runnable dispatched, Runnable success, Consumer<String> failure) {
        if (active != null || keyRelease != null) { failure.accept("上一个输入尚未结束"); return; }
        switch (name) {
            case "Enter": heldKey = KeyEvent.KEYCODE_ENTER; break;
            case "Tab": heldKey = KeyEvent.KEYCODE_TAB; break;
            case "Escape": heldKey = KeyEvent.KEYCODE_ESCAPE; break;
            case "Backspace": heldKey = KeyEvent.KEYCODE_DEL; break;
            case "Delete": heldKey = KeyEvent.KEYCODE_FORWARD_DEL; break;
            case "ArrowUp": heldKey = KeyEvent.KEYCODE_DPAD_UP; break;
            case "ArrowDown": heldKey = KeyEvent.KEYCODE_DPAD_DOWN; break;
            case "ArrowLeft": heldKey = KeyEvent.KEYCODE_DPAD_LEFT; break;
            case "ArrowRight": heldKey = KeyEvent.KEYCODE_DPAD_RIGHT; break;
            default: failure.accept("不支持此按键"); return;
        }
        if (!permitted.getAsBoolean()) { failure.accept("任务已暂停或网页已变化"); return; }
        view.requestFocus();
        // Focus callbacks may synchronously change the tab, viewport, or native owner.
        if (!permitted.getAsBoolean()) { failure.accept("任务已暂停或网页已变化"); return; }
        keyDownTime = SystemClock.uptimeMillis();
        keyRelease = () -> {
            if (keyRelease == null) return;
            if (!permitted.getAsBoolean()) { cancel(true); failure.accept("任务已暂停或网页已变化"); return; }
            keyRelease = null;
            try { dispatchKey(KeyEvent.ACTION_UP, 0); success.run(); }
            catch (RuntimeException error) { failure.accept("网页按键失败"); }
        };
        try {
            dispatched.run();
            if (!dispatchKey(KeyEvent.ACTION_DOWN, 0)) { cancel(true); failure.accept("网页未接受此按键"); return; }
            if (keyRelease != null) main.postDelayed(keyRelease, 50);
        } catch (RuntimeException error) { cancel(true); failure.accept("网页按键失败"); }
    }

    private boolean dispatchKey(int action, int flags) {
        KeyEvent event = new KeyEvent(keyDownTime, SystemClock.uptimeMillis(), action, heldKey, 0, 0,
            KeyCharacterMap.VIRTUAL_KEYBOARD, 0, flags, InputDevice.SOURCE_KEYBOARD);
        dispatching = true;
        try { return view.dispatchKeyEvent(event); }
        finally { dispatching = false; }
    }

    private static List<Sample> samples(JSONObject gesture, Rect bounds) {
        if (gesture == null || bounds == null || bounds.isEmpty()) throw new IllegalArgumentException("网页尚未显示");
        String kind = gesture.optString("kind");
        if ("touch".equals(kind)) return touchSamples(gesture.optJSONArray("contacts"), bounds);
        JSONArray points = gesture.optJSONArray("points");
        if (points == null || points.length() == 0 || points.length() > 128)
            throw new IllegalArgumentException("手势路径无效");
        float[][] path = new float[points.length()][2];
        for (int i = 0; i < points.length(); i++) {
            JSONObject point = points.optJSONObject(i);
            if (point == null) throw new IllegalArgumentException("手势坐标无效");
            path[i][0] = (float) point.optDouble("x", Double.NaN);
            path[i][1] = (float) point.optDouble("y", Double.NaN);
            checkPoint(path[i][0], path[i][1], bounds);
        }
        int duration = gesture.optInt("durationMs", "tap".equals(kind) ? 80 : 600);
        if (duration < 16 || duration > 5000) throw new IllegalArgumentException("手势时长须在 16–5000 毫秒内");
        List<Sample> result = new ArrayList<>();
        result.add(new Sample(0, MotionEvent.ACTION_DOWN, path[0][0], path[0][1]));
        if ("tap".equals(kind) || "long_press".equals(kind)) {
            if (path.length != 1) throw new IllegalArgumentException("点击和长按只接受一个坐标");
            if ("long_press".equals(kind)) duration = Math.max(duration, ViewConfiguration.getLongPressTimeout() + 50);
            result.add(new Sample(duration, MotionEvent.ACTION_UP, path[0][0], path[0][1]));
        } else if ("swipe".equals(kind) || "drag".equals(kind)) {
            if (path.length < 2) throw new IllegalArgumentException("滑动和拖动至少需要起点与终点");
            int hold = "drag".equals(kind) ? Math.min(gesture.optInt("holdMs", 120), 1000) : 0;
            if (hold < 0) throw new IllegalArgumentException("拖动等待时长无效");
            int steps = Math.max(2, (duration + 15) / 16);
            for (int i = 1; i <= steps; i++) {
                float pos = (path.length - 1) * (i / (float) steps);
                int left = Math.min(path.length - 2, (int) pos);
                float amount = pos - left;
                float x = path[left][0] + (path[left + 1][0] - path[left][0]) * amount;
                float y = path[left][1] + (path[left + 1][1] - path[left][1]) * amount;
                result.add(new Sample(hold + Math.round(duration * i / (float) steps), MotionEvent.ACTION_MOVE, x, y));
            }
            float[] end = path[path.length - 1];
            result.add(new Sample(hold + duration + 16L, MotionEvent.ACTION_UP, end[0], end[1]));
        } else if ("pinch".equals(kind)) {
            if (path.length != 2) throw new IllegalArgumentException("缩放需要两个起始触点");
            float scale = (float) gesture.optDouble("scale", 1.5);
            if (!Float.isFinite(scale) || scale < 0.2 || scale > 5) throw new IllegalArgumentException("缩放比例无效");
            float centerX = (path[0][0] + path[1][0]) / 2f;
            float centerY = (path[0][1] + path[1][1]) / 2f;
            if (Math.hypot(path[0][0] - path[1][0], path[0][1] - path[1][1]) < 10)
                throw new IllegalArgumentException("两个触点距离过近");
            float[] end = null;
            result.add(new Sample(1, MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT),
                path[0][0], path[0][1], path[1][0], path[1][1]));
            int steps = Math.max(2, (duration + 15) / 16);
            for (int i = 1; i <= steps; i++) {
                float factor = 1 + (scale - 1) * i / steps;
                end = new float[] {centerX + (path[0][0] - centerX) * factor,
                    centerY + (path[0][1] - centerY) * factor,
                    centerX + (path[1][0] - centerX) * factor,
                    centerY + (path[1][1] - centerY) * factor};
                checkPoint(end[0], end[1], bounds); checkPoint(end[2], end[3], bounds);
                result.add(new Sample(2 + Math.round(duration * i / (float) steps), MotionEvent.ACTION_MOVE, end));
            }
            result.add(new Sample(duration + 18L, MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), end));
            result.add(new Sample(duration + 34L, MotionEvent.ACTION_UP, end[0], end[1]));
        } else throw new IllegalArgumentException("不支持的手势");
        return result;
    }

    private static List<Sample> touchSamples(JSONArray contacts, Rect bounds) {
        if (contacts == null || contacts.length() < 1 || contacts.length() > 5)
            throw new IllegalArgumentException("多点触摸须包含 1–5 个触点");
        int count = contacts.length(), end = -1;
        int[] ids = new int[count];
        float[][][] paths = new float[count][][];
        int[][] times = new int[count][];
        java.util.Set<Integer> seen = new java.util.HashSet<>();
        java.util.TreeSet<Integer> steps = new java.util.TreeSet<>();
        for (int c = 0; c < count; c++) {
            JSONObject contact = contacts.optJSONObject(c);
            int id = contact == null ? -1 : contact.optInt("id", -1);
            JSONArray points = contact == null ? null : contact.optJSONArray("points");
            if (id < 0 || id > 4 || !seen.add(id) || points == null || points.length() < 2 || points.length() > 128)
                throw new IllegalArgumentException("触点编号或轨迹无效");
            ids[c] = id; paths[c] = new float[points.length()][2]; times[c] = new int[points.length()];
            int previous = -1;
            for (int p = 0; p < points.length(); p++) {
                JSONObject point = points.optJSONObject(p);
                int time = point == null ? -1 : point.optInt("timeMs", -1);
                if (time < 0 || time > 5000 || time <= previous || p == 0 && time != 0)
                    throw new IllegalArgumentException("触摸时间须从 0 开始严格递增，最多 5000 毫秒");
                float x = (float) point.optDouble("x", Double.NaN), y = (float) point.optDouble("y", Double.NaN);
                checkPoint(x, y, bounds);
                paths[c][p][0] = x; paths[c][p][1] = y; times[c][p] = time;
                if (time > 0) steps.add(time);
                previous = time;
            }
            if (previous < 16 || end >= 0 && end != previous)
                throw new IllegalArgumentException("各触点须在同一时刻结束，时长至少 16 毫秒");
            end = previous;
        }
        for (int time = 16; time < end; time += 16) steps.add(time);
        List<Sample> result = new ArrayList<>();
        float[] initial = new float[count * 2];
        for (int c = 0; c < count; c++) { initial[c * 2] = paths[c][0][0]; initial[c * 2 + 1] = paths[c][0][1]; }
        for (int down = 1; down <= count; down++) {
            int action = down == 1 ? MotionEvent.ACTION_DOWN
                : MotionEvent.ACTION_POINTER_DOWN | (down - 1) << MotionEvent.ACTION_POINTER_INDEX_SHIFT;
            result.add(new Sample(0, action, java.util.Arrays.copyOf(ids, down), java.util.Arrays.copyOf(initial, down * 2)));
        }
        float[] last = initial;
        for (int time : steps) {
            float[] xy = new float[count * 2];
            for (int c = 0; c < count; c++) {
                int segment = 0;
                while (segment + 1 < times[c].length - 1 && times[c][segment + 1] < time) segment++;
                float fraction = (time - times[c][segment]) / (float) (times[c][segment + 1] - times[c][segment]);
                xy[c * 2] = paths[c][segment][0] + (paths[c][segment + 1][0] - paths[c][segment][0]) * fraction;
                xy[c * 2 + 1] = paths[c][segment][1] + (paths[c][segment + 1][1] - paths[c][segment][1]) * fraction;
            }
            result.add(new Sample(time, MotionEvent.ACTION_MOVE, ids, xy)); last = xy;
        }
        for (int remaining = count; remaining >= 1; remaining--) {
            int action = remaining == 1 ? MotionEvent.ACTION_UP
                : MotionEvent.ACTION_POINTER_UP | (remaining - 1) << MotionEvent.ACTION_POINTER_INDEX_SHIFT;
            result.add(new Sample(end + count - remaining + 1, action,
                java.util.Arrays.copyOf(ids, remaining), java.util.Arrays.copyOf(last, remaining * 2)));
        }
        return result;
    }

    private static void checkPoint(float x, float y, Rect bounds) {
        if (!Float.isFinite(x) || !Float.isFinite(y) || x < bounds.left || y < bounds.top
                || x >= bounds.right || y >= bounds.bottom)
            throw new IllegalArgumentException("触摸位置超出可见网页范围，请重新截图");
    }
}
