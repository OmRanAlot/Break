# Implementation Plan: Reorganize `com.breqk` Native Package

> **User instruction (verbatim):**
> "create a plan to reorganize all the code in @android/app/src/main/java/com/breqk . Name everything accordingly, and make seperate files for YouTube and Instagram. Add boilerplate code for future features and other apps like TikTok, Facebook, and Snapchat(no implementation at all, just comments). Think through everything. make no mistakes"

---

## Task Type
- [x] **Refactor / Reorganization** (native Android Java + Kotlin layer only)
- [ ] Frontend
- [ ] Backend logic change
- [ ] New feature

**Zero behavior change.** Every symbol keeps its current semantics. Only locations, package declarations, imports, and (a handful of) class names change. Platform-specific ID constants move out of `ShortFormIds` into per-platform files. New boilerplate files for TikTok / Facebook / Snapchat contain **only comments** — no executable statements.

---

## 1. Current State Audit

### 1.1 File inventory (current flat layout under `android/app/src/main/java/com/breqk/`)

Root-level (16 files, ~7,000 LOC):

| File | LOC | Responsibility |
|------|----:|----------------|
| `AccessibilityPermissionActivity.java` | 115 | Gate activity for a11y permission |
| `AppBlockerPackage.java` | 31 | React Native package registration |
| `AppEventRouter.java` | 209 | Central a11y event dispatcher with per-package `AppConfig` inner class |
| `AppNameResolver.java` | 83 | Package → display-name utility |
| `AppUsageMonitor.java` | 1228 | 1s UsageStats polling + launch-delay overlay |
| `BreqkDeviceAdminReceiver.java` | 71 | Device admin receiver |
| `BreqkPrefs.java` | 612 | Centralized SharedPreferences facade + policy resolution |
| `BreqkWidgetProvider.java` | 122 | Home-screen widget |
| `ContentFilter.java` | 459 | Per-app event handlers (Instagram/YouTube/TikTok) + detection helpers |
| `ContentFilterService.java` | 269 | Wrapper a11y service (legacy) |
| `LaunchInterceptor.java` | 331 | Fresh-launch detection per app |
| `MainActivity.java` | 48 | RN host activity |
| `MainApplication.kt` | — | RN host application |
| `ModeManager.java` | 339 | Study/Bedtime/custom mode lifecycle |
| `ModeSchedulerReceiver.java` | 134 | AlarmManager receiver for mode schedules |
| `MyVpnService.java` | 263 | Foreground service; owns background `AppUsageMonitor` |
| `ReelsInterventionService.java` | 1058 | **Primary a11y service** — Reels/Shorts detection, overlay, budget |
| `ScreenTimeTracker.java` | 623 | Screen-time stats |
| `ServiceHelper.java` | 45 | Misc service utilities |
| `SettingsModule.java` | 387 | RN bridge for settings |
| `VPNModule.java` | 1135 | RN bridge for monitoring + permissions |

Sub-packages (already present, partial separation):

```
reels/
├── FrameworkClassFilter.java     (181)
├── FullScreenCheck.java          (99)
├── ShortFormIds.java             (187)  ← lumps Instagram + YouTube IDs
├── budget/
│   ├── BudgetHeartbeat.java      (92)
│   ├── BudgetState.java          (118)
│   └── HomeFeedCounter.java      (51)
├── detection/
│   ├── InstagramDetector.java    (109)
│   ├── ShortFormDetector.java    (71)
│   └── YouTubeDetector.java      (374)
└── intervention/
    ├── InterventionOverlay.java  (113)
    └── ReelsStateMachine.java    (77)
```

**Total: ~9,800 LOC across 32 files.**

### 1.2 Problem areas

1. **Flat root** — 21 unrelated responsibilities dumped in `com.breqk` root. No bridge / service / prefs separation.
2. **`reels/ShortFormIds.java`** — single file mixes Instagram home-feed IDs, Reels IDs, YouTube Shorts IDs, YouTube secondary IDs, YouTube class names, and full-screen geometry thresholds. Any YouTube-only tweak forces edits to a file shared with Instagram.
3. **`ContentFilter.java`** — `handleInstagram` / `handleYouTube` / `handleTikTok` handlers, plus `isInstagramReels` / `isYouTubeShorts` helpers, all live in one 459-line file.
4. **`AppEventRouter.MONITORED_PACKAGES`** — hardcoded HashSet; adding a platform requires editing the router instead of opting in from the platform file.
5. **`reels/` package name** — the package now handles YouTube Shorts too; "reels" is Instagram-specific.
6. **Inner `AppConfig`** in `AppEventRouter` — config data structure trapped inside a router class, hard to reuse.

---

## 2. Target Package Structure

