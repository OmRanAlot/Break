# Plan: Fix Scroll-Budget Overlay Disappearing Immediately

**File:** `android/app/src/main/java/com/breqk/ReelsInterventionService.java`  
**Status:** Ready to execute

---

## Root Cause

When `triggerIntervention()` calls `WindowManager.addView()` with `TYPE_ACCESSIBILITY_OVERLAY`, the overlay becomes the **active focusable window** (because `FLAG_NOT_FOCUSABLE` is intentionally absent — without it, the buttons are untappable).

The heartbeat fires 2 seconds later and calls `isStillInReels(packageName)`. Inside that method, `getRootInActiveWindow()` now returns the **overlay's** accessibility node tree (package = `com.breqk`), not Instagram's. The check at line ~1624:

```java
if (rootPkg == null || !rootPkg.toString().equals(expectedPackage)) {
    return false;  // ← fires because "com.breqk" ≠ "com.instagram.android"
}
```

Returns `false` → heartbeat calls `resetReelsState()` → `dismissIntervention()` → overlay disappears ~2 seconds after appearing.

The existing **STICKY-FIX** in `onAccessibilityEvent()` (line ~402) guards against `TYPE_WINDOW_STATE_CHANGED` from non-Instagram packages. But it does **not** guard the heartbeat's `isStillInReels()` call — that's the missing piece.

---

## Why the Existing STICKY-FIX Doesn't Help Here

The STICKY-FIX guards this path:
```
TYPE_WINDOW_STATE_CHANGED from non-Instagram pkg
  → if (interventionShowing) return;   ← works fine
```

But the heartbeat path is different:
```
Heartbeat.run() every 2s
  → isStillInReels()          ← no interventionShowing guard ← BUG
  → resetReelsState()
  → dismissIntervention()
```

---

## Desired Dismissal Conditions

The overlay should **stay** while the user is in Instagram Reels with an exhausted budget.  
The overlay should **go away** when:
1. User presses **"Lock In"** button → already handled by `btnLockIn.setOnClickListener`
2. User navigates **within Instagram** away from Reels (home feed, DMs, etc.) → fires `TYPE_WINDOW_STATE_CHANGED` from `com.instagram.android` → enters `handleReelsScrollEvent()` → `isReelsLayout()` returns false → `resetReelsState()` → **already works**
3. User navigates to a **different Instagram page** (same as #2 above) → **already works**

---

## The Fix

**File:** `ReelsInterventionService.java`, method `startReelsHeartbeat()`, line ~1560

**Change:** Guard the `isStillInReels()` check with `!interventionShowing`. When the intervention overlay is showing, the heartbeat should skip the active-window validation (which would see the overlay as the "active" window, not Instagram).

### Before:
```java
if (!isStillInReels(packageName)) {
    Log.d(TAG, "[REELS_STATE] Heartbeat: user no longer in Reels "
            + "(foreground check failed for " + packageName + ") — stopping heartbeat");
    resetReelsState();
    return;
}
```

### After:
```java
// [STICKY-FIX-HEARTBEAT] While the intervention overlay is showing, skip the
// isStillInReels() active-window check. The overlay is TYPE_ACCESSIBILITY_OVERLAY
// and is focusable (FLAG_NOT_FOCUSABLE intentionally absent so buttons work).
// When it's on screen, getRootInActiveWindow() returns the overlay's accessibility
// tree (pkg=com.breqk), not Instagram's, causing isStillInReels() to return false
// and triggering resetReelsState() → dismissIntervention() ~2s after the overlay
// appears. Skipping the check while the overlay is visible prevents this false
// dismissal. Navigation within Instagram (TYPE_WINDOW_STATE_CHANGED from Instagram)
// still reaches handleReelsScrollEvent() and correctly dismisses the overlay via
// the isReelsLayout()=false path.
if (!interventionShowing && !isStillInReels(packageName)) {
    Log.d(TAG, "[REELS_STATE] Heartbeat: user no longer in Reels "
            + "(foreground check failed for " + packageName + ") — stopping heartbeat");
    resetReelsState();
    return;
}
if (interventionShowing) {
    Log.d(TAG, "[STICKY-FIX-HEARTBEAT] Heartbeat: interventionShowing=true — "
            + "skipping isStillInReels() check, overlay must not be auto-dismissed by heartbeat");
}
```

---

## Implementation Steps

1. **Read** `ReelsInterventionService.java` lines 1548–1580 to confirm exact line numbers.
2. **Edit** the heartbeat runnable: add `!interventionShowing &&` to the `isStillInReels()` guard.
3. **Add** the `[STICKY-FIX-HEARTBEAT]` log line so the behavior is visible in logcat.
4. **Update** `docs/TASKS.md` — add this bug to Bug Inventory and mark it fixed.

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `android/app/src/main/java/com/breqk/ReelsInterventionService.java:~1560` | Modify | Add `!interventionShowing &&` guard before `isStillInReels()` in heartbeat |
| `docs/TASKS.md` | Update | Document bug and fix |

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Heartbeat now skips `isStillInReels()` while overlay shows — what if user exits Instagram entirely? | Navigation within Instagram fires TYPE_WINDOW_STATE_CHANGED from Instagram → `handleReelsScrollEvent()` → dismisses correctly. Android home button: STICKY-FIX in onAccessibilityEvent already handles this (intentional — user must press Lock In). |
| Heartbeat still runs while overlay is showing — does it accumulate budget unnecessarily? | `accumulateScrollBudget()` is still called each tick, but budget is already exhausted; `exhaustedAt > 0` is already set, so no harm. |
