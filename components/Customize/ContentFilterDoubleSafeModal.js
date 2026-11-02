/**
 * ContentFilterDoubleSafeModal
 * ----------------------------
 * Shown when the user turns Double-safe ON. Explains the two-layer commitment
 * before the feature activates: turning Double-safe off starts a lock-duration
 * wait, and turning the content filter off after that lasts only 12 hours before
 * it turns back on automatically.
 *
 * Props:
 *   visible       — controlled by parent
 *   lockDurationLabel — human-readable lock duration, e.g. "24h" or "2d"
 *   onCancel      — user dismissed; feature stays off
 *   onConfirm     — user accepted; parent should call setDoubleSafe(true)
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { L } from './customize.styles';

const ContentFilterDoubleSafeModal = ({
  visible,
  lockDurationLabel,
  onCancel,
  onConfirm,
}) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onCancel}
  >
    <View style={styles.overlay}>
      <View style={styles.card}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Before you turn this on</Text>

          <Text style={styles.sectionHeading}>What Double-safe does</Text>
          <Text style={styles.body}>
            With Double-safe on, you can't turn the content filter off in one
            tap. There are two separate steps, each with a built-in wait.
          </Text>

          <Text style={styles.sectionHeading}>Step 1 — Turn Double-safe off</Text>
          <Text style={styles.body}>
            You can turn Double-safe off any time, but doing so doesn't
            immediately free the content filter. Instead, it starts a wait equal
            to your Settings Change Lock duration
            {lockDurationLabel ? ` (currently ${lockDurationLabel})` : ''}.
            The content filter stays fully on and its switch is grayed out until
            the wait finishes.
          </Text>

          <Text style={styles.sectionHeading}>Step 2 — Turn the content filter off</Text>
          <Text style={styles.body}>
            Once the wait is done, you can turn the content filter off. But it
            only stays off for 12 hours — then it turns itself back on
            automatically, whether or not you've noticed.
          </Text>

          <Text style={styles.sectionHeading}>Turning both off at once</Text>
          <Text style={styles.body}>
            You cannot turn both Double-safe and the content filter off in a
            single session. The two waits must happen in sequence.
          </Text>

          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              Once Double-safe is on, turning the content filter off takes at
              least {lockDurationLabel || 'one full lock cycle'} plus a 12-hour
              window — plan ahead if you need it off.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.cancelButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.confirmButton}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Enable Double-safe"
            onPress={onConfirm}
          >
            <Text style={styles.confirmText}>Turn on</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

export default ContentFilterDoubleSafeModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    width: '100%',
    maxHeight: '85%',
    overflow: 'hidden',
  },
  scroll: { flexGrow: 0 },
  content: { padding: 22, paddingBottom: 4 },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: L.charcoal,
    marginBottom: 14,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: L.charcoal,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 5,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#525252',
    marginBottom: 4,
  },
  warnBox: {
    backgroundColor: '#fff4ed',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
    marginBottom: 6,
  },
  warnText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#9a3412',
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: L.border,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginRight: 8,
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#737373' },
  confirmButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: L.charcoal,
  },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
