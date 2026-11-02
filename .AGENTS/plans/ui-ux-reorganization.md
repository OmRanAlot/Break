# Plan: Scroll Budget Display Fix + Customize/Home Reorganization + Centering

Three related concerns from the user:

1. **Scroll budget bug** — counter continuously decreases for ~5 seconds, then jumps back to 5m.
2. **Per-app specs in Customize tab feel misplaced** — unclear mental model of where things live.
3. **Centering** — some elements are visually off-center.

---

## 1. Scroll Budget Countdown Bug (display-side)

### Root Cause

`components/Home/home.js:234-280` runs two timers: a 5s "truth poll" of `VPNModule.getScrollBudgetStatus()` and a 1s `displayTick`. In the render branch at `home.js:578-639`, the 1s tick recomputes:

```
elapsedSincePoll = Date.now() - budgetStatus.__polledAt
liveRemaining    = budgetStatus.remainingMs - elapsedSincePoll
liveUsed         = budgetStatus.usedMs + elapsedSincePoll
```

This assumes **time passing = budget being consumed**, but native-side consumption only happens while the user is actively scrolling Reels/Shorts. When the user is on the Home screen, nothing is actually being drained — yet the client fabricates a 1s/s drop. Every 5s the next truth poll arrives and resets the value back to what native actually reports. That is the exact "decreases for 5 seconds then snaps back to 5" symptom.

Same pattern is not present in `components/Customize/customize.js:578-623` (poll-only, no ticker), so the bug is isolated to Home.

### Fix

**Remove the client-side decrement entirely.** The native monitor is the single source of truth. Render `remainingMs`/`usedMs` directly from the last poll. Keep the 5s poll, drop the 1s ticker, drop `__polledAt` and `elapsedSincePoll` math.

Optional polish: tighten the poll cadence to 2s while the Home screen is focused — cheaper than fabricating wrong numbers, and feels live enough.

### Files to change

| File | Change |
|------|--------|
| `components/Home/home.js:231-280` | Drop `displayTick` state + 1s `ticker` interval. Keep 5s poll (or reduce to 2s). Remove `__polledAt` stamping on the poll result. |
| `components/Home/home.js:578-639` | Render `budgetStatus.remainingMs` / `budgetStatus.usedMs` directly. Delete `elapsedSincePoll`, `liveRemaining`, `liveUsed`. |

### Pseudocode (Home render branch)

```
const { canScroll, remainingMs, usedMs, allowanceMinutes, windowMinutes, nextScrollAtMs } = budgetStatus;
const allowanceMs = allowanceMinutes * 60_000;
const filledRatio = canScroll ? Math.min(1, usedMs / allowanceMs) : 1;
const statusLabel = canScroll
  ? `${formatBudgetTime(remainingMs)} remaining`
  : `Resets in ${formatBudgetTime(nextScrollAtMs - Date.now())}`;
```

`nextScrollAtMs - Date.now()` for the reset countdown is fine to recompute per render because that is a real wall-clock countdown, not a consumption countdown. For smoothness of that specific sub-case, a lightweight 1s ticker gated on `!canScroll` is acceptable.

---

## 2. Customize vs Home: Information Architecture

### Today's Customize is overloaded

`components/Customize/customize.js:410-678` packs four scopes into one screen:

- **Per-app behavior** — Reels Detection + App Open Intercept toggles for Instagram and YouTube.
- **Global feature toggle** — 20-Min Free Break.
- **App-specific limit** — Instagram Feed Post Limit (buried under "Scroll Budget").
- **Global defaults** — Scroll Budget (allowance/window), Intercept Message, Pause Duration.

The user's instinct ("not sure I want per-app specs in the Customize tab") is right: per-app behavior and global defaults have different mental models. Customize reads as "tweak the app's global behavior." Per-app switches belong closer to where the user thinks about those apps — either on Home (already shows the app list) or in a dedicated App Detail screen.

### Decision (locked in)

- **Option A — full restructure** with a dedicated AppDetail screen per managed app.
- **Free Break is per-app** — moves out of Customize and into each AppDetail so the user can enable a scroll-free window on just Instagram, just TikTok, etc.
- **Roadmap is 7 managed apps**: Instagram, YouTube, TikTok, Reddit, X/Twitter, Snapchat, Facebook. Each gets its own intervention vocabulary.

### Target structure

