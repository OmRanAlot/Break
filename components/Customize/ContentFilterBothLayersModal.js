/**
 * ContentFilterBothLayersModal
 * ----------------------------
 * Shown when the user taps the content filter OFF while Double-safe is still ON.
 * Explains that both layers can't be removed in one step — they must go in
 * sequence, with a full wait cycle in between.
 *
 * Props:
 *   visible           — controlled by parent
 *   lockDurationLabel — human-readable lock duration, e.g. "24h" or "2d"
 *   onDismiss         — user tapped "Got it"; no state change
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { L } from './customize.styles';

const ContentFilterBothLayersModal = ({
  visible,
  lockDurationLabel,
  onDismiss,
}) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onDismiss}
  >
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>Can't turn both off at once</Text>

        <Text style={styles.body}>
          Double-safe is still on, so the content filter can't be turned off
          directly. The two layers have to be removed in sequence.
        </Text>

        <Text style={styles.step}>
          <Text style={styles.stepNum}>1. </Text>
          Turn Double-safe off. The content filter stays on and its switch
          is grayed out while you wait{' '}
          {lockDurationLabel ? `(${lockDurationLabel})` : 'for one full lock cycle'}.
        </Text>

        <Text style={styles.step}>
          <Text style={styles.stepNum}>2. </Text>
          Once the wait is done, turn the content filter off. It stays off
          for 12 hours, then turns itself back on automatically.
        </Text>

        <TouchableOpacity
          style={styles.dismissButton}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Got it"
          onPress={onDismiss}
        >
          <Text style={styles.dismissText}>Got it</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

export default ContentFilterBothLayersModal;

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
    padding: 22,
    width: '100%',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: L.charcoal,
    marginBottom: 12,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#525252',
    marginBottom: 14,
  },
  step: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#525252',
    marginBottom: 10,
  },
  stepNum: {
    fontWeight: '700',
    color: L.charcoal,
  },
  dismissButton: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: L.charcoal,
    alignItems: 'center',
  },
  dismissText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
