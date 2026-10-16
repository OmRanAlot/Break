# Plan: Fix YouTube Shorts "Lock In" Overlay Persisting on Home / Long-Form

**Status:** Ready to execute
**Priority:** P0 — Launch blocker (false-positive intervention is worse than no intervention)
**Date:** 2026-05-01

---

## Bug Description (User's words)

> "When I am ONLY on YouTube. When the scroll budget is all used up and I open a Short, then close out of it, I still get the 'lock in' notification on the home page or on long form videos."

**Reproduction (Instagram disabled / no Instagram blocked):**
1. Set scroll budget to 0 minutes (or scroll until exhausted) in Customize → Scroll Budget.
2. Open YouTube and tap a Short. Overlay "Time is up! Lock In" appears (correct).
3. Tap the YouTube **Home** tab in the bottom navigation (taps pass through the overlay because of `FLAG_NOT_TOUCH_MODAL`), or tap a long-form video thumbnail.
4. **Bug:** "Lock In" overlay remains visible on the YouTube home feed and long-form video player; it never dismisses on its own.

---

## Root Cause

The "Lock In" overlay's lifecycle depends on three independent dismiss paths. **All three fail** when the user leaves YouTube Shorts to another YouTube screen, and the failures compound:

### Cause 1 (primary) — `YouTubeDetector` Tier 3 false-positive on the bottom nav "Shorts" tab

**File:** `android/app/src/main/java/com/breqk/shortform/detection/YouTubeDetector.java`
**Method:** `scanNodeForShortsText()` (lines 256-287)

Tier 3 walks the YouTube accessibility tree to depth 3 and matches **any** visible node whose `getText()` or `getContentDescription()` contains the substring "shorts" (case-insensitive). YouTube's persistent **bottom navigation bar** has a "Shorts" tab/button visible on the home page and behind long-form videos. That tab matches Tier 3, so `YouTubeDetector.detect(root)` returns `inShortForm=true` even when the user has clearly left the Shorts player.

Consequence: in `ReelsInterventionService.handleReelsScrollEvent()` (lines 510-521 and 580-589) and `isStillInReels()` (lines 991-998), the detector falsely confirms "still in Shorts," so:
- The "left Shorts via state change → resetReelsState()" branch never fires (line 519).
- `isStillInReels()` keeps returning `true`, so the heartbeat keeps running.
- `dismissIntervention()` is never called, so the overlay stays attached to `WindowManager`.

### Cause 2 — `STICKY-FIX-HEARTBEAT` short-circuits the heartbeat check while the overlay is up

**File:** `ReelsInterventionService.java`, lines 244-247

```java
if (interventionOverlay.isShowing()) {
    Log.d(TAG, "[STICKY-FIX-HEARTBEAT] ... skipping isStillInReels() check");
    return true;
}
```

Added to stop the overlay from being yanked away by its own attachment events (B14 fix, 2026-04-13). The intent was correct, but the side effect is that the heartbeat **never** dismisses the overlay on its own — dismissal is delegated entirely to the STATE_CHANGED → `resetReelsState()` path described in Cause 1, which is broken by the Tier 3 false positive.

### Cause 3 — `Tier 0` is empty, so `STATE_CHANGED` always falls through to the broken tree walk

**File:** `android/app/src/main/java/com/breqk/shortform/platform/youtube/YouTubeViewIds.java`, lines 71-74

```java
public static final String[] SHORTS_CLASS_NAMES = {
    // Example (add real names after observing [SHORTS_CLASS] logs):
    // "com.google.android.apps.youtube.app.shorts.ShortsActivity",
};
```

Tier 0 (O(1) class-name match) was designed as a fast, reliable signal for entering Shorts and would naturally also tell us when the user is on a non-Shorts screen, but the array is empty in production. Every entry/exit transition therefore goes through the tree walk in `detect()`, where Cause 1 lives.

### Cause 4 — Framework-class STATE_CHANGED early-return swallows real exits

**File:** `ReelsInterventionService.java`, lines 488-493

```java
if (FrameworkClassFilter.isFrameworkClass(eventClass)) {
    Log.d(TAG, "[SHORTS_CLASS] Skipping tree traversal — generic class '" + eventClass + "' ...");
    return; // ← never updates wasInReelsLayout, never resets
}
```

When YouTube transitions from Shorts back to home/long-form, the STATE_CHANGED event sometimes fires with a generic Android framework class (e.g., `android.view.ViewGroup`, `android.widget.FrameLayout`). The current code treats this as a "floating overlay update, not real navigation" and returns immediately, missing the genuine exit. Combined with Cause 1, the next non-framework STATE_CHANGED also fails to reset, and the overlay stays.

### Why Instagram does not exhibit this bug

Instagram's Reels detection (`InstagramDetector`) uses only Tier 1 view-ID lookups (`clips_viewer_view_pager` / `clips_viewer_pager`) plus `FullScreenCheck.isFullScreen()`. It has no equivalent of Tier 3 text-walk fallback, so leaving Reels reliably returns `inShortForm=false` and the overlay dismisses.