```
Home (dashboard)
  ├─ Header: BREQK · [Modes] [Settings]          (centering fix — see §3)
  ├─ Status strip (monitoring + active mode)
  ├─ Summary stats (screen time / unlocks / notifications)
  ├─ Scroll Budget card                           ← truth from native, no ticker
  ├─ Managed Apps list (NEW)                      ← row per app, scrolls if >5
  │    ├─ Instagram        On · Reels + Feed    ›  tap → AppDetail
  │    ├─ YouTube          On · Shorts          ›
  │    ├─ TikTok           Off                  ›
  │    ├─ Reddit           Off                  ›
  │    ├─ X / Twitter      Off                  ›
  │    ├─ Snapchat         Off                  ›
  │    └─ Facebook         Off                  ›
  └─ Today's Top Apps

AppDetail  (pushed from Managed Apps row, receives `{ packageName }`)
  ├─ Enabled master toggle                        (short-circuits everything below)
  ├─ App Open Intercept toggle                    (universal — delay overlay on launch)
  ├─ App-specific interventions                   (rendered from per-app manifest)
  │    ├─ Instagram: Reels Detection · Home Feed Post Limit
  │    ├─ YouTube:   Shorts Detection
  │    ├─ TikTok:    For You Detection · Session Post Limit
  │    ├─ Reddit:    Feed/Video Detection · Session Post Limit
  │    ├─ X/Twitter: For You Detection · Session Post Limit
  │    ├─ Snapchat:  Spotlight Detection
  │    └─ Facebook:  Reels Detection · Feed Post Limit
  ├─ 20-Min Free Break toggle                     (per-app, once-per-day scoped to this app)
  └─ "Open in Safe Mode" button                   (shown when relevant)

Customize  (global defaults only)
  ├─ Scroll Budget: allowance + window            (shared across apps that use it)
  ├─ Intercept Message text
  └─ Forced Pause Duration slider + preview

Modes (unchanged)
```

Effect:

- **Customize is lean** — only global intervention defaults.
- **Everything per-app lives with the app** on AppDetail.
- **Home stays a dashboard** — no per-app switches cluttering it; the Managed Apps list is just navigation + a one-line status per app.
- **Adding a new app = add a manifest entry + (if new intervention) add native detection** — no new screen work.

### Data model extensions

Existing keys in SharedPreferences (from `.claude/CLAUDE.md`): `app_policies` (JSON), `home_feed_post_limit`, `scroll_allowance_minutes`, `scroll_window_minutes`.

New shape for `app_policies[pkg]`:

```
{
  enabled:              bool,          // NEW master toggle
  app_open_intercept:   bool,          // existing — universal
  reels_detection:      bool,          // existing — IG
  shorts_detection:     bool,          // NEW — YT
  tiktok_foryou:        bool,          // NEW
  reddit_feed:          bool,          // NEW
  twitter_foryou:       bool,          // NEW
  snap_spotlight:       bool,          // NEW
  facebook_reels:       bool,          // NEW
  facebook_feed:        bool,          // NEW
  free_break_enabled:   bool,          // NEW — moved from global
  session_post_limit:   number | null  // NEW — replaces top-level home_feed_post_limit for IG, extends to TikTok/Reddit/X/FB
}
```

Migration: on first load, if the old global `free_break_enabled` flag is true, seed `app_policies['com.instagram.android'].free_break_enabled = true` and `...['com.google.android.youtube'].free_break_enabled = true`. Port `home_feed_post_limit` into `app_policies['com.instagram.android'].session_post_limit`. Then delete the legacy global keys.

Feature detection on the native side is a separate track — this plan only covers the UI, navigation, and data model reshape. New intervention services (`FacebookReelsDetector`, etc.) are out of scope here and will be added per-app as needed.

### Per-app manifest

Single source of truth for rendering AppDetail and the Managed Apps row. Keeping it in one place means adding app #8 is a one-line change.

