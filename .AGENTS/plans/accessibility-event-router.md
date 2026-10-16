# Implementation Plan: Accessibility Event Router Refactor

## Task Type
- [x] Backend (Android native — Java/Kotlin)

---

## Context: What Already Exists

Before writing a line of code, understand what the codebase already has:

| Requested Concept | Existing Equivalent |
|---|---|
| `AppConfig.blockShortForm` | `BreqkPrefs.FEATURE_REELS_DETECTION` |
| `AppConfig.launchPopup` | `BreqkPrefs.FEATURE_APP_OPEN_INTERCEPT` |
| `SettingsRepository` | `BreqkPrefs` (SharedPreferences-backed) |
| `ContentFilter` (scroll ejection) | `ReelsInterventionService` (partial — currently handles scroll budget/intervention) |
| `LaunchInterceptor` (overlay on open) | `AppUsageMonitor` (polling-based, WindowManager overlay) |
| Per-app config storage | `BreqkPrefs.getAppPolicies()` / `isFeatureEnabled()` |

The new work is a **structural refactor + TikTok support**, not a ground-up rewrite.

---

## Critical Design Decisions

### Decision 1: Java, not Kotlin
The entire codebase is Java. Kotlin files would interop but add toolchain complexity with no benefit. All new files will be `.java`. The DataStore request is declined for the same reason — `BreqkPrefs` (SharedPreferences) is already the established pattern, is synchronous (safe on accessibility thread), and is shared by every service. Using DataStore would require coroutines, a new dependency, and a parallel storage system.

### Decision 2: Route inside ReelsInterventionService, not a new Service
`ReelsInterventionService` already holds the `AccessibilityService` context, the `onAccessibilityEvent` callback, and the WindowManager reference. Creating a second AccessibilityService for routing is wrong — Android allows at most one active AccessibilityService per component at a time, and running two services for the same packages doubles battery impact. Instead, `AppEventRouter` becomes a plain Java class instantiated inside `ReelsInterventionService.onCreate()`.

### Decision 3: In-memory TTL cache via HashMap + timestamp
The 5-second config cache is trivially implemented with a `HashMap<String, CachedConfig>` where each entry carries a `long cachedAt`. No external library needed. This mirrors the existing `PREFS_SYNC_INTERVAL_MS` pattern already in `AppUsageMonitor`.

### Decision 4: TikTok `blockShortForm` = GLOBAL_ACTION_BACK on each scroll
TikTok's entire app is short-form video. If `blockShortForm` is true for TikTok, the `ContentFilter` calls `performGlobalAction(GLOBAL_ACTION_BACK)` on every scroll event (same path as Reels/Shorts). The `LaunchInterceptor` still shows a mindfulness overlay on launch independently — these are two separate flags and two separate behaviors.

### Decision 5: LaunchInterceptor debounce via SharedPreferences (survives service restart)
The "last foreground timestamp" must survive service restarts. Store it in `BreqkPrefs` (`launch_last_foreground_<pkg>` key). In-memory cache is used for TTL within a session; the pref is the source of truth.

---

## New Feature Flags

Add two new feature flag constants to `BreqkPrefs`:

```java
public static final String FEATURE_BLOCK_SHORT_FORM = "block_short_form"; // ContentFilter
public static final String FEATURE_LAUNCH_POPUP     = "launch_popup";      // LaunchInterceptor
```

These map cleanly onto the existing policy storage system. The existing `FEATURE_REELS_DETECTION` handled both detection AND intervention together. The new flags separate them cleanly.

**TikTok default policy** (added to `migrateIfNeeded` and `createDefaultModesIfNeeded`):
```java
AppConfig("com.zhiliaoapp.musically", blockShortForm = true, launchPopup = true)
```

---

## File Structure

```
android/app/src/main/java/com/breqk/
├── AppEventRouter.java          [NEW] Central dispatcher
├── LaunchInterceptor.java       [NEW] Overlay on fresh app open
├── ContentFilter.java           [NEW] Short-form ejection
├── ReelsInterventionService.java [MODIFY] Wire up AppEventRouter, preserve scroll budget logic
├── BreqkPrefs.java              [MODIFY] Add FEATURE_BLOCK_SHORT_FORM, FEATURE_LAUNCH_POPUP,
│                                         KEY_LAUNCH_LAST_FOREGROUND prefix, TikTok defaults
android/app/src/main/res/xml/
└── reels_intervention_service_config.xml [MODIFY] Add TikTok to accessibilityEventTypes handling
```

