package com.aizeek.newsnook;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.annotation.Nullable;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.io.IOException;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * Owns Android system TTS and the OS media session independently of the WebView/Activity.
 *
 * Android TextToSpeech has no pause API. Pause is implemented honestly as stop + the last
 * onRangeStart character offset; resume synthesizes the remaining suffix. The JS domain service
 * still owns the article queue while this service owns the currently spoken segment.
 */
public final class ReadAloudPlaybackService extends Service {

    static final String ACTION_SPEAK = "com.aizeek.newsnook.readaloud.SPEAK";
    static final String ACTION_PLAY_AUDIO = "com.aizeek.newsnook.readaloud.PLAY_AUDIO";
    static final String ACTION_PAUSE = "com.aizeek.newsnook.readaloud.PAUSE";
    static final String ACTION_RESUME = "com.aizeek.newsnook.readaloud.RESUME";
    static final String ACTION_STOP = "com.aizeek.newsnook.readaloud.STOP";
    static final String ACTION_MEDIA_UPDATE = "com.aizeek.newsnook.readaloud.MEDIA_UPDATE";
    static final String ACTION_MEDIA_PLAY = "com.aizeek.newsnook.readaloud.MEDIA_PLAY";
    static final String ACTION_MEDIA_PAUSE = "com.aizeek.newsnook.readaloud.MEDIA_PAUSE";
    static final String ACTION_MEDIA_STOP = "com.aizeek.newsnook.readaloud.MEDIA_STOP";
    static final String ACTION_MEDIA_PREVIOUS = "com.aizeek.newsnook.readaloud.MEDIA_PREVIOUS";
    static final String ACTION_MEDIA_NEXT = "com.aizeek.newsnook.readaloud.MEDIA_NEXT";

    static final String EXTRA_UTTERANCE_ID = "utteranceId";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_VOICE_ID = "voiceId";
    static final String EXTRA_LANGUAGE_TAG = "languageTag";
    static final String EXTRA_RATE = "rate";
    static final String EXTRA_PITCH = "pitch";
    static final String EXTRA_START_OFFSET = "startOffset";
    static final String EXTRA_AUDIO_PATH = "audioPath";
    static final String EXTRA_ACTIVE = "active";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_SOURCE = "sourceName";
    static final String EXTRA_ARTWORK = "artwork";
    static final String EXTRA_STATE = "state";
    static final String EXTRA_SEGMENT_INDEX = "segmentIndex";
    static final String EXTRA_SEGMENT_COUNT = "segmentCount";

    private static final String CHANNEL_ID = "newsnook_read_aloud";
    private static final int NOTIFICATION_ID = 0x4e4e52;
    private static final Set<EventListener> EVENT_LISTENERS = new CopyOnWriteArraySet<>();
    private static volatile boolean running;

    interface EventListener {
        void onEvent(
            String type,
            @Nullable String utteranceId,
            @Nullable Integer characterOffset,
            @Nullable String message
        );
    }

    static void addEventListener(EventListener listener) {
        EVENT_LISTENERS.add(listener);
    }

    static void removeEventListener(EventListener listener) {
        EVENT_LISTENERS.remove(listener);
    }