```
android/app/src/main/java/com/breqk/
├── MainActivity.java
├── MainApplication.kt
├── accessibility/
│   ├── AccessibilityPermissionActivity.java
│   ├── BreqkAccessibilityService.java     ← renamed from ContentFilterService (class rename safe — not persisted in a11y settings)
│   └── ReelsInterventionService.java      ← class name UNCHANGED (persisted in user settings)
├── bridge/
│   ├── BreqkReactPackage.java              ← renamed from AppBlockerPackage
│   ├── SettingsModule.java
│   └── VPNModule.java
├── deviceadmin/
│   └── BreqkDeviceAdminReceiver.java
├── mode/
│   ├── ModeManager.java
│   └── ModeSchedulerReceiver.java
├── monitor/
│   ├── AppNameResolver.java
│   ├── AppUsageMonitor.java
│   ├── LaunchInterceptor.java
│   ├── ScreenTimeTracker.java
│   └── ServiceHelper.java
├── prefs/
│   └── BreqkPrefs.java
├── service/
│   └── BreqkVpnService.java                ← renamed from MyVpnService
├── shortform/                              ← renamed from reels/
│   ├── AppEventRouter.java
│   ├── AppConfig.java                      ← promoted from AppEventRouter inner class
│   ├── ContentFilter.java                  ← slim dispatcher only
│   ├── FrameworkClassFilter.java
│   ├── FullScreenCheck.java                ← absorbs MIN_WIDTH_RATIO / MIN_HEIGHT_RATIO / MAX_TOP_PX
│   ├── budget/
│   │   ├── BudgetHeartbeat.java
│   │   ├── BudgetState.java
│   │   └── HomeFeedCounter.java
│   ├── detection/
│   │   └── ShortFormDetector.java          ← base interface
│   ├── intervention/
│   │   ├── InterventionOverlay.java
│   │   └── ShortFormStateMachine.java      ← renamed from ReelsStateMachine
│   ├── platform/
│   │   ├── Platform.java                   ← NEW enum (INSTAGRAM, YOUTUBE, TIKTOK, FACEBOOK, SNAPCHAT)
│   │   ├── PlatformRegistry.java           ← NEW opt-in wiring table
│   │   ├── instagram/
│   │   │   ├── InstagramViewIds.java       ← extracted from ShortFormIds
│   │   │   ├── InstagramDetector.java
│   │   │   └── InstagramFilterHandler.java ← extracted from ContentFilter.handleInstagram
│   │   ├── youtube/
│   │   │   ├── YouTubeViewIds.java         ← extracted from ShortFormIds
│   │   │   ├── YouTubeDetector.java
│   │   │   └── YouTubeFilterHandler.java   ← extracted from ContentFilter.handleYouTube
│   │   ├── tiktok/
│   │   │   ├── TikTokViewIds.java          ← BOILERPLATE (comments only)
│   │   │   ├── TikTokDetector.java         ← BOILERPLATE (comments only)
│   │   │   └── TikTokFilterHandler.java    ← BOILERPLATE (comments only)
│   │   ├── facebook/
│   │   │   ├── FacebookViewIds.java        ← BOILERPLATE (comments only)
│   │   │   ├── FacebookDetector.java       ← BOILERPLATE (comments only)
│   │   │   └── FacebookFilterHandler.java  ← BOILERPLATE (comments only)
│   │   └── snapchat/
│   │       ├── SnapchatViewIds.java        ← BOILERPLATE (comments only)
│   │       ├── SnapchatDetector.java       ← BOILERPLATE (comments only)
│   │       └── SnapchatFilterHandler.java  ← BOILERPLATE (comments only)
│   └── widget/
│       └── BreqkWidgetProvider.java        ← (under shortform if widget surfaces shortform stats; else keep under /widget/)
```

> **Decision note — widget placement.** If `BreqkWidgetProvider` renders shortform/budget data it belongs under `shortform/widget/`. If it renders general screen-time data it belongs under its own `com.breqk.widget` sibling package. Execution step 4 will inspect the widget source and make this call; default is a sibling `widget/` package. The directory tree above shows the conservative default (see step 4).

---

## 3. Rename Map (class-level)

| Old FQN | New FQN | Rationale | Compat risk |
|---------|---------|-----------|-------------|
| `com.breqk.AppBlockerPackage` | `com.breqk.bridge.BreqkReactPackage` | Not "app blocker"; it's the RN package entry. | Must update `MainApplication.kt` import + `packages.add(BreqkReactPackage())`. |
| `com.breqk.MyVpnService` | `com.breqk.service.BreqkVpnService` | "MyVpnService" is placeholder. Not a real VPN anymore — naming kept only for legacy. | Must update `AndroidManifest.xml` service entry **and** every `new Intent(ctx, MyVpnService.class)` call site (verified: `VPNModule.java`, `ReelsInterventionService.java` L369). Intent actions unchanged — SharedPreferences sync unaffected. |
| `com.breqk.ContentFilterService` | `com.breqk.accessibility.BreqkAccessibilityService` | Current name misleading (it's the legacy wrapper service). Class rename safe because manifest reference is relative `.ContentFilterService` → update to `.accessibility.BreqkAccessibilityService`. | Check whether this service is referenced from any persisted user state. (It's declared in manifest but may be disabled — if still listed, update any a11y settings UI path text.) |
| `com.breqk.ReelsInterventionService` | `com.breqk.accessibility.ReelsInterventionService` | **Class name MUST NOT change** — it's persisted in `Settings.Secure.enabled_accessibility_services` on user devices. Renaming would silently disable protection across the installed base. Only the package moves. | Manifest must update to fully-qualified `com.breqk.accessibility.ReelsInterventionService`. Users' enabled-services string references the old `com.breqk.ReelsInterventionService/com.breqk.ReelsInterventionService` — **handled by a one-shot migration: see §9 Risk R-03**. |
| `com.breqk.reels.ShortFormIds` | *(deleted — split into `InstagramViewIds`, `YouTubeViewIds`, and constants moved to `FullScreenCheck`)* | Per-platform files. | All call sites that used `ShortFormIds.INSTAGRAM_*` → `InstagramViewIds.*`; `ShortFormIds.YT_*` → `YouTubeViewIds.*`; `ShortFormIds.MIN_WIDTH_RATIO` etc. → `FullScreenCheck.MIN_WIDTH_RATIO`. |
| `com.breqk.reels.intervention.ReelsStateMachine` | `com.breqk.shortform.intervention.ShortFormStateMachine` | State machine handles both Reels and Shorts. | Update all references in `ReelsInterventionService`. |
| `com.breqk.AppEventRouter.AppConfig` *(inner)* | `com.breqk.shortform.AppConfig` *(top-level)* | Reusable outside router. | `AppEventRouter` now imports `AppConfig`. |

**No rename** for: `VPNModule` (used verbatim by JS `NativeModules.VPNModule`), `SettingsModule` (same), `ReelsInterventionService` class simple-name (persisted).

**Package rename**: `com.breqk.reels.*` → `com.breqk.shortform.*` (the umbrella now covers YouTube Shorts, TikTok, Reels, etc.).

---

## 4. `ShortFormIds` → per-platform split

Current `reels/ShortFormIds.java` sections and target destinations:

