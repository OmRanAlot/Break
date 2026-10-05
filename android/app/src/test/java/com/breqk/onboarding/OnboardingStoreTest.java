package com.Break.onboarding;

import android.app.Application;
import android.app.AppOpsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.Process;
import android.provider.Settings;
import com.Break.ReelsInterventionService;
import com.Break.lock.SettingsLockManager;
import com.Break.monitor.PopupDecision;
import com.Break.prefs.BreakPrefs;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowSettings;
import java.lang.reflect.Proxy;
import java.util.Collections;
import static org.junit.Assert.*;

/** Exercises real preferences and package lookup with controllable platform failures. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE, application = Application.class)
public class OnboardingStoreTest {
    private static final String YOUTUBE = "com.google.android.youtube";
    private static final String INSTAGRAM = "com.instagram.android";
    private TestContext context;
    private JSONArray catalog;

    private static final class TestContext extends ContextWrapper {
        boolean rejectStart;
        int starts;
        int failCommit;
        TestContext(Context base) { super(base); }
        @Override public ComponentName startForegroundService(Intent intent) {
            starts++;
            if (rejectStart) throw new IllegalStateException("Start rejected");
            return intent.getComponent();
        }
        @Override public boolean stopService(Intent intent) { return true; }
        @Override public SharedPreferences getSharedPreferences(String name, int mode) {
            SharedPreferences prefs = super.getSharedPreferences(name, mode);
            return (SharedPreferences) Proxy.newProxyInstance(getClassLoader(), new Class<?>[]{SharedPreferences.class},
                    (proxy, method, args) -> {
                        if (!method.getName().equals("edit")) return method.invoke(prefs, args);
                        SharedPreferences.Editor delegate = prefs.edit();
                        return Proxy.newProxyInstance(getClassLoader(), new Class<?>[]{SharedPreferences.Editor.class},
                                (editor, operation, values) -> {
                                    Object result = operation.invoke(delegate, values);
                                    if (operation.getName().equals("commit") && failCommit > 0 && --failCommit == 0) return false;
                                    return result instanceof SharedPreferences.Editor ? editor : result;
                                });
                    });
        }
    }

    @Before public void prepare() throws Exception {
        context = new TestContext(RuntimeEnvironment.getApplication());
        BreakPrefs.get(context).edit().clear().commit();
        catalog = new JSONArray().put(YOUTUBE).put(INSTAGRAM);
        install(YOUTUBE, true, true);
        install(INSTAGRAM, true, false);
        grantPermissions();
    }
    private void install(String pkg, boolean enabled, boolean system) {
        PackageInfo info = new PackageInfo();
        info.packageName = pkg;
        info.applicationInfo = new ApplicationInfo();
        info.applicationInfo.packageName = pkg;
        info.applicationInfo.enabled = enabled;
        info.applicationInfo.flags = system ? ApplicationInfo.FLAG_SYSTEM : 0;
        Shadows.shadowOf(context.getPackageManager()).installPackage(info);
    }
    private void grantPermissions() {
        ShadowSettings.setCanDrawOverlays(true);
        AppOpsManager ops = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        Shadows.shadowOf(ops).setMode(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName(), AppOpsManager.MODE_ALLOWED);
        Settings.Secure.putString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                new ComponentName(context, ReelsInterventionService.class).flattenToString());
    }
    private JSONObject draft(boolean apps) throws Exception {
        OnboardingStore.initialize(context);
        BreakPrefs.migrateIfNeeded(context);
        BreakPrefs.createDefaultModesIfNeeded(context);
        return OnboardingStore.read(context).put("step", 4)
                .put("selections", apps ? new JSONArray().put(YOUTUBE) : new JSONArray())
                .put("duration", 30).put("reminder", "Find a tutorial");
    }
    @Test public void lookupIncludesSystemYoutubeButExcludesDisabledAndAbsent() throws Exception {
        install(INSTAGRAM, false, false);
        catalog.put("absent.package");
        assertEquals("[\"" + YOUTUBE + "\"]", OnboardingStore.installed(context, catalog).toString());
    }
    @Test public void freshInstallStartsEmptyWithNoAutomaticSchedules() throws Exception {
        draft(false);
        assertFalse(OnboardingStore.read(context).getBoolean("completed"));
        assertFalse(BreakPrefs.get(context).getBoolean(BreakPrefs.KEY_MONITORING_ENABLED, true));
        assertTrue(BreakPrefs.getBlockedApps(context).isEmpty());
        assertEquals(0, BreakPrefs.getModes(context).getJSONObject("default").getJSONObject("policy_overrides").length());
        assertFalse(BreakPrefs.getModes(context).getJSONObject("bedtime").has("schedule"));
    }
    @Test public void legacyMigrationPreservesPoliciesAndModes() throws Exception {
        BreakPrefs.get(context).edit().putString(BreakPrefs.KEY_APP_POLICIES, "{\"saved\":{\"reels_detection\":true}}")
                .putString(BreakPrefs.KEY_MODES, "{\"custom\":{\"name\":\"Mine\"}}").commit();
        OnboardingStore.initialize(context);
        BreakPrefs.migrateIfNeeded(context);
        BreakPrefs.createDefaultModesIfNeeded(context);
        assertTrue(OnboardingStore.read(context).getBoolean("completed"));
        assertTrue(OnboardingStore.read(context).getBoolean("legacy"));
        assertTrue(BreakPrefs.getAppPolicy(context, "saved").get("reels_detection"));
        assertEquals("Mine", BreakPrefs.getModes(context).getJSONObject("custom").getString("name"));
    }
    @Test public void completionMatchesEffectiveOverlayAndHomeSettings() throws Exception {
        JSONObject state = draft(true);
        BreakPrefs.get(context).edit().putBoolean(BreakPrefs.KEY_CONTENT_FILTER_ENABLED, true).commit();
        assertTrue(OnboardingStore.complete(context, state.toString(), catalog).getBoolean("completed"));
        assertEquals(Collections.singleton(YOUTUBE), BreakPrefs.getBlockedApps(context));
        assertEquals(30, BreakPrefs.getEffectiveDelaySecs(context, YOUTUBE));
        assertEquals("Find a tutorial", BreakPrefs.getAppInterceptSettings(context, YOUTUBE).getString("message"));
        int repeat = BreakPrefs.getEffectivePopupDelayMinutes(context, YOUTUBE);
        assertEquals(BreakPrefs.POPUP_DELAY_ONCE_SENTINEL, repeat);
        assertFalse(PopupDecision.shouldShowNext(1L, repeat, Long.MAX_VALUE));
        assertFalse(BreakPrefs.isFeatureEnabled(context, INSTAGRAM, BreakPrefs.FEATURE_APP_OPEN_INTERCEPT));
        assertFalse(BreakPrefs.isFeatureEnabled(context, YOUTUBE, BreakPrefs.FEATURE_REELS_DETECTION));
        assertFalse(BreakPrefs.isFeatureEnabled(context, "com.zhiliaoapp.musically", BreakPrefs.FEATURE_BLOCK_SHORT_FORM));
        assertTrue(BreakPrefs.isContentFilterEnabled(context));
        assertEquals(1, context.starts);
        OnboardingStore.complete(context, state.toString(), catalog);
        assertEquals(1, context.starts);
    }
    @Test public void noAppsNeedsNoPermissionsAndDoesNotStartMonitoring() throws Exception {
        JSONObject state = draft(false);
        ShadowSettings.setCanDrawOverlays(false);
        JSONObject saved = OnboardingStore.complete(context, state.toString(), catalog);
        assertTrue(saved.getBoolean("completed"));
        assertFalse(saved.getBoolean("requiresPermissions"));
        assertEquals(0, context.starts);
        assertFalse(OnboardingStore.beginAppSetup(context).getBoolean("completed"));
    }
    @Test public void unavailableSelectionAndMissingPermissionRejectBeforePolicies() throws Exception {
        JSONObject state = draft(true);
        install(YOUTUBE, false, true);
        assertThrows(IllegalStateException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
        install(YOUTUBE, true, true);
        ShadowSettings.setCanDrawOverlays(false);
        assertThrows(IllegalStateException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
        assertFalse(OnboardingStore.read(context).getBoolean("completed"));
        assertTrue(BreakPrefs.getBlockedApps(context).isEmpty());
    }
    @Test public void startFailureRollsBackButKeepsDraftAndRetrySucceeds() throws Exception {
        JSONObject state = draft(true);
        context.rejectStart = true;
        assertThrows(IllegalStateException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
        assertEquals(30, OnboardingStore.read(context).getInt("duration"));
        assertFalse(OnboardingStore.read(context).getBoolean("completed"));
        assertTrue(BreakPrefs.getBlockedApps(context).isEmpty());
        assertFalse(BreakPrefs.get(context).getBoolean(BreakPrefs.KEY_MONITORING_ENABLED, true));
        context.rejectStart = false;
        assertTrue(OnboardingStore.complete(context, state.toString(), catalog).getBoolean("completed"));
    }
    @Test public void persistenceAndCompletionMarkerFailuresRemainRetryable() throws Exception {
        JSONObject state = draft(true);
        for (int failAt : new int[]{2, 3}) {
            context.failCommit = failAt;
            assertThrows(IllegalStateException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
            assertFalse(OnboardingStore.read(context).getBoolean("completed"));
            assertTrue(BreakPrefs.getBlockedApps(context).isEmpty());
        }
        assertTrue(OnboardingStore.complete(context, state.toString(), catalog).getBoolean("completed"));
    }
    @Test public void settingsLocksAndDeletionConsentCannotBeBypassed() throws Exception {
        JSONObject state = draft(true);
        SettingsLockManager.setEnabled(context, true);
        SettingsLockManager.startLock(context, YOUTUBE);
        assertThrows(IllegalStateException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
        SettingsLockManager.setEnabled(context, false);
        BreakPrefs.setUninstallLockEnabled(context, true);
        assertThrows(IllegalStateException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
        assertTrue(BreakPrefs.isUninstallLockEnabled(context));
    }
    @Test public void invalidDurationReminderAndPackageAreRejected() throws Exception {
        JSONObject state = draft(true).put("duration", 0);
        assertThrows(IllegalArgumentException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
        state.put("duration", 15).put("reminder", " ");
        assertThrows(IllegalArgumentException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
        state.put("reminder", "valid").put("selections", new JSONArray().put("unsupported"));
        assertThrows(IllegalArgumentException.class, () -> OnboardingStore.complete(context, state.toString(), catalog));
    }
}
