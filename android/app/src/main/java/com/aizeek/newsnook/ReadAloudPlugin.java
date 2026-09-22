package com.aizeek.newsnook;

import android.content.Context;
import android.content.Intent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Thin Capacitor bridge for ReadAloudPlaybackService.
 *
 * Playback lifetime belongs to the foreground service rather than this Plugin/Activity.
 */
@CapacitorPlugin(name = "ReadAloud")
public final class ReadAloudPlugin extends Plugin {

    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "newsnook-read-aloud-io");
        thread.setDaemon(true);
        return thread;
    });

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
        ioExecutor.shutdownNow();
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
                Set<Voice> available = engine.getVoices();
                List<Voice> voices = available == null
                    ? new ArrayList<>()
                    : new ArrayList<>(available);
                voices.sort(
                    Comparator.comparing((Voice voice) -> voice.getLocale().toLanguageTag())
                        .thenComparing(Voice::getName)
                );

                JSArray resultVoices = new JSArray();
                for (Voice voice : voices) {
                    JSObject item = new JSObject();
                    String displayName = voice.getLocale().getDisplayName(Locale.getDefault());
                    item.put("id", voice.getName());
                    item.put(
                        "name",
                        displayName == null || displayName.trim().isEmpty()
                            ? voice.getLocale().toLanguageTag()
                            : displayName
                    );
                    item.put("engineName", voice.getName());
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
                ReadAloudPlaybackService.EXTRA_LANGUAGE_TAG,
                call.getString("languageTag", "")
            )
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
    public void playAudio(PluginCall call) {
        String utteranceId = call.getString("utteranceId");
        String base64 = call.getString("base64");
        String mimeType = call.getString("mimeType", "audio/mpeg");
        if (utteranceId == null || utteranceId.isEmpty() || base64 == null || base64.isEmpty()) {
            call.reject("缺少 AI TTS 音频或 utteranceId");
            return;
        }

        String clean = base64;
        int comma = clean.indexOf(',');
        if (comma >= 0) clean = clean.substring(comma + 1);
        if (clean.length() > 18 * 1024 * 1024) {
            call.reject("AI TTS 音频过大");
            return;
        }

        final String encodedAudio = clean;
        Context app = getContext().getApplicationContext();
        ioExecutor.execute(() -> {
            File directory = new File(app.getCacheDir(), "readaloud");
            if (!directory.exists() && !directory.mkdirs()) {
                call.reject("无法创建朗读缓存目录");
                return;
            }
            pruneCache(directory);

            File audioFile = null;
            try {
                byte[] bytes = Base64.decode(encodedAudio, Base64.DEFAULT);
                audioFile = File.createTempFile(
                    "tts-",
                    suffixForMime(mimeType),
                    directory
                );
                try (FileOutputStream output = new FileOutputStream(audioFile)) {
                    output.write(bytes);
                    output.flush();
                }

                Intent intent = new Intent(app, ReadAloudPlaybackService.class)
                    .setAction(ReadAloudPlaybackService.ACTION_PLAY_AUDIO)
                    .putExtra(ReadAloudPlaybackService.EXTRA_UTTERANCE_ID, utteranceId)
                    .putExtra(ReadAloudPlaybackService.EXTRA_AUDIO_PATH, audioFile.getAbsolutePath());
                ReadAloudPlaybackService.startCommand(app, intent);
                call.resolve();
            } catch (IOException | RuntimeException error) {
                if (audioFile != null) audioFile.delete();
                call.reject("AI TTS 音频缓存或播放服务启动失败", error);
            }
        });
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

    private static void pruneCache(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
        for (File file : files) {
            if (file.isFile() && file.lastModified() < cutoff) {
                try {
                    file.delete();
                } catch (SecurityException ignored) {
                    // Cache cleanup is best effort.
                }
            }
        }
    }

    private static String suffixForMime(String mimeType) {
        String normalized = mimeType == null ? "" : mimeType.toLowerCase();
        if (normalized.contains("wav")) return ".wav";
        if (normalized.contains("aac")) return ".aac";
        if (normalized.contains("flac")) return ".flac";
        if (normalized.contains("ogg") || normalized.contains("opus")) return ".ogg";
        return ".mp3";
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