| Current constant group | New file | Notes |
|---|---|---|
| Instagram home feed IDs | `shortform/platform/instagram/InstagramViewIds.java` | `HOME_FEED_CONTAINER_IDS`, `HOME_FEED_VIEW_PAGER_IDS`, etc. |
| Instagram Reels IDs | `shortform/platform/instagram/InstagramViewIds.java` | Same file, separate static group. |
| YouTube Shorts primary IDs | `shortform/platform/youtube/YouTubeViewIds.java` | `SHORTS_VIEW_ID`, etc. |
| YouTube secondary IDs | `shortform/platform/youtube/YouTubeViewIds.java` | Same file. |
| YouTube seekbar ID | `shortform/platform/youtube/YouTubeViewIds.java` | Same file. |
| YouTube class names | `shortform/platform/youtube/YouTubeViewIds.java` | `YT_SHORTS_CLASSNAMES` array. |
| `MIN_WIDTH_RATIO`, `MIN_HEIGHT_RATIO`, `MAX_TOP_PX` | `shortform/FullScreenCheck.java` | Thresholds are geometric, not platform-specific. |

After migration, delete `shortform/ShortFormIds.java`. Compile error from any unmigrated reference is the safety net.

---

## 5. `ContentFilter` extraction

Current `ContentFilter.java` holds (confirmed from prior read of the file):

- `handleInstagram(event, root)` + helpers `isInstagramReels`, Instagram-specific fast paths
- `handleYouTube(event, root)` + helpers `isYouTubeShorts`, YouTube-specific fast paths
- `handleTikTok(event, root)` — stub / partial

**Split plan:**

```
shortform/ContentFilter.java
   → becomes a thin dispatcher. Given AccessibilityEvent + root + packageName,
     looks up handler via PlatformRegistry.handlerFor(platform) and delegates.

shortform/platform/instagram/InstagramFilterHandler.java
   → implements FilterHandler interface
   → moves handleInstagram body verbatim, plus isInstagramReels helper.

shortform/platform/youtube/YouTubeFilterHandler.java
   → implements FilterHandler interface
   → moves handleYouTube body verbatim, plus isYouTubeShorts helper.
```

**`FilterHandler` interface (new, in `shortform/platform/FilterHandler.java`):**

```java
package com.breqk.shortform.platform;

import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

public interface FilterHandler {
    /** Return true if event was handled / overlay triggered. */
    boolean handle(AccessibilityEvent event, AccessibilityNodeInfo root);

    /** Platform identity (for logging, budget keys). */
    Platform platform();
}
```

---

## 6. `Platform` enum + `PlatformRegistry`

### 6.1 `Platform.java`

```java
package com.breqk.shortform.platform;

public enum Platform {
    INSTAGRAM("com.instagram.android"),
    YOUTUBE("com.google.android.youtube"),
    TIKTOK("com.zhiliaoapp.musically"),     // boilerplate
    FACEBOOK("com.facebook.katana"),        // boilerplate
    SNAPCHAT("com.snapchat.android");       // boilerplate

    public final String pkg;
    Platform(String pkg) { this.pkg = pkg; }

    public static Platform fromPackage(String pkg) {
        for (Platform p : values()) if (p.pkg.equals(pkg)) return p;
        return null;
    }
}
```

### 6.2 `PlatformRegistry.java`

```java
package com.breqk.shortform.platform;

import com.breqk.shortform.platform.instagram.InstagramFilterHandler;
import com.breqk.shortform.platform.youtube.YouTubeFilterHandler;
// TikTok / Facebook / Snapchat handlers intentionally NOT imported — boilerplate only.

import java.util.EnumMap;
import java.util.Map;

/** Opt-in table for platform wiring. To enable a platform:
 *   1. Create its *Detector, *ViewIds, *FilterHandler files.
 *   2. Register its handler here.
 *   3. Add its package string to Platform enum (done).
 */
public final class PlatformRegistry {
    private static final Map<Platform, FilterHandler> HANDLERS = new EnumMap<>(Platform.class);
    static {
        HANDLERS.put(Platform.INSTAGRAM, new InstagramFilterHandler());
        HANDLERS.put(Platform.YOUTUBE,   new YouTubeFilterHandler());
        // HANDLERS.put(Platform.TIKTOK,   new TikTokFilterHandler());   // TODO: enable when implemented
        // HANDLERS.put(Platform.FACEBOOK, new FacebookFilterHandler()); // TODO: enable when implemented
        // HANDLERS.put(Platform.SNAPCHAT, new SnapchatFilterHandler()); // TODO: enable when implemented
    }

    public static FilterHandler handlerFor(Platform p) { return HANDLERS.get(p); }
    public static boolean isMonitored(String pkg) {
        Platform p = Platform.fromPackage(pkg);
        return p != null && HANDLERS.containsKey(p);
    }
    private PlatformRegistry() {}
}
```

### 6.3 `AppEventRouter` uses the registry

Remove the hardcoded `MONITORED_PACKAGES` HashSet. Replace with `PlatformRegistry.isMonitored(packageName)`. One edit site in `AppEventRouter.java` (the package-filter conditional).

---

## 7. Boilerplate templates for TikTok / Facebook / Snapchat

**Every boilerplate file contains comments only. No executable statements, no fields, no method bodies beyond `return null;` / `return false;` where the interface demands it.** The goal is to compile cleanly and serve as the entry point for future implementation.

### 7.1 `TikTokViewIds.java` (template — Facebook/Snapchat follow identical shape)

```java
package com.breqk.shortform.platform.tiktok;

/**
 * View-ID constants for TikTok short-form UI detection.
 *
 * TODO(tiktok): populate via UiAutomator dump of TikTok on a fresh install.
 *   Capture IDs for:
 *     - Video feed container
 *     - Like / comment / share buttons (to confirm in-video state)
 *     - Fullscreen video surface
 *     - "For You" vs "Following" tab identifiers (if filtering by tab)
 *
 * Source reference layout:
 *   - InstagramViewIds.java  (for structure)
 *   - YouTubeViewIds.java    (for class-name matching pattern)
 */
public final class TikTokViewIds {
    // TODO(tiktok): add String[] FEED_CONTAINER_IDS  = { ... };
    // TODO(tiktok): add String[] VIDEO_SURFACE_IDS   = { ... };
    // TODO(tiktok): add String[] CLASSNAMES          = { ... };

    private TikTokViewIds() {}
}
```

