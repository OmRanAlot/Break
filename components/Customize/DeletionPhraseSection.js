/**
 * DeletionPhraseSection.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * "Require phrase to delete" controls shown under Deletion Prevention.
 *
 * The phrase is NOT a password â€” it is a sentence the user chooses and must
 * type out (visibly) after the 60s pause before the uninstall can continue.
 *
 * Rules:
 *   - Toggle is disabled unless Deletion Prevention itself is on.
 *   - Enabling requires a non-blank phrase (error shown inline, never silent).
 *   - Turning it OFF is gated natively: first tap starts a 1-hour wait, then a
 *     15-minute window opens in which it can be turned off. If the window is
 *     missed, the safeguard stays on and the next attempt restarts the wait.
 *   - JS validation is UX only; SettingsModule re-validates natively.
 *   - The phrase is NEVER logged.
 *
 * Logging prefix: [DeletionPhrase]  (state transitions only â€” no values)
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
} from 'react-native';
import { L, styles } from './customize.styles';

const { SettingsModule } = NativeModules;

const BLANK_ERROR = 'Enter a phrase before turning this on.';
const SAVE_ERROR = 'Could not save. Please try again.';

/** Trim outer whitespace â€” mirrors the native UninstallPhrase contract. */
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
  // Draft is what the user is typing; savedPhrase is what native has stored.
  const [draft, setDraft] = useState(savedPhrase || '');
  const [error, setError] = useState('');
  // Disable-gate status from native: { state: 'none'|'waiting'|'ready', readyAt, expiresAt }
  const [gate, setGate] = useState(null);

  // Re-sync the draft when Customize reloads native state (mount / focus).
  useEffect(() => {
    setDraft(savedPhrase || '');
    setError('');
  }, [savedPhrase]);

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
      // Window closed between render and tap â€” refresh the status instead.
      console.warn('[DeletionPhrase] confirm rejected');
      try {
        setGate(await SettingsModule.getUninstallPhraseDisableStatus());
      } catch (_) {
        setGate(null);
      }
    }
  }, [onSaved, savedPhrase]);

  const handleSavePhrase = useCallback(async () => {
    console.log('[DeletionPhrase] save phrase requested');
    const phrase = await persistPhrase();
    if (!phrase) return;
    setError('');
    onSaved(enabled, phrase);
  }, [persistPhrase, onSaved, enabled]);

  const dirty = normalizePhrase(draft) !== normalizePhrase(savedPhrase);

  const gateState = gate && gate.state;
  const modalVisible = gateState === 'waiting' || gateState === 'ready';

  return (
    <View>
      <View style={styles.toggleRow}>
        <View style={styles.toggleLabelGroup}>
          <Text style={styles.toggleLabel}>Require phrase to delete</Text>
          <Text style={styles.toggleCaption}>
            After the 60-second pause you must also type out your phrase
            exactly (case-sensitive) before you can continue. Turning this off
            takes a 1-hour wait. Stored only on this device.
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
          <TextInput
            style={[styles.phraseInput, !!error && styles.phraseInputError]}
            value={draft}
            onChangeText={text => {
              setDraft(text);
              if (error) setError('');
            }}
            placeholder="Type the phrase you must enter to delete"
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
          {enabled && dirty && (
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
        visible={modalVisible}
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
                you can turn this off. Come back then â€” you will have a 15
                minute window ({formatClock(gate.readyAt)}â€“
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
    </View>
  );
};

export default DeletionPhraseSection;
