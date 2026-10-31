package com.aizeek.newsnook;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class BrowserAgentSessionTest {
    @Test public void failuresDistinguishAnUnsentActionFromAnUncertainDispatchedAction() {
        BrowserAgentSession session = new BrowserAgentSession();
        session.start("run", 1);
        List<Boolean> dispatched = new ArrayList<>();
        BrowserAgentSession.Request first = session.begin("run", "first", 1, "document", (error, sent) -> dispatched.add(sent));
        first.fail("validation failed");
        BrowserAgentSession.Request second = session.begin("run", "second", 1, "document", (error, sent) -> dispatched.add(sent));
        second.markDispatched();
        session.pause("run");
        assertEquals(java.util.Arrays.asList(false, true), dispatched);
    }
    @Test public void stoppingCancelsWorkBeforeAcknowledgementAndRejectsLateCompletion() {
        BrowserAgentSession session = new BrowserAgentSession();
        List<String> events = new ArrayList<>();
        session.start("run-one", 7);
        BrowserAgentSession.Request request = session.begin("run-one", "request-one", 7,
            "document-one", error -> events.add("rejected"));
        request.onCancel(() -> events.add("touch-cancel"));
        session.stop("run-one");
        events.add("stop-ack");
        assertEquals(java.util.Arrays.asList("touch-cancel", "rejected", "stop-ack"), events);
        assertFalse(request.complete());
        assertFalse(request.isLive());
    }

    @Test public void oldRunCannotReleaseOrEnqueueIntoANewRun() {
        BrowserAgentSession session = new BrowserAgentSession();
        session.start("first", 2);
        session.stop("first");
        session.start("second", 2);
        assertThrows(IllegalStateException.class, () -> session.stop("first"));
        assertThrows(IllegalStateException.class,
            () -> session.begin("first", "old", 2, "doc", ignored -> {}));
        assertEquals("second", session.runId());
        assertEquals("running", session.state());
    }

    @Test public void navigationInvalidatesEveryOldDocumentRequestWhileKeepingTheRun() {
        BrowserAgentSession session = new BrowserAgentSession();
        List<String> errors = new ArrayList<>();
        session.start("run", 3);
        BrowserAgentSession.Request request = session.begin("run", "read", 3, "old", error -> errors.add(error));
        session.invalidate("网页已跳转，请重新观察");
        assertFalse(request.complete());
        assertEquals(1, errors.size());
        assertEquals("running", session.state());
        assertTrue(session.begin("run", "read-again", 3, "new", error -> errors.add(error)).complete());
    }

    @Test public void pauseRequiresResumeAndRequestIdsCannotBeReused() {
        BrowserAgentSession session = new BrowserAgentSession();
        session.start("run", 9);
        session.begin("run", "id", 9, "doc", ignored -> {}).complete();
        assertThrows(IllegalArgumentException.class,
            () -> session.begin("run", "id", 9, "doc", ignored -> {}));
        session.pause("run");
        assertThrows(IllegalStateException.class,
            () -> session.begin("run", "next", 9, "doc", ignored -> {}));
        session.resume("run", 9);
        assertTrue(session.begin("run", "after-resume", 9, "doc", ignored -> {}).isLive());
    }
}