### 7.2 `TikTokDetector.java`

```java
package com.breqk.shortform.platform.tiktok;

import android.view.accessibility.AccessibilityNodeInfo;
import com.breqk.shortform.detection.ShortFormDetector;

/**
 * Detector for TikTok short-form video playback.
 *
 * TODO(tiktok): implement isShortForm(root) using TikTokViewIds + FullScreenCheck.
 * Reference implementations:
 *   - InstagramDetector  (home-feed vs Reels discrimination)
 *   - YouTubeDetector    (Shorts vs normal player discrimination)
 *
 * Detection strategy outline:
 *   1. Fast reject: if package != Platform.TIKTOK.pkg → false
 *   2. Find video surface node by TikTokViewIds.VIDEO_SURFACE_IDS
 *   3. Apply FullScreenCheck (width >= MIN_WIDTH_RATIO, height >= MIN_HEIGHT_RATIO)
 *   4. If tab filtering required, confirm "For You" tab is selected
 */
public final class TikTokDetector implements ShortFormDetector {
    @Override
    public boolean isShortForm(AccessibilityNodeInfo root) {
        // TODO(tiktok): implement.
        return false;
    }
}
```

### 7.3 `TikTokFilterHandler.java`

```java
package com.breqk.shortform.platform.tiktok;

import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import com.breqk.shortform.platform.FilterHandler;
import com.breqk.shortform.platform.Platform;

/**
 * Event handler for TikTok short-form interventions.
 *
 * TODO(tiktok): mirror InstagramFilterHandler and wire budget consumption,
 *   overlay triggers, and scroll counting via BudgetState + InterventionOverlay.
 *
 * Wiring checklist when enabling:
 *   1. Implement handle(...) below.
 *   2. Register in PlatformRegistry:
 *        HANDLERS.put(Platform.TIKTOK, new TikTokFilterHandler());
 *   3. Declare TikTok-specific prefs keys in BreqkPrefs if needed.
 *   4. Add UI entry under Customize screen for per-app TikTok settings.
 */
public final class TikTokFilterHandler implements FilterHandler {
    @Override
    public boolean handle(AccessibilityEvent event, AccessibilityNodeInfo root) {
        // TODO(tiktok): implement.
        return false;
    }

    @Override
    public Platform platform() { return Platform.TIKTOK; }
}
```

**Facebook** — identical three-file shape, `TODO(facebook)` markers, referencing Facebook Watch / Reels. **Snapchat** — identical shape, `TODO(snapchat)` markers, referencing Spotlight.

---

## 7A. Dead Code & Redundancy Removal

Graph audit (`refactor_tool mode=suggest` via code-review-graph MCP) surfaced 188 "unused" suggestions. After filtering out Android framework callbacks (manifest-registered services/receivers, `@ReactMethod` bridge methods, `AccessibilityService.onAccessibilityEvent`, widget `onUpdate`, lifecycle overrides), the following are **genuinely dead or redundant** and must be removed during the reorganization.

### 7A.1 Confirmed dead (remove outright)

| Symbol | File | Evidence | Action |
|---|---|---|---|
| `AppEventRouter.CachedConfig` (inner class) | `AppEventRouter.java` | Zero callers, zero imports, not an entry point. Replaced in-practice by `EnumMap` in the new `PlatformRegistry`. | Delete inner class + any fields/methods that reference it. |
| `AppEventRouter.MONITORED_PACKAGES` (static Set) | `AppEventRouter.java` | Replaced by `PlatformRegistry.isMonitored(pkg)` in step 6c. | Delete field after registry swap is live. Grep must return zero refs before deletion. |
| `ShortFormIds` class | `reels/ShortFormIds.java` | Already scheduled (§6a). Listed here for completeness — after per-platform ViewIds files are populated and `FullScreenCheck` absorbs the geometry constants, `ShortFormIds` has zero callers. | Delete file in step 6a. |
| `reels/ShortFormIds` JavaDoc cross-refs to `ContentFilter.java` line numbers (L86, L101, L106, L112) | `reels/ShortFormIds.java` | Stale. Becomes moot when `ShortFormIds` is deleted and `ContentFilter` becomes a dispatcher. | Deleted with the file. |
| `ReelsInterventionService.java:115` comment: `// Target package names — must stay in sync with AppEventRouter.MONITORED_PACKAGES` | `ReelsInterventionService.java` | Stale after `PlatformRegistry` takes over. The sync obligation no longer exists. | Delete comment in step 6c. |
| `ReelsInterventionService.java:282` log line referencing `AppEventRouter.MONITORED_PACKAGES` | `ReelsInterventionService.java` | References deleted field. | Replace with `PlatformRegistry` iteration log, or delete if redundant with existing startup logs. |
| `reels/FullScreenCheck.java:17` doc-comment cross-ref to `ContentFilter.java (isFullScreenNode)` | `reels/FullScreenCheck.java` | `isFullScreenNode` in `ContentFilter` is also graph-flagged unused. Both the helper and the cross-ref go away when thresholds land in `FullScreenCheck` and `ContentFilter` becomes a dispatcher. | Delete cross-ref; delete `ContentFilter.isFullScreenNode` if confirmed unused post-extraction. |

### 7A.2 Redundant (consolidate, don't duplicate)

