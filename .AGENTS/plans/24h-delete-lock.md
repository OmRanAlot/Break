# 24-Hour Uninstall Lock — Implementation Plan

> Created: 2026-05-05
> Branch: `bug-fixing`
> Owner: Native (Android) + RN frontend

## 1. Goal

Add an opt-in **Uninstall Protection** feature. Once enabled, the only sanctioned path to removing Breqk is a **24-hour cooldown**:

1. User toggles ON → multi-step consent → Device Admin enforced → lock active.
2. User taps "Delete Breqk" → 24h countdown starts → cannot be cancelled.
3. After 24h → user is walked through Device Admin deactivation → uninstall.

The plan also documents the **single Android-level bypass** we cannot programmatically close (Settings → Apps → Clear Data) and surfaces it in the consent screen so the user accepts that risk explicitly.

## 2. Honest Threat Model (read first)

Android does **not** let a non-device-owner app block its own uninstall or Device Admin deactivation. The system dialog is OS-rendered and we can only contribute a message. Therefore:

| Bypass attempt | Mitigation | Residual risk |
|----------------|------------|---------------|
| Tap Lock toggle OFF | Native rejects `disableUninstallLock()` unless a delete request has already expired | Closed |
| Tap "Delete Breqk" → cancel | No cancel API exists; pressing "Cancel" exits the modal but the timer keeps running | Closed |
| Tamper system clock forward | Cross-check `SystemClock.elapsedRealtime()` against `currentTimeMillis()` within same boot; show "Clock tampering detected" and refuse to expire | Closed within a boot session |
| Reboot to reset `elapsedRealtime` | Wall-clock time still advances; we fall back to wall clock if `boot_id` no longer matches | Accepted (still 24h wall) |
| Settings → Security → Device Admins → Deactivate | `onDisableRequested()` returns a multi-line warning embedding the live countdown; system "Deactivate" still works | **Open** — Android limitation |
| Settings → Apps → Breqk → Force Stop | Foreground service auto-restarts; lock state in SharedPreferences survives | Closed |
| Settings → Apps → Breqk → Clear Data | Wipes SharedPreferences → lock & countdown state lost. Device Admin record may also be cleared on some OEMs | **Open** — Android limitation |
| ADB `dpm remove-active-admin` + `adb uninstall` | Debug-only; not present on user devices | Closed for shipped APKs |

Both **Open** items are disclosed verbatim in the consent screen so the user explicitly accepts them. There is no claimed protection beyond what Android allows.

## 3. Architecture

```
User → Customize → "Danger Zone" section → Uninstall Protection toggle
                                          → Delete Breqk button (only if locked)

JS Layer:
  components/UninstallLock/
    UninstallLockSettings.js     — toggle row + status card
    EnableLockConsentModal.js    — 2-step consent + 2 required checkboxes
    DeleteRequestCountdown.js    — full-screen modal with hh:mm:ss
    DeleteReadyScreen.js         — shown when expired; CTA to uninstall
    useUninstallLock.js          — polling hook (status every 30s)

Bridge:
  VPNModule.java
    + getUninstallLockStatus(Promise)
    + enableUninstallLock(String consentVersion, Promise)
    + disableUninstallLock(Promise)              // rejects if locked & no expired request
    + requestDelete(Promise)                     // starts 24h timer
    + proceedToUninstall(Promise)                // only valid after expiry

Native:
  com.breqk.lock.UninstallLockManager    — owns state, twin-clock validation
  com.breqk.lock.UninstallExpiryReceiver — AlarmManager → expiry notification
  com.breqk.prefs.BreqkPrefs             — new keys (see §5)
  com.breqk.deviceadmin.BreqkDeviceAdminReceiver
    onDisableRequested() now embeds live countdown when active

Routing (App.tsx):
  if uninstallLockStatus.deleteRequestExpiresAt && now < expiresAt
    → render <DeleteRequestCountdown/> as full-screen modal (non-dismissable)
  else if expiresAt && now >= expiresAt
    → render <DeleteReadyScreen/> (CTA only)
  else
    → normal app
```

## 4. UX Flows

### 4.1 Enable lock

1. User taps "Uninstall Protection" toggle (currently OFF).
2. Modal opens — header: "Lock Breqk against impulsive deletion?"
3. Body lists 5 specific consequences:
   - You will not be able to uninstall Breqk for 24 hours after requesting deletion.
   - You cannot cancel a deletion request once started — only wait it out or let it complete.
   - Disabling this protection requires the same 24-hour wait.
   - Device Admin permission is required and stays active until you explicitly deactivate it.
   - **Android limitation:** clearing app data via system Settings → Apps may bypass this lock. We disclose this so you can decide.