```
// components/managedApps/manifest.ts (NEW)
export const MANAGED_APPS = [
  {
    pkg: 'com.instagram.android',
    label: 'Instagram',
    emoji: '📷',
    features: [
      { key: 'reels_detection',   label: 'Reels Detection' },
      { key: 'session_post_limit', label: 'Home Feed Post Limit', kind: 'stepper', min: 5, max: 100, step: 5 },
    ],
  },
  {
    pkg: 'com.google.android.youtube',
    label: 'YouTube',
    emoji: '▶️',
    features: [
      { key: 'shorts_detection', label: 'Shorts Detection' },
    ],
  },
  { pkg: 'com.zhiliaoapp.musically', label: 'TikTok',    emoji: '🎵',
    features: [
      { key: 'tiktok_foryou',     label: 'For You Detection' },
      { key: 'session_post_limit', label: 'Session Post Limit', kind: 'stepper', min: 5, max: 100, step: 5 },
    ],
  },
  { pkg: 'com.reddit.frontpage',  label: 'Reddit',    emoji: '👽',
    features: [
      { key: 'reddit_feed',       label: 'Feed / Video Detection' },
      { key: 'session_post_limit', label: 'Session Post Limit', kind: 'stepper', min: 5, max: 100, step: 5 },
    ],
  },
  { pkg: 'com.twitter.android',   label: 'X / Twitter', emoji: '𝕏',
    features: [
      { key: 'twitter_foryou',    label: 'For You Detection' },
      { key: 'session_post_limit', label: 'Session Post Limit', kind: 'stepper', min: 5, max: 100, step: 5 },
    ],
  },
  { pkg: 'com.snapchat.android',  label: 'Snapchat',   emoji: '👻',
    features: [
      { key: 'snap_spotlight',    label: 'Spotlight Detection' },
    ],
  },
  { pkg: 'com.facebook.katana',   label: 'Facebook',   emoji: '📘',
    features: [
      { key: 'facebook_reels',    label: 'Reels Detection' },
      { key: 'facebook_feed',     label: 'Feed Detection' },
      { key: 'session_post_limit', label: 'Feed Post Limit', kind: 'stepper', min: 5, max: 100, step: 5 },
    ],
  },
];
```

### Files to change

| File | Change |
|------|--------|
| `components/managedApps/manifest.ts` (NEW) | Single source of truth — array of 7 app definitions with features + stepper metadata. |
| `components/AppDetail/AppDetail.js` (NEW) | Renders from manifest. Master `enabled` toggle at top. Then `app_open_intercept`, feature toggles (Switch or stepper per `kind`), `free_break_enabled`, Safe Mode launch button. Reads `app_policies[pkg]` via `SettingsModule.getAppPolicies`, writes via `SettingsModule.setAppFeature` (extend native side to accept new keys, or write JSON blob directly). |
| `components/Home/ManagedAppsList.js` (NEW) | Compact row list. Row = emoji + label + one-line status derived from policy + chevron. Tap navigates to `AppDetail` with `{ packageName }`. |
| `components/Home/home.js` (~line 732, before Top Apps) | Insert `<ManagedAppsList onSelect={pkg => navigation.navigate('AppDetail', { packageName: pkg })} />`. |
| `components/Home/home.js:778-844` | Remove the inline Safe Mode footer buttons — those now live inside AppDetail. |
| `App.tsx:130-138` | Add `<Stack.Screen name="AppDetail" component={AppDetail} />`. |
| `components/Customize/customize.js:410-484` | Remove entire "Your Apps" section and the global Free Break toggle. |
| `components/Customize/customize.js:486-525` | Remove Instagram Feed Post Limit block (moves to AppDetail). |
| `components/Customize/customize.js:527-625` | Keep global Scroll Budget allowance/window steppers + live status row. Keep Intercept Message + Forced Pause Duration sections unchanged. |
| `android/app/src/main/java/com/breqk/SettingsModule` | Extend `setAppFeature` to accept new keys. Run one-time migration: lift legacy `free_break_enabled` into each app's policy, lift `home_feed_post_limit` into Instagram's `session_post_limit`, delete legacy keys. |
| `android/app/src/main/java/com/breqk/BreqkPrefs` | Add getters/setters for new per-app feature keys. Update per-app policy resolver to read `free_break_enabled` from `app_policies[pkg]` instead of global. |
| `android/app/src/main/java/com/breqk/VPNModule` | `getFreeBreakStatus` / `startFreeBreak` / `endFreeBreak` take an optional `packageName`. Break state is stored per-app. |

### Home "Managed Apps" row — one-line status logic

```
function statusLine(policy, manifestEntry) {
  if (!policy?.enabled) return 'Off';
  const active = manifestEntry.features
    .filter(f => f.kind !== 'stepper' && policy[f.key] === true)
    .map(f => f.label.replace(' Detection', '').replace(' / Video Detection', ''));
  if (policy.app_open_intercept) active.push('Intercept');
  return active.length ? `On · ${active.join(' + ')}` : 'On';
}
```