| Symbol | File | Redundancy | Action |
|---|---|---|---|
| `ContentFilterService` (legacy a11y wrapper) | `ContentFilterService.java` + manifest entry + `res/xml/content_filter_accessibility_config.xml` | Manifest registers two a11y services — `ContentFilterService` (legacy, content filtering) and `ReelsInterventionService` (primary, Reels/Shorts). The former is only reachable if the user toggles it in system a11y settings. Plan §1.1 already calls it "legacy". Keeping two registrations risks double event delivery and user confusion. | **Decision required:** (a) confirm it is functionally dead and delete file + manifest `<service>` entry + the a11y config XML, or (b) keep it for browser URL-based filtering as its own responsibility. **Default recommendation: delete.** Added as explicit Step 4b in §8. |
| `WidgetPrefs` | `WidgetPrefs.java` | Separate SharedPreferences facade living next to `BreqkPrefs`. Only caller is `SettingsModule.java:106` (`new WidgetPrefs(reactContext)`). `BreqkPrefs` is the "centralized SharedPreferences helper" per CLAUDE.md. | Fold widget-cache accessors (`updateWidgetCache`, `getFocusScore`, `getTimeSavedMin`, `getAppsBlocked`, `isMonitoringEnabled`, `getUpdatedAt`) into `BreqkPrefs` under a `widget_*` key prefix. Delete `WidgetPrefs.java`. Update the one call site in `SettingsModule`. |
| Duplicate full-screen geometry constants | `reels/ShortFormIds.java` (`MIN_WIDTH_RATIO`, `MIN_HEIGHT_RATIO`, `MAX_TOP_PX`) consumed by `FullScreenCheck.java` | Thresholds live in one file, are consumed from another with no added value. | Already consolidated in step 6a — move constants into `FullScreenCheck` and delete from `ShortFormIds`. Verified here for completeness. |
| Duplicate short-form detection paths per platform | `ContentFilter.isInstagramReels` + `reels/detection/InstagramDetector`; `ContentFilter.isYouTubeShorts` + `reels/detection/YouTubeDetector` | Two parallel detection code paths per platform. `*Detector` classes are intended as the single source of truth. | When extracting `InstagramFilterHandler` / `YouTubeFilterHandler` in step 6b, delegate detection to the `*Detector` classes instead of copying the inline `ContentFilter` helpers. Delete `isInstagramReels` / `isYouTubeShorts` from `ContentFilter` after extraction. |
| Stale delegation comment | `ReelsInterventionService.java:348`: "Delegates to FrameworkClassFilter.isFrameworkClass() — shared with ContentFilter" | Once `ContentFilter` becomes a pure dispatcher, only `ReelsInterventionService` uses the helper directly; the "shared with" phrasing is misleading. | Update the comment to reflect post-reorg reality. |

### 7A.3 Graph-flagged "unused" that are NOT dead (do not remove)

Retained for clarity — these will all re-appear on a future `refactor_tool mode=suggest` run and must be ignored:

- All `@ReactMethod` methods on `VPNModule`, `SettingsModule` — invoked via RN bridge string lookup.
- `MainActivity`, `MainApplication.getPackages`, `MainApplication.getUseDeveloperSupport` — framework entry points.
- `BreqkDeviceAdminReceiver.onEnabled` / `onDisabled`, `BreqkWidgetProvider.onUpdate`, `ModeSchedulerReceiver.onReceive` — manifest-registered broadcast/widget callbacks.
- `ContentFilterService.onAccessibilityEvent` / `onServiceConnected` / `onInterrupt`, `ReelsInterventionService.*` counterparts — a11y framework callbacks.
- `MyVpnService.onStartCommand` / `onDestroy`, `onAppDetected`, `onBlockedAppOpened` — service framework + `AppUsageMonitor` listener callbacks.
- `AppUsageMonitor.run` — `Runnable` implementation driven by `Handler.postDelayed`.
- `BudgetHeartbeat.run`, `BudgetHeartbeat.HeartbeatCallback.*` — callback interface implemented by `ReelsInterventionService`.
- `ScreenTimeTracker.getScreenTimeStats` / `getComprehensiveStats` / `getPerAppStats` — reached via `VPNModule` bridge.
- All `@Override` methods whose interface/superclass drives the call.

### 7A.4 Verification protocol for each removal

Before deleting any symbol listed above:

1. **Re-run the graph**: `mcp__code-review-graph__refactor_tool(mode="dead_code", file_pattern="android/app/src/main/java/com/breqk/")`. Confirm the symbol is still flagged.
2. **Grep all languages**: search for the symbol in `.java`, `.kt`, `.xml`, `.tsx`, `.ts`, `.js` — manifest refs and RN-bridge `NativeModules.*` string lookups will not appear in the Java graph.
3. **Check test locations**: even though there are no unit tests today, future tests under `android/app/src/test` or `__tests__/` must be searched.
4. **Build after each removal**: `./gradlew assembleDebug` must stay green. Removing dead code should never break the build — a failure means the symbol is not actually dead, revert and investigate.
5. **Commit per removal**: one symbol → one commit → one rollback unit.

---

## 8. Execution Order (8 compile-safe steps)

Each step ends with `./gradlew assembleDebug` green. No step leaves the tree half-moved.

### Step 1 — Create target directory skeleton

Create empty directories only (no files yet):
```
accessibility/  bridge/  deviceadmin/  mode/  monitor/  prefs/  service/
shortform/platform/{instagram,youtube,tiktok,facebook,snapchat}/
```

Rename `reels/` → `shortform/` **last** (step 7) to avoid double-move.

Build: N/A (no .java changes).

### Step 2 — Move non-controversial leaves (no renames)

Move each of these to its new package. Update ONLY the `package` line and every `import com.breqk.<ClassName>` across the codebase via search-and-replace.

- `AppNameResolver`, `AppUsageMonitor`, `LaunchInterceptor`, `ScreenTimeTracker`, `ServiceHelper` → `com.breqk.monitor.*`
- `BreqkPrefs` → `com.breqk.prefs.*`
- `ModeManager`, `ModeSchedulerReceiver` → `com.breqk.mode.*`
- `BreqkDeviceAdminReceiver` → `com.breqk.deviceadmin.*`
- `AccessibilityPermissionActivity` → `com.breqk.accessibility.*`
- `SettingsModule`, `VPNModule` → `com.breqk.bridge.*`

**Build + smoke test.**

### Step 3 — Update AndroidManifest + Kotlin host

After step 2, the manifest's relative class refs break. Update:

