package com.aizeek.newsnook.benchmark

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Generates ART compilation and DEX startup-layout profiles for the native shell.
 * Only code executed during actual cold launch belongs in Startup Profile rules.
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule val profileRule = BaselineProfileRule()

    @Test fun startup() = profileRule.collect(
        packageName = "com.aizeek.newsnook.benchmark",
        includeInStartupProfile = true,
        maxIterations = 10,
        stableIterations = 3,
    ) {
        pressHome()
        startActivityAndWait()
        awaitAppFirstFrame()
    }
}