4. Two required checkboxes (both must be checked to enable the primary CTA):
   - [ ] I understand the 24-hour delay and accept the inconvenience.
   - [ ] I accept the disclosed Android-level bypass paths.
5. "Activate Protection" button.
6. If Device Admin not active → call existing `activateDeviceAdmin()` first; on return, complete enable.
7. Native records: `lock_enabled=true`, `consent_version="2026-05-05-v1"`, `consent_at=<now>`.
8. Success toast.

### 4.2 Request deletion

1. With lock enabled, "Delete Breqk" button appears in Danger Zone.
2. Tap → confirmation modal: "Start the 24-hour countdown?" (single button "Start Countdown" + "Not now").
3. On confirm: `VPNModule.requestDelete()` writes state and schedules `AlarmManager`.
4. App routes to `<DeleteRequestCountdown/>`. From this point:
   - Countdown is the only visible screen. All other navigation is blocked.
   - Real-time hh:mm:ss display.
   - Background services keep running (blocking still works during countdown).
   - Subtle reminder: "Cancel is not available. The countdown completes automatically."
5. AlarmManager exact alarm fires at expiry → `UninstallExpiryReceiver` posts a "Ready to uninstall" notification.

### 4.3 After expiry

1. App opens to `<DeleteReadyScreen/>`.
2. Single CTA: "Continue to Uninstall".
3. Tap → `VPNModule.proceedToUninstall()`:
   - Opens system Device Admin deactivation dialog (we cannot bypass user confirm).
   - On return: opens system uninstall dialog via `Intent.ACTION_DELETE` with `package:com.breqk` URI.
4. If user backs out, screen remains; they can retry. Lock no longer blocks anything since the 24h has elapsed.

### 4.4 Mid-countdown Device Admin attempt

User goes Settings → Security → Device Administrators → tap Breqk → "Deactivate".
- Our `onDisableRequested()` is called and returns a string like:
  > "You requested deletion 5h 12m ago. The 24-hour wait completes at 8:42 PM. Disabling now will allow uninstall and end your protection."
- The system still shows OK / Cancel. We cannot block. Behavior accepted per §2.

## 5. Native State (BreqkPrefs)

Add to `BreqkPrefs.java`:

```java
// ── Uninstall Lock ────────────────────────────────────────────────
public static final String KEY_UNINSTALL_LOCK_ENABLED         = "uninstall_lock_enabled";
public static final String KEY_UNINSTALL_LOCK_CONSENT_VERSION = "uninstall_lock_consent_version";
public static final String KEY_UNINSTALL_LOCK_CONSENT_AT      = "uninstall_lock_consent_at";

// Twin-clock state for tamper detection
public static final String KEY_DELETE_REQUEST_AT_WALL    = "delete_request_at_wall";
public static final String KEY_DELETE_REQUEST_AT_BOOT    = "delete_request_at_boot";
public static final String KEY_DELETE_REQUEST_EXPIRES_AT = "delete_request_expires_at";
public static final String KEY_DELETE_REQUEST_BOOT_ID    = "delete_request_boot_id";

public static final long   UNINSTALL_LOCK_DURATION_MS         = 24L * 60L * 60L * 1000L;
public static final String UNINSTALL_LOCK_CONSENT_VERSION_CURRENT = "2026-05-05-v1";
```

`BOOT_ID` is `System.currentTimeMillis() - SystemClock.elapsedRealtime()` (approximate boot wall time). Same value across the boot; differs after reboot.

## 6. Native Logic — UninstallLockManager.java

Single source of truth for status + transitions. Pseudocode:

```java
public final class UninstallLockManager {
    public static final class Status {
        boolean enabled;
        String consentVersion;          // "" if never enabled
        long   consentAtWall;           // 0 if not enabled
        boolean deleteRequested;
        long   requestAtWall;
        long   expiresAtWall;
        long   remainingMs;             // 0 if not requested or already expired
        boolean expired;
        boolean tamperSuspected;        // wall clock moved backward vs boot elapsed
    }

    public static Status getStatus(Context ctx) {
        // Read all keys; cross-check wall vs boot when same-boot session.
        // Return Status snapshot. NEVER mutate here.
    }

    public static void enable(Context ctx, String consentVersion) {
        // Pre: BreqkDeviceAdminReceiver isAdminActive() == true
        // Else: throw IllegalStateException("DEVICE_ADMIN_REQUIRED")
        // Pre: consentVersion equals UNINSTALL_LOCK_CONSENT_VERSION_CURRENT
        // Atomically write enabled=true, consent_version, consent_at.
    }

    public static void disable(Context ctx) {
        // Pre: deleteRequested && expired
        // Else: throw IllegalStateException("LOCK_ACTIVE")
        // Wipe lock keys + delete request keys.
    }

    public static void requestDelete(Context ctx) {
        // Pre: enabled == true
        // Pre: !deleteRequested
        // Capture wallNow, bootNow, bootId.
        // Write atomically:
        //   request_at_wall=wallNow
        //   request_at_boot=bootNow
        //   request_boot_id=bootId
        //   expires_at_wall=wallNow + 24h
        // Schedule AlarmManager.setExactAndAllowWhileIdle to UninstallExpiryReceiver at expires_at.
    }

    public static void cancelDelete(Context ctx) {
        // EXPLICIT: do nothing & throw UnsupportedOperationException("CANCEL_NOT_ALLOWED").
    }

    public static void clearOnUninstallComplete(Context ctx) {
        // Called by Device Admin onDisabled() after expiry → clear keys.
    }
}
```

### Status computation rules

```
expiresAtWall = prefs.getLong(KEY_DELETE_REQUEST_EXPIRES_AT, 0)
deleteRequested = expiresAtWall > 0
storedBootId = prefs.getString(KEY_DELETE_REQUEST_BOOT_ID, "")
currentBootId = String.valueOf(System.currentTimeMillis() - SystemClock.elapsedRealtime())

if same boot:
    bootElapsedSinceRequest = SystemClock.elapsedRealtime() - request_at_boot
    wallElapsedSinceRequest = System.currentTimeMillis() - request_at_wall
    // If wall < boot - 60s tolerance, user rolled clock backward
    tamperSuspected = wallElapsedSinceRequest + 60000 < bootElapsedSinceRequest
    effectiveElapsed = max(wallElapsedSinceRequest, bootElapsedSinceRequest)
else:
    // post-reboot — trust wall clock only
    effectiveElapsed = max(0, System.currentTimeMillis() - request_at_wall)

remainingMs = max(0, UNINSTALL_LOCK_DURATION_MS - effectiveElapsed)
expired = (remainingMs == 0)
```

If `tamperSuspected`, surface in JS so countdown screen shows a "System clock tampering detected — using boot timer" banner. The timer continues; the user's bypass attempt fails.

## 7. UninstallExpiryReceiver.java

Registered in AndroidManifest as a private receiver. Triggered by `AlarmManager` exact alarm scheduled in `requestDelete()`.

Responsibilities:
1. Re-check status (alarm could fire late after reboot).
2. Post a notification on a new `UninstallReady` channel: "Your 24-hour wait is complete. Tap to uninstall." Tapping launches MainActivity, which routes to `<DeleteReadyScreen/>`.
3. Do **not** auto-uninstall. User confirmation in app + system dialogs is mandatory.

## 8. BreqkDeviceAdminReceiver — onDisableRequested()

Replace the static message with a context-aware one. Pseudocode:

```java
@Override
public CharSequence onDisableRequested(Context ctx, Intent intent) {
    UninstallLockManager.Status s = UninstallLockManager.getStatus(ctx);
    if (s.deleteRequested && !s.expired) {
        long h = s.remainingMs / 3_600_000;
        long m = (s.remainingMs % 3_600_000) / 60_000;
        return "You requested deletion. The 24-hour wait completes in "
            + h + "h " + m + "m. Disabling protection now ends the wait early "
            + "and removes all blocking.";
    }
    return "Disabling this will allow Breqk to be uninstalled, "
         + "which removes all blocking. Are you sure?";
}
```

## 9. VPNModule Bridge Methods

Add to `VPNModule.java` (sketch):