---

## 3. Centering Issues

### Home header (`components/Home/home.js:863-891`)

`appName` has `flex: 1, textAlign: 'center'` with a **zero-width left spacer** (`headerSpacer: { width: 0 }`) and a right `headerActions` cluster holding two 36×36 buttons + a 4px gap ≈ 76px. The title's flex box is therefore asymmetric; the centered text sits left of the geometric screen center.

Compare to `components/Customize/customize.js:750` — `headerSpacer: { width: 36 }` correctly balances the single back button.

**Fix:** give Home's `headerSpacer` a fixed width equal to the right cluster.

```
headerSpacer: { width: 76 }
```

Alternative: position the title absolutely with `left: 0, right: 0, textAlign: 'center'` and let the icon clusters float above it. The fixed-width spacer is simpler and matches the pattern already used on Customize.

### Free break card end button (`components/Home/home.js:1118-1126`)

`freeBreakEndButton` uses `alignSelf: 'flex-start'` inside a card whose countdown text is block-level (reads as centered against the padding). The button feels off because it is the only left-aligned element.

**Fix (optional):** `alignSelf: 'center'` — or leave as editorial-style asymmetry. User call.

### Status strip (`components/Home/home.js:894-901`)

`justifyContent: 'center'` already — correct.

### Footer buttons (`components/Home/home.js:1170-1216`)

`footer` uses `alignItems: 'center'` with 100%-width pill buttons + centered caption. Correct.

### Files to change

| File | Change |
|------|--------|
| `components/Home/home.js:870-872` | `headerSpacer: { width: 76 }`. |
| `components/Home/home.js:1125` (optional) | `freeBreakEndButton.alignSelf: 'center'`. |

---

## Implementation Order

1. **Scroll budget display fix** — low risk, fixes the visible bug. Ship first.
2. **Centering fixes** — trivial, fast.
3. **Manifest + AppDetail skeleton** — render the existing Instagram + YouTube policies through the new structure. No behavior change, just placement.
4. **Native migration** — lift `free_break_enabled` and `home_feed_post_limit` into `app_policies[pkg]`, delete legacy keys, update `BreqkPrefs` resolver. Per-app free break state in `VPNModule`.
5. **Home Managed Apps list** — replaces the inline Safe Mode footer buttons. Per-app navigation to AppDetail.
6. **Customize cleanup** — strip the per-app section and global Free Break toggle. Customize becomes "global defaults" only.
7. **New app onboarding (Tiktok → Facebook)** — add manifest entries one at a time. Native-side detection services land per-app as they are built; UI is already ready.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Removing the 1s ticker feels less "live" on Home. | Poll every 2s while Home is focused; keep 5s in background. Native truth remains the only source. |
| Per-app free break state expands SharedPreferences writes. | Free break status is small (active/usedToday/remainingMs per pkg); store as part of `app_policies[pkg]` to avoid a separate key explosion. |
| Manifest drift if a native detector ships without the corresponding feature key. | Manifest entries carry a `requiresNativeVersion` gate; AppDetail hides a feature row if native doesn't advertise support. Deferred — not required for v1 restructure. |
| 7 apps on Home makes the dashboard feel heavy. | `ManagedAppsList` uses row layout (height ~52px each). Total ~360px even with all 7, and the Home screen is a ScrollView. If user adds more later, consider collapsing to "3 visible + expand" — not needed yet. |
| Legacy `home_feed_post_limit` / global `free_break_enabled` readers elsewhere. | `Grep` for both keys before the native migration; update all readers to use the per-app policy lookup. Keep a one-time migration flag so the lift runs exactly once. |
| Native ticker draining in background that the UI doesn't reflect. | Verified in `.claude/CLAUDE.md`: consumption lives in `ReelsInterventionService` (accessibility) only while scrolling a real short-video feed. Removing the JS client ticker does not regress real tracking. |

## Open Questions

None outstanding. Plan is ready to execute.

---

## SESSION_ID (for `/ccg:execute` use)

- CODEX_SESSION: (not used — plan produced inline without external model calls; Codex/Gemini wrappers unverified on this Windows bash setup, and the memory feedback prefers fast tool-first execution)
- GEMINI_SESSION: (not used — same)
