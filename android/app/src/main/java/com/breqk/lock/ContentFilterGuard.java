package com.Break.lock;

import android.content.Context;
import android.util.Log;

import com.Break.prefs.BreakPrefs;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * ContentFilterGuard
 * ------------------
 * Two-layer protection for the browser content filter.
 *
 * Layer 1 — Double-safe toggle:
 *   Turning it OFF is instant but immediately starts a mandatory wait equal to
 *   the Settings Change Lock duration. During this wait the content filter stays
 *   ON and its switch is disabled.
 *
 * Layer 2 — Content filter switch:
 *   The filter can only be turned OFF once the wait has elapsed (LAYER_OFF_READY).
 *   Doing so stamps a 12-hour auto-on timer; the filter re-enables itself lazily
 *   on the next state read — no AlarmManager required.
 *
 * State machine (names shared with the JS layer via lockCycle.js):
 *
 *   GUARD_OFF       — Double-safe off, no wait, filter freely editable
 *   PROTECTED       — Double-safe on, filter on, no wait
 *   LAYER_OFF_WAIT  — Double-safe just turned off, filter on, wait in progress
 *   LAYER_OFF_READY — Wait complete, filter disable now allowed
 *   TEMP_OFF        — Filter off, 12h auto-on timer running
 *   DISABLED        — Filter off, no auto-on (guard was never the path)
 *
 * All state is derived lazily from stored timestamps — no AlarmManager.
 * BrowserBarContentFilter just reads isContentFilterEnabled() which is kept
 * correct at every state-read boundary.
 *
 * Logging prefix: CF_GUARD
 */
public final class ContentFilterGuard {

    private static final String TAG = "CF_GUARD";

    // State names — MUST match GUARD_STATES in components/shared/lockCycle.js.
    public static final String STATE_GUARD_OFF       = "GUARD_OFF";
    public static final String STATE_PROTECTED       = "PROTECTED";
    public static final String STATE_LAYER_OFF_WAIT  = "LAYER_OFF_WAIT";
    public static final String STATE_LAYER_OFF_READY = "LAYER_OFF_READY";
    public static final String STATE_TEMP_OFF        = "TEMP_OFF";
    public static final String STATE_DISABLED        = "DISABLED";

    private ContentFilterGuard() {}

    // ── Internal timestamp helpers ────────────────────────────────────────────

    /** Epoch-ms when Double-safe was turned off (0 = no wait started). */
    private static long getLayerOffAt(Context context) {
        return BreakPrefs.get(context).getLong(BreakPrefs.KEY_CF_PENDING_DISABLE_AT, 0L);
    }

    /** Epoch-ms when the filter disable becomes allowed (0 = no wait). */
    private static long getReadyAt(Context context) {
        return BreakPrefs.get(context).getLong(BreakPrefs.KEY_CF_PENDING_READY_AT, 0L);
    }

    /** Epoch-ms when the 12h auto-on timer fires (0 = no timer). */
    private static long getAutoOnAt(Context context) {
        return BreakPrefs.get(context).getLong(BreakPrefs.KEY_CF_AUTO_ON_AT, 0L);
    }

    private static void clearWait(Context context, String reason) {
        BreakPrefs.get(context).edit()
                .putLong(BreakPrefs.KEY_CF_PENDING_DISABLE_AT, 0L)
                .putLong(BreakPrefs.KEY_CF_PENDING_READY_AT, 0L)
                .apply();
        Log.d(TAG, "wait cleared (" + reason + ")");
    }

    private static void clearAutoOn(Context context, String reason) {
        BreakPrefs.get(context).edit()
                .putLong(BreakPrefs.KEY_CF_AUTO_ON_AT, 0L)
                .apply();
        Log.d(TAG, "auto-on cleared (" + reason + ")");
    }

    /**
     * Lazily re-enables the content filter if the 12h auto-on timer has elapsed.
     * Called at the start of every state read so blocking resumes passively — no
     * AlarmManager, no background service.
     */
    private static void maybeAutoReenable(Context context) {
        if (BreakPrefs.isContentFilterEnabled(context)) return;
        long autoOnAt = getAutoOnAt(context);
        if (autoOnAt <= 0) return;
        if (System.currentTimeMillis() < autoOnAt) return;
        BreakPrefs.setContentFilterEnabled(context, true);
        clearAutoOn(context, "12h auto-on elapsed — filter re-enabled");
        Log.d(TAG, "content filter auto-re-enabled after 12h");
    }

    // ── Public state ──────────────────────────────────────────────────────────

    /** Whether the double-safe guard feature is currently enabled. */
    public static boolean isDoubleSafeEnabled(Context context) {
        return BreakPrefs.get(context).getBoolean(BreakPrefs.KEY_CF_DOUBLE_SAFE_ENABLED, false);
    }

