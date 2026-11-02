# Implementation Plan: Refactor & Optimize ReelsInterventionService

> **Status: COMPLETE ✅ 2026-04-15** — All 7 steps shipped on branch `optimization`.

**Target file:** `android/app/src/main/java/com/breqk/ReelsInterventionService.java`
**Current state:** 1903 lines (docs/TASKS.md incorrectly lists it as 800 — stale)
**Risk level:** 🔴 HIGH fragility, hot-path performance liability, cross-file duplication

---

## Why this file

Scored against "fragile + inefficient + breaks easily" criteria from `docs/TASKS.md`:

| Signal | Evidence |
|---|---|
| 🔴 HIGH fragility (Fragility Map) | YouTube Shorts detection is the #1 flagged risk |
| Hot path | `onAccessibilityEvent` runs hundreds of times/sec during a scroll session |
| Size | 1903 lines in one class — 2.4× what `TASKS.md` claims |
| Known bug history | B1 (duplicate view IDs), B7 (fragile source recycle), B14 (recently patched overlay dismissal race) |
| Mixed concerns | Detection + state persistence + budget tracking + WindowManager overlay + IPC intents all in one file |
| Cross-file duplication | `YOUTUBE_SHORTS_VIEW_IDS`, `MIN_WIDTH_RATIO`, `MIN_HEIGHT_RATIO`, `MAX_TOP_OFFSET_PX`, `isFullScreen*()`, Instagram view IDs all duplicated in `ContentFilter.java` |

---

## Problems observed (concrete, with line refs)

### Inefficiency

1. **SharedPreferences thrashing on the hot path.** `isScrollBudgetExhausted()` (L769) reads prefs on every scroll event; `accumulateScrollBudget()` (L1735) reads 5 keys + writes 3 keys every heartbeat tick (1s); `isFreeBreakActive()` (L1715) re-reads prefs and is called 3+ times per scroll decision (L703, L738, L772). No in-memory cache.
2. **Verbose Log.d in tight loops.** `Log.d(TAG, …)` fires dozens of times per accessibility event (e.g. L593, L620, L648, L659, L714, L727, L874–900, L1573, L1588). Even when logcat is closed, the String concatenations allocate garbage and block the main thread. Equivalent to B9 (`VERBOSE_LOGGING` in `ScreenTimeTracker`).
3. **Repeated tree walks.** `isShortsLayout()` (L1224) can walk the tree up to 4 times: Tier 1 loops 7 view IDs each calling `findAccessibilityNodeInfosByViewId`, Tier 2 loops 4 IDs, Tier 3 does a recursive scan, Tier 4 does a dump. Every call to `getRootInActiveWindow()` is an IPC round-trip to the system.
4. **`isStillInReels` inside the 1s heartbeat** calls `getRootInActiveWindow()` + another full layout check — an IPC + tree walk once per second, forever, for every active Reels session.
5. **`dumpYouTubeTreeIfNeeded`** (L1852) allocates StringBuilder/Rect per child, calls `child.getText()`/`getContentDescription()` which are IPC — acceptable as a diagnostic but should be off unless an explicit debug flag is set.

### Fragility

6. **`YOUTUBE_SHORTS_VIEW_IDS` duplicated** at L131 here and L86 in `ContentFilter.java` (B1 in TASKS.md). A YouTube update forces two edits, and the team "will forget one."
7. **Full-screen thresholds duplicated.** `MIN_WIDTH_RATIO`, `MIN_HEIGHT_RATIO`, `MAX_TOP_OFFSET_PX` defined twice (L199 here, L101 in `ContentFilter.java`). Same for `isFullScreenReelsViewPager` vs `isFullScreenNode`.
8. **Instagram Reels view IDs** (`clips_viewer_view_pager`, `clips_viewer_pager`) appear literally in 3 places here (L616, L1162, L1181) and again in `ContentFilter.java`.
9. **Hard-coded launcher package list** (L1013) — 13 OEM entries with no invalidation of `cachedLauncherPackages` across config changes.
10. **Commented-out dead code block** L1421–L1439 (`Return to Feed` button handler) rots across future readers.

