package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.graphics.Rect;
import android.os.Looper;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.WebView;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserAgentInputTest {
    private static final class Target extends WebView {
        final List<MotionEvent> events = new ArrayList<>();
        final List<KeyEvent> keys = new ArrayList<>();
        Runnable beforeFocus;
        Target() { super(RuntimeEnvironment.getApplication()); }
        @Override public boolean requestFocus(int direction, Rect previouslyFocusedRect) {
            if (beforeFocus != null) beforeFocus.run();
            return super.requestFocus(direction, previouslyFocusedRect);
        }
        @Override public boolean dispatchTouchEvent(MotionEvent event) {
            events.add(MotionEvent.obtain(event));
            return true;
        }
        @Override public boolean dispatchKeyEvent(KeyEvent event) { keys.add(new KeyEvent(event)); return true; }
    }
    private static JSONObject gesture(String kind, int... coordinates) throws Exception {
        JSONArray points = new JSONArray();
        for (int i = 0; i < coordinates.length; i += 2)
            points.put(new JSONObject().put("x", coordinates[i]).put("y", coordinates[i + 1]));
        return new JSONObject().put("kind", kind).put("points", points).put("durationMs", 320);
    }

    @Test public void tapWaitsForReleaseAndUsesTheTouchscreenSource() throws Exception {
        Target view = new Target();
        BrowserAgentInput input = new BrowserAgentInput(view);
        List<String> result = new ArrayList<>();
        input.perform(gesture("tap", 60, 70), new Rect(0, 0, 300, 400), () -> true,
            () -> result.add("done"), result::add);
        assertEquals(1, view.events.size());
        assertEquals(MotionEvent.ACTION_DOWN, view.events.get(0).getActionMasked());
        assertEquals(InputDevice.SOURCE_TOUCHSCREEN, view.events.get(0).getSource());
        assertTrue(result.isEmpty());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(500));
        assertEquals(MotionEvent.ACTION_UP, view.events.get(1).getActionMasked());
        assertTrue(view.events.get(1).getEventTime() > view.events.get(0).getEventTime());
        assertEquals(java.util.Collections.singletonList("done"), result);
    }

    @Test public void cancelReleasesPointersAndPreventsEveryScheduledMove() throws Exception {
        Target view = new Target();
        BrowserAgentInput input = new BrowserAgentInput(view);
        List<String> result = new ArrayList<>();
        input.perform(gesture("drag", 20, 30, 200, 250), new Rect(0, 0, 300, 400), () -> true,
            () -> result.add("done"), result::add);
        input.cancel(true);
        int countAfterCancel = view.events.size();
        assertEquals(MotionEvent.ACTION_CANCEL, view.events.get(countAfterCancel - 1).getActionMasked());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2));
        assertEquals(countAfterCancel, view.events.size());
        assertFalse(result.contains("done"));
    }

    @Test public void pinchMaintainsTwoPointerIdsUntilPointerUp() throws Exception {
        Target view = new Target();
        BrowserAgentInput input = new BrowserAgentInput(view);
        List<String> result = new ArrayList<>();
        input.perform(gesture("pinch", 100, 100, 180, 100).put("scale", 1.5),
            new Rect(0, 0, 300, 400), () -> true, () -> result.add("done"), result::add);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1));
        MotionEvent down = view.events.get(1);
        assertEquals(MotionEvent.ACTION_POINTER_DOWN, down.getActionMasked());
        assertEquals(1, down.getActionIndex());
        assertEquals(2, down.getPointerCount());
        for (MotionEvent event : view.events) if (event.getPointerCount() == 2) {
            assertEquals(0, event.getPointerId(0));
            assertEquals(1, event.getPointerId(1));
        }
        assertEquals(MotionEvent.ACTION_POINTER_UP, view.events.get(view.events.size() - 2).getActionMasked());
        assertEquals(MotionEvent.ACTION_UP, view.events.get(view.events.size() - 1).getActionMasked());
        assertEquals(java.util.Collections.singletonList("done"), result);
    }

    @Test public void occludedCoordinatesAreRejectedBeforeAnyPointerDown() throws Exception {
        Target view = new Target();
        List<String> result = new ArrayList<>();
        new BrowserAgentInput(view).perform(gesture("tap", 60, 350), new Rect(0, 0, 300, 300),
            () -> true, () -> result.add("done"), result::add);
        assertTrue(view.events.isEmpty());
        assertEquals(1, result.size());
        assertFalse(result.contains("done"));
    }

    @Test public void keyCancellationReleasesTheKeyWithoutSendingAnOrdinaryKeyUpLater() {
        Target view = new Target();
        BrowserAgentInput input = new BrowserAgentInput(view);
        List<String> result = new ArrayList<>();
        input.key("Enter", () -> true, () -> result.add("done"), result::add);
        assertEquals(KeyEvent.ACTION_DOWN, view.keys.get(0).getAction());
        assertEquals(InputDevice.SOURCE_KEYBOARD, view.keys.get(0).getSource());
        input.cancel(true);
        assertEquals(KeyEvent.ACTION_UP, view.keys.get(1).getAction());
        assertTrue(view.keys.get(1).isCanceled());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1));
        assertEquals(2, view.keys.size());
        assertTrue(result.isEmpty());
    }

    @Test public void keyRechecksOwnershipAfterTheFocusCallbackBeforeSendingDown() {
        Target view = new Target();
        BrowserAgentInput input = new BrowserAgentInput(view);
        java.util.concurrent.atomic.AtomicBoolean permitted = new java.util.concurrent.atomic.AtomicBoolean(true);
        List<String> result = new ArrayList<>();
        view.beforeFocus = () -> permitted.set(false);
        input.key("Enter", permitted::get, () -> result.add("dispatched"), () -> result.add("done"), result::add);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1));
        assertTrue(view.keys.isEmpty());
        assertFalse(input.hasActiveInput());
        assertEquals(1, result.size());
        assertFalse(result.contains("dispatched"));
        assertFalse(result.contains("done"));
    }

    @Test public void arbitraryTouchTracksKeepSuppliedPointerIdsWhileMovingInDifferentDirections() throws Exception {
        Target view = new Target();
        BrowserAgentInput input = new BrowserAgentInput(view);
        JSONArray contacts = new JSONArray();
        contacts.put(new JSONObject().put("id", 4).put("points", new JSONArray()
            .put(new JSONObject().put("x", 50).put("y", 50).put("timeMs", 0))
            .put(new JSONObject().put("x", 150).put("y", 100).put("timeMs", 160))));
        contacts.put(new JSONObject().put("id", 2).put("points", new JSONArray()
            .put(new JSONObject().put("x", 150).put("y", 150).put("timeMs", 0))
            .put(new JSONObject().put("x", 50).put("y", 200).put("timeMs", 160))));
        List<String> result = new ArrayList<>();
        input.perform(new JSONObject().put("kind", "touch").put("contacts", contacts), new Rect(0, 0, 300, 400),
            () -> true, () -> result.add("done"), result::add);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300));
        MotionEvent firstBoth = view.events.get(1);
        assertEquals(MotionEvent.ACTION_POINTER_DOWN, firstBoth.getActionMasked());
        assertEquals(4, firstBoth.getPointerId(0)); assertEquals(2, firstBoth.getPointerId(1));
        MotionEvent end = view.events.get(view.events.size() - 3);
        assertEquals(MotionEvent.ACTION_MOVE, end.getActionMasked());
        assertEquals(150f, end.getX(0), .01); assertEquals(100f, end.getY(0), .01);
        assertEquals(50f, end.getX(1), .01); assertEquals(200f, end.getY(1), .01);
        assertEquals(4, view.events.get(view.events.size() - 1).getPointerId(0));
        assertEquals(java.util.Collections.singletonList("done"), result);
    }

    @Test public void malformedTouchTrackIsRejectedBeforeAnyContactIsPressed() throws Exception {
        Target view = new Target();
        JSONArray points = new JSONArray().put(new JSONObject().put("x", 50).put("y", 50).put("timeMs", 0))
            .put(new JSONObject().put("x", 60).put("y", 60).put("timeMs", 0));
        JSONObject contact = new JSONObject().put("id", 1).put("points", points);
        List<String> result = new ArrayList<>();
        new BrowserAgentInput(view).perform(new JSONObject().put("kind", "touch").put("contacts", new JSONArray().put(contact)),
            new Rect(0, 0, 300, 400), () -> true, () -> result.add("done"), result::add);
        assertTrue(view.events.isEmpty()); assertEquals(1, result.size()); assertFalse(result.contains("done"));
    }

    @Test public void cancellingAfterPointerUpOnlyCancelsTheRemainingPointer() throws Exception {
        Target view = new Target();
        BrowserAgentInput input = new BrowserAgentInput(view);
        input.perform(gesture("pinch", 100, 100, 180, 100).put("scale", 1.2), new Rect(0, 0, 300, 400),
            () -> true, () -> {}, message -> fail(message));
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(339));
        assertEquals(MotionEvent.ACTION_POINTER_UP, view.events.get(view.events.size() - 1).getActionMasked());
        input.cancel(true);
        MotionEvent cancel = view.events.get(view.events.size() - 1);
        assertEquals(MotionEvent.ACTION_CANCEL, cancel.getActionMasked());
        assertEquals(1, cancel.getPointerCount()); assertEquals(0, cancel.getPointerId(0));
    }
}
