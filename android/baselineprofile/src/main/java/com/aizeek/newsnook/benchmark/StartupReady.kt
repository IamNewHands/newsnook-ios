package com.aizeek.newsnook.benchmark

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import java.io.ByteArrayOutputStream

/**
 * The benchmark variants expose this marker only after the initial React surface
 * has passed WebView's visual-state callback and a visible native draw. Production
 * builds do not expose the technical accessibility label. Waiting for a container
 * or accessibility idleness would also accept a blank page or a Suspense fallback.
 */
fun MacrobenchmarkScope.awaitAppFirstFrame() {
    val ready = By.res("android", "content")
        .pkg("com.aizeek.newsnook.benchmark")
        .desc("newsnook-first-frame-ready")
    check(device.wait(Until.hasObject(ready), 15_000)) {
        val hierarchy = ByteArrayOutputStream().also(device::dumpWindowHierarchy)
        "NewsNook did not draw its initial application surface within 15 seconds. UI: $hierarchy"
    }
}
