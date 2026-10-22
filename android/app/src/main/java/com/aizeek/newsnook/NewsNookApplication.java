package com.aizeek.newsnook;

import android.app.Application;
import android.content.Context;

/** Keep upgrade cleanup for storage owned by the retired private browser process. */
public final class NewsNookApplication extends Application {
    @Override protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        LegacyPrivateBrowserCleanup.sweep(base);
    }
}