    /**
     * Current guard state. Applies the lazy auto-reenable on every call, so
     * both the Customize screen and BrowserBarContentFilter always see accurate
     * blocking state without needing an explicit polling alarm.
     */
    public static String getState(Context context) {
        maybeAutoReenable(context);

        boolean filterEnabled = BreakPrefs.isContentFilterEnabled(context);

        if (!filterEnabled) {
            long autoOnAt = getAutoOnAt(context);
            if (autoOnAt > 0) return STATE_TEMP_OFF;
            return STATE_DISABLED;
        }

        boolean doubleSafe = isDoubleSafeEnabled(context);
        long readyAt = getReadyAt(context);

        if (doubleSafe) {
            // Guard is on; any stale wait timestamps are ignored.
            return STATE_PROTECTED;
        }

        if (readyAt <= 0) {
            // Guard off, no wait in progress — filter freely editable.
            return STATE_GUARD_OFF;
        }

        long now = System.currentTimeMillis();
        if (now < readyAt) return STATE_LAYER_OFF_WAIT;
        return STATE_LAYER_OFF_READY;
    }

    /**
     * Enable or disable Double-safe.
     *
     * Enabling (true): always instant if the filter is on. Clears any pending
     *   wait, returning to PROTECTED.
     *
     * Disabling (false): only valid from PROTECTED. Writes the wait timestamps
     *   (readyAt = now + SettingsLockManager duration) and immediately succeeds.
     *   Refused from LAYER_OFF_WAIT/LAYER_OFF_READY (wait already running).
     *   Refused when the filter is already off.
     *
     * @return true if the change was applied.
     */
    public static boolean setDoubleSafeEnabled(Context context, boolean enabled) {
        if (enabled) {
            if (!BreakPrefs.isContentFilterEnabled(context)) {
                Log.w(TAG, "setDoubleSafeEnabled(true) refused — filter is off");
                return false;
            }
            BreakPrefs.get(context).edit()
                    .putBoolean(BreakPrefs.KEY_CF_DOUBLE_SAFE_ENABLED, true)
                    .apply();
            if (getLayerOffAt(context) > 0) {
                clearWait(context, "double-safe re-enabled — wait cancelled");
            }
            Log.d(TAG, "setDoubleSafeEnabled=true → PROTECTED");
            return true;
        }

        // Turning OFF: only valid from PROTECTED.
        String state = getState(context);
        if (!STATE_PROTECTED.equals(state)) {
            Log.w(TAG, "setDoubleSafeEnabled(false) refused — state=" + state);
            return false;
        }
        long now = System.currentTimeMillis();
        long readyAt = now + SettingsLockManager.getDurationMs(context);
        BreakPrefs.get(context).edit()
                .putBoolean(BreakPrefs.KEY_CF_DOUBLE_SAFE_ENABLED, false)
                .putLong(BreakPrefs.KEY_CF_PENDING_DISABLE_AT, now)
                .putLong(BreakPrefs.KEY_CF_PENDING_READY_AT, readyAt)
                .apply();
        Log.d(TAG, "setDoubleSafeEnabled=false → LAYER_OFF_WAIT; readyAt=" + readyAt);
        return true;
    }

    /**
     * Whether a direct content-filter disable is permitted right now.
     * Only true from LAYER_OFF_READY (Double-safe off and wait complete).
     * From GUARD_OFF the filter is also freely editable — but that case is
     * handled by the absence of the guard entirely. This gate is specifically
     * for the two-layer path.
     */
    public static boolean isDirectDisableAllowed(Context context) {
        String state = getState(context);
        return STATE_GUARD_OFF.equals(state) || STATE_LAYER_OFF_READY.equals(state);
    }

    /**
     * Called by SettingsModule after successfully disabling the filter from
     * LAYER_OFF_READY. Sets the 12h auto-on timer and clears wait timestamps.
     */
    public static void onFilterDisabled(Context context) {
        long autoOnAt = System.currentTimeMillis() + BreakPrefs.CF_AUTO_ON_MS;
        BreakPrefs.get(context).edit()
                .putLong(BreakPrefs.KEY_CF_AUTO_ON_AT, autoOnAt)
                .apply();
        clearWait(context, "filter disabled from LAYER_OFF_READY — auto-on timer set");
        Log.d(TAG, "filter disabled; auto-on at " + autoOnAt
                + " (in " + (BreakPrefs.CF_AUTO_ON_MS / 60_000) + " min)");
    }

    /**
     * Called by SettingsModule when the filter is turned ON (re-enabled manually
     * or via any direct enable path). Clears the auto-on timer and stale wait.
     */
    public static void onFilterEnabled(Context context) {
        if (getAutoOnAt(context) > 0) {
            clearAutoOn(context, "filter manually re-enabled");
        }
        if (getLayerOffAt(context) > 0) {
            clearWait(context, "filter re-enabled — stale wait cleared");
        }
    }

    /**
     * Full guard state as a JSON string for the React Native bridge.
     * Fields: doubleSafeEnabled, filterEnabled, state, layerOffAt, readyAt,
     *   autoOnAt, now.
     * The JS layer uses these to tick countdowns without native round-trips.
     */
    public static String getStateJson(Context context) {
        String state = getState(context); // applies lazy auto-reenable
        JSONObject out = new JSONObject();
        try {
            out.put("doubleSafeEnabled", isDoubleSafeEnabled(context));
            out.put("filterEnabled", BreakPrefs.isContentFilterEnabled(context));
            out.put("state", state);
            out.put("layerOffAt", getLayerOffAt(context));
            out.put("readyAt", getReadyAt(context));
            out.put("autoOnAt", getAutoOnAt(context));
            out.put("now", System.currentTimeMillis());
        } catch (JSONException e) {
            Log.w(TAG, "getStateJson failed: " + e.getMessage());
        }
        return out.toString();
    }
}