---

## Fix Design (Layered Defense)

Three layers, ordered by importance. Each layer alone fixes the reported bug; together they harden the system against future regressions.

### Layer 1 (REQUIRED) — Add a strict "still-in" detection mode to `YouTubeDetector`

Tier 3 (text walk) is useful for **entry** detection because it lets us catch new YouTube view-ID renames without a code change. It is **harmful** for **exit** / **still-in** detection because the persistent bottom-nav "Shorts" tab text always matches.

**Change:** Introduce `YouTubeDetector.detectStrict(root)` — runs Tier 1 + Tier 2 only, no Tier 3, no Tier 4 dump.

```java
/**
 * Strict variant — Tier 1 + Tier 2 only. Use when verifying the user is STILL in Shorts.
 * Tier 3 (text walk) is excluded because YouTube's bottom-nav "Shorts" tab always
 * matches and would falsely confirm Shorts on the home page or long-form videos.
 */
public DetectResult detectStrict(AccessibilityNodeInfo root) { ... }
```

**Call sites updated:**
1. `ReelsInterventionService.isStillInReels()` (line ~993) — replace `youtubeDetector.detect(root)` with `youtubeDetector.detectStrict(root)`.
2. `ReelsInterventionService.handleReelsScrollEvent()` STATE_CHANGED branch (line ~514) — when `stateMachine.isInReels()` is already `true`, use `detectStrict`. For the entry case (`!stateMachine.isInReels()`), keep the lenient `detect()` so a YouTube view-ID rename does not break entry detection.
3. The slow-path scroll branch (line ~584) — when `stateMachine.isInReels()` is already `true`, use `detectStrict`.

`InstagramDetector` requires no change — it has no Tier 3.

### Layer 2 (REQUIRED) — Tighten Tier 3 itself

Even though Layer 1 stops Tier 3 from running on exit checks, future code might call `detect()` in a still-in context. Defense-in-depth: make Tier 3 reject obvious nav-tab matches.

**Change:** `YouTubeDetector.scanNodeForShortsText()` rejects nodes whose `getBoundsInScreen()`:
- has `bounds.height() < screenHeight * 0.30` (a real Shorts UI element occupies a meaningful portion of the screen — a 100px nav tab does not), **OR**
- has `bounds.top > screenHeight * 0.85` (matched node sits in the bottom 15% — that is the bottom-nav strip).

Also add a seekbar-absence check: Tier 3 only confirms when `YOUTUBE_SEEKBAR_ID` is absent. Long-form videos always expose a seekbar in the accessibility tree even when controls auto-hide; Shorts never do.

**Effect:** A bottom-nav "Shorts" tab (small bounds, in the bottom 15%) is excluded. Real Shorts UI text (large player area, no seekbar) still matches.

### Layer 3 (RECOMMENDED) — Watchdog dismiss when overlay outlives Shorts

**Change:** In `BudgetHeartbeat`, replace the unconditional `STICKY-FIX-HEARTBEAT` `return true` with a counter:

- On the first failure, record a "started doubting" timestamp.
- On the second failure, call `callback.onHeartbeatInvalid()` (which already drives `resetReelsState()` → `dismissIntervention()`).
- Reset to zero on any success.