```java
@ReactMethod public void getUninstallLockStatus(Promise p) {
    UninstallLockManager.Status s = UninstallLockManager.getStatus(reactContext);
    WritableMap m = Arguments.createMap();
    m.putBoolean("enabled", s.enabled);
    m.putString("consentVersion", s.consentVersion);
    m.putDouble("consentAtMs", s.consentAtWall);
    m.putBoolean("deleteRequested", s.deleteRequested);
    m.putDouble("requestAtMs", s.requestAtWall);
    m.putDouble("expiresAtMs", s.expiresAtWall);
    m.putDouble("remainingMs", s.remainingMs);
    m.putBoolean("expired", s.expired);
    m.putBoolean("tamperSuspected", s.tamperSuspected);
    p.resolve(m);
}

@ReactMethod public void enableUninstallLock(String consentVersion, Promise p) {
    if (!isDeviceAdminActiveInternal()) { p.reject("DEVICE_ADMIN_REQUIRED", "..."); return; }
    if (!BreqkPrefs.UNINSTALL_LOCK_CONSENT_VERSION_CURRENT.equals(consentVersion)) {
        p.reject("CONSENT_VERSION_MISMATCH", "..."); return;
    }
    UninstallLockManager.enable(reactContext, consentVersion);
    p.resolve(true);
}

@ReactMethod public void disableUninstallLock(Promise p) {
    try { UninstallLockManager.disable(reactContext); p.resolve(true); }
    catch (IllegalStateException e) { p.reject("LOCK_ACTIVE", e.getMessage()); }
}

@ReactMethod public void requestDelete(Promise p) {
    try { UninstallLockManager.requestDelete(reactContext); p.resolve(true); }
    catch (Exception e) { p.reject("REQUEST_DELETE_ERROR", e.getMessage()); }
}

@ReactMethod public void proceedToUninstall(Promise p) {
    UninstallLockManager.Status s = UninstallLockManager.getStatus(reactContext);
    if (!s.expired) { p.reject("LOCK_ACTIVE", "Wait not complete"); return; }
    DevicePolicyManager dpm = ...;
    dpm.removeActiveAdmin(new ComponentName(reactContext, BreqkDeviceAdminReceiver.class));
    Intent uninstall = new Intent(Intent.ACTION_DELETE,
                                   Uri.parse("package:" + reactContext.getPackageName()));
    uninstall.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    reactContext.startActivity(uninstall);
    p.resolve(true);
}
```

## 10. Frontend Components

### 10.1 `useUninstallLock.js`

```js
export function useUninstallLock(pollMs = 30_000) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const s = await VPNModule.getUninstallLockStatus();
        if (mounted) setStatus(s);
      } catch (e) { /* swallow; native log */ }
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => { mounted = false; clearInterval(id); };
  }, [pollMs]);
  return status;
}
```

### 10.2 `EnableLockConsentModal.js`

- Two `Switch`/`Checkbox` rows wired to local state.
- "Activate Protection" `disabled` until both true.
- Calls `VPNModule.activateDeviceAdmin()` first if `isDeviceAdminActive() === false`.
- On Device Admin success → `VPNModule.enableUninstallLock("2026-05-05-v1")`.

### 10.3 `DeleteRequestCountdown.js`

- Full-screen `Modal` with `presentationStyle="fullScreen"` and `hardwareAccelerated`.
- Hardware back press intercepted (`BackHandler`) — does nothing.
- 1-second `setInterval` updates `remainingMs` from a local timer; reconciles with native every 30s.
- Banner if `tamperSuspected` is true.
- Body copy: "Your 24-hour wait is in progress. You cannot cancel this. Once it completes, Breqk will guide you through the uninstall."

### 10.4 `DeleteReadyScreen.js`

- Single CTA "Continue to Uninstall" → `VPNModule.proceedToUninstall()`.
- Secondary text: "You can also keep Breqk by tapping the back gesture. The lock will reset to disabled after uninstall completes."

### 10.5 `UninstallLockSettings.js` (in Customize Danger Zone)

- Row 1: "Uninstall Protection" — `Switch`. ON tap when OFF → opens consent modal. ON tap when ON → opens "You can only disable this through the 24-hour delete flow" tooltip.
- Row 2 (only when ON): "Status: Protected since {date}".
- Row 3 (only when ON): "Delete Breqk" red destructive button → confirm dialog → `requestDelete()`.

### 10.6 `App.tsx` routing additions

```jsx
const lock = useUninstallLock();

if (lock?.deleteRequested && !lock.expired) {
  return <DeleteRequestCountdown status={lock}/>;
}
if (lock?.deleteRequested && lock.expired) {
  return <DeleteReadyScreen/>;
}
// existing routing
```

## 11. AndroidManifest changes

```xml
<receiver
    android:name=".lock.UninstallExpiryReceiver"
    android:exported="false"/>
```

Notification channel `UninstallReady` created on first use in `MainApplication` or lazily in receiver.

## 12. Implementation Steps (build order)