    static void startCommand(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        String action = intent.getAction();
        if (
            ACTION_SPEAK.equals(action)
                || ACTION_PLAY_AUDIO.equals(action)
                || ACTION_MEDIA_UPDATE.equals(action)
        ) {
            ContextCompat.startForegroundService(app, intent.setClass(app, ReadAloudPlaybackService.class));
            return;
        }
        if (!running) return;
        try {
            app.startService(intent.setClass(app, ReadAloudPlaybackService.class));
        } catch (RuntimeException error) {
            // If Android blocks a background start, the service was not alive anymore anyway.
        }
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private TextToSpeech tts;
    private MediaPlayer audioPlayer;
    private boolean audioPrepared;
    private boolean ttsReady;
    private int ttsGeneration;
    private boolean pendingSpeak;
    private boolean paused;
    private boolean sessionActive;
    private boolean foreground;
    private boolean noisyReceiverRegistered;
    private boolean resumeOnFocusGain;

    private String logicalUtteranceId;
    private String activeEngineUtteranceId = "";
    private String audioPath = "";
    private String fullText = "";
    private String voiceId = "";
    private String languageTag = "";
    private float rate = 1f;
    private float pitch = 1f;
    private int currentOffset;
    private int baseOffset;

    private String mediaTitle = "有所闻";
    private String mediaSource = "文章朗读";
    private String mediaArtwork = "";
    private int mediaSegmentIndex;
    private int mediaSegmentCount;
    private String mediaState = "paused";

    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private MediaSession mediaSession;

    private final BroadcastReceiver noisyReceiver =
        new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) return;
                if (!sessionActive || !"playing".equals(mediaState)) return;
                pauseInternal(false);
                emit("noisy", null, null, null);
            }
        };

    private final AudioManager.OnAudioFocusChangeListener focusChangeListener =
        focusChange -> mainHandler.post(() -> handleAudioFocusChange(focusChange));

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        createNotificationChannel();
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createMediaSession();
        registerNoisyReceiver();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_NOT_STICKY;

        switch (intent.getAction()) {
            case ACTION_SPEAK:
                releaseAudioPlayer(true);
                readSpeakIntent(intent);
                sessionActive = true;
                paused = false;
                mediaState = "playing";
                promoteToForeground();
                if (ttsReady) {
                    speakFrom(currentOffset);
                } else {
                    pendingSpeak = true;
                    if (tts == null) createTts();
                }
                break;
            case ACTION_PLAY_AUDIO:
                activeEngineUtteranceId = "";
                if (tts != null) {
                    ++ttsGeneration;
                    tts.stop();
                    tts.shutdown();
                    tts = null;
                    ttsReady = false;
                }
                pendingSpeak = false;
                releaseAudioPlayer(true);
                fullText = "";
                currentOffset = 0;
                baseOffset = 0;
                logicalUtteranceId = intent.getStringExtra(EXTRA_UTTERANCE_ID);
                audioPath = safe(intent.getStringExtra(EXTRA_AUDIO_PATH));
                sessionActive = true;
                paused = false;
                mediaState = "playing";
                promoteToForeground();
                playAudioFile();
                break;
            case ACTION_PAUSE:
                pauseInternal(false);
                break;
            case ACTION_RESUME:
                resumeInternal(false);
                break;
            case ACTION_STOP:
                stopInternal(false, true);
                break;
            case ACTION_MEDIA_PLAY:
                resumeInternal(false);
                emit("play", null, null, null);
                break;
            case ACTION_MEDIA_PAUSE:
                pauseInternal(false);
                emit("pause", null, null, null);
                break;
            case ACTION_MEDIA_STOP:
                emit("stop", null, null, null);
                stopInternal(false, true);
                break;
            case ACTION_MEDIA_UPDATE:
                readMediaIntent(intent);
                if (sessionActive) {
                    promoteToForeground();
                    if ("playing".equals(mediaState)) requestAudioFocus();
                    updateMediaSessionAndNotification();
                } else {
                    stopInternal(false, true);
                }
                break;
            case ACTION_MEDIA_PREVIOUS:
                pauseInternal(false);
                emit("previous", null, null, null);
                break;
            case ACTION_MEDIA_NEXT:
                pauseInternal(false);
                emit("next", null, null, null);
                break;
            default:
                break;
        }
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        ++ttsGeneration;
        pendingSpeak = false;
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        releaseAudioPlayer(true);
        abandonAudioFocus();
        unregisterNoisyReceiver();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        if (foreground) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            foreground = false;
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // WebView/JS owns the article queue. If the whole task is explicitly swiped away,
        // stop native playback rather than leaving a one-segment ghost session behind.
        stopInternal(false, true);
        super.onTaskRemoved(rootIntent);
    }

    private void createTts() {
        final int generation = ++ttsGeneration;
        ttsReady = false;
        tts = new TextToSpeech(
            getApplicationContext(),
            status -> {
                mainHandler.post(
                    () -> {
                        if (!running || generation != ttsGeneration) return;
                        ttsReady = status == TextToSpeech.SUCCESS && tts != null;
                        if (!ttsReady) {
                            emit("error", logicalUtteranceId, null, "Android 系统 TTS 初始化失败");
                            stopInternal(false, true);
                            return;
                        }
                        configureTtsListener();
                        if (pendingSpeak && !paused && !fullText.isEmpty()) {
                            pendingSpeak = false;
                            speakFrom(currentOffset);
                        }
                    }
                );
            }
        );
    }

    private void configureTtsListener() {
        if (tts == null) return;
        tts.setOnUtteranceProgressListener(
            new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                    mainHandler.post(
                        () -> {
                            if (!matchesEngineUtterance(utteranceId)) return;
                            mediaState = "playing";
                            updateMediaSessionAndNotification();
                            emit("started", logicalUtteranceId, currentOffset, null);
                        }
                    );
                }

                @Override
                public void onDone(String utteranceId) {
                    mainHandler.post(
                        () -> {
                            if (!matchesEngineUtterance(utteranceId) || paused) return;
                            currentOffset = fullText.length();
                            mediaState = "paused";
                            abandonAudioFocus();
                            updateMediaSessionAndNotification();
                            emit("ended", logicalUtteranceId, currentOffset, null);
                        }
                    );
                }

                @Override
                @SuppressWarnings("deprecation")
                public void onError(String utteranceId) {
                    onError(utteranceId, TextToSpeech.ERROR);
                }

                @Override
                public void onError(String utteranceId, int errorCode) {
                    mainHandler.post(
                        () -> {
                            if (!matchesEngineUtterance(utteranceId) || paused) return;
                            mediaState = "paused";
                            abandonAudioFocus();
                            updateMediaSessionAndNotification();
                            emit(
                                "error",
                                logicalUtteranceId,
                                currentOffset,
                                "Android 系统 TTS 朗读失败（" + errorCode + "）"
                            );
                        }
                    );
                }

                @Override
                public void onRangeStart(String utteranceId, int start, int end, int frame) {
                    mainHandler.post(
                        () -> {
                            if (!matchesEngineUtterance(utteranceId)) return;
                            currentOffset = Math.min(fullText.length(), Math.max(0, baseOffset + start));
                            emit("range", logicalUtteranceId, currentOffset, null);
                        }
                    );
                }
            }
        );
    }

    private void readSpeakIntent(Intent intent) {
        logicalUtteranceId = intent.getStringExtra(EXTRA_UTTERANCE_ID);
        fullText = safe(intent.getStringExtra(EXTRA_TEXT));
        voiceId = safe(intent.getStringExtra(EXTRA_VOICE_ID));
        languageTag = safe(intent.getStringExtra(EXTRA_LANGUAGE_TAG));
        rate = clamp(intent.getFloatExtra(EXTRA_RATE, 1f), 0.5f, 2.5f);
        pitch = clamp(intent.getFloatExtra(EXTRA_PITCH, 1f), 0.5f, 2f);
        currentOffset = clampOffset(intent.getIntExtra(EXTRA_START_OFFSET, 0));
        baseOffset = currentOffset;
    }

    private void readMediaIntent(Intent intent) {
        sessionActive = intent.getBooleanExtra(EXTRA_ACTIVE, false);
        mediaTitle = nonBlank(intent.getStringExtra(EXTRA_TITLE), mediaTitle);
        mediaSource = nonBlank(intent.getStringExtra(EXTRA_SOURCE), mediaSource);
        mediaArtwork = safe(intent.getStringExtra(EXTRA_ARTWORK));
        mediaState = nonBlank(intent.getStringExtra(EXTRA_STATE), mediaState);
        mediaSegmentIndex = Math.max(0, intent.getIntExtra(EXTRA_SEGMENT_INDEX, 0));
        mediaSegmentCount = Math.max(0, intent.getIntExtra(EXTRA_SEGMENT_COUNT, 0));
    }

    private void speakFrom(int requestedOffset) {
        if (!ttsReady || tts == null || fullText.isEmpty()) return;
        int offset = Math.min(fullText.length(), Math.max(0, requestedOffset));
        if (offset >= fullText.length()) {
            currentOffset = fullText.length();
            emit("ended", logicalUtteranceId, currentOffset, null);
            return;
        }
        if (!requestAudioFocus()) {
            emit("error", logicalUtteranceId, currentOffset, "无法获取媒体音频焦点");
            return;
        }

        paused = false;
        currentOffset = offset;
        baseOffset = offset;
        tts.setSpeechRate(rate);
        tts.setPitch(pitch);
        tts.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        );
        // 没有指定 voice 时按段落语言选择；跨设备不存在的 voice 也会回落到语言默认。
        Locale requestedLocale = languageTag.isEmpty()
            ? Locale.getDefault()
            : Locale.forLanguageTag(languageTag);
        tts.setLanguage(requestedLocale);
        if (!voiceId.isEmpty()) {
            for (android.speech.tts.Voice voice : tts.getVoices()) {
                if (voiceId.equals(voice.getName())) {
                    tts.setVoice(voice);
                    break;
                }
            }
        }

        Bundle params = new Bundle();
        String engineUtteranceId = engineUtteranceId();
        activeEngineUtteranceId = engineUtteranceId;
        int result = tts.speak(
            fullText.substring(offset),
            TextToSpeech.QUEUE_FLUSH,
            params,
            engineUtteranceId
        );
        if (result == TextToSpeech.ERROR) {
            abandonAudioFocus();
            emit("error", logicalUtteranceId, currentOffset, "Android 系统 TTS 无法开始朗读");
        }
    }

    private void playAudioFile() {
        releaseAudioPlayer(false);
        if (audioPath.isEmpty()) {
            emit("error", logicalUtteranceId, null, "AI TTS 音频文件为空");
            return;
        }
        File file = new File(audioPath);
        if (!file.isFile()) {
            emit("error", logicalUtteranceId, null, "AI TTS 音频缓存不存在");
            return;
        }
        if (!requestAudioFocus()) {
            emit("error", logicalUtteranceId, null, "无法获取媒体音频焦点");
            return;
        }

        MediaPlayer player = new MediaPlayer();
        audioPlayer = player;
        audioPrepared = false;
        try {
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            );
            player.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
            player.setDataSource(file.getAbsolutePath());
            player.setOnPreparedListener(
                prepared -> {
                    if (audioPlayer != prepared) return;
                    audioPrepared = true;
                    if (paused) return;
                    try {
                        prepared.start();
                        mediaState = "playing";
                        updateMediaSessionAndNotification();
                        emit("started", logicalUtteranceId, null, null);
                    } catch (IllegalStateException error) {
                        emit("error", logicalUtteranceId, null, "AI TTS 音频无法开始播放");
                    }
                }
            );
            player.setOnCompletionListener(
                completed -> {
                    if (audioPlayer != completed) return;
                    String completedId = logicalUtteranceId;
                    mediaState = "paused";
                    abandonAudioFocus();
                    // 先释放当前文件，再通知 JS 切下一段，避免下一段启动后误删新缓存。
                    releaseAudioPlayer(true);
                    updateMediaSessionAndNotification();
                    emit("ended", completedId, null, null);
                }
            );
            player.setOnErrorListener(
                (failed, what, extra) -> {
                    if (audioPlayer != failed) return true;
                    String failedId = logicalUtteranceId;
                    mediaState = "paused";
                    abandonAudioFocus();
                    releaseAudioPlayer(true);
                    updateMediaSessionAndNotification();
                    emit(
                        "error",
                        failedId,
                        null,
                        "AI TTS 音频播放失败（" + what + "/" + extra + "）"
                    );
                    return true;
                }
            );
            player.prepareAsync();
        } catch (IOException | IllegalArgumentException | IllegalStateException error) {
            releaseAudioPlayer(true);
            abandonAudioFocus();
            emit("error", logicalUtteranceId, null, "AI TTS 音频准备失败");
        }
    }

    private void releaseAudioPlayer(boolean deleteFile) {
        MediaPlayer player = audioPlayer;
        audioPlayer = null;
        audioPrepared = false;
        if (player != null) {
            try {
                player.setOnPreparedListener(null);
                player.setOnCompletionListener(null);
                player.setOnErrorListener(null);
                player.stop();
            } catch (IllegalStateException ignored) {
                // Not all MediaPlayer states allow stop; release is always safe.
            }
            player.release();
        }

        if (deleteFile && !audioPath.isEmpty()) {
            try {
                new File(audioPath).delete();
            } catch (SecurityException ignored) {
                // Cache cleanup is best effort.
            }
            audioPath = "";
        }
    }

    private void pauseInternal(boolean emitPlayControl) {
        if (!isSpeakingOrPaused()) return;
        paused = true;
        pendingSpeak = false;
        if (!fullText.isEmpty() && tts != null) {
            tts.stop();
        }
        if (audioPlayer != null) {
            try {
                if (audioPlayer.isPlaying()) audioPlayer.pause();
            } catch (IllegalStateException ignored) {
                // player is already transitioning/released
            }
        }
        abandonAudioFocus();
        mediaState = "paused";
        updateMediaSessionAndNotification();
        if (emitPlayControl) emit("pause", null, null, null);
    }

    private void resumeInternal(boolean emitPlayControl) {
        if (!paused) return;
        paused = false;
        mediaState = "playing";
        updateMediaSessionAndNotification();
        if (!fullText.isEmpty()) {
            if (ttsReady) {
                speakFrom(currentOffset);
            } else {
                pendingSpeak = true;
                if (tts == null) createTts();
            }
        } else if (audioPlayer != null && audioPrepared) {
            if (requestAudioFocus()) {
                try {
                    audioPlayer.start();
                } catch (IllegalStateException error) {
                    emit("error", logicalUtteranceId, null, "AI TTS 音频无法继续播放");
                }
            }
        }
        // MediaPlayer still preparing: onPrepared will observe paused=false and start there.
        if (emitPlayControl) emit("play", null, null, null);
    }

    private void stopInternal(boolean emitControl, boolean stopService) {
        pendingSpeak = false;
        paused = false;
        sessionActive = false;
        if (tts != null) tts.stop();
        releaseAudioPlayer(true);
        abandonAudioFocus();
        fullText = "";
        logicalUtteranceId = null;
        activeEngineUtteranceId = "";
        currentOffset = 0;
        baseOffset = 0;
        mediaState = "paused";
        if (mediaSession != null) {
            mediaSession.setPlaybackState(playbackState(PlaybackState.STATE_STOPPED));
            mediaSession.setActive(false);
        }
        if (foreground) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            foreground = false;
        }
        if (emitControl) emit("stop", null, null, null);
        if (stopService) stopSelf();
    }

    private void createMediaSession() {
        mediaSession = new MediaSession(this, "NewsNookReadAloud");
        mediaSession.setFlags(
            MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    resumeInternal(false);
                    emit("play", null, null, null);
                }

                @Override
                public void onPause() {
                    pauseInternal(false);
                    emit("pause", null, null, null);
                }

                @Override
                public void onStop() {
                    emit("stop", null, null, null);
                    stopInternal(false, true);
                }

                @Override
                public void onSkipToNext() {
                    pauseInternal(false);
                    emit("next", null, null, null);
                }

                @Override
                public void onSkipToPrevious() {
                    pauseInternal(false);
                    emit("previous", null, null, null);
                }
            },
            mainHandler
        );
    }

    private void updateMediaSessionAndNotification() {
        if (mediaSession == null) return;
        mediaSession.setActive(sessionActive);
        if (!sessionActive) return;

        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, mediaTitle)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, mediaSource)
            .putString(
                MediaMetadata.METADATA_KEY_ALBUM,
                mediaSegmentCount > 0
                    ? "第 " + (mediaSegmentIndex + 1) + " / " + mediaSegmentCount + " 段"
                    : "文章朗读"
            );
        if (!mediaArtwork.isEmpty()) {
            metadata.putString(MediaMetadata.METADATA_KEY_ART_URI, mediaArtwork);
            metadata.putString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI, mediaArtwork);
        }
        mediaSession.setMetadata(metadata.build());

        mediaSession.setPlaybackState(playbackState(playbackStateForMediaState()));
        if (foreground) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private int playbackStateForMediaState() {
        if ("playing".equals(mediaState)) return PlaybackState.STATE_PLAYING;
        if ("loading".equals(mediaState)) return PlaybackState.STATE_BUFFERING;
        return PlaybackState.STATE_PAUSED;
    }

    private PlaybackState playbackState(int state) {
        long actions =
            PlaybackState.ACTION_PLAY |
            PlaybackState.ACTION_PAUSE |
            PlaybackState.ACTION_PLAY_PAUSE |
            PlaybackState.ACTION_STOP |
            PlaybackState.ACTION_SKIP_TO_NEXT |
            PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        return new PlaybackState.Builder()
            .setActions(actions)
            .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build();
    }

    private void promoteToForeground() {
        if (mediaSession != null) {
            mediaSession.setActive(true);
            mediaSession.setPlaybackState(playbackState(playbackStateForMediaState()));
        }
        int serviceType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), serviceType);
        foreground = true;
    }

    private Notification buildNotification() {
        boolean playing = "playing".equals(mediaState) || "loading".equals(mediaState);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            100,
            new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            pendingFlags()
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        builder
            .setSmallIcon(R.drawable.ic_read_aloud_notification)
            .setContentTitle(mediaTitle)
            .setContentText(
                mediaSegmentCount > 0
                    ? mediaSource + " · " + (mediaSegmentIndex + 1) + "/" + mediaSegmentCount
                    : mediaSource
            )
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setPriority(Notification.PRIORITY_LOW)
            .addAction(
                new Notification.Action.Builder(
                    R.drawable.ic_media_previous,
                    "上一段",
                    servicePendingIntent(ACTION_MEDIA_PREVIOUS, 201)
                ).build()
            )
            .addAction(
                new Notification.Action.Builder(
                    playing ? R.drawable.ic_media_pause : R.drawable.ic_media_play,
                    playing ? "暂停" : "继续",
                    servicePendingIntent(playing ? ACTION_MEDIA_PAUSE : ACTION_MEDIA_PLAY, 202)
                ).build()
            )
            .addAction(
                new Notification.Action.Builder(
                    R.drawable.ic_media_next,
                    "下一段",
                    servicePendingIntent(ACTION_MEDIA_NEXT, 203)
                ).build()
            )
            .addAction(
                new Notification.Action.Builder(
                    R.drawable.ic_media_stop,
                    "停止",
                    servicePendingIntent(ACTION_MEDIA_STOP, 204)
                ).build()
            );

        if (mediaSession != null) {
            builder.setStyle(
                new Notification.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );
        }
        return builder.build();
    }

    private PendingIntent servicePendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, ReadAloudPlaybackService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent, pendingFlags());
    }

    private int pendingFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "文章朗读",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("有所闻文章朗读、锁屏和蓝牙媒体控制");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private boolean requestAudioFocus() {
        if (audioManager == null) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest == null) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(focusChangeListener, mainHandler)
                    .setWillPauseWhenDucked(true)
                    .build();
            }
            return audioManager.requestAudioFocus(audioFocusRequest)
                == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        @SuppressWarnings("deprecation")
        int result = audioManager.requestAudioFocus(
            focusChangeListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN
        );
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
            return;
        }
        @SuppressWarnings("deprecation")
        int ignored = audioManager.abandonAudioFocus(focusChangeListener);
    }

    private void handleAudioFocusChange(int focusChange) {
        if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
            if (resumeOnFocusGain) {
                resumeOnFocusGain = false;
                resumeInternal(false);
                emit("focus-gain", null, null, null);
                // JS 同步自己的状态；重复 resume 到 native 会因 paused=false 安全 no-op。
                emit("play", null, null, null);
            }
            return;
        }

        if (
            focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
            focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
        ) {
            resumeOnFocusGain = sessionActive && "playing".equals(mediaState);
            pauseInternal(false);
            emit("focus-loss", null, null, null);
            return;
        }

        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
            resumeOnFocusGain = false;
            pauseInternal(false);
            emit("focus-loss", null, null, null);
        }
    }

    private void registerNoisyReceiver() {
        if (noisyReceiverRegistered) return;
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(noisyReceiver, filter);
        }
        noisyReceiverRegistered = true;
    }

    private void unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) return;
        try {
            unregisterReceiver(noisyReceiver);
        } catch (IllegalArgumentException ignored) {
            // already unregistered
        }
        noisyReceiverRegistered = false;
    }

    private boolean isSpeakingOrPaused() {
        if (paused || pendingSpeak) return true;
        if (!fullText.isEmpty() && tts != null && tts.isSpeaking()) return true;
        // MediaPlayer 在 prepareAsync 阶段也必须可暂停；否则用户在 prepared 前按暂停会继续出声。
        if (audioPlayer != null) return true;
        return false;
    }

    private String engineUtteranceId() {
        return "engine:" + safe(logicalUtteranceId) + ":" + baseOffset + ":" + System.nanoTime();
    }

    private boolean matchesEngineUtterance(@Nullable String id) {
        return id != null && !activeEngineUtteranceId.isEmpty() && id.equals(activeEngineUtteranceId);
    }

    private int clampOffset(int offset) {
        return Math.min(fullText.length(), Math.max(0, offset));
    }

    private static float clamp(float value, float min, float max) {
        if (Float.isNaN(value)) return min;
        return Math.max(min, Math.min(max, value));
    }

    private static String safe(@Nullable String value) {
        return value == null ? "" : value;
    }

    private static String nonBlank(@Nullable String value, String fallback) {
        if (value == null || value.trim().isEmpty()) return fallback;
        return value.trim();
    }

    private static void emit(
        String type,
        @Nullable String utteranceId,
        @Nullable Integer characterOffset,
        @Nullable String message
    ) {
        for (EventListener listener : EVENT_LISTENERS) {
            listener.onEvent(type, utteranceId, characterOffset, message);
        }
    }
}
