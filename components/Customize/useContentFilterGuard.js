/**
 * useContentFilterGuard
 * ---------------------
 * Drives the two-layer protection for the browser content filter.
 *
 * State machine (authoritative in native ContentFilterGuard.java; mirrored live
 * here via shared/lockCycle.deriveGuardState):
 *
 *   PROTECTED ──setDoubleSafe(false)──▶ LAYER_OFF_WAIT ──(wait ends)──▶ LAYER_OFF_READY
 *   LAYER_OFF_WAIT/READY ──setDoubleSafe(true)──▶ PROTECTED
 *   LAYER_OFF_READY ──saveContentFilterEnabled(false)──▶ TEMP_OFF
 *   TEMP_OFF ──(12h)──▶ auto-re-enabled → LAYER_OFF_READY
 *
 * The hook refreshes from native on mount/focus, ticks once a second while a
 * wait or auto-on is in progress, and re-syncs when a boundary passes.
 *
 * Logging prefix: [CFGuard]
 */

import { useCallback, useEffect, useState } from 'react';
import { NativeModules } from 'react-native';
import { deriveGuardState, GUARD_STATES } from '../shared/lockCycle';

const { SettingsModule } = NativeModules;

const EMPTY_RAW = {
  doubleSafeEnabled: false,
  filterEnabled: true,
  readyAtMs: 0,
  autoOnAtMs: 0,
};

/**
 * @param {object} [navigation] React Navigation prop (optional)
 * @returns {{
 *   state: string,
 *   doubleSafeEnabled: boolean,
 *   filterEnabled: boolean,
 *   readyAtMs: number,
 *   autoOnAtMs: number,
 *   waitRemainingMs: number,
 *   autoOnRemainingMs: number,
 *   refresh: () => void,
 *   setDoubleSafe: (v: boolean) => Promise<boolean>,
 * }}
 */
export default function useContentFilterGuard(navigation) {
  const [raw, setRaw] = useState(EMPTY_RAW);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(() => {
    try {
      SettingsModule.getContentFilterGuardState(json => {
        try {
          const parsed = JSON.parse(json || '{}');
          setRaw({
            doubleSafeEnabled: !!parsed.doubleSafeEnabled,
            filterEnabled: !!parsed.filterEnabled,
            readyAtMs: Number(parsed.readyAt) || 0,
            autoOnAtMs: Number(parsed.autoOnAt) || 0,
          });
        } catch (e) {
          console.warn('[CFGuard] parse failed:', e?.message || e);
        }
      });
    } catch (e) {
      console.warn('[CFGuard] refresh failed:', e?.message || e);
    }
  }, []);

  // Load on mount + on focus return.
  useEffect(() => {
    refresh();
    const focusUnsub = navigation?.addListener
      ? navigation.addListener('focus', refresh)
      : null;
    return () => {
      if (focusUnsub) focusUnsub();
    };
  }, [navigation, refresh]);

  // Live derivation — mirrors native math so state boundaries flip without a poll.
  const derived = deriveGuardState({
    nowMs: now,
    doubleSafeEnabled: raw.doubleSafeEnabled,
    filterEnabled: raw.filterEnabled,
    readyAtMs: raw.readyAtMs,
    autoOnAtMs: raw.autoOnAtMs,
  });

  const isLive =
    derived.state === GUARD_STATES.LAYER_OFF_WAIT ||
    derived.state === GUARD_STATES.TEMP_OFF;

  // Tick while a wait or auto-on countdown is active.
  useEffect(() => {
    if (!isLive) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  // When LAYER_OFF_READY is reached (wait ended) or LAYER_OFF_READY → GUARD_OFF
  // (auto-on elapsed while raw still has stale timestamps), re-sync from native
  // so native can lazily clear expired state.
  useEffect(() => {
    const nativeHasWait = raw.readyAtMs > 0;
    const nativeHasAutoOn = raw.autoOnAtMs > 0;
    if (
      (nativeHasWait && derived.state === GUARD_STATES.LAYER_OFF_READY) ||
      (nativeHasAutoOn && derived.state === GUARD_STATES.LAYER_OFF_READY)
    ) {
      console.log('[CFGuard] boundary reached → refreshing from native');
      refresh();
    }
  }, [derived.state, raw.readyAtMs, raw.autoOnAtMs, refresh]);

  const setDoubleSafe = useCallback(
    async value => {
      try {
        await SettingsModule.setContentFilterDoubleSafe(value);
        console.log('[CFGuard] setDoubleSafe →', value);
        return true;
      } catch (e) {
        console.warn('[CFGuard] setDoubleSafe refused:', e?.message || e);
        return false;
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  return {
    state: derived.state,
    doubleSafeEnabled: raw.doubleSafeEnabled,
    filterEnabled: raw.filterEnabled,
    readyAtMs: derived.readyAtMs,
    autoOnAtMs: derived.autoOnAtMs,
    waitRemainingMs:
      derived.state === GUARD_STATES.LAYER_OFF_WAIT
        ? Math.max(0, derived.readyAtMs - now)
        : 0,
    autoOnRemainingMs:
      derived.state === GUARD_STATES.TEMP_OFF
        ? Math.max(0, derived.autoOnAtMs - now)
        : 0,
    refresh,
    setDoubleSafe,
  };
}
