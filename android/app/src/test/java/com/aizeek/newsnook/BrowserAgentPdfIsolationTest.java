package com.aizeek.newsnook;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Process;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Robolectric;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.shadows.ShadowProcess;

/** Manifest/IPC behavior only; real PdfRenderer and UID isolation require Android instrumentation. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserAgentPdfIsolationTest {
    @Test public void pdfWorkerHasAnIsolatedUidAndNoExportedEntryPoint() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        ServiceInfo service = context.getPackageManager().getServiceInfo(
            new ComponentName(context.getPackageName(), "com.aizeek.newsnook.BrowserAgentPdfService"), 0);
        assertFalse(service.exported);
        assertTrue((service.flags & ServiceInfo.FLAG_ISOLATED_PROCESS) != 0);
        assertEquals(context.getPackageName() + ":agent_pdf", service.processName);
    }

    @Test public void pdfServiceRefusesToRunInsideTheApplicationUid() {
        Context context = RuntimeEnvironment.getApplication();
        int originalUid = Process.myUid();
        ServiceController<BrowserAgentPdfService> controller = null;
        try {
            ShadowProcess.setUid(context.getApplicationInfo().uid);
            controller = Robolectric.buildService(BrowserAgentPdfService.class).create();
            assertNull(controller.get().onBind(binding("pdf_11111111111111111111111111111111")));
        } finally {
            if (controller != null) controller.destroy();
            ShadowProcess.setUid(originalUid);
        }
    }

    @Test public void anOldEmptyBindingCannotTerminateANewerBindingInTheSameService() {
        int originalUid = Process.myUid();
        ServiceController<BrowserAgentPdfService> controller = null;
        try {
            ShadowProcess.setUid(99001); ShadowProcess.clearKilledProcesses();
            controller = Robolectric.buildService(BrowserAgentPdfService.class).create();
            BrowserAgentPdfService service = controller.get();
            Intent first = binding("pdf_11111111111111111111111111111111");
            Intent second = binding("pdf_22222222222222222222222222222222");
            assertNotNull(service.onBind(first)); assertNotNull(service.onBind(second));
            service.onUnbind(first);
            assertFalse("Unbinding an older connection must preserve the newer connection", ShadowProcess.wasKilled(Process.myPid()));
            service.onUnbind(second);
            assertTrue("The unused isolated process must be retired", ShadowProcess.wasKilled(Process.myPid()));
        } finally {
            if (controller != null) controller.destroy();
            ShadowProcess.setUid(originalUid); ShadowProcess.clearKilledProcesses();
        }
    }

    private static Intent binding(String id) {
        return new Intent().setAction("com.aizeek.newsnook.PDF." + id).putExtra(BrowserAgentPdfService.JOB_ID, id);
    }
}
