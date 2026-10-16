# Merge Accessibility Services into One

**Status:** Planned — awaiting implementation
**Branch:** bug-fixing
**Date:** 2026-05-06

## Problem

The app currently registers **two** separate `AccessibilityService` entries in `AndroidManifest.xml`:

1. `com.breqk.ReelsInterventionService` — Instagram Reels / YouTube Shorts scroll budget + short-form interventions (logcat tag `REELS_WATCH`).
2. `com.breqk.ContentFilterService` — browser omnibar monitoring + adult-domain redirect (logcat tag `BROWSER_WATCH`).

The user must enable **both** toggles in Android Settings → Accessibility for the app to fully function. This is friction for end users and the second toggle is easy to miss. Goal: collapse to one toggle.

## Requirements

- Single `AccessibilityService` handles both Reels/Shorts scroll budget AND browser URL filtering.
- User flips **one** toggle in Android Settings.
- The `content_filter_enabled` SharedPreferences flag still gates browser logic at runtime (separate from OS permission).
- Logcat tags `REELS_WATCH` and `BROWSER_WATCH` both preserved so existing log filters keep working.
- `AccessibilityPermissionActivity` cold-launch gate keeps working unchanged (still checks `ReelsInterventionService`).
- Static test `tests/static/test_001_manifest_services_have_classes.py` stays green.

## Architecture Decision

Keep `ReelsInterventionService` as the canonical class (because the launch gate already references it) and fold the browser-filter behavior into it. `ContentFilterService` becomes a thin wrapper that's deleted; its actual logic in `BrowserBarContentFilter` is reused as-is via static helper calls.

Browser packages (`com.android.chrome`, `org.mozilla.firefox`, `com.brave.browser`, etc.) are disjoint from Reels packages (`com.instagram.android`, `com.google.android.youtube`), so dispatch is unambiguous: branch on package early in `onAccessibilityEvent`.

## Implementation

### Phase 1: Native consolidation (single commit)

#### 1. Union the XML config

File: `android/app/src/main/res/xml/reels_intervention_service_config.xml`

- `accessibilityEventTypes`: `typeViewScrolled|typeWindowStateChanged|typeWindowContentChanged|typeViewTextChanged|typeViewFocused|typeWindowsChanged`
- `accessibilityFlags`: `flagReportViewIds|flagRetrieveInteractiveWindows|flagIncludeNotImportantViews`
- `notificationTimeout="100"` (smaller value wins; browser code already tolerates more frequent events).
- Update header comment to reflect unified scope.

#### 2. Wire browser dispatch into `ReelsInterventionService`

File: `android/app/src/main/java/com/breqk/ReelsInterventionService.java`

- In `onServiceConnected()`: after existing setup, call `BrowserBarContentFilter.logStandaloneServiceConnected(this)`. Skip `configureStandaloneAccessibilityService` if XML now drives everything; otherwise call it once here.
- In `onAccessibilityEvent(event)`: **before** existing Reels logic, branch on package — if browser package AND `BreqkPrefs.isContentFilterEnabled(this)` is true, call `BrowserBarContentFilter.onAccessibilityEvent(this, event)` and `return`. Add a public `BrowserBarContentFilter.isBrowserPackage(String pkg)` helper, or expose the `BROWSER_URL_IDS.containsKey()` check.
- In `onInterrupt()` and `onDestroy()`: also call `BrowserBarContentFilter.cancelDeferredCallbacks()`.

The Reels framework-class guards (`isFrameworkClass`, `isSystemOverlayPackage`) only run **after** the browser branch returns, so they never see browser events.

#### 3. Remove the old service

- Delete `android/app/src/main/java/com/breqk/ContentFilterService.java`.
- Delete `android/app/src/main/res/xml/content_filter_accessibility_config.xml`.
- Remove `<service android:name=".ContentFilterService" ...>` block from `android/app/src/main/AndroidManifest.xml`.
- Delete `BrowserBarContentFilter.configureStandaloneAccessibilityService` if unused after step 2.

### Phase 2: JS bridge + UI cleanup (single commit)

#### 4. Simplify `SettingsModule`

File: `android/app/src/main/java/com/breqk/bridge/SettingsModule.java:427`

Repoint `isContentFilterServiceEnabled` to match `com.breqk/com.breqk.ReelsInterventionService` (the same string the Reels-enabled check already uses), or have it delegate to the existing Reels-enabled check. Prefer delegation so JS callers keep working without changes.

#### 5. Collapse Customize UI

File: `components/Customize/customize.js:220, 329`

- Remove the separate "content filter service active" indicator.
- Show one unified "Accessibility service active" status row.
- Keep the `content_filter_enabled` toggle as an in-app feature switch (independent of OS permission).

### Phase 3: Docs + verification

#### 6. Update docs

- `docs/LOGGING.md` — note `BROWSER_WATCH` logs now originate from `ReelsInterventionService`.
- `docs/TASKS.md` — log the merge under completed work.
- `docs/adr/2026-04-15-reels-refactor.md` — append note.
- `docs/current_task.md` — update.

#### 7. Verify

- Run `python tests/static/test_001_manifest_services_have_classes.py` — passes (only `ReelsInterventionService` remains and its class exists).
- Manual on device:
  - Toggle the single accessibility switch.
  - Verify Instagram Reels scroll cap fires.
  - Visit a `BLOCKED_DOMAINS` entry in Chrome — verify redirect.
  - Run `adb logcat -s REELS_WATCH BROWSER_WATCH` — verify both streams.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Existing users with only `ContentFilterService` enabled lose browser blocking on upgrade. | App launch gate already forces Reels service on, so any active user has it on. |
| Event volume on Reels service increases (browser events added). | Browser dispatch is O(1) HashMap lookup with early return — no measurable perf impact on Reels path. |
| `flagIncludeNotImportantViews` added globally — slightly larger event payloads on IG/YouTube. | Reels code filters by view ID and is unaffected. |
| `configureStandaloneAccessibilityService` may set `serviceInfo` fields not expressible in XML. | Verify before deletion; if needed, call from `onServiceConnected` instead of deleting. |

## Files Touched

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/breqk/ReelsInterventionService.java`
- `android/app/src/main/java/com/breqk/ContentFilterService.java` (delete)
- `android/app/src/main/java/com/breqk/BrowserBarContentFilter.java`
- `android/app/src/main/res/xml/reels_intervention_service_config.xml`
- `android/app/src/main/res/xml/content_filter_accessibility_config.xml` (delete)
- `android/app/src/main/java/com/breqk/bridge/SettingsModule.java`
- `components/Customize/customize.js`
- `docs/LOGGING.md`, `docs/TASKS.md`, `docs/current_task.md`, `docs/adr/2026-04-15-reels-refactor.md`

## Complexity & Time

**Low-Medium.** Estimated **60–90 minutes**:
- Phase 1 (native): 30 min
- Phase 2 (JS/UI): 15 min
- Phase 3 (docs + smoke test): 15 min