No new XML config file is needed. The existing `reels_intervention_service_config.xml` already omits `packageNames` intentionally (to catch home screen / app switch events), and already declares `typeWindowStateChanged|typeWindowContentChanged|typeViewScrolled`. We only need to make sure TikTok events are processed inside `onAccessibilityEvent`.

---

## Implementation Steps

### Step 1: Add constants to `BreqkPrefs.java`

**File**: `android/app/src/main/java/com/breqk/BreqkPrefs.java`

Add after the existing `FEATURE_*` constants:

```java
// New feature flags for AppEventRouter components
public static final String FEATURE_BLOCK_SHORT_FORM = "block_short_form";
public static final String FEATURE_LAUNCH_POPUP     = "launch_popup";

// Key prefix for LaunchInterceptor debounce timestamps
// Full key: KEY_LAUNCH_LAST_FOREGROUND + packageName
// e.g., "launch_last_foreground_com.instagram.android"
public static final String KEY_LAUNCH_LAST_FOREGROUND = "launch_last_foreground_";
```

Add TikTok to `migrateIfNeeded()` default block (alongside Instagram/YouTube):
```java
Map<String, Boolean> tikTokPolicy = new HashMap<>();
tikTokPolicy.put(FEATURE_BLOCK_SHORT_FORM, true);
tikTokPolicy.put(FEATURE_LAUNCH_POPUP, true);
defaults.put("com.zhiliaoapp.musically", tikTokPolicy);
```

Add TikTok to `createDefaultModesIfNeeded()` default mode policies.

**Expected deliverable**: `BreqkPrefs.java` compiles with new constants; `migrateIfNeeded` includes TikTok.

---

### Step 2: Create `AppEventRouter.java`

**File**: `android/app/src/main/java/com/breqk/AppEventRouter.java`

```java
/**
 * AppEventRouter
 * ---------------
 * Central dispatcher for accessibility events inside ReelsInterventionService.
 * Routes TYPE_WINDOW_STATE_CHANGED → LaunchInterceptor
 *         TYPE_WINDOW_CONTENT_CHANGED → ContentFilter
 *
 * These two dispatches are fully independent — no shared state between them.
 *
 * Config cache: 5-second in-memory TTL to avoid hitting SharedPreferences on every event.
 * Cache keys: package name → CachedConfig(blockShortForm, launchPopup, cachedAt)
 *
 * Logging tag: APP_ROUTER
 * Filter: adb logcat -s APP_ROUTER
 */
public class AppEventRouter {
    private static final String TAG = "APP_ROUTER";
    private static final long CONFIG_CACHE_TTL_MS = 5_000L;

    // Monitored package names — router ignores all other packages
    static final Set<String> MONITORED_PACKAGES = new HashSet<>(Arrays.asList(
        "com.instagram.android",
        "com.google.android.youtube",
        "com.zhiliaoapp.musically"
    ));

    private final Context context;
    private final LaunchInterceptor launchInterceptor;
    private final ContentFilter contentFilter;

    // In-memory config cache: packageName → CachedConfig
    private final Map<String, CachedConfig> configCache = new HashMap<>();

    // Lifecycle
    public AppEventRouter(Context context, AccessibilityService service);
    public void onAccessibilityEvent(AccessibilityEvent event);
    public void onDestroy(); // Forwards to LaunchInterceptor + ContentFilter

    // Internal
    private AppConfig getConfig(String packageName);
    private boolean isCacheValid(CachedConfig cached);

    // Inner classes
    static class AppConfig {
        final String packageName;
        final boolean blockShortForm;
        final boolean launchPopup;
    }
    private static class CachedConfig {
        final AppConfig config;
        final long cachedAt;
    }
}
```

**Key implementation detail** in `onAccessibilityEvent`:
```java
public void onAccessibilityEvent(AccessibilityEvent event) {
    String pkg = event.getPackageName() != null ? event.getPackageName().toString() : "";
    if (!MONITORED_PACKAGES.contains(pkg)) return; // fast exit for non-monitored apps

    AppConfig config = getConfig(pkg);
    int eventType = event.getEventType();

    // These two dispatches are independent — order matters for readability only
    if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
        launchInterceptor.onWindowStateChanged(event, config);
    }
    if (eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
            || eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
        contentFilter.onContentChanged(event, config);
    }
}
```

Note: `TYPE_VIEW_SCROLLED` is also routed to `ContentFilter` because TikTok scroll ejection uses it.

