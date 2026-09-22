package com.aizeek.newsnook;

import android.content.Context;
import android.content.Intent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Thin Capacitor bridge for ReadAloudPlaybackService.
 *
 * Playback lifetime belongs to the foreground service rather than this Plugin/Activity.
 */
@CapacitorPlugin(name = "ReadAloud")
public final class ReadAloudPlugin extends Plugin {

    private final ReadAloudPlaybackService.EventListener eventListener =
        (type, utteranceId, characterOffset, message) -> {
            JSObject event = new JSObject();
            event.put("type", type);
            if (utteranceId != null) event.put("utteranceId", utteranceId);
            if (characterOffset != null) event.put("characterOffset", characterOffset);
            if (message != null) event.put("message", message);
            notifyListeners("readAloudEvent", event);
        };

    @Override
    public void load() {
        ReadAloudPlaybackService.addEventListener(eventListener);
    }

    @Override
    protected void handleOnDestroy() {
        ReadAloudPlaybackService.removeEventListener(eventListener);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        withTemporaryTts(
            call,
            engine -> {
                JSObject result = new JSObject();
                result.put("available", true);
                call.resolve(result);
            }
        );
    }

    @PluginMethod
    public void listVoices(PluginCall call) {
        withTemporaryTts(
            call,
            engine -> {
                List<Voice> voices = new ArrayList<>(engine.getVoices());
                voices.sort(
                    Comparator.comparing((Voice voice) -> voice.getLocale().toLanguageTag())
                        .thenComparing(Voice::getName)
                );

                JSArray resultVoices = new JSArray();
                for (Voice voice : voices) {
                    JSObject item = new JSObject();
                    item.put("id", voice.getName());
                    item.put("name", voice.getName());
                    item.put("lang", voice.getLocale().toLanguageTag());
                    item.put("local", !voice.isNetworkConnectionRequired());
                    resultVoices.put(item);
                }
                JSObject result = new JSObject();
                result.put("voices", resultVoices);
                call.resolve(result);
            }
        );
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String utteranceId = call.getString("utteranceId");
        String text = call.getString("text");
        if (utteranceId == null || utteranceId.isEmpty() || text == null || text.trim().isEmpty()) {
            call.reject("缺少朗读文本或 utteranceId");
            return;
        }

        Double requestedRate = call.getDouble("rate");
        Double requestedPitch = call.getDouble("pitch");
        Integer requestedOffset = call.getInt("startOffset");

        Intent intent = new Intent(getContext(), ReadAloudPlaybackService.class)
            .setAction(ReadAloudPlaybackService.ACTION_SPEAK)
            .putExtra(ReadAloudPlaybackService.EXTRA_UTTERANCE_ID, utteranceId)
            .putExtra(ReadAloudPlaybackService.EXTRA_TEXT, text)
            .putExtra(ReadAloudPlaybackService.EXTRA_VOICE_ID, call.getString("voiceId", ""))
            .putExtra(
                ReadAloudPlaybackService.EXTRA_RATE,
                requestedRate == null ? 1f : requestedRate.floatValue()
            )
            .putExtra(
                ReadAloudPlaybackService.EXTRA_PITCH,
                requestedPitch == null ? 1f : requestedPitch.floatValue()
            )
            .putExtra(
                ReadAloudPlaybackService.EXTRA_START_OFFSET,
                requestedOffset == null ? 0 : Math.max(0, requestedOffset)
            );
        ReadAloudPlaybackService.startCommand(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        sendSimple(ReadAloudPlaybackService.ACTION_PAUSE);
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        sendSimple(ReadAloudPlaybackService.ACTION_RESUME);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        sendSimple(ReadAloudPlaybackService.ACTION_STOP);
        call.resolve();
    }

    @PluginMethod
    public void setMediaSession(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        if (!active) {
            sendSimple(ReadAloudPlaybackService.ACTION_STOP);
            call.resolve();
            return;
        }
        Intent intent = new Intent(getContext(), ReadAloudPlaybackService.class)
            .setAction(ReadAloudPlaybackService.ACTION_MEDIA_UPDATE)
            .putExtra(ReadAloudPlaybackService.EXTRA_ACTIVE, active)
            .putExtra(ReadAloudPlaybackService.EXTRA_TITLE, call.getString("title", "有所闻"))
            .putExtra(ReadAloudPlaybackService.EXTRA_SOURCE, call.getString("sourceName", "文章朗读"))
            .putExtra(ReadAloudPlaybackService.EXTRA_ARTWORK, call.getString("artwork", ""))
            .putExtra(ReadAloudPlaybackService.EXTRA_STATE, call.getString("state", "paused"))
            .putExtra(
                ReadAloudPlaybackService.EXTRA_SEGMENT_INDEX,
                call.getInt("segmentIndex", 0)
            )
            .putExtra(
                ReadAloudPlaybackService.EXTRA_SEGMENT_COUNT,
                call.getInt("segmentCount", 0)
            );
        ReadAloudPlaybackService.startCommand(getContext(), intent);
        call.resolve();
    }

    private void sendSimple(String action) {
        ReadAloudPlaybackService.startCommand(
            getContext(),
            new Intent(getContext(), ReadAloudPlaybackService.class).setAction(action)
        );
    }

    private interface TtsReady {
        void run(TextToSpeech engine);
    }

    private void withTemporaryTts(PluginCall call, TtsReady ready) {
        Context app = getContext().getApplicationContext();
        AtomicReference<TextToSpeech> holder = new AtomicReference<>();
        TextToSpeech engine = new TextToSpeech(
            app,
            status -> {
                TextToSpeech initialized = holder.get();
                if (initialized == null) {
                    call.reject("系统 TTS 初始化失败");
                    return;
                }
                if (status != TextToSpeech.SUCCESS) {
                    initialized.shutdown();
                    call.reject("系统 TTS 不可用");
                    return;
                }
                try {
                    ready.run(initialized);
                } catch (RuntimeException error) {
                    call.reject("读取系统 TTS 信息失败", error);
                } finally {
                    initialized.shutdown();
                }
            }
        );
        holder.set(engine);
    }
}