### Legibility

11. **`onAccessibilityEvent` is 100 lines** (L360) interleaving dispatcher, app-switch detection, system-overlay guards, framework-class guards, policy check, and the actual dispatch to `handleReelsScrollEvent`.
12. **`handleReelsScrollEvent` is 240 lines** (L502) mixing `STATE_CHANGED` handling, Tier 0 detection for YouTube, fast path, slow path, grace period termination, free break short-circuit, debounce, and budget check. Deep nesting — hard for humans *and* other agents to trace any single code path.
13. **Thirty-plus single-letter-purpose flags** live as private fields on one class (`wasInReelsLayout`, `shortsCurrentlyDetected`, `interventionShowing`, `inGracePeriod`, `currentReelsPackage`, `lastScrollTimestamp`, `lastYtTreeDump`, `cachedLauncherPackages`, …) with no state-machine diagram. Invariants are maintained by implicit ordering.
14. **Mixed concerns** — detection, persistence, budget math, overlay UI, and cross-service IPC intents all live in one class. Any surgical change risks touching an unrelated invariant.

---

## Task type

- [x] Backend (Java / Android native) — no UI contract changes
- [ ] Frontend
- [ ] Fullstack

---

## Technical solution (high level)

Refactor into a **package of focused collaborators** under `com.breqk.reels`, driven from a slim `ReelsInterventionService` shell. Introduce a **single source of truth** for constants (`ShortFormIds`), a **cached-prefs facade** for hot-path reads (`BudgetState`), and an **explicit state machine** (`ReelsStateMachine`) for grace/active/exhausted transitions. Delete cross-file duplication by routing `ContentFilter` through the same `ShortFormIds` + `FullScreenCheck` utilities.

**Non-goals:** no behavior change, no new features, no dependency upgrades. Every existing log tag must keep firing (downgraded to verbose but still reachable via a debug flag). External API contract with `AppUsageMonitor`, `VPNModule`, and `ContentFilter` stays byte-for-byte identical.

---

## Target architecture

```
com.breqk.reels/
├── ShortFormIds.java         ← single source of truth for view IDs (kills B1)
│     • INSTAGRAM_REELS_IDS[]
│     • YOUTUBE_SHORTS_IDS[]
│     • YOUTUBE_SHORTS_SECONDARY_IDS[]
│     • YOUTUBE_SEEKBAR_ID
│     • YOUTUBE_SHORTS_CLASS_NAMES[]
│     • MIN_WIDTH_RATIO / MIN_HEIGHT_RATIO / MAX_TOP_OFFSET_PX
│
├── FullScreenCheck.java      ← static utility, replaces isFullScreenReelsViewPager + isFullScreenNode
│     • boolean isFullScreen(AccessibilityNodeInfo, DisplayMetrics)
│
├── FrameworkClassFilter.java ← replaces isAndroidFrameworkClass + APP_SWITCH_IGNORE_PACKAGES
│     • boolean isFrameworkClass(String)
│     • boolean isSystemOverlayPackage(Context, String) ← caches launchers
│
├── detection/
│   ├── ShortFormDetector.java    ← interface { DetectResult detect(root, source, eventClass) }
│   ├── InstagramDetector.java    ← encapsulates isReelsLayout + fast-path
│   └── YouTubeDetector.java      ← Tier 0–3 ladder (class → ID → secondary → text)
│
├── state/
│   ├── ReelsStateMachine.java    ← explicit states: IDLE | GRACE | ACTIVE | EXHAUSTED
│   │    transitions: onEnter(pkg), onFirstScroll(), onExit(), onBudgetExhausted(),
│   │                 onIntervention(), onInterventionDismissed(), onWindowRollover()
│   └── ReelsStatePersistence.java ← writes is_in_reels / timestamp / package to prefs
│
├── budget/
│   ├── BudgetState.java          ← in-memory mirror of the 5 scroll_* pref keys
│   │    • load(prefs) once at service start, mutate in memory on heartbeat
│   │    • flush(prefs) throttled to every N ticks (e.g. every 5s)
│   │    • boolean isExhausted(now)
│   │    • boolean isFreeBreakActive(now) with a 1s in-memory TTL
│   └── BudgetHeartbeat.java      ← Runnable, holds the 1s loop + accumulation math
│
├── overlay/
│   └── InterventionOverlay.java  ← WindowManager addView/removeView + button wiring
│
└── ReelsInterventionService.java ← shell (~250 lines) that wires the collaborators
```

