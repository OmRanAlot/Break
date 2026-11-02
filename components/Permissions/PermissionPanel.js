import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { PERMISSION_STEPS } from './permissionSteps';
import { PillButton } from './onboarding/components';
import { allGranted, checkPermissions } from './setupState';
import { styles } from './PermissionsScreen.styles';

export default function PermissionPanel({ onChecked }) {
  const [permissions, setPermissions] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const result = await checkPermissions();
      setPermissions(result);
      setError('');
      onChecked(result);
    } catch (e) {
      setError('Could not check permissions. Please retry.');
    } finally {
      setChecking(false);
    }
  }, [onChecked]);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  const missing = PERMISSION_STEPS.find(
    config => !permissions?.[config.permKey],
  );
  return (
    <View>
      <Text style={styles.h2}>
        {missing ? missing.headline : 'Permissions ready'}
      </Text>
      <Text style={styles.p}>
        {missing ? missing.body : 'Your opening pauses can now run.'}
      </Text>
      {checking && <ActivityIndicator />}
      {error ? (
        <Text accessibilityRole="alert" style={styles.p}>
          {error}
        </Text>
      ) : null}
      {permissions && !allGranted(permissions) && (
        <PillButton
          label={missing.cta}
          disabled={checking}
          onPress={async () => {
            try {
              await missing.request();
            } catch (e) {
              setError('Could not open Android Settings. Please try again.');
            }
          }}
        />
      )}
      <Text style={styles.p}>
        Return to Break after enabling the permission. Your choices stay saved
        on this phone.
      </Text>
      <PillButton
        label="Check permissions again"
        disabled={checking}
        onPress={refresh}
      />
    </View>
  );
}
