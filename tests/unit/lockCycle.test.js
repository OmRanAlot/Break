/**
 * Tests for components/shared/lockCycle.js — the pure JS mirror of the native
 * SettingsLockManager.computeCycle and ContentFilterGuard.getState math.
 */

import {
  deriveLockCycle,
  deriveGuardState,
  formatRemaining,
  GUARD_STATES,
} from '../../components/shared/lockCycle';

const HOUR = 60 * 60 * 1000;
const DURATION = 24 * HOUR; // default Settings Change Lock duration
const BASE = 1_780_000_000_000; // arbitrary epoch anchor
const READY = BASE + DURATION; // when the layer-off wait ends
const AUTO_ON_MS = 12 * HOUR;

describe('deriveLockCycle', () => {
  test('returns idle state when never locked (base = 0)', () => {
    const result = deriveLockCycle({
      nowMs: BASE,
      baseLockUntilMs: 0,
      durationMs: DURATION,
      graceMs: 0,
    });

    expect(result).toEqual({
      locked: false,
      lockUntilMs: 0,
      inGrace: false,
      graceEndsAtMs: 0,
    });
  });

  test('is locked until the stamped base during the first lock segment', () => {
    const result = deriveLockCycle({
      nowMs: BASE - 1,
      baseLockUntilMs: BASE,
      durationMs: DURATION,
      graceMs: 0,
    });

    expect(result.locked).toBe(true);
    expect(result.lockUntilMs).toBe(BASE);
    expect(result.inGrace).toBe(false);
  });

  test('becomes unlocked immediately once the lock expires', () => {
    const result = deriveLockCycle({
      nowMs: BASE,
      baseLockUntilMs: BASE,
      durationMs: DURATION,
      graceMs: 0,
    });

    expect(result).toEqual({
      locked: false,
      lockUntilMs: 0,
      inGrace: false,
      graceEndsAtMs: 0,
    });
  });

  test('stays unlocked forever after expiry regardless of how much time passes', () => {
    const result = deriveLockCycle({
      nowMs: BASE + 500 * HOUR,
      baseLockUntilMs: BASE,
      durationMs: DURATION,
      graceMs: 0,
    });

    expect(result).toEqual({
      locked: false,
      lockUntilMs: 0,
      inGrace: false,
      graceEndsAtMs: 0,
    });
  });

  test('ignores graceMs even when a non-zero value is passed (re-arm removed)', () => {
    const result = deriveLockCycle({
      nowMs: BASE + 1,
      baseLockUntilMs: BASE,
      durationMs: DURATION,
      graceMs: 8 * HOUR,
    });

    expect(result.locked).toBe(false);
    expect(result.inGrace).toBe(false);
    expect(result.graceEndsAtMs).toBe(0);
  });

  test('boundary: one ms before expiry is still locked', () => {
    const result = deriveLockCycle({
      nowMs: BASE - 1,
      baseLockUntilMs: BASE,
      durationMs: DURATION,
      graceMs: 0,
    });

    expect(result.locked).toBe(true);
    expect(result.lockUntilMs).toBe(BASE);
  });
});