Everything above shares `ShortFormIds` with `ContentFilter.java`, eliminating B1.

---

## Implementation steps

Each step is independently shippable and gated by a build + manual smoke test (Reels detects, budget triggers overlay, grace period works, free break works).

### Step 1 — Extract `ShortFormIds` + `FullScreenCheck` (kills B1)

**Deliverable:** new files `ShortFormIds.java`, `FullScreenCheck.java`, `FrameworkClassFilter.java` under `com.breqk.reels`. `ReelsInterventionService.java` and `ContentFilter.java` both reference them. Old constants and helper methods deleted from both files. Mark B1 `[x]` in `docs/TASKS.md`.

**Files touched:**
- ✏️ `ReelsInterventionService.java` L131–L205, L848–L902, L1055–L1114 → replace with imports
- ✏️ `ContentFilter.java` L80–L112 + `isFullScreenNode` → replace with imports
- ➕ `reels/ShortFormIds.java`, `reels/FullScreenCheck.java`, `reels/FrameworkClassFilter.java`

**Validation:** build passes; scroll Instagram Reels → overlay fires on budget exhaustion; scroll YouTube Shorts → same; `ContentFilter` still ejects on blockShortForm. Expected LOC drop: ~150 lines across both files. Effort: **1.5h**.

### Step 2 — Extract detectors (`InstagramDetector`, `YouTubeDetector`)

