package com.Break.onboarding;

import android.app.AppOpsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import com.Break.ReelsInterventionService;
import com.Break.lock.SettingsLockManager;
import com.Break.prefs.BreakPrefs;
import com.Break.service.BreakVpnService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Durable setup draft and checked activation, using the existing preferences store. */
public final class OnboardingStore {
    private OnboardingStore() {}

    /** Must run before any preference seeding. An unmarked nonempty store is legacy. */
    public static synchronized void initialize(Context context) {
        SharedPreferences prefs = BreakPrefs.get(context);
        if (prefs.contains(BreakPrefs.KEY_ONBOARDING_STATE)) return;
        boolean legacy = !prefs.getAll().isEmpty();
        try {
            JSONObject state = new JSONObject()
                    .put("version", 1).put("completed", legacy).put("legacy", legacy)
                    .put("step", 0).put("selections", new JSONArray())
                    .put("duration", 15).put("reminder", "Why am I opening this?")
                    .put("deletionProtection", false);
            SharedPreferences.Editor edit = prefs.edit()
                    .putString(BreakPrefs.KEY_ONBOARDING_STATE, state.toString());
            if (!legacy) {
                edit.putBoolean(BreakPrefs.KEY_MONITORING_ENABLED, false)
                        .putString(BreakPrefs.KEY_APP_POLICIES, "{}")
                        .putStringSet(BreakPrefs.KEY_BLOCKED_APPS, new HashSet<>());
            }
            if (!edit.commit()) throw new IllegalStateException("Could not initialize setup storage.");
        } catch (org.json.JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    public static JSONObject read(Context context) throws Exception {
        initialize(context);
        JSONObject state = new JSONObject(BreakPrefs.get(context)
                .getString(BreakPrefs.KEY_ONBOARDING_STATE, "{}"));
        state.put("requiresPermissions", BreakPrefs.get(context)
                .getBoolean(BreakPrefs.KEY_MONITORING_ENABLED, true)
                || BreakPrefs.isUninstallLockEnabled(context) || BreakPrefs.isContentFilterEnabled(context));
        return state;
    }

    public static boolean isFreshSetup(Context context) {
        try { return !read(context).optBoolean("legacy", true); }
        catch (Exception e) { return false; }
    }

    /** Looks up explicit catalog packages, including system apps; never enumerates user apps. */
    public static JSONArray installed(Context context, JSONArray catalog) throws Exception {
        JSONArray result = new JSONArray();
        PackageManager pm = context.getPackageManager();
        for (int i = 0; i < catalog.length(); i++) {
            String pkg = catalog.getString(i);
            try {
                if (pm.getApplicationInfo(pkg, 0).enabled) result.put(pkg);
            } catch (PackageManager.NameNotFoundException absent) {
                // Absence is expected; other lookup errors must reach the caller.
            }
        }
        return result;
    }

    public static synchronized JSONObject saveDraft(Context context, String json) throws Exception {
        JSONObject current = read(context);
        if (current.getBoolean("completed")) throw new IllegalStateException("Setup is already complete.");
        JSONObject draft = new JSONObject(json);
        int step = draft.getInt("step");
        if (step < 0 || step > 4) throw new IllegalArgumentException("Invalid setup step.");
        int duration = draft.getInt("duration");
        if (duration != 5 && duration != 15 && duration != 30) throw new IllegalArgumentException("Choose 5, 15, or 30 seconds.");
        String reminder = draft.getString("reminder");
        if (reminder.length() > 80) throw new IllegalArgumentException("Keep the reminder within 80 characters.");
        current.put("step", step).put("selections", draft.getJSONArray("selections"))
                .put("duration", duration).put("reminder", reminder)
                .put("deletionProtection", draft.getBoolean("deletionProtection"));
        commitState(context, current);
        return current;
    }

    /** Reopens only the explicitly deferred, empty setup; legacy configurations cannot be reset. */
    public static synchronized JSONObject beginAppSetup(Context context) throws Exception {
        JSONObject state = read(context);
        if (state.optBoolean("legacy") || state.getJSONArray("selections").length() != 0)
            throw new IllegalStateException("Use app settings to change your existing setup.");
        assertEditable(context, new HashSet<>(BreakPrefs.getAppPolicies(context).keySet()));
        state.put("completed", false).put("step", 1);
        commitState(context, state);
        return state;
    }

    private static void commitState(Context context, JSONObject state) throws Exception {
        if (!BreakPrefs.get(context).edit().putString(BreakPrefs.KEY_ONBOARDING_STATE, state.toString()).commit())
            throw new IllegalStateException("Could not save setup. Please try again.");
    }

    public static boolean permissionsGranted(Context context) {
        AppOpsManager ops = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        boolean usage = ops != null && ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(), context.getPackageName()) == AppOpsManager.MODE_ALLOWED;
        String enabled = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        ComponentName service = new ComponentName(context, ReelsInterventionService.class);
        boolean accessibility = false;
        if (enabled != null) for (String entry : enabled.split(":")) {
            if (service.equals(ComponentName.unflattenFromString(entry))) accessibility = true;
        }
        return usage && Settings.canDrawOverlays(context) && accessibility;
    }

    private static void assertEditable(Context context, Set<String> packages) {
        if (SettingsLockManager.isLocked(context, SettingsLockManager.SCOPE_GLOBAL))
            throw new IllegalStateException("Settings are locked. Try again when the lock ends.");
        for (String pkg : packages) if (SettingsLockManager.isLocked(context, pkg))
            throw new IllegalStateException("App settings are locked. Try again when the lock ends.");
        String mode = BreakPrefs.get(context).getString(BreakPrefs.KEY_ACTIVE_MODE, "default");
        if (!mode.isEmpty() && !"default".equals(mode))
            throw new IllegalStateException("Switch to Default mode before activating setup.");
    }

    /** Persistence and service acceptance both precede the completion marker. Safe to retry. */
    public static synchronized JSONObject complete(Context context, String json, JSONArray catalog) throws Exception {
        JSONObject current = read(context);
        if (current.getBoolean("completed")) return current;
        JSONObject draft = saveDraft(context, json);
        Set<String> selected = strings(draft.getJSONArray("selections"));
        Set<String> supported = strings(catalog);
        if (!supported.containsAll(selected)) throw new IllegalArgumentException("Choose supported apps only.");
        if (!selected.isEmpty() && !strings(installed(context, catalog)).containsAll(selected))
            throw new IllegalStateException("A selected app is no longer available. Go back and update your choices.");
        String reminder = draft.getString("reminder").trim();
        if (!selected.isEmpty() && reminder.isEmpty()) throw new IllegalArgumentException("Write a reminder first.");
        boolean protect = draft.getBoolean("deletionProtection");
        if (selected.isEmpty() && protect) throw new IllegalArgumentException("Choose apps before enabling deletion protection.");
        if ((!selected.isEmpty() || protect) && !permissionsGranted(context))
            throw new IllegalStateException("Required permissions are missing. Return to Permissions to enable them.");
        // Existing consent can only be removed through Customize's disable-pause flow.
        if (BreakPrefs.isUninstallLockEnabled(context) && !protect)
            throw new IllegalStateException("Change deletion protection in Settings first.");
        Set<String> all = new HashSet<>(BreakPrefs.getAppPolicies(context).keySet());
        all.addAll(supported);
        assertEditable(context, all);

        JSONObject policies = new JSONObject();
        JSONObject intercepts = new JSONObject();
        for (String pkg : all) {
            boolean chosen = selected.contains(pkg);
            JSONObject policy = new JSONObject().put("enabled", chosen)
                    .put(BreakPrefs.FEATURE_APP_OPEN_INTERCEPT, chosen);
            for (String feature : new String[] {"reels_detection", "scroll_budget", "free_break",
                    "free_break_enabled", "block_short_form", "launch_popup", "tiktok_foryou",
                    "reddit_feed", "twitter_foryou", "snap_spotlight", "facebook_reels", "facebook_feed"}) {
                policy.put(feature, false);
            }
            policies.put(pkg, policy);
            if (chosen) intercepts.put(pkg, new JSONObject().put("message", reminder)
                    .put("delay_secs", draft.getInt("duration"))
                    .put("popup_delay_min", BreakPrefs.POPUP_DELAY_ONCE_SENTINEL));
        }
        JSONObject modes = BreakPrefs.getModes(context);
        JSONObject baseline = modes.optJSONObject("default");
        if (baseline == null) baseline = new JSONObject().put("name", "Default").put("is_default", true);
        baseline.put("policy_overrides", policies).put("setting_overrides", new JSONObject());
        modes.put("default", baseline);
        SharedPreferences prefs = BreakPrefs.get(context);
        Map<String, ?> before = prefs.getAll();
        Set<String> changed = new HashSet<>(java.util.Arrays.asList(
                BreakPrefs.KEY_APP_POLICIES, BreakPrefs.KEY_INTERCEPT_SETTINGS, BreakPrefs.KEY_MODES,
                BreakPrefs.KEY_ACTIVE_MODE, BreakPrefs.KEY_ACTIVE_MODE_SOURCE, BreakPrefs.KEY_BLOCKED_APPS,
                BreakPrefs.KEY_MONITORING_ENABLED, BreakPrefs.KEY_UNINSTALL_LOCK_ENABLED,
                BreakPrefs.KEY_DELAY_MESSAGE, BreakPrefs.KEY_DELAY_TIME_SECONDS, BreakPrefs.KEY_POPUP_DELAY_MINUTES,
                BreakPrefs.KEY_ONBOARDING_STATE));
        try {
            if (!prefs.edit().putString(BreakPrefs.KEY_APP_POLICIES, policies.toString())
                    .putString(BreakPrefs.KEY_INTERCEPT_SETTINGS, intercepts.toString())
                    .putString(BreakPrefs.KEY_MODES, modes.toString())
                    .putString(BreakPrefs.KEY_ACTIVE_MODE, "default").putString(BreakPrefs.KEY_ACTIVE_MODE_SOURCE, "manual")
                    .putStringSet(BreakPrefs.KEY_BLOCKED_APPS, selected)
                    .putString(BreakPrefs.KEY_DELAY_MESSAGE, reminder).putInt(BreakPrefs.KEY_DELAY_TIME_SECONDS, draft.getInt("duration"))
                    .putInt(BreakPrefs.KEY_POPUP_DELAY_MINUTES, BreakPrefs.POPUP_DELAY_ONCE_SENTINEL)
                    .putBoolean(BreakPrefs.KEY_UNINSTALL_LOCK_ENABLED, protect)
                    .putBoolean(BreakPrefs.KEY_MONITORING_ENABLED, !selected.isEmpty()).commit())
                throw new IllegalStateException("Could not save settings. Please try again.");
            if (!selected.isEmpty()) startMonitoring(context);
            draft.put("completed", true).put("step", 5);
            commitState(context, draft);
            return read(context);
        } catch (Exception failure) {
            // Restore only the keys this operation owns, retaining the saved draft.
            SharedPreferences.Editor rollback = prefs.edit();
            for (String key : changed) {
                Object value = before.get(key);
                if (value == null) rollback.remove(key);
                else if (value instanceof String) rollback.putString(key, (String) value);
                else if (value instanceof Boolean) rollback.putBoolean(key, (Boolean) value);
                else if (value instanceof Integer) rollback.putInt(key, (Integer) value);
                else if (value instanceof Set) {
                    Set<String> values = new HashSet<>();
                    for (Object item : (Set<?>) value) values.add((String) item);
                    rollback.putStringSet(key, values);
                }
            }
            if (!rollback.commit()) throw new IllegalStateException("Storage failed. Reopen Break and retry setup.", failure);
            if (!Boolean.TRUE.equals(before.get(BreakPrefs.KEY_MONITORING_ENABLED))) {
                context.stopService(new Intent(context, BreakVpnService.class));
            }
            throw failure;
        }
    }

    public static void startMonitoring(Context context) {
        Intent intent = new Intent(context, BreakVpnService.class).setAction("START_MONITORING");
        ComponentName accepted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? context.startForegroundService(intent) : context.startService(intent);
        if (accepted == null) throw new IllegalStateException("Android could not start monitoring. Please try again.");
    }

    private static Set<String> strings(JSONArray array) throws Exception {
        Set<String> values = new HashSet<>();
        for (int i = 0; i < array.length(); i++) values.add(array.getString(i));
        return values;
    }
}