describe('deriveGuardState', () => {
  const baseArgs = {
    doubleSafeEnabled: true,
    filterEnabled: true,
    readyAtMs: READY,
    autoOnAtMs: 0,
  };

  // ── PROTECTED ──────────────────────────────────────────────────────────────

  test('reports PROTECTED when double-safe on and no wait', () => {
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: BASE,
      readyAtMs: 0,
    });
    expect(result.state).toBe(GUARD_STATES.PROTECTED);
    expect(result.readyAtMs).toBe(0);
    expect(result.autoOnAtMs).toBe(0);
  });

  // ── GUARD_OFF ──────────────────────────────────────────────────────────────

  test('reports GUARD_OFF when double-safe is off and no wait in progress', () => {
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: BASE,
      doubleSafeEnabled: false,
      readyAtMs: 0,
    });
    expect(result.state).toBe(GUARD_STATES.GUARD_OFF);
  });

  // ── LAYER_OFF_WAIT ─────────────────────────────────────────────────────────

  test('reports LAYER_OFF_WAIT while the lock-duration wait is running', () => {
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: READY - 1,
      doubleSafeEnabled: false,
    });
    expect(result.state).toBe(GUARD_STATES.LAYER_OFF_WAIT);
    expect(result.readyAtMs).toBe(READY);
  });

  test('boundary: one ms before readyAt is still LAYER_OFF_WAIT', () => {
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: READY - 1,
      doubleSafeEnabled: false,
    });
    expect(result.state).toBe(GUARD_STATES.LAYER_OFF_WAIT);
  });

  // ── LAYER_OFF_READY ────────────────────────────────────────────────────────

  test('reports LAYER_OFF_READY the instant readyAt is reached', () => {
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: READY,
      doubleSafeEnabled: false,
    });
    expect(result.state).toBe(GUARD_STATES.LAYER_OFF_READY);
    expect(result.readyAtMs).toBe(READY);
  });

  test('remains LAYER_OFF_READY well past readyAt (no auto-expiry)', () => {
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: READY + 100 * HOUR,
      doubleSafeEnabled: false,
    });
    expect(result.state).toBe(GUARD_STATES.LAYER_OFF_READY);
  });

  // ── TEMP_OFF ───────────────────────────────────────────────────────────────

  test('reports TEMP_OFF while filter is off and auto-on timer is running', () => {
    const autoOnAt = BASE + AUTO_ON_MS;
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: autoOnAt - 1,
      filterEnabled: false,
      doubleSafeEnabled: false,
      readyAtMs: 0,
      autoOnAtMs: autoOnAt,
    });
    expect(result.state).toBe(GUARD_STATES.TEMP_OFF);
    expect(result.autoOnAtMs).toBe(autoOnAt);
  });

  test('auto-re-enables (treats filter as on) once 12h elapses in TEMP_OFF', () => {
    const autoOnAt = BASE + AUTO_ON_MS;
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: autoOnAt, // exactly at boundary
      filterEnabled: false,
      doubleSafeEnabled: false,
      readyAtMs: 0,
      autoOnAtMs: autoOnAt,
    });
    // Once elapsed, filter is treated as on; no wait pending → GUARD_OFF
    expect(result.state).toBe(GUARD_STATES.GUARD_OFF);
    expect(result.autoOnAtMs).toBe(0);
  });

  test('auto-re-enable boundary: one ms before timer is still TEMP_OFF', () => {
    const autoOnAt = BASE + AUTO_ON_MS;
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: autoOnAt - 1,
      filterEnabled: false,
      doubleSafeEnabled: false,
      readyAtMs: 0,
      autoOnAtMs: autoOnAt,
    });
    expect(result.state).toBe(GUARD_STATES.TEMP_OFF);
  });

  // ── DISABLED ───────────────────────────────────────────────────────────────

  test('reports DISABLED when filter is off and no auto-on timer', () => {
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: BASE,
      filterEnabled: false,
      autoOnAtMs: 0,
    });
    expect(result.state).toBe(GUARD_STATES.DISABLED);
  });

  // ── Double-safe on takes priority over wait timestamps ─────────────────────

  test('reports PROTECTED even if stale readyAt is non-zero when double-safe is on', () => {
    const result = deriveGuardState({
      ...baseArgs,
      nowMs: READY - 1,
      doubleSafeEnabled: true,
      readyAtMs: READY,
    });
    expect(result.state).toBe(GUARD_STATES.PROTECTED);
  });
});

describe('formatRemaining', () => {
  test('returns 0s for zero or negative input', () => {
    expect(formatRemaining(0)).toBe('0s');
    expect(formatRemaining(-5000)).toBe('0s');
  });

  test('formats seconds, minutes, hours, and days', () => {
    expect(formatRemaining(58 * 1000)).toBe('58s');
    expect(formatRemaining(45 * 60 * 1000 + 8 * 1000)).toBe('45m 8s');
    expect(formatRemaining(23 * HOUR + 12 * 60 * 1000)).toBe('23h 12m');
    expect(formatRemaining(2 * 24 * HOUR + 5 * HOUR)).toBe('2d 5h');
  });
});
