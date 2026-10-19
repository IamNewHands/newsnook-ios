package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.ApplicationInfo;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.rules.TemporaryFolder;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class LegacyPrivateBrowserCleanupTest {
    @Rule public TemporaryFolder directory = new TemporaryFolder();

    private Context isolatedDataContext() {
        Context application = RuntimeEnvironment.getApplication();
        return new ContextWrapper(application) {
            @Override public ApplicationInfo getApplicationInfo() {
                ApplicationInfo info = new ApplicationInfo(application.getApplicationInfo());
                info.dataDir = directory.getRoot().getAbsolutePath();
                return info;
            }
        };
    }

    private File marker(String path) throws Exception {
        File file = new File(directory.getRoot(), path);
        assertTrue(file.getParentFile().isDirectory() || file.getParentFile().mkdirs());
        Files.write(file.toPath(), "sentinel".getBytes(StandardCharsets.UTF_8));
        return file;
    }

    @org.robolectric.annotation.Implements(android.system.Os.class)
    public static class AndroidFileStat {
        @org.robolectric.annotation.Implementation
        protected static android.system.StructStat lstat(String path) throws android.system.ErrnoException {
            // Robolectric's host-file stat returns an empty StructStat for absent paths on Windows.
            // Android lstat throws ENOENT, including the second idempotent cleanup pass.
            File file = new File(path);
            if (!file.exists() && !Files.isSymbolicLink(file.toPath()))
                throw new android.system.ErrnoException("lstat", android.system.OsConstants.ENOENT);
            return org.robolectric.shadow.api.Shadow.directlyOn(android.system.Os.class, "lstat",
                org.robolectric.util.ReflectionHelpers.ClassParameter.from(String.class, path));
        }
    }

    @Test
    @Config(shadows = AndroidFileStat.class)
    public void interruptedSessionCleanupOnlyRemovesOwnedDirectories() throws Exception {
        File cookie = marker("app_webview/Default/Cookies");
        File regularCache = marker("cache/regular-image");
        File account = marker("files/account-state");
        File preferences = marker("shared_prefs/user.xml");
        File ordinaryCodeCache = marker("code_cache/normal-module");
        File similarProfile = marker("app_webview_newsnook_private_v10/Default/Cookies");
        File similarCache = marker("cache/browser-private-backup/image");
        File privateCookie = marker("app_webview_" + LegacyPrivateBrowserCleanup.DATA_SUFFIX + "/Default/Cookies");
        File privateCache = marker("cache/webview_" + LegacyPrivateBrowserCleanup.DATA_SUFFIX + "/Cache/data");
        File privateExport = marker("cache/" + LegacyPrivateBrowserCleanup.TEMP_DIRECTORY + "/share-image.png");
        File privateFiles = marker("files/" + LegacyPrivateBrowserCleanup.TEMP_DIRECTORY + "/temporary-image");
        File privateCodeCache = marker("code_cache/" + LegacyPrivateBrowserCleanup.TEMP_DIRECTORY + "/temporary-code");

        LegacyPrivateBrowserCleanup.cleanupOwnedDirectories(isolatedDataContext());

        for (File preserved : new File[] { cookie, regularCache, account, preferences, ordinaryCodeCache, similarProfile, similarCache })
            assertTrue("ordinary application data must survive: " + preserved.getName(), preserved.isFile());
        for (File removed : new File[] { privateCookie, privateCache, privateExport, privateFiles, privateCodeCache })
            assertFalse("an interrupted private session must not be restored", removed.exists());
        // A second startup sweep is harmless after a successful cleanup.
        LegacyPrivateBrowserCleanup.cleanupOwnedDirectories(isolatedDataContext());
    }

}