```xml
<!-- OLD → NEW -->
<activity android:name=".AccessibilityPermissionActivity" …/>
    → android:name=".accessibility.AccessibilityPermissionActivity"

<receiver android:name=".BreqkDeviceAdminReceiver" …/>
    → android:name=".deviceadmin.BreqkDeviceAdminReceiver"

<receiver android:name=".ModeSchedulerReceiver" …/>
    → android:name=".mode.ModeSchedulerReceiver"

<receiver android:name=".BreqkWidgetProvider" …/>
    → android:name=".widget.BreqkWidgetProvider"   (or shortform.widget, see §2 decision note)

<!-- Services — see step 4 for MyVpnService rename -->
<service android:name=".MyVpnService" …/>
    → android:name=".service.BreqkVpnService"     (in step 4)
<service android:name=".ContentFilterService" …/>
    → android:name=".accessibility.BreqkAccessibilityService"  (in step 4)
<service android:name=".ReelsInterventionService" …/>
    → android:name=".accessibility.ReelsInterventionService"

<activity android:name=".MainActivity" …/>        (unchanged — MainActivity stays at root)
<application android:name=".MainApplication" …/>  (unchanged — Kotlin stays at root)
```

Update `MainApplication.kt`:
```kotlin
// OLD
import com.breqk.AppBlockerPackage
import com.breqk.VPNModule
import com.breqk.SettingsModule
import com.breqk.AppUsageMonitor

// NEW (after step 2 moves — AppBlockerPackage rename happens in step 6)
import com.breqk.AppBlockerPackage      // still AppBlockerPackage until step 6
import com.breqk.bridge.VPNModule
import com.breqk.bridge.SettingsModule
import com.breqk.monitor.AppUsageMonitor
```

**Build + install on device + verify app launches.**

### Step 4b — Delete `ContentFilterService` (legacy a11y wrapper)

Per §7A.2, `ContentFilterService` is the legacy wrapper; `ReelsInterventionService` is the canonical a11y service. Delete before attempting the rename in Step 4 so there is only one a11y service to move.

- Delete `ContentFilterService.java`.
- Remove the `<service android:name=".ContentFilterService" …>` block from `AndroidManifest.xml`.
- Delete `android/app/src/main/res/xml/content_filter_accessibility_config.xml`.
- Grep for any `ContentFilterService.class` / `"ContentFilterService"` string ref and remove.
- The `<service android:name=".accessibility.BreqkAccessibilityService">` rename planned in Step 4 is **cancelled** — no replacement is needed.

**Rollback note:** users who had only `ContentFilterService` enabled (not `ReelsInterventionService`) will lose content filtering on upgrade. `AccessibilityPermissionActivity` already gates on `ReelsInterventionService` being enabled, so the affected population is zero for anyone who completed the permission gate. Document in release notes.

**Build + install + verify:** Reels intervention, launch-delay overlay, and RN bridge all still function.

### Step 4c — Delete `WidgetPrefs`, fold into `BreqkPrefs`

Per §7A.2, `WidgetPrefs` duplicates `BreqkPrefs` responsibilities.

- Copy the six accessors (`updateWidgetCache`, `getFocusScore`, `getTimeSavedMin`, `getAppsBlocked`, `isMonitoringEnabled`, `getUpdatedAt`) into `BreqkPrefs` under a `widget_*` key-prefix group, preserving existing key strings to avoid a data migration.
- Update `SettingsModule.java:106` from `WidgetPrefs widgetPrefs = new WidgetPrefs(reactContext);` to the equivalent `BreqkPrefs` call.
- Delete `WidgetPrefs.java`.
- Grep `WidgetPrefs` across the repo — zero hits expected post-change.

**Build + install + verify:** widget still renders after `BreqkWidgetProvider.onUpdate` fires. Launch app, change blocked apps, confirm widget updates next refresh cycle.

### Step 4 — Move services (with `MyVpnService` rename)

- Move `MyVpnService.java` → `service/BreqkVpnService.java`. Rename class. Rename file.
- `ContentFilterService.java` — **already deleted in Step 4b.** No move needed.
- Move `ReelsInterventionService.java` → `accessibility/ReelsInterventionService.java`. **Do not rename class.** (Reconsider per §10 / R-03: may stay at root to preserve persisted FQN.)
- Move `BreqkWidgetProvider.java` → `widget/BreqkWidgetProvider.java` (fresh `widget/` sibling package; or `shortform/widget/` if it renders budget data — inspect source first).
- Move `MainActivity.java` — **stays at root** (referenced as `.MainActivity` in manifest).

Update call sites of `MyVpnService.class`:
- `bridge/VPNModule.java` — every `new Intent(ctx, MyVpnService.class)` → `new Intent(ctx, BreqkVpnService.class)`.
- `accessibility/ReelsInterventionService.java` L369 area — the DISMISS_OVERLAY intent dispatch.

Update manifest service names (done partially in step 3; finalize here).

**Build + install + verify:**
- Monitoring toggle still starts foreground service.
- Opening a blocked app still shows delay overlay.
- Opening Instagram Reels still triggers intervention.

### Step 5 — Reorganize shortform package (rename `reels/` → `shortform/`)

Move `reels/*` to `shortform/*`:
- `reels/FrameworkClassFilter.java` → `shortform/FrameworkClassFilter.java`
- `reels/FullScreenCheck.java` → `shortform/FullScreenCheck.java`
- `reels/ShortFormIds.java` → temporarily `shortform/ShortFormIds.java` (deleted in step 6)
- `reels/budget/*` → `shortform/budget/*`
- `reels/detection/ShortFormDetector.java` → `shortform/detection/ShortFormDetector.java`
- `reels/detection/InstagramDetector.java` → `shortform/platform/instagram/InstagramDetector.java`
- `reels/detection/YouTubeDetector.java` → `shortform/platform/youtube/YouTubeDetector.java`
- `reels/intervention/InterventionOverlay.java` → `shortform/intervention/InterventionOverlay.java`
- `reels/intervention/ReelsStateMachine.java` → `shortform/intervention/ShortFormStateMachine.java` (rename class)

Update package decls + all imports. Update `ReelsStateMachine` → `ShortFormStateMachine` references (grep-confirmed, should be in `ReelsInterventionService.java` only).