| # | Step | Deliverable |
|---|------|-------------|
| 1 | Add `BreqkPrefs` constants + `UNINSTALL_LOCK_DURATION_MS` + consent version | Compile-clean keys |
| 2 | Create `UninstallLockManager` with `getStatus()`, twin-clock logic, `enable/disable/requestDelete/cancelDelete` | Unit-testable manager |
| 3 | Create `UninstallExpiryReceiver` + register in manifest + notification channel | Alarm fires & posts notif |
| 4 | Update `BreqkDeviceAdminReceiver.onDisableRequested()` to embed live countdown | Manual test on device |
| 5 | Add 5 `@ReactMethod`s to `VPNModule` | RN-callable bridge |
| 6 | Create `useUninstallLock.js` hook | Polls status correctly |
| 7 | Create `EnableLockConsentModal.js` | 2-checkbox gate works |
| 8 | Create `DeleteRequestCountdown.js` with `BackHandler` block | Cannot exit modal |
| 9 | Create `DeleteReadyScreen.js` | Walks user to uninstall |
| 10 | Insert routing in `App.tsx` | Modal preempts normal UI |
| 11 | Add Danger Zone section to `customize.js` (or `Customize/DangerZone.js` to keep file < 800 lines per project rule) | Toggle + button rendered |
| 12 | Manual QA: enable → request → wait shortened to 60s via debug-only constant override → expire → uninstall walkthrough | End-to-end works |
| 13 | QA tamper paths: change clock, reboot during countdown, force-stop, clear data | Behavior matches §2 table |
| 14 | Update `docs/TASKS.md` and `docs/current_task.md` | Single-source-of-truth in sync |

For step 12, expose a debug-only override:
```java
public static long uninstallLockDurationMs() {
    return BuildConfig.DEBUG ? 60_000L : UNINSTALL_LOCK_DURATION_MS;
}
```

## 13. Key Files

| File | Operation |
|------|-----------|
| `android/app/src/main/java/com/breqk/prefs/BreqkPrefs.java` | Add ~10 constants |
| `android/app/src/main/java/com/breqk/lock/UninstallLockManager.java` | **New** |
| `android/app/src/main/java/com/breqk/lock/UninstallExpiryReceiver.java` | **New** |
| `android/app/src/main/java/com/breqk/bridge/VPNModule.java` | Add 5 `@ReactMethod`s |
| `android/app/src/main/java/com/breqk/deviceadmin/BreqkDeviceAdminReceiver.java` | Rewrite `onDisableRequested()` body |
| `android/app/src/main/AndroidManifest.xml` | Register `UninstallExpiryReceiver` |
| `components/UninstallLock/UninstallLockSettings.js` | **New** |
| `components/UninstallLock/EnableLockConsentModal.js` | **New** |
| `components/UninstallLock/DeleteRequestCountdown.js` | **New** |
| `components/UninstallLock/DeleteReadyScreen.js` | **New** |
| `components/UninstallLock/useUninstallLock.js` | **New** |
| `components/Customize/customize.js` | Add Danger Zone section (consider extracting to `Customize/DangerZone.js` to keep file under 800 lines) |
| `App.tsx` | Add routing branch |
| `docs/TASKS.md` | Add P1 entry |
| `docs/current_task.md` | Per project rule: track this task |

## 14. Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| User clears app data and bypasses lock | Disclosed in consent screen; impossible to close at API level. Consider an OEM-aware warning (e.g. "On Samsung, clearing data may also remove Device Admin"). |
| AlarmManager exact alarm denied on Android 14+ | Use `setAndAllowWhileIdle()` fallback if `canScheduleExactAlarms()` is false; the app polls every 30s anyway, so the notification is redundant for in-app flow. |
| `BackHandler` doesn't intercept gesture nav on Android 13+ | Use `Modal` with `onRequestClose={() => {}}` to block the gesture; verify on Pixel 8. |
| User reboots, loses `request_at_boot` | Falls back to wall clock per §6 rules; tamper detection limited to same boot. Acceptable since user still waits the wall 24h. |
| `BreqkPrefs` clear from Customize "Reset" path | Audit: ensure no existing reset clears uninstall lock keys (current code: nothing does). Add explicit comment in `BreqkPrefs` to never include lock keys in any reset routine. |
| Notification permission denied (Android 13+) | App still works; user just doesn't get the expiry ping. In-app countdown still updates. |
| User changes locale / 24h vs 12h time format | Use `DateUtils.getRelativeTimeSpanString` for messages instead of hardcoded format strings. |

## 15. Out of Scope

- Multi-device sync of countdown state.
- Server-backed enforcement.
- Cloud restore of consent record.
- Premium-gating this feature (orthogonal to monetization plan).

## 16. SESSION_ID

This plan was authored without external model collaboration (multi-plan delegation tooling unavailable in this environment). No `CODEX_SESSION` / `GEMINI_SESSION` to record. `/ccg:execute` should be invoked without session resumption.
