# Plan: Fix Overlay Disappearing After Recent-Apps Round-Trip

## Bug

When the user opens an app with an active intercept (Settings, YouTube, etc.),
the delay overlay appears as expected. If the user then opens the recent-apps
overview (swipe up / square button) and taps back into that same app, the
overlay is gone — the intercept is effectively bypassed until the
`popup_delay_min` timer expires.

## Root Cause

In `android/app/src/main/java/com/breqk/monitor/AppUsageMonitor.java` inside
the `monitorApps()` runnable:

1. **L275–281 — Auto-dismiss on foreground change.** When recents opens, the
   foreground package switches to `com.android.systemui` (or the launcher's
   recents activity). The auto-dismiss branch fires because
   `foregroundApp != lastAppPackage`, calls `removeOverlay()`, and clears
   `isOverlayActive` / `lastAppPackage`.

2. **L284–288 — System/launcher auto-dismiss.** `isSystemOrLauncher()`
   includes `com.android.systemui`, so recents specifically also routes
   through this branch.

3. **L410 — `lastPopupShownTimestamps` was set when the popup first
   appeared.** `removeOverlay()` deliberately does NOT clear this map
   (per the comment at L854–856).

4. **L357–361 — Return path.** When the user returns to the blocked app:
   - `shouldShowFirstPopup` is `false` because `lastPopupTime != null`.
   - `shouldShowNextPopup` is `false` because only a few seconds have
     elapsed and `popupDelayMs` is on the order of minutes.
   - Net result: no popup is shown until the long popup-delay window has
     passed.

The same dismiss-on-foreground-change pattern is the only path used by every
app-open intercept — fixing it in `AppUsageMonitor` fixes the bug for **all
intercepts driven by app-open detection** (Settings, YouTube, any custom
blocked app).

## Other Overlays Reviewed

- `InterventionOverlay` (Reels/Shorts "Time is up!") — driven by the
  accessibility service watching scroll events, not by foreground polling. It
  is not subject to this bug. No change required.
- `UninstallLockOverlay` — driven by accessibility window-content events on
  the Settings uninstall screen. It already has its own reshow/cooldown
  semantics and is not subject to this bug. No change required.

So the fix is localized to `AppUsageMonitor.java`.

## Fix Strategy

Two cooperating changes:

### A. Treat recents/systemui/launcher as transient — don't dismiss yet

The recents overview is not the user choosing to leave the app; it is a
short-lived system surface they almost always return from. Dismissing the
overlay on recents causes the bug.

- Track `awayFromBlockedAppSince` (long ms). Set it the first tick the
  foreground differs from `lastAppPackage` while overlay is active.
- While `now - awayFromBlockedAppSince < TRANSIENT_AWAY_GRACE_MS`
  (~1500ms) AND the foreground is a transient surface (systemui or the
  launcher), do NOT dismiss.
- If the user returns to `lastAppPackage`, clear the timer; overlay stays.
- Once the grace window elapses, dismiss as today.

### B. On real dismiss, clear timestamps so re-entry re-triggers

`removeOverlay()` deliberately keeps `lastPopupShownTimestamps`. That is
correct for Continue/Back but wrong for auto-dismiss — the user never saw the
full intercept, so the next open should re-show it immediately.

Split into:
- `removeOverlayUserDismissed()` — Continue / Back / explicit JS dismiss.
  Existing semantics (keep timestamps, set cooldown).
- `removeOverlayAutoDismissed(pkg)` — auto-dismiss / safety timeout. Clears
  `lastPopupShownTimestamps[pkg]` and `appOpenTimestamps[pkg]` so the next
  foreground tick on that package satisfies `shouldShowFirstPopup`.

Both call the existing private `removeOverlay()` view-teardown.

## Implementation Steps

All in `android/app/src/main/java/com/breqk/monitor/AppUsageMonitor.java`.

### Step 1 — Add grace-window fields/constant (near L75)

```java
private static final long TRANSIENT_AWAY_GRACE_MS = 1500;
private long awayFromBlockedAppSince = 0L;
```

### Step 2 — Rewrite the L275–299 auto-dismiss block

Pseudo-code (capture pkg before posting, since lastAppPackage gets cleared
inside removeOverlay):