**Expected deliverable**: `AppEventRouter.java` compiles; routes events to the two subsystems.

---

### Step 3: Create `LaunchInterceptor.java`

**File**: `android/app/src/main/java/com/breqk/LaunchInterceptor.java`

**Responsibilities**:
- Receives `TYPE_WINDOW_STATE_CHANGED` events from `AppEventRouter`
- Determines if it's a **fresh launch** (app was last in foreground > 30s ago)
- If `launchPopup == true` and it IS a fresh launch: shows 15-second countdown overlay via `WindowManager`
- Overlay must block interaction with underlying app (use `FLAG_NOT_TOUCH_MODAL` cleared + `FLAG_LAYOUT_IN_SCREEN`)
- On dismiss ("I'm being intentional" button): records current timestamp → prevents re-trigger for 30s
- On timer completion: also dismisses, also records timestamp

**Debounce logic**:
```java
// Key: "launch_last_foreground_com.instagram.android"
private boolean isFreshLaunch(String packageName) {
    String key = BreqkPrefs.KEY_LAUNCH_LAST_FOREGROUND + packageName;
    long lastFg = BreqkPrefs.get(context).getLong(key, 0L);
    long elapsed = System.currentTimeMillis() - lastFg;
    boolean fresh = elapsed > FRESH_LAUNCH_THRESHOLD_MS; // 30_000L
    Log.d(TAG, "[LAUNCH_INTERCEPT] pkg=" + packageName
        + " lastFg=" + lastFg + " elapsed=" + elapsed + "ms fresh=" + fresh);
    return fresh;
}

private void recordForeground(String packageName) {
    String key = BreqkPrefs.KEY_LAUNCH_LAST_FOREGROUND + packageName;
    BreqkPrefs.get(context).edit().putLong(key, System.currentTimeMillis()).apply();
}
```

**Overlay design** (WindowManager params):
```java
WindowManager.LayoutParams params = new WindowManager.LayoutParams(
    WindowManager.LayoutParams.MATCH_PARENT,
    WindowManager.LayoutParams.MATCH_PARENT,
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        : WindowManager.LayoutParams.TYPE_PHONE,
    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
    PixelFormat.TRANSLUCENT
);
```

**Countdown timer**: Use `android.os.CountDownTimer` (not `Thread.sleep`). Cancel on dismiss.

**Layout**: Reuse `delay_overlay.xml` or create a new `launch_popup_overlay.xml` with:
- Fullscreen dark background
- App icon (resolved via `AppNameResolver`)
- "Take a breath before opening [App Name]" text
- 15-second countdown
- "I'm being intentional →" dismiss button

**Logging tag**: `LAUNCH_INTERCEPT`
Filter: `adb logcat -s LAUNCH_INTERCEPT`

**Expected deliverable**: `LaunchInterceptor.java` compiles; shows overlay on fresh Instagram open; doesn't re-trigger within 30s.

---

### Step 4: Create `ContentFilter.java`

**File**: `android/app/src/main/java/com/breqk/ContentFilter.java`

**Responsibilities**:
- Receives `TYPE_WINDOW_CONTENT_CHANGED` and `TYPE_VIEW_SCROLLED` events
- Per-package detection logic:
  - **Instagram**: Check for node with `viewIdResourceName` containing `"reels"` or `"clips"`. When found + passes full-screen bounds check → `GLOBAL_ACTION_BACK`
  - **YouTube**: Check for node matching any ID in `YOUTUBE_SHORTS_VIEW_IDS` (copied from existing `ReelsInterventionService`). When found → `GLOBAL_ACTION_BACK`
  - **TikTok**: If `blockShortForm == true`, perform `GLOBAL_ACTION_BACK` on every `TYPE_VIEW_SCROLLED` event (entire app is short-form video; no detection needed)
- **Never block the accessibility thread** — all detection is synchronous node inspection (already the pattern in `ReelsInterventionService`)
- **Debounce**: 600ms between ejections to prevent rapid-fire back-presses (`SCROLL_DEBOUNCE_MS`)

**Extraction from existing code**:
The Instagram Reels detection and YouTube Shorts detection logic already exists in `ReelsInterventionService`. The key methods to extract are:
- `isReelsLayout(AccessibilityNodeInfo root)` 
- `isShortsLayout(AccessibilityNodeInfo root)`
- `isFullScreenReelsViewPager(AccessibilityNodeInfo node, ...)`

