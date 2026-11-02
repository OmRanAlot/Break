# Plan: Per-App Feature Policies + Modes & Scheduling

## Problem

1. **Per-app control**: All features currently apply globally. User wants Instagram = reels blocking only (open freely), YouTube = app-open intercept only.
2. **Modes**: User wants named presets (e.g., "Study Mode") that override per-app policies with specific configs — e.g., intercepts ON for both apps at 20s delay.
3. **Scheduling**: User wants time-based auto-activation — e.g., at 10pm, Bedtime mode turns on automatically (intercepts + reels for all apps).

## Architecture Overview

Three layers, each building on the previous:

```
Layer 1: Base Per-App Policies (always present, user's default config)
   ↓ overridden by
Layer 2: Active Mode (optional — when a mode is active, its policy overrides win)
   ↓ triggered by
Layer 3: Schedule (optional — time-based rules that auto-activate/deactivate modes)
```

**Resolution rule**: If a mode is active, its policies merge on top of base policies. Mode policies only specify overrides — any feature not mentioned in the mode falls through to the base policy. This means a mode can be lightweight (e.g., Study Mode only sets `app_open_intercept: true` + `delay_time_seconds: 20` without touching reels settings).

---

## Data Model

### 1. Base Per-App Policies

Stored as JSON in SharedPreferences:

```
Key: "app_policies"
Value: {
  "com.instagram.android": {
    "app_open_intercept": false,
    "reels_detection": true,
    "scroll_budget": true,
    "free_break": true
  },
  "com.google.android.youtube": {
    "app_open_intercept": true,
    "reels_detection": false,
    "scroll_budget": false,
    "free_break": false
  }
}
```

**Feature flags per app**:
| Flag | What it controls |
|------|-----------------|
| `app_open_intercept` | Delay overlay when opening this app (AppUsageMonitor) |
| `reels_detection` | Scroll monitoring in Reels/Shorts (ReelsInterventionService) |
| `scroll_budget` | Time-limited scrolling (sub-feature of reels_detection) |
| `free_break` | 20-min break eligibility (sub-feature of reels_detection) |

**Backwards compatibility**: On first launch after update, migrate existing `blocked_apps` set → policy map with all features enabled. Keep `blocked_apps` key derived from policies where `app_open_intercept == true` so AppUsageMonitor/MyVpnService need zero refactoring.

### 2. Modes

Stored as JSON in SharedPreferences:

```
Key: "breqk_modes"
Value: {
  "study": {
    "name": "Study Mode",
    "icon": "book",
    "color": "#FF9800",
    "policy_overrides": {
      "com.instagram.android": { "app_open_intercept": true },
      "com.google.android.youtube": { "app_open_intercept": true }
    },
    "setting_overrides": {
      "delay_time_seconds": 20
    },
    "schedule": null
  },
  "bedtime": {
    "name": "Bedtime",
    "icon": "moon",
    "color": "#7C4DFF",
    "policy_overrides": {
      "com.instagram.android": { "app_open_intercept": true, "reels_detection": true },
      "com.google.android.youtube": { "app_open_intercept": true, "reels_detection": true }
    },
    "setting_overrides": {
      "delay_time_seconds": 20
    },
    "schedule": {
      "start_time": "22:00",
      "end_time": "07:00",
      "days": [0, 1, 2, 3, 4, 5, 6]
    }
  }
}
```

```
Key: "active_mode"
Value: "study" | "bedtime" | null (string ID or empty = no mode active)
```

```
Key: "active_mode_source"
Value: "manual" | "schedule" (tracks whether mode was hand-toggled or auto-triggered)
```

**Mode fields**:
| Field | Purpose |
|-------|---------|
| `name` | Display name (user-editable) |
| `icon` | Icon identifier for the card (book, moon, dumbbell, etc.) |
| `color` | Accent color for the active mode indicator |
| `policy_overrides` | Sparse per-app overrides — only features that differ from base. Missing features = fall through to base. |
| `setting_overrides` | Global setting overrides (delay_time_seconds, scroll_threshold, etc.) |
| `schedule` | Optional time trigger. `null` = manual-only. |

**Schedule fields**:
| Field | Purpose |
|-------|---------|
| `start_time` | "HH:mm" — when this mode auto-activates |
| `end_time` | "HH:mm" — when this mode auto-deactivates (supports overnight: 22:00→07:00) |
| `days` | Array of day indices (0=Sun, 6=Sat). All days = `[0,1,2,3,4,5,6]` |

### 3. Effective Policy Resolution (Runtime)

When any service needs to check a feature for a given app:

```java
boolean isEnabled(String packageName, String featureKey) {
    String activeMode = prefs.getString("active_mode", null);
    if (activeMode != null) {
        // Check mode override first
        Map modeOverrides = getModeOverrides(activeMode, packageName);
        if (modeOverrides.containsKey(featureKey)) {
            return modeOverrides.get(featureKey);
        }
    }
    // Fall through to base policy
    return getBasePolicy(packageName, featureKey);
}
```

Same for settings like `delay_time_seconds` — mode override wins if present, else base value.

---

## UX Design

### Customize Screen Layout

```
Home → Customize (gear icon)
  ├── Modes section (NEW — quick toggle + schedule config)
  │     ├── Study Mode card (manual toggle + optional schedule)
  │     ├── Bedtime card (manual toggle + schedule: 10pm–7am)
  │     └── (+ Create Mode) button
  ├── Managed Apps section (NEW — replaces Intervention Modes)
  │     ├── Instagram card → expand with per-feature toggles
  │     ├── YouTube card → expand with per-feature toggles
  │     └── (+ Add App) future
  ├── Scroll Budget section (unchanged — global config)
  ├── Intercept Message section (unchanged — global config)
  └── Version footer
```

### Modes Section UI

```
┌─────────────────────────────────────────┐
│  MODES                                  │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ 📖 Study Mode              [  ■  ] ││
│  │ Intercepts on all apps, 20s delay   ││
│  │                            Edit ▸   ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ 🌙 Bedtime                 [    ]  ││
│  │ Full blocking — 10pm → 7am          ││
│  │                            Edit ▸   ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐│
│  │         + Create Mode              ││
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘│
└─────────────────────────────────────────┘
```

**Mode card (collapsed)**:
- Left: icon + name
- Right: toggle switch (activates/deactivates the mode immediately)
- Subtitle: one-line summary auto-generated from config (e.g., "Intercepts on all apps, 20s delay")
- "Edit ▸" link → opens mode editor (inline expand or bottom sheet)

**Only one mode can be active at a time.** Toggling a mode ON deactivates any other active mode. This is simpler than stacking and avoids conflict resolution.

**When a mode is active**, a colored banner appears at the top of the Customize screen (and on Home):
```
┌─────────────────────────────────────────┐
│  ■ Study Mode active                 ✕  │
└─────────────────────────────────────────┘
```
The `✕` deactivates the mode. The banner uses the mode's accent color.

### Mode Editor (Edit ▸)

Expands inline below the mode card (same accordion pattern as Managed Apps):

```
┌─────────────────────────────────────────┐
│ 📖 Study Mode                    [  ■  ]│
│                                         │
│  Name: [Study Mode          ]           │
│                                         │
│  APPS & FEATURES                        │
│  ┌─────────────────────────────────────┐│
│  │ Instagram                           ││
│  │   App Open Intercept    [■]         ││
│  │   Reels Detection       [ ]         ││
│  └─────────────────────────────────────┘│
│  ┌─────────────────────────────────────┐│
│  │ YouTube                             ││
│  │   App Open Intercept    [■]         ││
│  │   Reels Detection       [ ]         ││
│  └─────────────────────────────────────┘│
│                                         │
│  OVERRIDES                              │
│  Forced Pause Duration    [20] seconds  │
│                                         │
│  SCHEDULE (optional)                    │
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐│
│  │  Starts at   [10:00 PM]            ││
│  │  Ends at     [ 7:00 AM]            ││
│  │  Days  [M][T][W][T][F][S][S]       ││
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘│
│                                         │
│  [Delete Mode]                          │
└─────────────────────────────────────────┘
```

**Key UX decisions**:
- Toggles in the mode editor only show features that differ from base — but for simplicity in v1, show all features for all apps and let the user set whatever they want. Only toggled-ON features become overrides; toggled-OFF features are omitted (fall through to base).
- Schedule is optional — shown with a dashed border. Tap "Add Schedule" to reveal time pickers. Tap "Remove Schedule" to go back to manual-only.
- Time pickers: simple HH:MM input or React Native's DateTimePicker (time mode).
- Day selector: row of 7 circular buttons (Mon–Sun), filled = active.

### Managed Apps Section (Base Policies)

Same as previous plan — accordion cards with per-app feature toggles:

```
┌─────────────────────────────────────────┐
│  MANAGED APPS (defaults)                │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ Instagram            [Reels][Budget]││
│  └─────────────────────────────────────┘│
│  ┌─────────────────────────────────────┐│
│  │ YouTube              [Intercept]    ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

**When a mode is active**, a subtle "(overridden by Study Mode)" label appears on features that the mode overrides, so the user knows why a toggle appears to disagree with what they set.

### Home Screen

Active mode shown as a prominent card:

```
┌─────────────────────────────────────────┐
│  ■ Study Mode                    Until  │
│  Intercepts: all apps, 20s     manual ✕ │
└─────────────────────────────────────────┘
```

Or for a scheduled mode:
```
┌─────────────────────────────────────────┐
│  🌙 Bedtime                     Until   │
│  Full blocking                  7:00 AM │
└─────────────────────────────────────────┘
```

Users can also quick-toggle modes from Home (tap the mode card or a dedicated row).

---

## Scheduling Implementation

### Android AlarmManager Approach

Schedules are implemented using Android's `AlarmManager` for reliable time-based triggers:

1. When a mode with a schedule is saved, register two exact alarms:
   - **Start alarm**: fires at `start_time` → activates the mode
   - **End alarm**: fires at `end_time` → deactivates the mode
2. Alarms are re-registered on boot via a `BOOT_COMPLETED` BroadcastReceiver.
3. A `ModeSchedulerReceiver` (BroadcastReceiver) handles alarm intents → reads mode config from SharedPreferences → sets `active_mode` → broadcasts intent to running services so they pick up the change.

**Why AlarmManager over WorkManager**: We need exact timing (10:00 PM sharp, not "sometime around 10 PM"). `AlarmManager.setExactAndAllowWhileIdle()` is the right tool. WorkManager's minimum interval is 15 minutes and is not guaranteed to fire at exact times.

**Day filtering**: The alarm fires daily; the receiver checks if today's day-of-week is in the mode's `days` array before activating.

### New Native Files

| File | Purpose |
|------|---------|
| `ModeManager.java` | Central mode logic: activate/deactivate, resolve effective policies, register/cancel alarms |
| `ModeSchedulerReceiver.java` | BroadcastReceiver for alarm intents + BOOT_COMPLETED re-registration |

---

## Implementation Steps

### Step 1: Data Model — BreqkPrefs + SettingsModule

**Files**: `BreqkPrefs.java`, `SettingsModule.java`

1. Add keys to BreqkPrefs:
   - `KEY_APP_POLICIES = "app_policies"` (base per-app policies JSON)
   - `KEY_MODES = "breqk_modes"` (modes config JSON)
   - `KEY_ACTIVE_MODE = "active_mode"` (current active mode ID or empty)
   - `KEY_ACTIVE_MODE_SOURCE = "active_mode_source"` ("manual" | "schedule")
2. Add BreqkPrefs helpers:
   - `getAppPolicies(Context)` / `saveAppPolicies(Context, Map)`
   - `getEffectivePolicy(Context, String packageName, String featureKey)` — resolves base + active mode
   - `getEffectiveSettingInt(Context, String settingKey, int defaultValue)` — resolves setting with mode override
   - Migration: if `app_policies` empty but `blocked_apps` has entries → generate policy map with all features ON
3. Add SettingsModule React methods:
   - `getAppPolicies(Callback)` / `saveAppPolicies(String json)`
   - `setAppFeature(String pkg, String feature, boolean enabled)` — atomic single-feature update
   - `getModes(Callback)` / `saveModes(String json)`
   - `getActiveMode(Callback)` / `activateMode(String modeId)` / `deactivateMode()`
4. Keep `blocked_apps` in sync: derived from effective policies (base + active mode) where `app_open_intercept == true`.

### Step 2: Mode Manager — Native logic

**Files**: `ModeManager.java` (NEW), `ModeSchedulerReceiver.java` (NEW)

1. `ModeManager`:
   - `activate(Context, String modeId, String source)` — sets active_mode, recomputes blocked_apps, dispatches UPDATE_BLOCKED_APPS intent to MyVpnService
   - `deactivate(Context)` — clears active_mode, recomputes blocked_apps from base policies
   - `resolveEffectivePolicy(Context, String pkg, String feature)` — base + mode merge
   - `registerScheduleAlarms(Context, String modeId)` — sets AlarmManager exact alarms
   - `cancelScheduleAlarms(Context, String modeId)` — removes alarms
   - `reregisterAllAlarms(Context)` — called on BOOT_COMPLETED
2. `ModeSchedulerReceiver`:
   - Handles `ACTION_MODE_START` / `ACTION_MODE_END` intents from AlarmManager
   - Handles `BOOT_COMPLETED` → calls `reregisterAllAlarms()`
   - Day-of-week check before activating

### Step 3: Native Services — Use effective policies

**Files**: `ReelsInterventionService.java`, `AppUsageMonitor.java`

1. `ReelsInterventionService`: Replace direct SharedPreferences reads with `BreqkPrefs.getEffectivePolicy(context, currentPackage, "reels_detection")`. Same for scroll_budget/free_break checks.
2. `AppUsageMonitor`: Already uses `blocked_apps` which is kept in sync by ModeManager — no change needed.
3. Delay overlay: Read effective `delay_time_seconds` via `BreqkPrefs.getEffectiveSettingInt()` so mode overrides take effect.

### Step 4: Customize UI — Modes + Managed Apps

**File**: `components/Customize/customize.js`

1. Add **Modes section** at the top:
   - Load modes from `SettingsModule.getModes()`
   - Load active mode from `SettingsModule.getActiveMode()`
   - Each mode card: name, subtitle, toggle, "Edit ▸"
   - Toggle calls `SettingsModule.activateMode(id)` / `deactivateMode()`
   - Edit expands inline with: name input, per-app feature toggles, delay override input, schedule config
   - "+ Create Mode" button: generates a new mode with defaults, expands editor
   - Active mode banner at top when a mode is ON
2. Ship **two default modes** on first launch:
   - "Study Mode" — intercepts ON for all apps, 20s delay, no schedule
   - "Bedtime" — intercepts + reels ON for all apps, 20s delay, schedule 10pm→7am all days
   - User can edit/delete these freely
3. Replace **Intervention Modes section** with **Managed Apps** accordion:
   - Same as previous plan: per-app expandable cards with feature toggles
   - When a mode is active, show "(overridden by [Mode Name])" on affected toggles
   - Overridden toggles are dimmed but still show what the mode has set

### Step 5: Home Screen — Mode status + derived visibility

**File**: `components/Home/home.js`

1. Active mode card: if a mode is active, show a prominent status card with mode name, summary, "Until [time/manual]", and dismiss button
2. Quick-toggle: if no mode is active, optionally show mode shortcuts (v2 — skip for v1 to keep Home clean)
3. Derive all visibility from effective policies (not base policies):
   - Scroll Budget card: visible if any effective policy has `reels_detection` + `scroll_budget`
   - Free Break: visible if any effective policy has `free_break`
   - "Open Instagram (Safe Mode)": visible if Instagram effective policy has `reels_detection`
4. `init()`: Derive `blocked_apps` from effective policies instead of hardcoding

### Step 6: VPNModule + Manifest updates

**Files**: `VPNModule.java`, `AndroidManifest.xml`

1. `VPNModule`: Add `activateMode(String modeId)` / `deactivateMode()` React methods that delegate to `ModeManager`
2. Add `getFreeBreakStatus` / `getScrollBudgetStatus` to use effective policies
3. `AndroidManifest.xml`: Register `ModeSchedulerReceiver` with `BOOT_COMPLETED` + custom mode intent actions
4. Add `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` permission for AlarmManager

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `BreqkPrefs.java` | Modify | Add policy/mode keys, effective resolution helpers, migration |
| `SettingsModule.java` | Modify | Add policy/mode CRUD React methods |
| `ModeManager.java` | **NEW** | Mode activation, policy resolution, alarm scheduling |
| `ModeSchedulerReceiver.java` | **NEW** | BroadcastReceiver for schedule alarms + boot |
| `ReelsInterventionService.java` | Modify | Use effective policy checks instead of direct prefs |
| `AppUsageMonitor.java` | Minimal | blocked_apps sync handles this automatically |
| `customize.js` | Modify | Add Modes section + Managed Apps accordion |
| `home.js` | Modify | Active mode card + effective policy-derived visibility |
| `VPNModule.java` | Modify | Mode activation bridge methods |
| `AndroidManifest.xml` | Modify | Register receiver, add alarm permissions |
| `LOGGING.md` | Modify | Add mode/schedule log tags |

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Migration corrupts existing settings | Migration only runs if `app_policies` is empty; old `blocked_apps` preserved as fallback |
| Dual monitor sync breaks | `blocked_apps` still derived automatically; ModeManager dispatches UPDATE_BLOCKED_APPS intent on every mode change |
| AlarmManager killed by battery optimization | Use `setExactAndAllowWhileIdle()`; document that user may need to disable battery optimization for Breqk |
| Overnight schedule (22:00→07:00) edge case | ModeSchedulerReceiver checks: if start > end, mode is active when current_time >= start OR current_time < end |
| Two modes with overlapping schedules | Only one mode active at a time; later-scheduled mode wins (last-write-wins). UI warns if schedules overlap. |
| JSON parse errors | Wrap in try/catch; return empty/defaults on failure |
| Mode activated while app is in background | ModeManager writes to SharedPreferences + sends intent; services pick up changes on next poll/event |

## Out of Scope (v1)

- Adding new apps via an app picker (hardcode Instagram + YouTube)
- Per-app scroll budget amounts (global config, per-app enable/disable only)
- Per-app intercept messages
- Stacking multiple modes simultaneously
- Geolocation-based mode triggers
- Mode sharing/export
