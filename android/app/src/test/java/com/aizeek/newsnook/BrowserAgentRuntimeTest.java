package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.os.Looper;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.List;
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
public class BrowserAgentRuntimeTest {
    private BrowserAgentRuntime runtime() {
        return new BrowserAgentRuntime(new WebView(RuntimeEnvironment.getApplication()), "", () -> true, false);
    }
    private JSONObject ready(String frame, String document) throws Exception {
        return new JSONObject().put("type", "ready").put("frameId", frame).put("documentId", document)
            .put("url", "https://child.example/form");
    }

    @Test public void frameIdentityIsBoundToTheNativePortAndDocument() throws Exception {
        BrowserAgentRuntime runtime = runtime();
        Object original = new Object(), attacker = new Object();
        List<String> sent = new ArrayList<>();
        runtime.receive(ready("frame", "document").toString(), "https://child.example", false, original, sent::add);
        List<JSONObject> completed = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        runtime.executeFrame("run", "request", "frame", "document", new JSONObject().put("action", "observe"),
            completed::add, errors::add);
        JSONObject command = new JSONObject(sent.get(0));
        JSONObject response = new JSONObject().put("type", "result").put("frameId", "frame")
            .put("documentId", "document").put("runId", "run").put("requestId", command.getString("requestId"))
            .put("result", new JSONObject().put("ok", true));
        runtime.receive(response.toString(), "https://child.example", false, attacker, sent::add);
        assertTrue("a forged result from a different frame must not settle the command", completed.isEmpty());
        runtime.receive(response.toString(), "https://child.example", false, original, sent::add);
        assertEquals(1, completed.size());
        assertTrue(errors.isEmpty());
        runtime.close(false);
    }

    @Test public void navigationRejectsOldDocumentCommandsEvenForTheSameUrl() throws Exception {
        BrowserAgentRuntime runtime = runtime();
        List<String> sent = new ArrayList<>(), errors = new ArrayList<>();
        Object port = new Object();
        runtime.receive(ready("frame", "old-document").toString(), "https://child.example", false, port, sent::add);
        String before = runtime.documentId();
        runtime.executeFrame("run", "request", "frame", "old-document", new JSONObject().put("action", "observe"),
            result -> fail("a retired document must not return a result"), errors::add);
        runtime.onPageStarted("https://main.example/");
        assertNotEquals(before, runtime.documentId());
        assertEquals(1, errors.size());
        runtime.executeFrame("run", "next", "frame", "old-document", new JSONObject().put("action", "observe"),
            result -> fail("a retired frame must not execute"), errors::add);
        assertEquals(2, errors.size());
        runtime.close(false);
    }

    @Test public void aFrameCannotReplaceAnotherFramesDocumentBinding() throws Exception {
        BrowserAgentRuntime runtime = runtime();
        List<String> originalMessages = new ArrayList<>(), attackerMessages = new ArrayList<>();
        Object original = new Object();
        runtime.receive(ready("frame", "document").toString(), "https://child.example", false, original, originalMessages::add);
        runtime.receive(ready("frame", "other-document").toString(), "https://elsewhere.example", false, new Object(), attackerMessages::add);
        runtime.executeFrame("run", "request", "frame", "document", new JSONObject().put("action", "observe"),
            result -> {}, error -> fail(error));
        assertEquals(1, originalMessages.size());
        assertTrue(attackerMessages.isEmpty());
        JSONObject command = new JSONObject(originalMessages.get(0));
        runtime.receive(new JSONObject().put("type", "result").put("frameId", "frame").put("documentId", "document")
            .put("runId", "run").put("requestId", command.getString("requestId"))
            .put("result", new JSONObject().put("ok", true)).toString(), "https://child.example", false, original, originalMessages::add);
        runtime.close(false);
    }

    @Test public void cancellationAcknowledgementMustComeFromEveryFrameWithAnUnfinishedCommand() throws Exception {
        BrowserAgentRuntime runtime = runtime();
        List<String> sent = new ArrayList<>();
        List<String> completion = new ArrayList<>();
        Object port = new Object();
        runtime.receive(ready("frame", "document").toString(), "https://child.example", false, port, sent::add);
        runtime.executeFrame("run", "request", "frame", "document", new JSONObject().put("action", "observe"),
            result -> fail("cancelled operation must not complete"), error -> {});
        runtime.cancelRun("run", () -> completion.add("ack"), completion::add);
        assertTrue(completion.isEmpty());
        JSONObject cancel = new JSONObject(sent.get(1));
        JSONObject ack = new JSONObject().put("type", "cancel_ack").put("frameId", "frame").put("documentId", "document")
            .put("runId", "run").put("requestId", cancel.getString("requestId"));
        runtime.receive(ack.toString(), "https://child.example", false, new Object(), sent::add);
        assertTrue(completion.isEmpty());
        runtime.receive(ack.toString(), "https://child.example", false, port, sent::add);
        assertEquals(java.util.Collections.singletonList("ack"), completion);
        runtime.close(false);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
    }
}