These will be moved to `ContentFilter`. `ReelsInterventionService` will delegate to `AppEventRouter` for this detection, but **retain the scroll budget tracking and intervention popup** (that's separate from ejection).

**TikTok ejection** (simplest case):
```java
case "com.zhiliaoapp.musically":
    if (config.blockShortForm && event.getEventType() == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
        long now = System.currentTimeMillis();
        if (now - lastEjectionTime > EJECTION_DEBOUNCE_MS) {
            Log.d(TAG, "[CONTENT_FILTER] TikTok scroll → BACK (blockShortForm=true)");
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
            lastEjectionTime = now;
        }
    }
    break;
```

**Logging tag**: `CONTENT_FILTER`
Filter: `adb logcat -s CONTENT_FILTER`

**Expected deliverable**: `ContentFilter.java` compiles; TikTok ejection works; Instagram/YouTube Reels/Shorts ejection works.

---

### Step 5: Wire AppEventRouter into `ReelsInterventionService`

**File**: `android/app/src/main/java/com/breqk/ReelsInterventionService.java`

Changes:
1. Add field: `private AppEventRouter eventRouter;`
2. In `onServiceConnected()`: `eventRouter = new AppEventRouter(this, this);`
3. In `onAccessibilityEvent()`: Call `eventRouter.onAccessibilityEvent(event)` **before** existing scroll budget logic. The existing budget logic is preserved — `ContentFilter` handles ejection separately, while `ReelsInterventionService` continues tracking time spent in Reels for the budget feature.
4. In `onDestroy()`: `eventRouter.onDestroy();`

**Important**: Do NOT remove existing scroll budget / heartbeat / grace period logic from `ReelsInterventionService`. That's a separate feature (scroll budget tracking + intervention popup when budget is exhausted). The new `ContentFilter` handles proactive ejection; the existing code handles budget-based intervention. Both can coexist.

**Expected deliverable**: `ReelsInterventionService` compiles with the router wired in; no existing behavior regresses.

---

### Step 6: Update AndroidManifest.xml

No new Service registration needed (no new `AccessibilityService` classes). Only verify TikTok is handled by the existing service routing.

If `packageNames` is added back to `reels_intervention_service_config.xml` for performance, add TikTok:
```xml
android:packageNames="com.instagram.android,com.google.android.youtube,com.zhiliaoapp.musically"
```

However, the existing config intentionally omits `packageNames` to catch home-screen navigation events. Keep it omitted and let `AppEventRouter` filter in code.

---

## Key Files

| File | Operation | Purpose |
|------|-----------|---------|
| `BreqkPrefs.java` | Modify | Add `FEATURE_BLOCK_SHORT_FORM`, `FEATURE_LAUNCH_POPUP`, `KEY_LAUNCH_LAST_FOREGROUND`, TikTok defaults |
| `AppEventRouter.java` | Create | Central dispatcher; 5s config cache; routes events to LaunchInterceptor + ContentFilter |
| `LaunchInterceptor.java` | Create | 15s countdown overlay on fresh app open; 30s debounce; WindowManager |
| `ContentFilter.java` | Create | Short-form ejection via GLOBAL_ACTION_BACK; Instagram/YouTube/TikTok detection |
| `ReelsInterventionService.java` | Modify | Wire `AppEventRouter`; preserve all existing scroll budget logic unchanged |

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| `ContentFilter` duplicates logic from `ReelsInterventionService` | Extract detection methods directly from existing code; don't rewrite them |
| `LaunchInterceptor` triggers on back-navigation into app (not just cold launch) | The 30s debounce handles this: returning from a quick task won't re-trigger |
| TikTok ejection catches too aggressively (non-FYP views) | The entire TikTok UX is short-form; `GLOBAL_ACTION_BACK` on scroll is correct behavior |
| Overlay blocks user from dismissing keyboard | LaunchInterceptor overlay must set `FLAG_NOT_FOCUSABLE` + `FLAG_NOT_TOUCH_MODAL` cleared on the input region |
| Two AccessibilityService instances processing same events | Only one service; `AppEventRouter` is a plain Java class, not a second service |
| Kotlin/DataStore mismatch with existing Java/SharedPreferences | Plan uses Java + SharedPreferences to match existing codebase |
| `onAccessibilityEvent` performance (called hundreds of times/sec) | Fast package-name filter in `AppEventRouter` exits in O(1) for non-monitored apps; cache prevents SharedPreferences reads |

---

## SESSION_ID
*External model backends not available — plan generated by Claude directly.*
*Execute with: `/ccg:execute .claude/plan/accessibility-event-router.md`*
