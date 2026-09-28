/**
 * customize.js — Customize Screen (Break light design system)
 * ─────────────────────────────────────────────────────────────────────────────
 * Settings screen layout:
 *   • Sticky header: back button + "Customize" title
 *   • "Your Apps" section — per-app toggles (App Open Intercept, Reels Detection)
 *   • "20-Min Free Break" toggle (when Reels Detection is on)
 *   • "Scroll Budget" section — only visible when Reels Detection is on
 *   • "Intercept Message" section — text input, duration slider, preview button
 *   • Version footer
 *
 * Note: Modes management has moved to the dedicated Modes screen.
 *
 * State wired to VPNModule (monitoring, delay) and SettingsModule (redirect).
 *
 * Logging prefix: [Customize]
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ScrollView,
  NativeModules,
  Animated,
  AppState,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import useDebouncedSaver from './useDebouncedSaver';
import {
  deriveBudgetStatus,
  inferWindowStartMs,
} from '../shared/scrollBudgetStatus';
import useSettingsLock from './useSettingsLock';
import useContentFilterGuard from './useContentFilterGuard';
import SettingsLockGate from './SettingsLockGate';
import SettingsLockSection from './SettingsLockSection';
import InfoCircle from '../shared/InfoCircle';
import { formatRemaining, GUARD_STATES } from '../shared/lockCycle';
import ScrollBudgetSection from './ScrollBudgetSection';
import DeletionInfoModal from './DeletionInfoModal';
import DeletionDisablePauseModal from './DeletionDisablePauseModal';
import ContentFilterDoubleSafeModal from './ContentFilterDoubleSafeModal';
import ContentFilterBothLayersModal from './ContentFilterBothLayersModal';
import { styles, L } from './customize.styles';

// Debounce window for Customize writes. Rapid toggles coalesce into a single
// commit after this quiet period; any navigate-away / background / unmount
// forces an immediate flush so no writes are ever dropped.
const SAVE_DEBOUNCE_MS = 7000;

const { VPNModule, SettingsModule } = NativeModules;

// ─── Icons ───────────────────────────────────────────────────────────────────

const BackIcon = ({ color, size }) => (
  <Svg
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
  >
    <Path d="M15 19l-7-7 7-7" />
  </Svg>
);

// ─── Main Component ──────────────────────────────────────────────────────────
const Customize = ({ navigation }) => {
  const insets = useSafeAreaInsets();

  // Settings on this screen (scroll budget, browser safety, deletion prevention,
  // settings-lock) are GLOBAL and shared across modes — there is no mode gate.
  // Per-app blocking and forced-pause live in AppDetail and edit the active mode.

  // ── Browser content filter state ─────────────────────────────────────────
  const [contentFilterEnabled, setContentFilterEnabled] = useState(false);
  const [accessibilityServiceActive, setAccessibilityServiceActive] =
    useState(false);

  // ── Deletion-prevention (uninstall lock) state ───────────────────────────
  // Opt-in. When on, a 60s lock screen appears if the user opens the Break
  // uninstall screen in Android Settings.
  const [uninstallLockEnabled, setUninstallLockEnabled] = useState(false);
  // Confirmation modal shown before enabling deletion prevention, so the user
  // reads what it does, its limitations, and the privacy guarantee first.
  const [deletionInfoVisible, setDeletionInfoVisible] = useState(false);
  // Pause modal shown before turning deletion prevention OFF. It requires a
  // continuous five-minute foreground countdown before confirm is enabled.
  const [deletionDisablePauseVisible, setDeletionDisablePauseVisible] =
    useState(false);

  // ── Scroll budget state ───────────────────────────────────────────────────
  const [scrollAllowance, setScrollAllowance] = useState(5);
  const [scrollWindow, setScrollWindow] = useState(60);
  const [budgetStatus, setBudgetStatus] = useState(null);

  // ── "Saved" toast ─────────────────────────────────────────────────────────
  // Two states:
  //   - "Saving…"   — shown while a debounced write is pending (opacity held at 1)
  //   - "✓ Saved"   — shown once a commit lands (fades in then out)
  const savedOpacity = useRef(new Animated.Value(0)).current;
  const savedTimer = useRef(null);
  const [savedLabel, setSavedLabel] = useState('✓  Saved');

  // Settings Change Lock for the GLOBAL scope. Any edit on this screen marks the
  // scope dirty; leaving the screen (blur/background/unmount) then starts the lock
  // if the feature is enabled. See useSettingsLock.
  const settingsLock = useSettingsLock('global', navigation);
  const { markDirty: markSettingsDirty } = settingsLock;

  // Content-filter double-safe guard: two-layer protection for the browser
  // content filter. See useContentFilterGuard / ContentFilterGuard.java.
  const cfGuard = useContentFilterGuard(navigation);
  // Modal shown before enabling Double-safe (explains the two-step commitment).
  const [cfDoubleSafeModalVisible, setCfDoubleSafeModalVisible] = useState(false);
  // Modal shown when the user taps content filter OFF while Double-safe is on.
  const [cfBothLayersModalVisible, setCfBothLayersModalVisible] = useState(false);

  // Called every time the user taps a toggle that gets scheduled.
  // Keeps the pill visible ("Saving…") until the commit fires.
  const showSavedPending = useCallback(() => {
    if (savedTimer.current) {
      clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
    setSavedLabel('Saving…');
    savedOpacity.setValue(1);
    markSettingsDirty();
  }, [savedOpacity, markSettingsDirty]);

  // Called by the saver's onCommit hook after pending writes flush to native.
  // Flips the label to "✓ Saved" and runs the fade-out animation.
  const showSavedCommitted = useCallback(() => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedLabel('✓  Saved');
    Animated.timing(savedOpacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
    savedTimer.current = setTimeout(() => {
      Animated.timing(savedOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }, 1800);
    markSettingsDirty();
  }, [savedOpacity, markSettingsDirty]);

  // Legacy alias: immediate writes (e.g. scroll budget buttons, preview message)
  // that don't go through the debounced saver still use the one-shot pill.
  const showSaved = showSavedCommitted;

  // Debounced saver — coalesces rapid toggles and commits after SAVE_DEBOUNCE_MS.
  // Flushed on navigation blur, AppState→background, and unmount (see effects below).
  const saver = useDebouncedSaver(SAVE_DEBOUNCE_MS, {
    onCommit: showSavedCommitted,
  });

  // Flush any pending writes when the user navigates away or backgrounds the app.
  useEffect(() => {
    const blurUnsub = navigation?.addListener
      ? navigation.addListener('blur', () => {
          console.log('[Customize] blur → flushing saver');
          saver.flush();
        })
      : null;
    const appStateSub = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        console.log('[Customize] AppState=' + next + ' → flushing saver');
        saver.flush();
      }
    });
    return () => {
      if (blurUnsub) blurUnsub();
      appStateSub.remove();
    };
  }, [navigation, saver]);

  // ── Load saved settings ───────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    console.log('[Customize] loading saved settings');
    try {
      // Load scroll budget
      await new Promise(resolve => {
        SettingsModule.getScrollBudget((allowance, window) => {
          setScrollAllowance(allowance);
          setScrollWindow(window);
          // Re-push the saved budget to the live monitor so it matches what we
          // just read back. Scroll budget is global, so this always runs.
          VPNModule.setScrollBudget(allowance, window).catch(e =>
            console.warn('[Customize] setScrollBudget failed:', e),
          );
          resolve();
        });
      });
      console.log('[Customize] scroll budget loaded');

      // Load content filter state
      SettingsModule.getContentFilterEnabled(enabled => {
        setContentFilterEnabled(enabled);
        console.log('[Customize] content_filter_enabled=', enabled);
      });
      SettingsModule.isContentFilterServiceEnabled(active => {
        setAccessibilityServiceActive(active);
        console.log('[Customize] accessibility_service_active=', active);
      });

      // Load deletion-prevention state
      SettingsModule.getUninstallLockEnabled(enabled => {
        setUninstallLockEnabled(enabled);
        console.log('[Customize] uninstall_lock_enabled=', enabled);
      });
    } catch (e) {
      console.warn('[Customize] load settings error:', e);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Reload when screen regains focus (e.g. returning from AppDetail / Modes)
  useEffect(() => {
    const focusUnsub = navigation?.addListener
      ? navigation.addListener('focus', () => {
          console.log('[Customize] focus → reloading settings');
          loadSettings();
        })
      : null;
    return () => {
      if (focusUnsub) focusUnsub();
    };
  }, [navigation, loadSettings]);

  // ── Scroll budget handlers ────────────────────────────────────────────────

  const adjustAllowance = useCallback(
    delta => {
      const next = Math.max(0, Math.min(15, scrollAllowance + delta));
      setScrollAllowance(next);

      // Optimistic UI: immediately derive the new status from current runtime
      // data so the display updates before the native poll resolves.
      setBudgetStatus(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          allowanceMinutes: next,
          ...deriveBudgetStatus({
            allowanceMinutes: next,
            windowMinutes: scrollWindow,
            usedMs: prev.usedMs,
            windowStartMs: inferWindowStartMs(prev),
            exhaustedAtMs: prev.canScroll
              ? 0
              : prev.nextScrollAtMs - scrollWindow * 60_000,
          }),
        };
      });

      // Fire native update in the background — no await so the UI doesn't block.
      VPNModule.setScrollBudget(next, scrollWindow)
        .then(() => VPNModule.getScrollBudgetStatus().then(setBudgetStatus))
        .catch(e => console.warn('[Customize] setScrollBudget failed:', e));
      SettingsModule.saveScrollBudget(next, scrollWindow);
      console.log('[Customize] scroll allowance →', next);
      showSaved();
    },
    [scrollAllowance, scrollWindow, showSaved],
  );

  const adjustWindow = useCallback(
    delta => {
      const next = Math.max(45, Math.min(240, scrollWindow + delta));
      setScrollWindow(next);

      setBudgetStatus(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          windowMinutes: next,
          ...deriveBudgetStatus({
            allowanceMinutes: scrollAllowance,
            windowMinutes: next,
            usedMs: prev.usedMs,
            windowStartMs: inferWindowStartMs(prev),
            exhaustedAtMs: prev.canScroll
              ? 0
              : prev.nextScrollAtMs - next * 60_000,
          }),
        };
      });

      VPNModule.setScrollBudget(scrollAllowance, next)
        .then(() => VPNModule.getScrollBudgetStatus().then(setBudgetStatus))
        .catch(e => console.warn('[Customize] setScrollBudget failed:', e));
      SettingsModule.saveScrollBudget(scrollAllowance, next);
      console.log('[Customize] scroll window →', next);
      showSaved();
    },
    [scrollAllowance, scrollWindow, showSaved],
  );

  // Scroll budget polling (every 5s)
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await VPNModule.getScrollBudgetStatus();
        setBudgetStatus(status);
      } catch (e) {
        console.warn('[Customize] getScrollBudgetStatus failed:', e);
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Content filter handler ────────────────────────────────────────────────

  const handleContentFilterToggle = useCallback(
    async value => {
      if (!value && cfGuard.doubleSafeEnabled) {
        // Double-safe is still on — can't remove both layers at once.
        console.log('[Customize] content_filter disable blocked — showing both-layers modal');
        setCfBothLayersModalVisible(true);
        return;
      }
      setContentFilterEnabled(value);
      console.log('[Customize] content_filter toggled →', value);
      try {
        await SettingsModule.saveContentFilterEnabled(value);
        showSaved();
        cfGuard.refresh();
        if (value) {
          SettingsModule.isContentFilterServiceEnabled(active => {
            setAccessibilityServiceActive(active);
          });
        }
      } catch (e) {
        console.warn('[Customize] saveContentFilterEnabled error:', e);
        // Native refused (e.g. still in LAYER_OFF_WAIT) — revert optimistic update.
        cfGuard.refresh();
        setContentFilterEnabled(cfGuard.filterEnabled);
      }
    },
    [showSaved, cfGuard],
  );

  // Turning Double-safe ON: open info modal first so the user understands the
  // two-step commitment before the feature activates.
  // Turning Double-safe OFF: immediately starts the lock-duration wait natively;
  // no extra confirmation needed (native handles the guard).
  const handleDoubleSafeToggle = useCallback(
    async value => {
      if (value) {
        console.log('[Customize] cf double-safe enable requested — showing info modal');
        setCfDoubleSafeModalVisible(true);
        return;
      }
      console.log('[Customize] cf double-safe toggled → false');
      const ok = await cfGuard.setDoubleSafe(false);
      if (ok) showSaved();
    },
    [cfGuard, showSaved],
  );

  const handleCfDoubleSafeConfirm = useCallback(async () => {
    console.log('[Customize] cf double-safe modal confirmed — enabling');
    setCfDoubleSafeModalVisible(false);
    const ok = await cfGuard.setDoubleSafe(true);
    if (ok) showSaved();
  }, [cfGuard, showSaved]);

  const handleCfDoubleSafeCancel = useCallback(() => {
    console.log('[Customize] cf double-safe modal cancelled');
    setCfDoubleSafeModalVisible(false);
  }, []);

  // Persist the deletion-prevention flag. Extracted so both the confirm-modal
  // "Enable" action and the direct "turn off" path share one write.
  const saveUninstallLock = useCallback(
    async value => {
      setUninstallLockEnabled(value);
      console.log('[Customize] uninstall_lock toggled →', value);
      try {
        await SettingsModule.saveUninstallLockEnabled(value);
        showSaved();
      } catch (e) {
        console.warn('[Customize] saveUninstallLockEnabled error:', e);
      }
    },
    [showSaved],
  );

  const handleUninstallLockToggle = useCallback(
    value => {
      // Turning on requires reading the info modal first.
      // Turning off opens a five-minute foreground pause — no direct disable.
      if (value) {
        console.log(
          '[Customize] uninstall_lock enable requested — showing info',
        );
        setDeletionInfoVisible(true);
        return;
      }
      console.log(
        '[Customize] uninstall_lock disable requested — showing pause',
      );
      setDeletionDisablePauseVisible(true);
    },
    [],
  );

  const handleDeletionInfoConfirm = useCallback(() => {
    console.log('[Customize] deletion-prevention info confirmed — enabling');
    setDeletionInfoVisible(false);
    saveUninstallLock(true);
  }, [saveUninstallLock]);

  const handleDeletionInfoCancel = useCallback(() => {
    console.log('[Customize] deletion-prevention info cancelled');
    setDeletionInfoVisible(false);
  }, []);

  const handleDeletionDisablePauseConfirm = useCallback(() => {
    console.log(
      '[Customize] deletion-prevention disable confirmed after 5-minute pause',
    );
    setDeletionDisablePauseVisible(false);
    saveUninstallLock(false);
  }, [saveUninstallLock]);

  const handleDeletionDisablePauseCancel = useCallback(() => {
    console.log('[Customize] deletion-prevention disable cancelled — keeping on');
    setDeletionDisablePauseVisible(false);
  }, []);

  // Human-readable Settings Change Lock duration for modal copy.
  const lockDurationLabel = (() => {
    const h = Math.round((settingsLock.durationMs || 0) / (60 * 60 * 1000)) || 24;
    if (h < 48) return `${h}h`;
    if (h < 168) return `${Math.round(h / 24)}d`;
    return '1wk';
  })();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 0) }]}>
      {/* ── Sticky header ───────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => {
            console.log('[Customize] back tapped');
            navigation.goBack();
          }}
        >
          <BackIcon color={L.charcoal} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Customize</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Settings Change Lock: read-only gate while the global scope is locked ── */}
        {settingsLock.locked ? (
          <SettingsLockGate remainingMs={settingsLock.remainingMs} />
        ) : (
          <>
            <ScrollBudgetSection
              scrollAllowance={scrollAllowance}
              scrollWindow={scrollWindow}
              budgetStatus={budgetStatus}
              adjustAllowance={adjustAllowance}
              adjustWindow={adjustWindow}
            />

            {/* <InterceptMessageSection
              interceptMessage={interceptMessage}
              setInterceptMessage={setInterceptMessage}
              handleMessageSubmit={handleMessageSubmit}
              sliderValue={sliderValue}
              pauseDuration={pauseDuration}
              handleSliderChange={handleSliderChange}
              handleSliderComplete={handleSliderComplete}
              onPreview={() => {
                console.log('[Customize] showing preview interstitial');
                setPreviewVisible(true);
              }}
            /> */}
            {/* ── Browser Content Filter ───────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Browser Safety</Text>

              {/* Content filter switch — grayed out during LAYER_OFF_WAIT */}
              <View
                style={[
                  styles.toggleRow,
                  cfGuard.state === GUARD_STATES.LAYER_OFF_WAIT && { opacity: 0.45 },
                ]}
              >
                <View style={styles.toggleLabelGroup}>
                  <Text style={styles.toggleLabel}>Content filter</Text>
                  {cfGuard.state === GUARD_STATES.LAYER_OFF_WAIT ? (
                    <Text style={styles.toggleCaption}>
                      Locked — available in{' '}
                      {formatRemaining(cfGuard.waitRemainingMs)} (Settings
                      Change Lock wait is running).
                    </Text>
                  ) : cfGuard.state === GUARD_STATES.TEMP_OFF ? (
                    <Text style={styles.toggleCaption}>
                      Off for now — turns back on automatically in{' '}
                      {formatRemaining(cfGuard.autoOnRemainingMs)}.
                    </Text>
                  ) : (
                    <Text style={styles.toggleCaption}>
                      Blocks listed domains in Chrome and other browsers.
                      Requires the Break accessibility service (one toggle in
                      system settings).
                    </Text>
                  )}
                </View>
                <Switch
                  value={contentFilterEnabled}
                  onValueChange={handleContentFilterToggle}
                  disabled={cfGuard.state === GUARD_STATES.LAYER_OFF_WAIT}
                  trackColor={{ false: L.border, true: L.charcoal }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Browser content filter"
                />
              </View>

              {/* Double-safe: two-layer protection for the content filter. */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <View style={styles.labelWithInfo}>
                    <Text style={styles.toggleLabel}>Double-safe</Text>
                    <InfoCircle title="How Double-safe works">
                      <Text style={styles.infoPara}>
                        With Double-safe on, you can't turn the content filter
                        off in one tap. There are two separate steps with a
                        built-in wait between them.
                      </Text>
                      <Text style={styles.infoPara}>
                        Step 1 — turn Double-safe off. The content filter stays
                        fully on while a wait equal to your Settings Change Lock
                        duration ({lockDurationLabel}) runs. The filter switch
                        is grayed out for the entire wait.
                      </Text>
                      <Text style={styles.infoPara}>
                        Step 2 — once the wait ends, turn the content filter
                        off. It stays off for 12 hours, then re-enables itself
                        automatically.
                      </Text>
                      <Text style={styles.infoPara}>
                        You cannot remove both layers in the same session — the
                        waits must happen in sequence.
                      </Text>
                    </InfoCircle>
                  </View>
                  <Text style={styles.toggleCaption}>
                    Turning the filter off requires a {lockDurationLabel} wait,
                    then the filter auto-restores after 12 hours.
                  </Text>
                </View>
                <Switch
                  value={cfGuard.doubleSafeEnabled}
                  onValueChange={handleDoubleSafeToggle}
                  trackColor={{ false: L.border, true: L.charcoal }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Double-safe for content filter"
                />
              </View>

              {contentFilterEnabled && !accessibilityServiceActive && (
                <TouchableOpacity
                  style={styles.permissionHint}
                  activeOpacity={0.75}
                  onPress={() => {
                    console.log(
                      '[Customize] opening accessibility settings for unified service',
                    );
                    Linking.sendIntent(
                      'android.settings.ACCESSIBILITY_SETTINGS',
                    ).catch(e =>
                      console.warn('[Customize] openSettings error:', e),
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Grant accessibility permission for Break"
                >
                  <Text style={styles.permissionHintText}>
                    ⚠ Enable the Break accessibility service — tap to open
                    Accessibility Settings
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Settings Change Lock (opt-in) ─────────────────────────
                Lives INSIDE the gate so that once the global scope is locked
                the toggle itself is read-only — you can't simply disable the
                feature to bypass the wait. Enabling it (or changing its
                duration) marks the scope dirty, so leaving the screen arms the
                lock the same way any other change does. */}
            <SettingsLockSection
              enabled={settingsLock.enabled}
              durationMs={settingsLock.durationMs}
              locked={settingsLock.anyLocked}
              onToggle={value => {
                settingsLock.setEnabled(value);
                // Turning it ON (or keeping it on) commits the global scope so
                // it locks on exit. Turning OFF never arms a lock.
                if (value) markSettingsDirty();
              }}
              onPickDuration={hours => {
                settingsLock.setDurationHours(hours);
                markSettingsDirty();
              }}
            />
          </>
        )}

        {/* ── Content-filter guard status ───────────────────────────
            Rendered OUTSIDE the SettingsLockGate: if the global scope re-locks
            while a wait is running the user must still see countdowns. No
            actions are needed here — all interactions live on the switches. */}
        {cfGuard.state === GUARD_STATES.LAYER_OFF_WAIT && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Browser Safety — Wait Running</Text>
            <Text style={styles.guardStatusText}>
              Double-safe is off. The content filter stays on while your
              Settings Change Lock duration runs. Filter available in{' '}
              <Text style={styles.guardStatusStrong}>
                {formatRemaining(cfGuard.waitRemainingMs)}
              </Text>
              .
            </Text>
          </View>
        )}

        {cfGuard.state === GUARD_STATES.LAYER_OFF_READY && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Browser Safety — Ready</Text>
            <Text style={styles.guardStatusText}>
              The wait is done. You can now turn the content filter off. It
              will stay off for 12 hours, then turn itself back on.
            </Text>
          </View>
        )}

        {cfGuard.state === GUARD_STATES.TEMP_OFF && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Browser Safety — Temporarily Off</Text>
            <Text style={styles.guardStatusWarn}>
              Content filter is off. It turns back on automatically in{' '}
              <Text style={styles.guardStatusStrong}>
                {formatRemaining(cfGuard.autoOnRemainingMs)}
              </Text>
              . You can re-enable it earlier using the switch above.
            </Text>
          </View>
        )}

        {/* ── Deletion Prevention ──────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Deletion Prevention</Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelGroup}>
              <Text style={styles.toggleLabel}>Prevent deletion</Text>
              <Text style={styles.toggleCaption}>
                If you open the Break uninstall screen, a full-screen pause
                appears for 60 seconds with reasons to keep going before you can
                continue. Helps you not quit on impulse.
              </Text>
            </View>
            <Switch
              value={uninstallLockEnabled}
              onValueChange={handleUninstallLockToggle}
              disabled={deletionDisablePauseVisible}
              trackColor={{ false: L.border, true: L.charcoal }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Prevent deletion"
            />
          </View>
        </View>

        <Text style={styles.footer}>v1.0 • Minimal Design</Text>
      </ScrollView>

      {/* ── Saved toast ──────────────────────────────────────────────── */}
      <Animated.View
        style={[styles.savedToast, { opacity: savedOpacity }]}
        pointerEvents="none"
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.savedToastText}>{savedLabel}</Text>
      </Animated.View>

      {/* ── Content-filter Double-safe enable modal ─────────────────── */}
      <ContentFilterDoubleSafeModal
        visible={cfDoubleSafeModalVisible}
        lockDurationLabel={lockDurationLabel}
        onCancel={handleCfDoubleSafeCancel}
        onConfirm={handleCfDoubleSafeConfirm}
      />

      {/* ── Content-filter both-layers-at-once modal ─────────────────── */}
      <ContentFilterBothLayersModal
        visible={cfBothLayersModalVisible}
        lockDurationLabel={lockDurationLabel}
        onDismiss={() => setCfBothLayersModalVisible(false)}
      />

      {/* ── Deletion-prevention info modal ───────────────────────────── */}
      <DeletionInfoModal
        visible={deletionInfoVisible}
        onCancel={handleDeletionInfoCancel}
        onConfirm={handleDeletionInfoConfirm}
      />

      {/* ── Deletion-prevention disable pause (5-minute foreground wait) ── */}
      <DeletionDisablePauseModal
        visible={deletionDisablePauseVisible}
        onCancel={handleDeletionDisablePauseCancel}
        onConfirm={handleDeletionDisablePauseConfirm}
      />
    </View>
  );
};

export default Customize;
