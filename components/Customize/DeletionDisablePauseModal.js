/**
 * Foreground-only cooldown before turning off Deletion Prevention.
 * Leaving Break or locking the phone resets the entire five-minute wait.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Text, TouchableOpacity, View } from 'react-native';
import { styles } from './customize.styles';

export const DISABLE_PAUSE_MS = 5 * 60 * 1000;

export const formatDeletionCountdown = remainingSeconds => {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const DeletionDisablePauseModal = ({ visible, onCancel, onConfirm }) => {
  const [confirmReady, setConfirmReady] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(
    DISABLE_PAUSE_MS / 1000,
  );
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  const clearCountdown = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    startedAtRef.current = null;
  }, []);

  const resetCountdown = useCallback(() => {
    clearCountdown();
    setConfirmReady(false);
    setRemainingSeconds(DISABLE_PAUSE_MS / 1000);
  }, [clearCountdown]);

  const startCountdown = useCallback(() => {
    resetCountdown();
    startedAtRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsedMs = Date.now() - startedAtRef.current;
      const nextRemaining = Math.max(
        0,
        Math.ceil((DISABLE_PAUSE_MS - elapsedMs) / 1000),
      );
      setRemainingSeconds(nextRemaining);
      if (nextRemaining === 0) {
        clearCountdown();
        setConfirmReady(true);
      }
    }, 1000);
  }, [clearCountdown, resetCountdown]);

  useEffect(() => {
    if (!visible) {
      resetCountdown();
      return undefined;
    }

    appStateRef.current = AppState.currentState;
    if (appStateRef.current === 'active') startCountdown();
    else resetCountdown();

    const appStateSubscription = AppState.addEventListener('change', next => {
      const previous = appStateRef.current;
      appStateRef.current = next;

      if (next !== 'active') resetCountdown();
      else if (previous !== 'active') startCountdown();
    });

    return () => {
      appStateSubscription.remove();
      clearCountdown();
    };
  }, [clearCountdown, resetCountdown, startCountdown, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.infoModalOverlay}>
        <View style={styles.infoModalCard}>
          <View style={styles.infoModalContent}>
            <Text style={styles.infoModalTitle}>
              Turn off deletion prevention?
            </Text>
            <Text
              style={[
                styles.infoModalBulletText,
                styles.deletionDisableIntro,
              ]}
            >
              You turned this on to protect against impulsive deletion. Are you
              sure you want to remove that protection?
            </Text>
            <Text
              style={[
                styles.infoModalBulletText,
                styles.deletionDisableInstruction,
              ]}
            >
              Keep Break open while the timer runs. Leaving the app or locking
              your phone resets it to 5:00.
            </Text>
            <Text
              style={styles.deletionCountdown}
              accessibilityRole="timer"
              accessibilityLabel={`${formatDeletionCountdown(
                remainingSeconds,
              )} remaining`}
            >
              {formatDeletionCountdown(remainingSeconds)}
            </Text>
            <Text
              style={styles.deletionCountdownCaption}
              accessibilityLiveRegion="polite"
            >
              {confirmReady
                ? 'You can now turn off deletion prevention.'
                : 'Deletion prevention stays on during this wait.'}
            </Text>
          </View>

          <View style={styles.infoModalButtonRow}>
            <TouchableOpacity
              style={styles.infoModalCancelButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Keep deletion prevention"
              onPress={onCancel}
            >
              <Text style={styles.infoModalCancelText}>Keep protection</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.infoModalEnableButton,
                !confirmReady && styles.deletionDisableButtonDisabled,
              ]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Turn off deletion prevention"
              accessibilityState={{ disabled: !confirmReady }}
              onPress={confirmReady ? onConfirm : undefined}
              disabled={!confirmReady}
            >
              <Text style={styles.deletionDisableButtonText}>
                Turn off
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default DeletionDisablePauseModal;
