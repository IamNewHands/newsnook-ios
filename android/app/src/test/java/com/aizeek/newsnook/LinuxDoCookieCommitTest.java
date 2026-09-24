package com.aizeek.newsnook;

import static org.junit.Assert.assertEquals;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.junit.Test;

public class LinuxDoCookieCommitTest {
    @Test public void csrfResponseCannotResolveBeforeEverySessionCookieIsCommitted() {
        List<Consumer<Boolean>> completions = new ArrayList<>();
        AtomicInteger success = new AtomicInteger();
        AtomicInteger failure = new AtomicInteger();
        LinuxDoCookieCommit.commit(Arrays.asList("a=one", "b=two"),
            (cookie, done) -> completions.add(done), success::incrementAndGet, failure::incrementAndGet);
        assertEquals(0, success.get());
        completions.get(1).accept(true);
        assertEquals(0, success.get());
        completions.get(0).accept(true);
        assertEquals(1, success.get());
        completions.get(0).accept(true);
        assertEquals(1, success.get());
        assertEquals(0, failure.get());
    }

    @Test public void cookieFailureCannotBecomeSuccessOnAnotherCallback() {
        List<Consumer<Boolean>> completions = new ArrayList<>();
        AtomicInteger success = new AtomicInteger();
        AtomicInteger failure = new AtomicInteger();
        LinuxDoCookieCommit.commit(Arrays.asList("a=one", "b=two"),
            (cookie, done) -> completions.add(done), success::incrementAndGet, failure::incrementAndGet);
        completions.get(0).accept(false);
        completions.get(1).accept(true);
        assertEquals(0, success.get());
        assertEquals(1, failure.get());
    }

    @Test public void emptyCookieSetResolvesImmediately() {
        AtomicInteger success = new AtomicInteger();
        LinuxDoCookieCommit.commit(Collections.emptyList(), (cookie, done) -> { throw new AssertionError(); },
            success::incrementAndGet, () -> { throw new AssertionError(); });
        assertEquals(1, success.get());
    }

    @Test public void writerExceptionFailsOnce() {
        AtomicInteger failure = new AtomicInteger();
        LinuxDoCookieCommit.commit(Arrays.asList("a=one", "b=two"),
            (cookie, done) -> { throw new IllegalStateException(); },
            () -> { throw new AssertionError(); }, failure::incrementAndGet);
        assertEquals(1, failure.get());
    }
}