Strict re-check uses `detectStrict` (Layer 1) and only runs when the active-window package equals the expected Shorts package — this preserves B14 behavior (overlay's own `com.breqk` window does not count as "left Shorts").

This layer is recommended but not strictly required if Layers 1 + 2 are in place. Include it for resilience.

### Layer 4 (OPTIONAL — discovery) — Populate `SHORTS_CLASS_NAMES`

Run with verbose logging on a real device, observe `[SHORTS_CLASS]` log lines while opening and closing Shorts, and add the observed class names to `YouTubeViewIds.SHORTS_CLASS_NAMES`. This makes Tier 0 active and gives the cleanest entry/exit signal. Track as follow-up; not required to fix the reported bug.

---

## Implementation Steps

1. **Add `detectStrict` to `YouTubeDetector`**
   - Refactor the Tier 1 + Tier 2 logic in `detect()` into a private helper, call it from both `detect()` and the new `detectStrict()`.
   - Document the contract: "strict = no Tier 3 text fallback, no Tier 4 dump; use for STILL-IN checks."

2. **Tighten Tier 3 in `scanNodeForShortsText`**
   - Pass `screenHeight` (via `context.getResources().getDisplayMetrics()`) into the recursive helper, or compute once at the top of `hasShortsTextSignal()`.
   - Reject matches where the matching node's bounds violate the height/top thresholds described above.
   - Add the seekbar-absence sanity check inside `hasShortsTextSignal()` before returning true.

3. **Update `ReelsInterventionService` call sites** — three locations identified above. Pure mechanical change: `youtubeDetector.detect(root)` → `youtubeDetector.detectStrict(root)` where appropriate.

4. **Refactor `BudgetHeartbeat.STICKY-FIX-HEARTBEAT`** (optional Layer 3) — replace the unconditional `return true` with a 2-tick failure counter as described above.

5. **Add focused log lines** under the existing `REELS_WATCH` tag with prefix `[STRICT_DETECT]` so the dismiss path is observable in logcat:
   ```bash
   adb logcat -s REELS_WATCH | findstr "STRICT_DETECT"
   ```

6. **Manual QA**
   - Set scroll allowance to 0 minutes; open YouTube → open Short → confirm overlay appears.
   - Tap the Home tab in YouTube's bottom nav while the overlay is up; confirm overlay dismisses within ~1s.
   - Open a long-form video from the home feed; confirm no false re-trigger.
   - Repeat with Instagram only (no YouTube blocked) to confirm no regression — Instagram path is untouched, but worth a smoke test.
   - Repeat the original B14 scenario (overlay should not disappear ~2s after appearing while user is genuinely in Shorts).
   - Verify `[STRICT_DETECT]` log lines appear at each transition.

7. **Build verification**
   ```bash
   cd android && ./gradlew assembleDebug
   ```

---

## Files Modified

| File | Change |
|------|--------|
| `android/app/src/main/java/com/breqk/shortform/detection/YouTubeDetector.java` | Add `detectStrict()`; refactor Tier 1+2 into shared helper; tighten `scanNodeForShortsText()` with bounds + seekbar guards. |
| `android/app/src/main/java/com/breqk/ReelsInterventionService.java` | Switch three call sites (STATE_CHANGED still-in branch, slow-path scroll still-in branch, `isStillInReels`) from `detect` → `detectStrict`. |
| `android/app/src/main/java/com/breqk/shortform/budget/BudgetHeartbeat.java` | (Layer 3) Replace unconditional `STICKY-FIX-HEARTBEAT` return-true with consecutive-failure counter. Optional. |
| `docs/TASKS.md` | Add P0 entry referencing this plan; this update is part of the doc step done by the planner. |
| `docs/current_task.md` | Replace with this plan's summary; doc step done by the planner. |

No production code edits performed by `/multi-plan` itself — code edits are deferred to `/ccg:execute`.

---

## Testing Strategy

### Manual (must pass)
1. **Reported bug fixed:** budget exhausted → open Short → tap YouTube Home tab → overlay dismisses ≤ 1s. Tap long-form video → no overlay re-trigger.
2. **B14 regression check:** budget exhausted → open Short → DO NOT navigate away → overlay stays continuously for at least 30 s, dismisses only on "Lock In" tap.
3. **App switch dismiss:** budget exhausted → open Short → press Android Home → overlay dismisses (should already work via `[APP_SWITCH]` path).
4. **Instagram smoke test:** budget exhausted → open Reels → tap Home tab → overlay dismisses; open Reels again → overlay re-triggers.

### Logcat verification
```bash
adb logcat -s REELS_WATCH | findstr "STRICT_DETECT TIER DISMISS_CALL"
```
Expected: on tapping the YouTube Home tab, see `[TIER] TIER1 — no known container IDs matched full-screen` followed by `[TIER] TIER2 — no secondary signals found`, and (with strict mode) NO `[TIER] TIER3 text scan matched` line, then `Left Reels/Shorts via state change — resetting` and `[DISMISS_CALL] dismissIntervention: removing overlay`.

### Automated (best effort — none currently)
There are no JVM-side unit tests for the detector. Adding one is out of scope for the bug fix but should be tracked as follow-up:
- Mock `AccessibilityNodeInfo` returning a tree with a small "Shorts" text node in the bottom-nav region; assert `detectStrict` returns false.
- Mock a tree with a large reel_recycler node passing FullScreen; assert `detectStrict` returns true.

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tightening Tier 3 also breaks legitimate ENTRY detection on a future YouTube redesign | Low | `detect()` (lenient) is still used on ENTRY paths. Tier 3 still runs there. |
| Bounds threshold (30% / 85%) is wrong for tablets / foldables / split-screen | Low | Thresholds are ratios of `DisplayMetrics`, not absolute pixels. Tablet status/nav bars scale similarly. Document and revisit if reports surface. |
| Layer 3 heartbeat watchdog re-introduces B14 (overlay disappearing ~2s after appearing) | Medium | Strict re-check only runs when active-window package matches expected Shorts package. The overlay's own `com.breqk` window keeps returning `true` via the existing package-mismatch path. |
| Seekbar-absence assumption fails on a future YouTube version that hides the seekbar from the accessibility tree | Low | Seekbar absence is one of two combined conditions in Layer 2; the bounds check still rejects nav-tab matches independently. |

---

## Out of Scope

- Populating `SHORTS_CLASS_NAMES` (Layer 4) — separate follow-up task, requires device observation.
- Refactoring `YouTubeDetector` into a strategy pattern with separate strict/lenient implementations — over-engineering for the current scope.
- Adding JVM unit tests for detectors — separate test-coverage task.

---

## Session IDs (for `/ccg:execute`)

This plan was produced without external Codex/Gemini calls (focused single-bug investigation). No session IDs to forward.
