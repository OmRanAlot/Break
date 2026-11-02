/**
 * ManagedAppsList.js — Compact per-app status rows on the Home dashboard.
 *
 * Renders one row per managed app. Each row shows:
 *   emoji + label | one-line status derived from policy | chevron
 *
 * Tapping a row calls onSelect(pkg) → Home navigates to AppDetail.
 *
 * Logging prefix: [ManagedAppsList]
 */

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useInstalledApps } from '../managedApps/installedApps';
import { Monogram } from '../Permissions/onboarding/components';

const L = {
  charcoal: '#1A1A1A',
  muted: '#757575',
  border: 'rgba(0,0,0,0.07)',
  cardBg: '#FFFFFF',
};

const ChevronIcon = () => (
  <Svg
    width={16}
    height={16}
    fill="none"
    stroke={L.muted}
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
  >
    <Path d="M9 18l6-6-6-6" />
  </Svg>
);

/**
 * Returns a one-line status string for display in the app row.
 * "Off" → app master toggle is off or no features enabled.
 * "On · Reels + Intercept" → active feature labels joined with +.
 */
function statusLine(policy, appEntry) {
  if (!policy || policy.enabled === false) {
    return 'Off';
  }
  const active = appEntry.features
    .filter(f => f.kind !== 'stepper' && policy[f.key] === true)
    .map(f =>
      f.label.replace(' Detection', '').replace(' / Video Detection', ''),
    );
  if (policy.app_open_intercept === true) {
    active.push('Intercept');
  }
  return active.length ? `On · ${active.join(' + ')}` : 'On';
}

const ManagedAppsList = ({ appPolicies = {}, onSelect, onSetup }) => {
  const { apps, loading, error, refresh } = useInstalledApps();
  const [setupError, setSetupError] = useState('');
  const starting = useRef(false);
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Managed Apps</Text>
      {onSetup && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={async () => {
            if (starting.current) return;
            starting.current = true;
            try {
              await onSetup();
            } catch (e) {
              setSetupError(e.message);
            } finally {
              starting.current = false;
            }
          }}
        >
          <Text style={styles.appLabel}>Set up opening pauses</Text>
        </TouchableOpacity>
      )}
      {setupError ? <Text accessibilityRole="alert">{setupError}</Text> : null}
      {loading ? (
        <ActivityIndicator />
      ) : error ? (
        <>
          <Text style={styles.statusText}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={refresh}>
            <Text>Retry app lookup</Text>
          </TouchableOpacity>
        </>
      ) : apps.length === 0 ? (
        <Text style={styles.statusText}>No supported apps are installed.</Text>
      ) : null}
      <View style={styles.card}>
        {!loading &&
          !error &&
          apps.map((app, index) => {
            const policy = appPolicies[app.pkg];
            const status = statusLine(policy, app);
            const isLast = index === apps.length - 1;
            // Tile is "active" (dark) when the app has any intervention on, matching
            // the onboarding selection styling.
            const isActive = Boolean(policy) && policy.enabled !== false;

            return (
              <TouchableOpacity
                key={app.pkg}
                style={[styles.row, !isLast && styles.rowBorder]}
                onPress={() => {
                  console.log('[ManagedAppsList] tapped:', app.pkg);
                  onSelect(app.pkg);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${app.label} settings`}
              >
                <Monogram
                  text={app.monogram}
                  active={isActive}
                  size={36}
                  radius={10}
                  fontSize={14}
                />
                <View style={styles.rowContent}>
                  <Text style={styles.appLabel}>{app.label}</Text>
                  <Text style={styles.statusText}>{status}</Text>
                </View>
                <ChevronIcon />
              </TouchableOpacity>
            );
          })}
      </View>
    </View>
  );
};

export default ManagedAppsList;

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: L.charcoal,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  card: {
    backgroundColor: L.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: L.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: L.border,
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  appLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: L.charcoal,
  },
  statusText: {
    fontSize: 12,
    color: L.muted,
  },
});
