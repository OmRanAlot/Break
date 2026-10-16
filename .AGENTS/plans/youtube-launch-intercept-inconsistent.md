# YouTube Launch Intercept Fires Inconsistently — Diagnosis & Fix Plan

**Symptom (reported):** The app-open intercept for **YouTube only** does not show
up consistently or on time. Open YouTube → no intercept → ~5 minutes later it
suddenly starts showing again.

**Status:** Diagnosed. Root cause identified with high confidence. Awaiting
approval before code changes.

---

## TL;DR

YouTube is the **only** app whose intercept is owned by the *mindful-viewing
coach* (`IntentCoachOverlay`), not by the reliable 500 ms polling delay overlay.
The coach decides "is this a fresh YouTube launch?" using a single in-memory
field, `coachLastForegroundPackage`, that is **pinned to YouTube and never
cleared when you leave via the Home screen** — because the launcher is
deliberately filtered out as a "system overlay." So every re-open of YouTube
looks like an *internal* window change, and no coach appears. It only re-arms
when you happen to open some *other* real app (Chrome, WhatsApp, Instagram…),
which is the seemingly random "5 minutes later."

Meanwhile `AppUsageMonitor` **unconditionally suppresses** its own YouTube delay
overlay whenever the coach is enabled, so a coach miss = **zero** interception.

---

## How YouTube interception is wired (and why it's different)

There are three overlay mechanisms in the app. YouTube's default policy
(`BreakPrefs`) enables `FEATURE_APP_OPEN_INTERCEPT` (not `FEATURE_LAUNCH_POPUP`),
so:

| App | Intercept mechanism | Reliability |
|-----|---------------------|-------------|
| Instagram, TikTok, others | `AppUsageMonitor` delay overlay (500 ms `UsageStats` poll) **or** `LaunchInterceptor` | High — polled every 500 ms |
| **YouTube (coach ON)** | **`IntentCoachOverlay`** via `ReelsInterventionService.maybeTriggerYouTubeCoach()` | **Fragile — event-driven, stateful** |
| YouTube (coach OFF) | `AppUsageMonitor` delay overlay | High |

The hand-off is in `AppUsageMonitor.java:446-448`:

```java
boolean coachOwnsYouTube = "com.google.android.youtube".equals(foregroundApp)
        && BreakPrefs.isCoachEnabled(context);
if (isBlocked && !isOverlayActive && !coachOwnsYouTube) { /* show delay overlay */ }
```

> **Consequence:** when the coach is enabled, `AppUsageMonitor` *never* shows the
> reliable delay overlay for YouTube. YouTube's interception depends **entirely**
> on the coach firing. Any coach miss is a total miss. This is why the bug is
> "YouTube only."

---

## Root cause — the pinned `coachLastForegroundPackage`

`ReelsInterventionService.maybeTriggerYouTubeCoach()` (≈ line 650):

```java
// (1) Transient windows filtered out BEFORE the package check:
if (packageName.equals(getPackageName())
        || FrameworkClassFilter.isFrameworkClass(className)
        || frameworkClassFilter.isSystemOverlayPackage(packageName, this, TAG)) {
    return;                       // <-- returns WITHOUT updating the tracker
}

// (2) Remember the last *non-YouTube* foreground app:
if (!PKG_YOUTUBE.equals(packageName)) {
    coachLastForegroundPackage = packageName;
    return;
}

// (3) Only fire when the previous foreground was NOT YouTube:
boolean transitioningIn = !PKG_YOUTUBE.equals(coachLastForegroundPackage);
coachLastForegroundPackage = PKG_YOUTUBE;
if (!transitioningIn) {
    return;                       // "YouTube internal window change" → no coach
}
...
coachOverlay.show(...);
```

The launch detector requires the **previous** foreground package to be something
other than YouTube. But `coachLastForegroundPackage` is updated to a non-YouTube
value **only** at step (2) — and step (1) filters out **the home launcher** first.

The launcher is treated as a system-overlay package on purpose:
`FrameworkClassFilter.isSystemOverlayPackage()` dynamically resolves every
`CATEGORY_HOME` package (Pixel, Samsung One UI, MIUI, OnePlus, etc.) and returns
`true` for them (the `[STICKY-FIX]` that stops the home screen behind Reels from
resetting the scroll budget — `FrameworkClassFilter.java:60-73, 124-138`).

