/**
 * DeletionPhraseSection.js
 * ─────────────────────────────────────────────────────────────────────────────
 * "Require phrase to delete" controls shown under Deletion Prevention.
 *
 * The phrase is NOT a password — it is a sentence the user chooses and must
 * type out (visibly) after the 60s pause before the uninstall can continue.
 *
 * Rules:
 *   - Toggle is disabled unless Deletion Prevention itself is on.
 *   - Enabling requires a non-blank phrase (error shown inline, never silent).
 *   - Turning it OFF is gated natively: first tap starts a 1-hour wait, then a
 *     15-minute window opens in which it can be turned off. If the window is
 *     missed, the safeguard stays on and the next attempt restarts the wait.
 *   - While the requirement is on, CHANGING the phrase uses the same 1-hour
 *     wait + 15-minute window. Inside the window, you must also type your
 *     current phrase before the new one saves.
 *   - JS validation is UX only; SettingsModule re-validates natively.
 *   - Neither phrase value is EVER logged.
 *
 * Logging prefix: [DeletionPhrase]  (state transitions only — no values)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Switch,
  TextInput,
  TouchableOpacity,
  Modal,
  NativeModules,
  StyleSheet,
} from 'react-native';
import { L, styles } from './customize.styles';

const { SettingsModule } = NativeModules;

const BLANK_ERROR = 'Enter a phrase before turning this on.';
const SAVE_ERROR = 'Could not save. Please try again.';
const WRONG_CURRENT_ERROR = 'That isn\u2019t your current phrase.';
const CHANGE_CLOSED_ERROR = 'The change window closed. Tap \u201cChange phrase\u201d to start again.';
const SAME_ERROR = 'That\u2019s already your phrase.';

/** Trim outer whitespace — mirrors the native UninstallPhrase contract. */
export const normalizePhrase = raw => (raw == null ? '' : String(raw).trim());

