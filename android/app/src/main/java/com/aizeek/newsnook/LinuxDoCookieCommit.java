package com.aizeek.newsnook;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/** Wait for CookieManager acknowledgements before exposing a CSRF response. */
final class LinuxDoCookieCommit {
    interface Writer { void write(String cookie, Consumer<Boolean> completed); }

    private LinuxDoCookieCommit() {}

    static void commit(List<String> cookies, Writer writer, Runnable success, Runnable failure) {
        if (cookies.isEmpty()) { success.run(); return; }
        AtomicInteger remaining = new AtomicInteger(cookies.size());
        AtomicBoolean finished = new AtomicBoolean();
        for (String cookie : cookies) {
            if (finished.get()) break;
            AtomicBoolean delivered = new AtomicBoolean();
            try {
                writer.write(cookie, accepted -> {
                    if (!delivered.compareAndSet(false, true) || finished.get()) return;
                    if (!Boolean.TRUE.equals(accepted)) {
                        if (finished.compareAndSet(false, true)) failure.run();
                    } else if (remaining.decrementAndGet() == 0 && finished.compareAndSet(false, true)) {
                        success.run();
                    }
                });
            } catch (RuntimeException error) {
                if (finished.compareAndSet(false, true)) failure.run();
            }
        }
    }
}