```java
if (isOverlayActive) {
    boolean leftBlockedApp = foregroundApp != null
            && !foregroundApp.equals(lastAppPackage)
            && !foregroundApp.equals(context.getPackageName());

    if (!leftBlockedApp) {
        awayFromBlockedAppSince = 0L;          // back on blocked app
    } else {
        if (awayFromBlockedAppSince == 0L) {
            awayFromBlockedAppSince = now;
            Log.i(TAG, "[AUTO_DISMISS_GRACE] left " + lastAppPackage
                    + " -> " + foregroundApp + " start grace");
        }
        long awayFor = now - awayFromBlockedAppSince;
        boolean transient = isSystemOrLauncher(foregroundApp);
        if (transient && awayFor < TRANSIENT_AWAY_GRACE_MS) {
            Log.d(TAG, "[AUTO_DISMISS_GRACE] transient "
                    + foregroundApp + " awayFor=" + awayFor + "ms; holding");
        } else {
            final String dismissedPkg = lastAppPackage;
            Log.i(TAG, "[AUTO_DISMISS] left " + dismissedPkg
                    + " transient=" + transient + " awayFor=" + awayFor + "ms");
            handler.post(() -> removeOverlayAutoDismissed(dismissedPkg));
            awayFromBlockedAppSince = 0L;
        }
    }

    // Safety timeout — also clear timestamps on auto-dismiss
    if (isOverlayActive && overlayShownAt > 0) {
        long maxOverlayDurationMs = (customDelayTimeSeconds + 30) * 1000L;
        if ((now - overlayShownAt) > maxOverlayDurationMs) {
            final String dismissedPkg = lastAppPackage;
            Log.w(TAG, "[SAFETY_DISMISS] exceeded; auto-dismiss");
            handler.post(() -> removeOverlayAutoDismissed(dismissedPkg));
        }
    }
}
```

The standalone `isSystemOrLauncher` dismiss branch is folded into the same
grace logic above — it now only dismisses after the grace window.

### Step 3 — Split dismiss into two callers

Keep `removeOverlay()` (private) as today, plus:

```java
private void removeOverlayUserDismissed() {
    removeOverlay();
}

private void removeOverlayAutoDismissed(String pkg) {
    if (pkg != null && !pkg.isEmpty()) {
        appOpenTimestamps.remove(pkg);
        lastPopupShownTimestamps.remove(pkg);
        Log.i(TAG, "[AUTO_DISMISS_CLEAR] cleared timestamps for " + pkg);
    }
    removeOverlay();
}
```

Inside `removeOverlay()` add `awayFromBlockedAppSince = 0L;` so stale state
can never leak across sessions.

### Step 4 — Update Continue / Back / external dismiss callers

- L713 Continue handler → `removeOverlayUserDismissed()`
- L724 Back handler → `removeOverlayUserDismissed()`
- L937 `dismissOverlayIfShowing()` → `removeOverlayAutoDismissed(lastAppPackage)`
  (this path is hit by the Home-button dispatcher, which IS the user leaving
  the blocked app, so it should re-arm too).

### Step 5 — Docs

- `docs/LOGGING.md`: add `[AUTO_DISMISS_GRACE]` and `[AUTO_DISMISS_CLEAR]`.
- `docs/TASKS.md`: tick this bug.
- `docs/current_task.md`: record the fix.

## Key Files

| File | Operation | Why |
|------|-----------|-----|
| `android/app/src/main/java/com/breqk/monitor/AppUsageMonitor.java` (L75, L275–299, L713, L724, L835–859, L934–941) | Modify | Grace window + dismiss-type split |
| `docs/LOGGING.md` | Append | Document new log tags |
| `docs/TASKS.md` | Edit | Mark bug fixed |
| `docs/current_task.md` | Edit | Record work |

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Grace too long — overlay lingers after real Home press | 1500ms is shorter than typical home navigation; safety timeout backstop unchanged |
| Grace too short — recents still slips through | Single constant, easy to tune; logs print `awayFor` |
| User spams open/close to harass themselves | They still get the intercept every return — that's protective, not a bug |
| `lastAppPackage` race when posting | Capture into `final` local before `handler.post` |
| Switching to a different blocked app | Existing per-app tracking already records a new `appOpenTimestamps`; clearing the previous one does not affect it |

## Test Plan

Manual on-device:

1. **Recents round-trip (the reported bug).** YouTube → overlay → recents →
   YouTube card. Overlay must still be visible (or re-appear ≤500ms).
   Repeat for Settings.
2. **Real Home.** YouTube → overlay → Home, stay on launcher ≥2s. Overlay
   dismisses. Re-opening YouTube re-shows overlay immediately.
3. **Continue still works.** Overlay → wait countdown → Continue. No re-popup
   until `popup_delay_min`.
4. **Back still works.** Overlay → Back → home; reopening YouTube re-shows
   immediately (existing behavior, reinforced).
5. **Safety timeout.** Force overlay to outlive safety window; verify
   re-opening re-shows.
6. **Phone call.** Overlay active → incoming call → dialer foreground >grace
   → overlay dismisses → returning re-shows.

Logcat filter:
```
adb logcat -s AppUsageMonitor | findstr "AUTO_DISMISS POPUP_MARKER INTERCEPT_DECISION"
```

## SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: (none — codeagent-wrapper not available on this Windows host)
- GEMINI_SESSION: (none — same)