/** "3:45 PM" style clock time for modal copy. */
export const formatClock = ms =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const DeletionPhraseSection = ({
  parentEnabled,
  enabled,
  savedPhrase,
  onSaved,
}) => {
  // Draft is what the user is typing for a new phrase.
  const [draft, setDraft] = useState(savedPhrase || '');
  // currentDraft is typed while the change window is open (must match stored phrase).
  const [currentDraft, setCurrentDraft] = useState('');
  const [error, setError] = useState('');

  // Disable-gate: { state: 'none'|'waiting'|'ready', readyAt, expiresAt }
  const [gate, setGate] = useState(null);
  // Change-gate: same shape.
  const [changeGate, setChangeGate] = useState(null);

  // Re-sync the draft when Customize reloads native state (mount / focus).
  useEffect(() => {
    setDraft(savedPhrase || '');
    setError('');
  }, [savedPhrase]);

  // Load any in-progress change request on mount so a wait started earlier
  // shows correctly after reopening Customize.
  useEffect(() => {
    if (!enabled) return;
    SettingsModule.getUninstallPhraseChangeStatus()
      .then(status => {
        if (status && status.state !== 'none') {
          setChangeGate(status);
        }
      })
      .catch(() => {});
  }, [enabled]);

  // ── Enable flow (phrase requirement is off) ──────────────────────────────

  const persistPhrase = useCallback(async () => {
    const phrase = normalizePhrase(draft);
    if (!phrase) {
      setError(BLANK_ERROR);
      return false;
    }
    try {
      await SettingsModule.saveUninstallPhrase(phrase);
      return phrase;
    } catch (e) {
      console.warn('[DeletionPhrase] save phrase failed');
      setError(SAVE_ERROR);
      return false;
    }
  }, [draft]);

  const handleToggle = useCallback(
    async value => {
      if (!value) {
        // No direct off: ask native to start (or report) the gated disable.
        console.log('[DeletionPhrase] disable requested');
        try {
          setGate(await SettingsModule.requestUninstallPhraseDisable());
        } catch (e) {
          console.warn('[DeletionPhrase] disable request failed');
          setError(SAVE_ERROR);
        }
        return;
      }
      console.log('[DeletionPhrase] enable requested');
      const phrase = await persistPhrase();
      if (!phrase) return;
      try {
        await SettingsModule.enableUninstallPhrase();
        setError('');
        onSaved(true, phrase);
      } catch (e) {
        console.warn('[DeletionPhrase] enable failed');
        setError(BLANK_ERROR);
      }
    },
    [persistPhrase, onSaved],
  );

  const handleConfirmDisable = useCallback(async () => {
    try {
      await SettingsModule.confirmUninstallPhraseDisable();
      console.log('[DeletionPhrase] disabled after wait');
      setGate(null);
      onSaved(false, savedPhrase);
    } catch (e) {
      // Window closed between render and tap — refresh the status instead.
      console.warn('[DeletionPhrase] confirm rejected');
      try {
        setGate(await SettingsModule.getUninstallPhraseDisableStatus());
      } catch (_) {
        setGate(null);
      }
    }
  }, [onSaved, savedPhrase]);

  // ── Save (requirement off) ───────────────────────────────────────────────

  const handleSavePhrase = useCallback(async () => {
    console.log('[DeletionPhrase] save phrase requested');
    const phrase = await persistPhrase();
    if (!phrase) return;
    setError('');
    onSaved(enabled, phrase);
  }, [persistPhrase, onSaved, enabled]);

  // ── Change flow (requirement is on) ─────────────────────────────────────

  const handleRequestChange = useCallback(async () => {
    console.log('[DeletionPhrase] change requested');
    try {
      const status = await SettingsModule.requestUninstallPhraseChange();
      setChangeGate(status);
    } catch (e) {
      console.warn('[DeletionPhrase] change request failed');
      setError(SAVE_ERROR);
    }
  }, []);

  const handleSaveChange = useCallback(async () => {
    console.log('[DeletionPhrase] save change requested');
    const newPhrase = normalizePhrase(draft);
    if (!newPhrase) {
      setError(BLANK_ERROR);
      return;
    }
    try {
      await SettingsModule.changeUninstallPhrase(currentDraft, newPhrase);
      console.log('[DeletionPhrase] phrase changed');
      setChangeGate(null);
      setCurrentDraft('');
      setError('');
      onSaved(enabled, newPhrase);
    } catch (e) {
      const code = e && e.code;
      console.warn('[DeletionPhrase] change failed code=' + code);
      if (code === 'WRONG_CURRENT') {
        setError(WRONG_CURRENT_ERROR);
      } else if (code === 'NOT_READY') {
        setError(CHANGE_CLOSED_ERROR);
        // Refresh so the "waiting" state re-appears.
        try {
          setChangeGate(await SettingsModule.getUninstallPhraseChangeStatus());
        } catch (_) {
          setChangeGate(null);
        }
      } else if (code === 'SAME') {
        setError(SAME_ERROR);
      } else {
        setError(BLANK_ERROR);
      }
    }
  }, [currentDraft, draft, enabled, onSaved]);

  const changeGateState = changeGate && changeGate.state;
  const changeModalVisible =
    changeGateState === 'waiting' || changeGateState === 'ready';
  // The phrase field is editable when: requirement is off, OR the change window is open.
  const phraseEditable = !enabled || changeGateState === 'ready';

  const dirty = normalizePhrase(draft) !== normalizePhrase(savedPhrase);
  const gateState = gate && gate.state;
  const disableModalVisible = gateState === 'waiting' || gateState === 'ready';

  return (
    <View>
      <View style={styles.toggleRow}>
        <View style={styles.toggleLabelGroup}>
          <Text style={styles.toggleLabel}>Require phrase to delete</Text>
          <Text style={styles.toggleCaption}>
            After the 60-second pause you must also type out your phrase
            exactly (case-sensitive) before you can continue. Turning it off
            or changing the phrase each takes a 1-hour wait. Stored only on
            this device.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={!parentEnabled}
          trackColor={{ false: L.border, true: L.charcoal }}
          thumbColor="#FFFFFF"
          accessibilityLabel="Require phrase to delete"
        />
      </View>

      {parentEnabled && (
        <View style={styles.phraseBlock}>
          {/* Current-phrase field — only shown while the change window is open */}
          {enabled && changeGateState === 'ready' && (
            <TextInput
              style={[localStyles.currentPhraseInput, !!error && styles.phraseInputError]}
              value={currentDraft}
              onChangeText={text => {
                setCurrentDraft(text);
                if (error) setError('');
              }}
              placeholder="Type your current phrase"
              placeholderTextColor={L.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              accessibilityLabel="Current deletion phrase"
            />
          )}

          {/* New-phrase field (or read-only view when locked) */}
          <TextInput
            style={[
              styles.phraseInput,
              !!error && styles.phraseInputError,
              !phraseEditable && localStyles.phraseInputLocked,
              enabled && changeGateState === 'ready' && localStyles.newPhraseTopGap,
            ]}
            value={draft}
            editable={phraseEditable}
            onChangeText={text => {
              setDraft(text);
              if (error) setError('');
            }}
            placeholder={
              enabled && changeGateState === 'ready'
                ? 'Type your new phrase'
                : 'Type the phrase you must enter to delete'
            }
            placeholderTextColor={L.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            accessibilityLabel="Deletion phrase"
          />

          {!!error && (
            <Text style={styles.phraseErrorText} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}

          {/* Save / Change buttons */}
          {enabled && changeGateState !== 'ready' && (
            <TouchableOpacity
              style={[styles.phraseSaveBtn, localStyles.changeBtn]}
              onPress={handleRequestChange}
              accessibilityRole="button"
              accessibilityLabel="Change phrase"
            >
              <Text style={styles.phraseSaveBtnText}>Change phrase</Text>
            </TouchableOpacity>
          )}

          {enabled && changeGateState === 'ready' && dirty && (
            <TouchableOpacity
              style={styles.phraseSaveBtn}
              onPress={handleSaveChange}
              accessibilityRole="button"
              accessibilityLabel="Save new phrase"
            >
              <Text style={styles.phraseSaveBtnText}>Save new phrase</Text>
            </TouchableOpacity>
          )}

          {!enabled && dirty && (
            <TouchableOpacity
              style={styles.phraseSaveBtn}
              onPress={handleSavePhrase}
              accessibilityRole="button"
              accessibilityLabel="Save phrase"
            >
              <Text style={styles.phraseSaveBtnText}>Save phrase</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Gated-disable popup: wait info, or the 15-minute turn-off window. */}
      <Modal
        visible={disableModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGate(null)}
      >
        <View style={styles.infoModalOverlay}>
          <View style={styles.infoModalCard}>
            <Text style={styles.infoModalTitle}>
              {gateState === 'ready' ? 'You can turn this off now' : 'Please wait'}
            </Text>
            {gateState === 'waiting' && (
              <Text style={styles.infoModalPrivacy}>
                You must wait until {formatClock(gate.readyAt)} (1 hour) before
                you can turn this off. Come back then — you will have a 15
                minute window ({formatClock(gate.readyAt)}–
                {formatClock(gate.expiresAt)}). If you miss it, the phrase
                requirement stays on and the 1-hour wait starts over.
              </Text>
            )}
            {gateState === 'ready' && (
              <Text style={styles.infoModalPrivacy}>
                Turn it off before {formatClock(gate.expiresAt)}, or the phrase
                requirement stays on and you will need to wait another hour.
              </Text>
            )}
            <View style={styles.infoModalButtonRow}>
              <TouchableOpacity
                style={styles.infoModalCancelButton}
                onPress={() => setGate(null)}
                accessibilityRole="button"
              >
                <Text style={styles.infoModalCancelText}>
                  {gateState === 'ready' ? 'Keep on' : 'OK'}
                </Text>
              </TouchableOpacity>
              {gateState === 'ready' && (
                <TouchableOpacity
                  style={styles.infoModalEnableButton}
                  onPress={handleConfirmDisable}
                  accessibilityRole="button"
                  accessibilityLabel="Turn off phrase requirement"
                >
                  <Text style={styles.infoModalEnableText}>Turn off</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Gated-change popup: wait info, or the 15-minute change window. */}
      <Modal
        visible={changeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setChangeGate(null)}
      >
        <View style={styles.infoModalOverlay}>
          <View style={styles.infoModalCard}>
            <Text style={styles.infoModalTitle}>
              {changeGateState === 'ready' ? 'Change window open' : 'Please wait'}
            </Text>
            {changeGateState === 'waiting' && (
              <Text style={styles.infoModalPrivacy}>
                You must wait until {formatClock(changeGate.readyAt)} (1 hour)
                before you can change your phrase. Come back then — you will
                have a 15-minute window (
                {formatClock(changeGate.readyAt)}–
                {formatClock(changeGate.expiresAt)}). If you miss it, the
                phrase stays as-is and the next attempt starts a fresh hour.
              </Text>
            )}
            {changeGateState === 'ready' && (
              <Text style={styles.infoModalPrivacy}>
                The 15-minute window is now open. Type your current phrase and
                your new phrase below, then tap Save. The window closes at{' '}
                {formatClock(changeGate.expiresAt)}.
              </Text>
            )}
            <View style={styles.infoModalButtonRow}>
              <TouchableOpacity
                style={styles.infoModalCancelButton}
                onPress={() => setChangeGate(null)}
                accessibilityRole="button"
              >
                <Text style={styles.infoModalCancelText}>
                  {changeGateState === 'ready' ? 'Later' : 'OK'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const localStyles = StyleSheet.create({
  phraseInputLocked: {
    opacity: 0.5,
  },
  currentPhraseInput: {
    borderWidth: 1,
    borderColor: L.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: L.charcoal,
    marginBottom: 8,
  },
  newPhraseTopGap: {
    marginTop: 0,
  },
  changeBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: L.charcoal,
  },
});

export default DeletionPhraseSection;