Move `AppEventRouter` + `ContentFilter` to `shortform/`:
- `AppEventRouter.java` → `shortform/AppEventRouter.java`. Promote inner `AppConfig` to `shortform/AppConfig.java`.
- `ContentFilter.java` → `shortform/ContentFilter.java`. Leave body intact for now (extraction in step 6).

**Build + install + verify:** same three smoke tests.

### Step 6 — Split `ShortFormIds` + extract `ContentFilter` handlers + introduce registry

**6a. Split `ShortFormIds`:**
- Create `shortform/platform/instagram/InstagramViewIds.java` with Instagram constants.
- Create `shortform/platform/youtube/YouTubeViewIds.java` with YouTube constants.
- Move `MIN_WIDTH_RATIO` / `MIN_HEIGHT_RATIO` / `MAX_TOP_PX` into `FullScreenCheck.java` (as `public static final` constants).
- Update all references (grep `ShortFormIds\.` codebase-wide — Instagram refs → `InstagramViewIds`, YouTube refs → `YouTubeViewIds`, thresholds → `FullScreenCheck`).
- Delete `shortform/ShortFormIds.java`. Compile must stay green.

**6b. Extract handlers:**
- Create `shortform/platform/FilterHandler.java` interface (§5).
- Create `shortform/platform/Platform.java` enum.
- Create `shortform/platform/instagram/InstagramFilterHandler.java` — move `handleInstagram` + `isInstagramReels` body verbatim from `ContentFilter`.
- Create `shortform/platform/youtube/YouTubeFilterHandler.java` — move `handleYouTube` + `isYouTubeShorts` body verbatim.
- Reduce `ContentFilter.java` to a thin dispatcher that calls `PlatformRegistry.handlerFor(Platform.fromPackage(pkg)).handle(...)`.

**6c. Introduce `PlatformRegistry`:**
- Create `shortform/platform/PlatformRegistry.java` with Instagram + YouTube wired.
- Replace `AppEventRouter.MONITORED_PACKAGES` Set with `PlatformRegistry.isMonitored(pkg)`.
- **Delete `AppEventRouter.MONITORED_PACKAGES` field** (per §7A.1). Grep must return zero refs first.
- **Delete `AppEventRouter.CachedConfig` inner class** (per §7A.1) if it is still present after the router edits.
- **Delete stale comment at `ReelsInterventionService.java:115`** ("must stay in sync with AppEventRouter.MONITORED_PACKAGES"); the sync obligation no longer exists.
- **Update the log line at `ReelsInterventionService.java:282`** to iterate `PlatformRegistry` instead of the deleted Set, or delete if redundant.
- **Delete `ContentFilter.isFullScreenNode`**, `ContentFilter.isInstagramReels`, and `ContentFilter.isYouTubeShorts` (per §7A.1 / §7A.2) — the extracted handlers delegate to `FullScreenCheck` and the `*Detector` classes.

**Build + install + run full smoke test:**
- Instagram home feed counter still increments.
- Instagram Reels intervention still triggers.
- YouTube Shorts intervention still triggers.
- YouTube seekbar / primary feed detection unchanged.
- Budget state survives foreground toggle.

### Step 7 — Create boilerplate files for TikTok, Facebook, Snapchat

Create **nine files** (three per platform), each comment-only per §7:

```
shortform/platform/tiktok/TikTokViewIds.java
shortform/platform/tiktok/TikTokDetector.java
shortform/platform/tiktok/TikTokFilterHandler.java
shortform/platform/facebook/FacebookViewIds.java
shortform/platform/facebook/FacebookDetector.java
shortform/platform/facebook/FacebookFilterHandler.java
shortform/platform/snapchat/SnapchatViewIds.java
shortform/platform/snapchat/SnapchatDetector.java
shortform/platform/snapchat/SnapchatFilterHandler.java
```

Add `TIKTOK`, `FACEBOOK`, `SNAPCHAT` entries to `Platform` enum with package names.

Do **NOT** register handlers in `PlatformRegistry` yet — leave the three `// HANDLERS.put(...)` lines commented out as TODO markers.

**Build:** all boilerplate files must compile (interface contract satisfied with placeholder returns).

### Step 8 — Final rename: `AppBlockerPackage` → `BreqkReactPackage`

Done last because `MainApplication.kt` is Kotlin and must update in lockstep.

- Rename class in `bridge/` folder. File rename: `AppBlockerPackage.java` → `BreqkReactPackage.java`.
- Update `MainApplication.kt`:
  ```kotlin
  import com.breqk.bridge.BreqkReactPackage
  // …
  packages.add(BreqkReactPackage())
  ```

**Build + install + full smoke:** RN bridge methods still invocable from JS.

---

## 9. Risk Matrix

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R-01 | Moving `ReelsInterventionService` class to sub-package **disables accessibility service** on upgraded installs because the persisted `enabled_accessibility_services` string references the old FQN. | **CRITICAL** | See R-03. |
| R-02 | `MyVpnService` rename breaks foreground-service restart on app upgrade (framework tracks by ComponentName). | HIGH | OS treats new ComponentName as a new service — old one just never starts again. Acceptable. No data loss (state in SharedPreferences). Document in release notes. |
| R-03 | Persisted a11y-service FQN. | **CRITICAL** | **Keep ReelsInterventionService class simple-name unchanged AND keep its package unchanged if possible.** Alternative: keep it at `com.breqk.ReelsInterventionService` (root) — do NOT move it to `accessibility/`. **This overrides the §2 structure for this one file.** Updated decision: **ReelsInterventionService stays at `com.breqk` root.** Update §2 structure tree accordingly before execution. |
| R-04 | Manifest-relative `.ClassName` refs silently resolve wrong after moves. | HIGH | Replace every `.ClassName` with fully-qualified `com.breqk.subpkg.ClassName` in manifest. Grep `android:name="\."` to confirm none remain. |
| R-05 | RN bridge modules expose `getName()` strings that JS depends on. | HIGH | Do **NOT** change `VPNModule.getName()` or `SettingsModule.getName()` return values. Class moves only. |
| R-06 | Broadcast/Intent action strings hardcoded across packages. | MEDIUM | These are string constants, not class refs — no change needed. Verify via grep of `"com.breqk.action."` prefixes. |
| R-07 | IDE may auto-add imports for `ShortFormIds` after deletion. | LOW | Rely on compiler error to catch. Do step 6a before any follow-on refactor. |
| R-08 | `ReelsStateMachine` rename breaks a log-grep workflow documented in `docs/LOGGING.md`. | LOW | Search docs for "ReelsStateMachine" — update tag strings if used as log tags. |
| R-09 | React Native's Gradle metro cache holds old package paths. | LOW | `cd android && ./gradlew clean` between each step. |

