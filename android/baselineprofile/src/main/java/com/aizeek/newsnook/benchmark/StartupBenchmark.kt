package com.aizeek.newsnook.benchmark

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Compares identical R8-enabled APK under cold ART compilation modes.
 * Reported TTID/TTFD are measured by the OS, not WebView document commit.
 */
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule val benchmarkRule = MacrobenchmarkRule()

    @Test fun startupNoProfile() = coldStart(CompilationMode.None())
    @Test fun startupWithProfile() = coldStart(CompilationMode.Partial(BaselineProfileMode.Require))

    private fun coldStart(compilationMode: CompilationMode) = benchmarkRule.measureRepeated(
        packageName = "com.aizeek.newsnook.benchmark",
        metrics = listOf(StartupTimingMetric()),
        compilationMode = compilationMode,
        startupMode = StartupMode.COLD,
        iterations = 12,
        setupBlock = { pressHome() },
        measureBlock = {
            startActivityAndWait()
            awaitAppFirstFrame()
        },
    )
}
