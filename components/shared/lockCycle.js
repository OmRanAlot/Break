/**
 * lockCycle.js
 * ------------
 * Pure derivation helpers for the Settings Change Lock and the Content Filter
 * double-safe guard. These MIRROR the authoritative native math
 * (SettingsLockManager.computeCycle / ContentFilterGuard.getState) so the UI can
 * tick countdowns live between native refreshes — and so the math is unit-
 * testable in Jest without an emulator.
 *
 * Keep in sync with:
 *   android/.../lock/SettingsLockManager.java (computeCycle)
 *   android/.../lock/ContentFilterGuard.java  (getState)
 *
 * All functions are pure: (inputs) → new object, no mutation, no I/O.
 */

/**
 * Guard state names — must match ContentFilterGuard.java STATE_* constants.
 *
 * GUARD_OFF        Double-safe off, no wait running, filter freely editable
 * PROTECTED        Double-safe on, filter on, no wait
 * LAYER_OFF_WAIT   Double-safe just turned off; filter on; wait in progress
 * LAYER_OFF_READY  Wait complete; filter disable now allowed
 * TEMP_OFF         Filter off; 12h auto-on timer running
 * DISABLED         Filter off; no auto-on timer
 */
export const GUARD_STATES = {
  GUARD_OFF:        'GUARD_OFF',
  PROTECTED:        'PROTECTED',
  LAYER_OFF_WAIT:   'LAYER_OFF_WAIT',
  LAYER_OFF_READY:  'LAYER_OFF_READY',
  TEMP_OFF:         'TEMP_OFF',
  DISABLED:         'DISABLED',
};

/** @deprecated Confirm window removed. Kept so old imports don't break. */
export const CF_INTERNAL_CONFIRM_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Where a scope sits in its lock at one instant.
 *
 * Locked while `nowMs < baseLockUntilMs`; unlocked forever after expiry.
 * The scope stays editable until the next real edit triggers a new lock.
 *
 * @param {{
 *   nowMs: number,
 *   baseLockUntilMs: number,  // 0 = never locked
 *   durationMs: number,       // lock segment length (unused post-expiry, kept for compat)
 *   graceMs: number,          // ignored — re-arm is removed
 * }} args
 * @returns {{ locked: boolean, lockUntilMs: number, inGrace: boolean, graceEndsAtMs: number }}
 */
export function deriveLockCycle({
  nowMs,
  baseLockUntilMs,
}) {
  if (!baseLockUntilMs || baseLockUntilMs <= 0) {
    return { locked: false, lockUntilMs: 0, inGrace: false, graceEndsAtMs: 0 };
  }
  if (nowMs < baseLockUntilMs) {
    return {
      locked: true,
      lockUntilMs: baseLockUntilMs,
      inGrace: false,
      graceEndsAtMs: 0,
    };
  }
  // Lock expired — stays unlocked until the next edit.
  return { locked: false, lockUntilMs: 0, inGrace: false, graceEndsAtMs: 0 };
}

/**
 * Live guard state from the raw timestamps the bridge returns.
 * Mirrors ContentFilterGuard.getState() — keep in sync with the native logic.
 *
 * @param {{
 *   nowMs: number,
 *   doubleSafeEnabled: boolean,
 *   filterEnabled: boolean,
 *   readyAtMs: number,   // epoch-ms when filter disable becomes allowed (0 = none)
 *   autoOnAtMs: number,  // epoch-ms for 12h auto-on (0 = none)
 * }} args
 * @returns {{
 *   state: string,       // one of GUARD_STATES
 *   readyAtMs: number,   // as passed in (0 if not applicable)
 *   autoOnAtMs: number,  // as passed in (0 if not applicable)
 * }}
 */
export function deriveGuardState({
  nowMs,
  doubleSafeEnabled,
  filterEnabled,
  readyAtMs,
  autoOnAtMs,
}) {
  // Mirror the lazy auto-reenable: if 12h has elapsed treat the filter as on.
  let effectiveFilterEnabled = filterEnabled;
  let effectiveAutoOnAtMs = autoOnAtMs || 0;
  if (!effectiveFilterEnabled && effectiveAutoOnAtMs > 0 && nowMs >= effectiveAutoOnAtMs) {
    effectiveFilterEnabled = true;
    effectiveAutoOnAtMs = 0;
  }

  if (!effectiveFilterEnabled) {
    if (effectiveAutoOnAtMs > 0) {
      return { state: GUARD_STATES.TEMP_OFF, readyAtMs: 0, autoOnAtMs: effectiveAutoOnAtMs };
    }
    return { state: GUARD_STATES.DISABLED, readyAtMs: 0, autoOnAtMs: 0 };
  }

  if (doubleSafeEnabled) {
    return { state: GUARD_STATES.PROTECTED, readyAtMs: 0, autoOnAtMs: 0 };
  }

  const effectiveReadyAt = readyAtMs || 0;
  if (effectiveReadyAt <= 0) {
    return { state: GUARD_STATES.GUARD_OFF, readyAtMs: 0, autoOnAtMs: 0 };
  }

  if (nowMs < effectiveReadyAt) {
    return { state: GUARD_STATES.LAYER_OFF_WAIT, readyAtMs: effectiveReadyAt, autoOnAtMs: 0 };
  }

  return { state: GUARD_STATES.LAYER_OFF_READY, readyAtMs: effectiveReadyAt, autoOnAtMs: 0 };
}

/**
 * Human-readable countdown, e.g. "23h 12m", "45m 8s", "58s".
 * Returns "0s" for zero/negative remainders.
 *
 * @param {number} remainingMs
 * @returns {string}
 */
export function formatRemaining(remainingMs) {
  if (!remainingMs || remainingMs <= 0) return '0s';
  const totalSec = Math.ceil(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
