package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real Chromium rendering against inline fixtures only; no external website is contacted. */
@RunWith(AndroidJUnit4.class)
public class EncyclopediaPageProbeTest {
    private JSONObject render(String html) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String script;
        try (InputStream input = context.getAssets().open("wiki-baike-probe.js")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] bytes = new byte[4096];
            int length;
            while ((length = input.read(bytes)) != -1) output.write(bytes, 0, length);
            script = output.toString(StandardCharsets.UTF_8.name());
        }
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        AtomicReference<WebView> browser = new AtomicReference<>();
        String pageHtml = html.replace("<!--probe-during-parse-->", "<script>document.getElementById('early-state').textContent=JSON.parse(eval(" + JSONObject.quote(script) + ")).state;</script>");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView view = new WebView(context);
            browser.set(view);
            view.getSettings().setJavaScriptEnabled(true);
            view.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView ignored, String url) {
                    view.evaluateJavascript(script, result -> { value.set(result); completed.countDown(); });
                }
            });
            view.loadDataWithBaseURL("https://example.test/wiki-fixture", pageHtml, "text/html", "UTF-8", null);
        });
        try {
            assertTrue("Local WebView rendering timed out", completed.await(15, TimeUnit.SECONDS));
            return new JSONObject((String) new JSONTokener(value.get()).nextValue());
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> browser.get().destroy());
        }
    }

    @Test public void extractsAfterBrowserExecutesPageJavascript() throws Exception {
        JSONObject result = render("<html><head><title>星星_百度百科</title></head><body>"
            + "<main class='main-content'><h1>星星</h1><script>"
            + "document.querySelector('main').insertAdjacentHTML('beforeend', '<div class=lemma-summary><p class=para>夜空中的天体。</p></div>');"
            + "</script></main></body></html>");
        assertEquals("ready", result.getString("state"));
        assertTrue(result.getString("html").contains("夜空中的天体"));
        assertFalse(result.getString("html").contains("<script"));
    }

    @Test public void challengeIsReportedForManualCompletion() throws Exception {
        JSONObject result = render("<html><head><title>百度安全验证</title></head><body><div id='captcha'>验证</div></body></html>");
        assertEquals("challenge", result.getString("state"));
        assertFalse(result.has("html"));
    }

    @Test public void completedUnknownLayoutIsNotReportedAsStillLoading() throws Exception {
        JSONObject result = render("<html><head><title>Unknown layout</title></head><body><article>Unrecognized page</article></body></html>");
        assertEquals("unsupported", result.getString("state"));
        assertFalse(result.getJSONObject("diagnostics").getBoolean("root"));
    }

    @Test public void waitsForTrailingChapterBeforeCompleting() throws Exception {
        JSONObject result = render("<html><head><title>Local fixture</title></head><body>"
            + "<main class='main-content'><h1>星星</h1><div class='lemma-summary'><p class='para'>摘要先到达</p></div>"
            + "<p class='para' id='early-state'></p><!--probe-during-parse-->"
            + "<div class='para-title'><h2>后续章节</h2></div><p class='para'>随后解析的完整正文</p></main></body></html>");
        assertEquals("ready", result.getString("state"));
        assertTrue(result.getString("html").contains(">loading</p>"));
        assertTrue(result.getString("html").contains("随后解析的完整正文"));
    }

    @Test public void recognizesArticleIntroductionWithoutSummaryClass() throws Exception {
        JSONObject result = render("<html><head><title>Local fixture</title></head><body><main class='main-content'>"
            + "<nav><p>导航和推荐内容不能作为词条导言</p></nav><h1>OpenAI</h1>"
            + "<section class='changed-introduction'><p>OpenAI 是一家人工智能研究机构，开展人工智能系统的研究与开发，研究方向包括自然语言处理、机器学习与通用人工智能，提供多种面向用户的智能工具。</p></section>"
            + "<h2>发展历程</h2><p>章节正文</p></main></body></html>");
        assertEquals("ready", result.getString("state"));
        assertTrue(result.getJSONObject("diagnostics").getBoolean("intro"));
        assertFalse(result.getJSONObject("diagnostics").getBoolean("summary"));
        assertEquals("https://example.test/wiki-fixture", result.getString("url"));
    }
}