### The failure sequence

1. Launch YouTube from Home. The Home event is filtered at step (1), so
   `coachLastForegroundPackage` is still whatever it was before (e.g. `""`).
   First open: `transitioningIn == true` → **coach shows.** ✅
2. Watch, then press **Home** to leave. The launcher event is filtered at
   step (1) → `coachLastForegroundPackage` is **NOT** updated. It stays
   `"com.google.android.youtube"`.
3. Re-open YouTube. `previous == YouTube` → `transitioningIn == false` →
   treated as an internal window change → **no coach.** ❌
4. This persists for every re-open until the user opens some **other** real,
   non-launcher app (Chrome, WhatsApp, Instagram…). That event passes step (1),
   sets `coachLastForegroundPackage` to that app, and the **next** YouTube open
   fires the coach again.

Step 4 is the "≈5 minutes later it shows" — it is **not a timer**. It is
whenever an unrelated foreground app happens to re-arm the tracker. There is no
5-minute constant anywhere; the interval is simply nondeterministic user
behavior. Nothing ever clears `coachLastForegroundPackage` when YouTube goes to
the background (confirmed: it is assigned only at lines 668 and 674, never reset
on departure).

---

## Contributing factor — once-per-session gate (design, not a bug)

Even with perfect launch detection, `CoachSessionTracker` shows the coach **at
most once per "session,"** where a new session starts only after YouTube has been
absent for `COACH_SESSION_GAP_MS = 30 minutes` (`BreakPrefs.java:166`,
`CoachSessionTracker.shouldShowCoach` / `onYouTubeForeground`).

So reopening YouTube within 30 minutes is *designed* not to re-show the coach.
This is separate from the bug (30 min > the reported 5 min, and it suppresses
rather than triggers), but it will still surprise the user after the primary fix
lands. Confirm the intended behavior:

- **A.** Intercept **every** genuine YouTube open (recommended for a "make me
  pause every time" tool) → drop or drastically shorten the session gate.
- **B.** Keep once-per-session, but make `COACH_SESSION_GAP_MS` a user setting.

---

## The Fix

**Goal:** make "is this a genuine YouTube (re)launch?" robust and independent of
catching the intervening launcher event, without weakening the Reels
`[STICKY-FIX]` (we must NOT stop filtering the launcher globally).

### Step 1 — Replace the pinned-package heuristic with a time-gap detector

In `maybeTriggerYouTubeCoach()`, stop depending on `coachLastForegroundPackage`
to decide `transitioningIn`. Instead, derive a relaunch from the **persisted
last-YouTube-foreground timestamp** that `CoachSessionTracker` already maintains
(`KEY_COACH_LAST_YT_FOREGROUND`).

- Add `RELAUNCH_GAP_MS` (start at **1500 ms**). YouTube's own internal window
  changes fire back-to-back within a few hundred ms; a ≥1.5 s gap since the last
  YouTube-foreground event cleanly marks a real return from elsewhere.
- On a YouTube `TYPE_WINDOW_STATE_CHANGED`:
  1. Read `lastYtForeground` from prefs, compute `gap = now - lastYtForeground`.
  2. Always call `coachTracker.onYouTubeForeground(now)` (refreshes the
     timestamp and rolls the session boundary — its existing logic is correct).
  3. Treat it as a launch when `gap >= RELAUNCH_GAP_MS` (or first-ever open).
  4. Then apply the existing gates: `coachOverlay.isShowing()`,
     `shouldShowCoach()`, `Settings.canDrawOverlays()`, and show.

This removes the dependence on the launcher event entirely. The `[STICKY-FIX]`
launcher filtering stays untouched — we simply no longer need to *observe* the
launcher to know the user left YouTube; the time gap tells us.

`coachLastForegroundPackage` can then be **deleted** (dead state), or kept only
for logging (`from=` in the launch log line).

### Step 2 — Coach cadence: fire on EVERY genuine open (DECIDED — Option A)

**Decision:** the coach should intercept **every genuine YouTube (re)launch**, not
once per 30-min session.

- In `CoachSessionTracker.shouldShowCoach`, drop the `alreadyShown`
  (`KEY_COACH_SHOWN_FOR_SESSION`) gate as the primary suppressor.
- Replace it with a short **re-show cooldown** (`COACH_RESHOW_COOLDOWN_MS`,
  start at **60 s**) keyed off the last time the coach was actually shown, so a
  single launch that emits several `STATE_CHANGED` events cannot double-fire, but
  a real reopen a few minutes later still triggers the coach.
- The `RELAUNCH_GAP_MS` detector from Step 1 remains the "is this a real launch?"
  gate; the cooldown only prevents same-open duplicates.
- `COACH_SESSION_GAP_MS` (30 min) stays only for session **stats** boundaries
  (video counts / session minutes shown in the verdict), not for gating the
  overlay.

### Step 3 — Defense in depth: coach-miss fallback in `AppUsageMonitor`

So a future coach regression can never again leave YouTube with **zero**
interception, relax the hard suppression at `AppUsageMonitor.java:446-448`:

- Keep suppressing the delay overlay while the coach **is showing or was shown
  this session**, but if YouTube has been foreground for more than a short grace
  (e.g. `COACH_FALLBACK_GRACE_MS = 4000`) and the coach never appeared, allow the
  normal delay overlay to fire as a fallback.
- Read coach state via a shared pref flag (`KEY_COACH_SHOWN_FOR_SESSION` /
  a new `coach_overlay_visible`) so the VPN-process monitor and the accessibility
  process stay in sync (they are different processes — must go through prefs).

> Step 3 is optional but strongly recommended: it converts "silent total miss"
> into "slightly delayed but guaranteed" interception.

### Step 4 — Logging to verify

Add/confirm these so the fix is observable via logcat:

```
adb logcat -s COACH REELS_WATCH AppUsageMonitor | findstr "COACH LAUNCH gap coachOwnsYouTube"
```

Log `gap`, the relaunch decision, and every gate outcome in
`maybeTriggerYouTubeCoach`. Log `coachOwnsYouTube` and any fallback firing in
`AppUsageMonitor`.

---

## Files to change

| File | Change |
|------|--------|
| `android/.../ReelsInterventionService.java` | Rewrite `maybeTriggerYouTubeCoach()` to use the time-gap relaunch detector; add `RELAUNCH_GAP_MS`; remove/relegate `coachLastForegroundPackage`. |
| `android/.../coach/CoachSessionTracker.java` | (Option A/B) adjust `shouldShowCoach` gate / expose session gap. |
| `android/.../prefs/BreakPrefs.java` | Add `RELAUNCH_GAP_MS` / fallback constants; (Step 3) coach-visible flag; (Option B) configurable session gap. |
| `android/.../monitor/AppUsageMonitor.java` | (Step 3) replace hard `coachOwnsYouTube` suppression with grace-based fallback. |
| `android/.../coach/IntentCoachOverlay.java` | (Step 3) write the coach-visible pref flag on show/dismiss. |

## Test plan

1. **Unit** — extract the relaunch decision (`gap >= RELAUNCH_GAP_MS`, session
   rollover) into a pure helper and unit-test: first open, re-open after 2 s,
   re-open after 100 ms (internal churn — no launch), re-open after 31 min (new
   session).
2. **Manual (the repro)** — coach ON: open YouTube (coach shows) → Home → reopen
   → **coach shows again** (previously failed). Repeat 5×, no misses. Verify no
   double overlay (coach + delay) ever stacks.
3. **Regression** — Instagram/TikTok interception unchanged; Reels scroll-budget
   `[STICKY-FIX]` still holds (home screen behind Reels does not reset budget).
4. **Fallback (Step 3)** — force-disable the coach overlay show path; confirm the
   delay overlay fires after the grace window instead of nothing.

---

## Key references

- `ReelsInterventionService.maybeTriggerYouTubeCoach()` — the buggy launch
  detector (`coachLastForegroundPackage`, `transitioningIn`).
- `ReelsInterventionService.onAccessibilityEvent()` :401 — dispatch order.
- `FrameworkClassFilter.isSystemOverlayPackage()` :124 + launcher list :60 —
  why the Home event is filtered.
- `AppUsageMonitor.java` :446 — `coachOwnsYouTube` hard suppression.
- `CoachSessionTracker` — session gate + `COACH_SESSION_GAP_MS` (30 min).
- `BreakPrefs.java` :166 — `COACH_SESSION_GAP_MS`.