---

## 10. Updated Structure (after R-03 correction)

**ReelsInterventionService stays at `com.breqk` root** to preserve the persisted a11y-service FQN:

```
com.breqk/
├── MainActivity.java
├── MainApplication.kt
├── ReelsInterventionService.java        ← PINNED at root (a11y persistence)
├── accessibility/
│   ├── AccessibilityPermissionActivity.java
│   └── BreqkAccessibilityService.java   ← (if ContentFilterService is still in manifest)
├── bridge/  …
├── deviceadmin/  …
├── mode/  …
├── monitor/  …
├── prefs/  …
├── service/  …
├── shortform/  …
└── widget/  …
```

`ReelsInterventionService` still imports from `com.breqk.shortform.*` — its location changes nothing about its dependencies, only preserves the ComponentName persisted in user settings.

**If** the user confirms no installed base yet (greenfield), the pin can be lifted and the service moved to `accessibility/` as originally shown. **Default: PIN AT ROOT.**

---

## 11. AndroidManifest.xml updates (final diff)

```diff
- <activity android:name=".AccessibilityPermissionActivity"
+ <activity android:name=".accessibility.AccessibilityPermissionActivity"

- <receiver android:name=".BreqkDeviceAdminReceiver"
+ <receiver android:name=".deviceadmin.BreqkDeviceAdminReceiver"

- <receiver android:name=".ModeSchedulerReceiver"
+ <receiver android:name=".mode.ModeSchedulerReceiver"

- <receiver android:name=".BreqkWidgetProvider"
+ <receiver android:name=".widget.BreqkWidgetProvider"

- <service android:name=".MyVpnService"
+ <service android:name=".service.BreqkVpnService"

- <service android:name=".ContentFilterService"
+ <service android:name=".accessibility.BreqkAccessibilityService"

  <service android:name=".ReelsInterventionService"     ← UNCHANGED (R-03)

  <activity android:name=".MainActivity"                 ← UNCHANGED
  <application android:name=".MainApplication"           ← UNCHANGED
```

---

## 12. Verification Checklist (run after every step)

- [ ] `./gradlew assembleDebug` green.
- [ ] `./gradlew lint` reports no new errors.
- [ ] App launches on device.
- [ ] `adb logcat | findstr /i breqk` shows service start logs.
- [ ] Permissions screen opens and enables accessibility service.
- [ ] Opening Instagram → delay overlay appears (if Instagram is in blocked_apps).
- [ ] Scrolling Instagram Reels → intervention popup appears at threshold.
- [ ] Scrolling YouTube Shorts → intervention popup appears at threshold.
- [ ] Home-screen widget updates (if installed).
- [ ] Mode schedules still trigger (set a 1-min test schedule).
- [ ] RN JS `NativeModules.VPNModule.startMonitoring()` still resolves.
- [ ] RN JS `NativeModules.SettingsModule.setBlockedApps(...)` still persists.

---

## 13. Rollback Plan

Each step is a separate commit. To roll back any step:

```bash
git revert <commit-sha-of-failed-step>
./gradlew clean assembleDebug
```

No SharedPreferences schema changes — rollback is pure source-level. User data preserved across every step.

---

## 14. Out of Scope

- Rewriting any method body beyond the targeted dead-code deletions in §7A. Code otherwise moves verbatim; only package declarations + imports + a handful of class names change.
- Adding TikTok/Facebook/Snapchat detection logic. Those three platforms get comment-only scaffolding. A future `/ccg:plan` per platform fills in `TODO(tiktok)` etc.
- Unit test additions. (Existing tests move with their source file if any exist; otherwise untouched.)
- Kotlin conversion. All Java files stay Java.
- Changes to `BreqkPrefs` persisted key strings. The `WidgetPrefs` fold (Step 4c) preserves existing key names; no data migration.

**Now IN scope (per §7A):**
- Deletion of `ContentFilterService` + manifest entry + a11y config XML.
- Deletion of `WidgetPrefs.java`; fold into `BreqkPrefs`.
- Deletion of `AppEventRouter.CachedConfig` and `AppEventRouter.MONITORED_PACKAGES`.
- Deletion of `ShortFormIds.java` (already in §6a).
- Deletion of `ContentFilter.isFullScreenNode` / `isInstagramReels` / `isYouTubeShorts` after handler extraction.
- Comment/log cleanup in `ReelsInterventionService` referencing deleted symbols.

---

## 15. Effort Estimate

| Step | Time |
|------|-----:|
| 1 — Skeleton dirs | 5m |
| 2 — Move leaves (11 files) | 45m |
| 3 — Manifest + MainApplication | 20m |
| 4b — Delete `ContentFilterService` | 20m |
| 4c — Fold `WidgetPrefs` into `BreqkPrefs` | 30m |
| 4 — Services + widget | 45m |
| 5 — `reels/` → `shortform/` + router | 60m |
| 6 — Split IDs + extract handlers + registry + dead-code deletions | 120m |
| 7 — Boilerplate (9 files) | 30m |
| 8 — `BreqkReactPackage` rename | 15m |
| Full-device smoke after each step | ~40m total |
| **Total** | **~7h** |

---

## 16. SESSION_ID (for /ccg:execute use)

- CODEX_SESSION: _(unavailable — codeagent-wrapper not installed in this environment; plan is Claude-only)_
- GEMINI_SESSION: _(unavailable — same reason)_

Execution via `/ccg:execute` will proceed without external-model resume; rely on this plan document plus source-file inspection per step.