**Deliverable:** Tier ladder moved out of the service. Service calls `detector.detect(event, root)` and receives a `DetectResult { boolean inReels; String tier; }`. The `hasShortsTextSignal` + `dumpYouTubeTreeIfNeeded` helpers move into `YouTubeDetector`. `notifyShortsState` stays in the service (it's presentation/logging).

**Files touched:**
- ✏️ `ReelsInterventionService.java` L502–L740 (`handleReelsScrollEvent` body), L1154–L1327 (`isReelsLayout`, `isShortsLayout`), L951–L995 (`hasShortsTextSignal`), L1852–L1902 (tree dump) → delete or inline call to detector
- ➕ `reels/detection/ShortFormDetector.java` (interface), `InstagramDetector.java`, `YouTubeDetector.java`

**Validation:** same smoke test; additionally verify `YT_TREE_DUMP` still fires when all tiers fail (temporarily remove a view ID to confirm). Expected LOC drop: ~500 lines from the service. Effort: **3h**.

### Step 3 — Introduce `BudgetState` + `BudgetHeartbeat` (kills hot-path prefs reads)

**Deliverable:** A single `BudgetState` instance owns all `scroll_*` values. On service start, one `load(prefs)` call. Heartbeat mutates in memory every 1s, flushes to prefs **every 5s or on state transition** (window rollover, exhaustion, exit). `isFreeBreakActive()` becomes a method on `BudgetState` with a 1s cache so the per-scroll triple-call becomes free.

**Files touched:**
- ✏️ `ReelsInterventionService.java` L300–L315 (budget pref keys), L1735–L1801 (`accumulateScrollBudget`), L769–L803 (`isScrollBudgetExhausted`), L1715–L1733 (`isFreeBreakActive`), L1550–L1595 (`startReelsHeartbeat`) → delegate to `BudgetState`/`BudgetHeartbeat`
- ➕ `reels/budget/BudgetState.java`, `reels/budget/BudgetHeartbeat.java`

**Invariant to preserve:** `AppUsageMonitor` and `VPNModule` both read these pref keys. The 5s flush cadence must be less than the 5s staleness threshold in `AppUsageMonitor`, and **any state transition must flush synchronously**. Document this in `BudgetState.flush()` Javadoc.

**Validation:** budget math identical (unit-testable in pure Java for the first time); `AppUsageMonitor` dashboard numbers match pre-refactor within ±2s; free break still suppresses interventions. Effort: **3h**.

### Step 4 — Extract `InterventionOverlay`

**Deliverable:** `triggerIntervention` + `dismissIntervention` + `interventionView` + `interventionShowing` move into `InterventionOverlay`. The service asks `overlay.show(pkg)` / `overlay.dismiss()` / `overlay.isShowing()`. Dead commented-out `Return to Feed` block (L1421–L1439) deleted.

**Files touched:**
- ✏️ `ReelsInterventionService.java` L1387–L1502 → thin delegates
- ➕ `reels/overlay/InterventionOverlay.java`

**Validation:** overlay appears on budget exhaustion, `Lock In` button still fires `GLOBAL_ACTION_HOME`, `DISMISS_CALL` log line still emitted with caller info for B14 regression safety. Effort: **1.5h**.

### Step 5 — Introduce `ReelsStateMachine` (legibility win) ✅ 2026-04-15

**Deliverable:** explicit enum `State { IDLE, GRACE, ACTIVE, EXHAUSTED }` with an exhaustive `transition(Event)` method. The scattered flags (`wasInReelsLayout`, `inGracePeriod`, `interventionShowing`, `currentReelsPackage`, `lastScrollTimestamp`) collapse into one state object. Every transition emits one log line with `oldState → newState reason=…`.

**Files touched:**
- ✏️ `ReelsInterventionService.java` L216–L298 (state fields), every `resetReelsState()` call site (L456, L581, L655, L1352, L1575), `[GRACE]` / `[APP_SWITCH]` / `[STICKY-FIX]` sites
- ➕ `reels/state/ReelsStateMachine.java`, `reels/state/ReelsStatePersistence.java`

**Validation:** replay regression set — grace period on entry, first scroll terminates grace, app switch resets from ACTIVE, sticky overlay survives framework-class events, window rollover clears EXHAUSTED. Effort: **3h**.

### Step 6 — Gate verbose logs behind `BuildConfig.DEBUG` or static flag ✅ 2026-04-15

**Deliverable:** introduce `private static final boolean VERBOSE = BuildConfig.DEBUG;` (mirroring the B9 fix in `ScreenTimeTracker`). Wrap all per-event `Log.d` calls: `if (VERBOSE) Log.d(TAG, …);`. `Log.i` calls (state transitions, interventions, errors) stay unconditional. Tree-dump `Log.w` stays gated by its existing 10s rate-limiter.

**Files touched:** every `Log.d` site in the extracted classes. This is mechanical — do last so it applies to the new file layout.

**Validation:** release build shows empty logcat during normal Reels use; debug build matches current output. Effort: **1h**.

### Step 7 — Update `docs/TASKS.md` + write ADR ✅ 2026-04-15

**Deliverable achieved:**
- B1 marked `[x]` in `docs/TASKS.md` (dated 2026-04-15).
- B9 marked `[x]` in `docs/TASKS.md` (dated 2026-04-15).
- ADR written at `docs/adr/2026-04-15-reels-refactor.md`.
- Refactor plan status header updated to COMPLETE.

---

## Key files & operations

| File | Operation | Description |
|------|-----------|-------------|
| `android/app/src/main/java/com/breqk/ReelsInterventionService.java` | Shrink ~1900 → ~250 | Shell wiring collaborators |
| `android/app/src/main/java/com/breqk/ContentFilter.java` | Trim ~50 lines | Import shared constants + `FullScreenCheck` |
| `android/app/src/main/java/com/breqk/reels/ShortFormIds.java` | New | Single source of truth for view IDs + thresholds |
| `.../reels/FullScreenCheck.java` | New | `isFullScreen(node, metrics)` |
| `.../reels/FrameworkClassFilter.java` | New | `isFrameworkClass` + `isSystemOverlayPackage` + launcher cache |
| `.../reels/detection/ShortFormDetector.java` | New | Interface `DetectResult detect(...)` |
| `.../reels/detection/InstagramDetector.java` | New | Fast path + tree walk for `clips_viewer_*` |
| `.../reels/detection/YouTubeDetector.java` | New | Tier 0–3 ladder + `YT_TREE_DUMP` |
| `.../reels/state/ReelsStateMachine.java` | New | `State { IDLE, GRACE, ACTIVE, EXHAUSTED }` |
| `.../reels/state/ReelsStatePersistence.java` | New | `is_in_reels*` pref writer |
| `.../reels/budget/BudgetState.java` | New | In-memory mirror of `scroll_*` prefs + 5s flush |
| `.../reels/budget/BudgetHeartbeat.java` | New | Owns the 1s `Runnable`, accumulation math |
| `.../reels/overlay/InterventionOverlay.java` | New | WindowManager attach/detach, button wiring |
| `docs/TASKS.md` | Edit | Mark B1 `[x]`; fix stale line count |
| `.claude/CLAUDE.md` | Edit | Add `reels/` package subsection |
| `docs/adr/2026-04-15-reels-refactor.md` | New | 2-para ADR |

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Behavior drift** — any missed invariant breaks blocking silently | Keep every log tag alive (Step 6 only *gates*, never deletes). Run a manual regression script: enter Reels → watch first video (grace) → scroll 3× → leave via Home → re-enter → exhaust budget → verify overlay → Lock In → verify home screen. Do the same for YouTube Shorts and TikTok. |
| **B14 regression** (overlay auto-dismissed by heartbeat) | Preserve the `interventionShowing` guard in `BudgetHeartbeat.run()` — called out explicitly in the `ReelsStateMachine` transition table. Add a log assertion: if state=`EXHAUSTED` and heartbeat sees `!isStillInReels`, never call `resetReelsState()`; let explicit user action drive the transition. |
| **Flush cadence vs `AppUsageMonitor` staleness** | `BudgetState.flush()` must be called on every transition AND at most 4s apart (staleness threshold in `AppUsageMonitor` is 5s). Enforce with a unit test. |
| **Detector interface change breaks ContentFilter** | Step 1 (shared constants) ships independently; Step 2 keeps the old public shape in the service until `ContentFilter` is updated in a follow-up (not in scope here). |
| **Large diff review burden** | Ship each step as a separate commit on the `optimization` branch. Each commit builds & passes the smoke test. Makes `git bisect` trivial if something breaks. |
| **Stale `TASKS.md` line counts** | Step 7 fixes the specific discrepancy we hit; consider a CI lint later (out of scope). |

---

## Expected outcomes

| Metric | Before | After |
|---|---|---|
| `ReelsInterventionService.java` LOC | 1903 | ~250 |
| `ContentFilter.java` LOC | 476 | ~420 |
| Total new files in `reels/` | 0 | ~11 |
| SharedPreferences reads per scroll event | ~6 | 0 (in-memory) |
| SharedPreferences reads per heartbeat tick | ~5 | 0 steady, flush every ~5s |
| `Log.d` allocations per scroll in release build | ~30 | 0 |
| Duplicated constant arrays across files | 4 | 0 |
| Bugs closed | — | B1 (B9-equivalent for this file as side effect of Step 6) |

---

## Session IDs (for /ccg:execute continuation)

- CODEX_SESSION: _(not used — codeagent-wrapper not configured in this env, fell back to direct Read + Grep)_
- GEMINI_SESSION: _(not used — same reason)_

---

## Out of scope (intentionally)

- B2 (VpnService migration), B4, B5, B8 — separate launch-blocker tasks
- Remote config for view IDs — nice but a new feature, not optimization
- iOS rewrite, billing, dark mode — P2+ items in TASKS.md
- Unit tests for the extracted classes — recommended follow-up (`BudgetState` and `ReelsStateMachine` are now pure-Java testable for the first time, but writing tests isn't in this plan's budget)
