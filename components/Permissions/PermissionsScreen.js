import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppSelectRow,
  PillButton,
  ProgressDots,
  Segmented,
  StepHeader,
  Toggle,
} from './onboarding/components';
import { T } from './onboarding/theme';
import { styles } from './PermissionsScreen.styles';
import {
  CATALOG_PACKAGES,
  useInstalledApps,
} from '../managedApps/installedApps';
import { MANAGED_APPS } from '../managedApps/manifest';
import {
  allGranted,
  checkPermissions,
  EMPTY_DRAFT,
  MESSAGE_PRESETS,
  parseSetup,
  previousStep,
} from './setupState';
import PermissionPanel from './PermissionPanel';
import DeletionInfoModal from '../Customize/DeletionInfoModal';

const { SettingsModule, VPNModule } = NativeModules;

export default function PermissionsScreen({
  initialState = EMPTY_DRAFT,
  repair = false,
  onComplete,
}) {
  const [draft, setDraft] = useState(initialState);
  const draftRef = useRef(draft);
  const [permissions, setPermissions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const queue = useRef(Promise.resolve());
  const [custom, setCustom] = useState(
    !MESSAGE_PRESETS.includes(draft.reminder),
  );
  const [consent, setConsent] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;
  const installed = useInstalledApps();
  const step = repair ? 3 : draft.step;
  const hasApps = draft.selections.length > 0;

  const edit = useCallback(patch => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    return next;
  }, []);
  // Serialize background saves with navigation/activation so stale writes cannot win.
  const persist = useCallback(next => {
    const result = queue.current
      .catch(() => {})
      .then(() => SettingsModule.saveOnboardingDraft(JSON.stringify(next)));
    queue.current = result;
    return result;
  }, []);
  const go = useCallback(
    async nextStep => {
      if (working.current) return;
      working.current = true;
      setBusy(true);
      setError('');
      try {
        const next = { ...draftRef.current, step: nextStep };
        await persist(next);
        edit(next);
      } catch (e) {
        setError(e.message || 'Could not save your choices. Please retry.');
      } finally {
        working.current = false;
        setBusy(false);
      }
    },
    [edit, persist],
  );

  useEffect(() => {
    if (repair || draft.completed) return undefined;
    const timer = setTimeout(() => {
      if (!working.current)
        persist(draftRef.current).catch(e => setError(e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, persist, repair]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (
        state !== 'active' &&
        !repair &&
        !draftRef.current.completed &&
        !working.current
      ) {
        persist(draftRef.current).catch(e => setError(e.message));
      }
    });
    return () => sub.remove();
  }, [persist, repair]);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    opacity.setValue(reducedMotion ? 1 : 0);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: reducedMotion ? 0 : 160,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [step, reducedMotion, opacity]);
  useEffect(() => {
    if (
      working.current ||
      repair ||
      installed.loading ||
      installed.error ||
      draft.completed
    )
      return;
    const available = new Set(installed.apps.map(app => app.pkg));
    const selections = draftRef.current.selections.filter(pkg =>
      available.has(pkg),
    );
    if (selections.length !== draftRef.current.selections.length) {
      edit({
        selections,
        step: 1,
        deletionProtection: selections.length
          ? draftRef.current.deletionProtection
          : false,
      });
      setError(
        'An app is no longer installed or enabled. Please review your choices.',
      );
    }
  }, [
    installed.apps,
    installed.loading,
    installed.error,
    edit,
    repair,
    draft.completed,
  ]);
  const back = useCallback(() => {
    if (working.current) return true;
    if (repair || step === 0) return false;
    if (step === 5) {
      onComplete();
      return true;
    }
    go(previousStep(step, hasApps, permissions));
    return true;
  }, [go, step, repair, hasApps, permissions, onComplete]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]);
  const checked = useCallback(result => {
    setPermissions(result);
  }, []);
  useEffect(() => {
    if (!repair && step === 3 && allGranted(permissions)) go(4);
  }, [repair, step, permissions, go]);

  const continuePause = async () => {
    try {
      const result = await checkPermissions();
      setPermissions(result);
      go(allGranted(result) ? 4 : 3);
    } catch (e) {
      setError('Could not check permissions. Please retry.');
    }
  };
  const activate = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      if (repair) {
        const result = await checkPermissions();
        setPermissions(result);
        if (!allGranted(result))
          throw new Error('Enable the remaining permissions first.');
        const state = parseSetup(await SettingsModule.getOnboardingState());
        const monitoring = await new Promise(resolve =>
          SettingsModule.getMonitoringEnabled(resolve),
        );
        if (monitoring) await VPNModule.startMonitoring();
        onComplete(state);
      } else {
        await queue.current.catch(() => {});
        const submission = { ...draftRef.current };
        if (hasApps) {
          const apps = await installed.refresh();
          if (!apps)
            throw new Error(
              'Could not check installed apps. Retry before activating.',
            );
          if (
            submission.selections.some(
              pkg => !apps.some(app => app.pkg === pkg),
            )
          ) {
            const selections = submission.selections.filter(pkg =>
              apps.some(app => app.pkg === pkg),
            );
            const corrected = edit({
              selections,
              step: 1,
              deletionProtection: selections.length
                ? submission.deletionProtection
                : false,
            });
            await persist(corrected);
            throw new Error(
              'A selected app is no longer available. Go back to Apps and review your choices.',
            );
          }
        }
        const completed = parseSetup(
          await SettingsModule.completeOnboarding(
            JSON.stringify(submission),
            CATALOG_PACKAGES,
          ),
        );
        edit(completed);
      }
    } catch (e) {
      setError(
        e.message ||
          'Setup could not finish. Your choices are saved; please retry.',
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StepHeader
          onBack={!repair && step > 0 && step < 5 && !busy ? back : undefined}
          stepLabel={repair ? 'Restore permissions' : `Step ${step + 1} of 6`}
        />
        {!repair && <ProgressDots total={6} active={step} />}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollBody}
        >
          <Animated.View
            style={{ opacity }}
            pointerEvents={busy ? 'none' : 'auto'}
          >
            {step === 0 && (
              <>
                <Text style={styles.welcomeTitle}>Stay intentional</Text>
                <Text style={styles.welcomeBody}>
                  Make a little space before opening the apps that pull you in.
                </Text>
              </>
            )}
            {step === 1 && (
              <>
                <Text style={styles.h2}>
                  Which apps do you want a pause before opening?
                </Text>
                <Text style={styles.p}>
                  Choose from supported apps installed on your phone.
                </Text>
                {installed.loading ? (
                  <ActivityIndicator />
                ) : installed.error ? (
                  <>
                    <Text style={styles.p}>{installed.error}</Text>
                    <PillButton
                      label="Retry app lookup"
                      onPress={installed.refresh}
                    />
                  </>
                ) : installed.apps.length === 0 ? (
                  <Text style={styles.p}>
                    No supported apps are installed. You can set this up later
                    from Home.
                  </Text>
                ) : (
                  installed.apps.map(app => (
                    <AppSelectRow
                      key={app.pkg}
                      app={app}
                      selected={draft.selections.includes(app.pkg)}
                      onToggle={() =>
                        edit({
                          selections: draft.selections.includes(app.pkg)
                            ? draft.selections.filter(pkg => pkg !== app.pkg)
                            : [...draft.selections, app.pkg],
                        })
                      }
                    />
                  ))
                )}
              </>
            )}
            {step === 2 && (
              <>
                <Text style={styles.h2}>How long would help you pause?</Text>
                <Text style={styles.p}>
                  The same pause applies to every app you chose.
                </Text>
                <Segmented
                  options={[5, 15, 30]}
                  value={draft.duration}
                  onChange={duration => edit({ duration })}
                />
                <Text style={styles.h2}>
                  What would you like to remind yourself?
                </Text>
                {MESSAGE_PRESETS.map(reminder => (
                  <TouchableOpacity
                    key={reminder}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: !custom && draft.reminder === reminder,
                    }}
                    style={[
                      styles.messageOption,
                      !custom &&
                        draft.reminder === reminder &&
                        styles.messageOptionActive,
                    ]}
                    onPress={() => {
                      setCustom(false);
                      edit({ reminder });
                    }}
                  >
                    <Text style={styles.messageText}>{reminder}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Write my own reminder"
                  onPress={() => {
                    setCustom(true);
                    edit({ reminder: '' });
                  }}
                >
                  <Text style={styles.customOptionText}>
                    Write my own reminder
                  </Text>
                </TouchableOpacity>
                {custom && (
                  <>
                    <TextInput
                      accessibilityLabel="Custom reminder"
                      style={styles.customInput}
                      value={draft.reminder}
                      onChangeText={reminder => edit({ reminder })}
                      maxLength={80}
                      multiline
                    />
                    <Text style={styles.p}>{draft.reminder.length}/80</Text>
                  </>
                )}
                <View style={styles.previewCard}>
                  <Text style={styles.previewLabel}>
                    Opening pause preview · {draft.duration} seconds
                  </Text>
                  <Text style={styles.previewMessage}>
                    {draft.reminder || 'Your reminder here'}
                  </Text>
                </View>
              </>
            )}
            {step === 3 && (
              <>
                {repair && (
                  <Text style={styles.p}>
                    Restore access so Break can use your saved settings. Your
                    apps and pauses are unchanged.
                  </Text>
                )}
                <PermissionPanel onChecked={checked} />
              </>
            )}
            {step === 4 && (
              <>
                <Text style={styles.h2}>Review and activate</Text>
                <Text style={styles.p}>
                  {hasApps
                    ? MANAGED_APPS.filter(app =>
                        draft.selections.includes(app.pkg),
                      )
                        .map(app => app.label)
                        .join(', ')
                    : 'No apps selected. Monitoring will stay off.'}
                </Text>
                {hasApps && (
                  <>
                    <Text style={styles.p}>
                      {draft.duration}-second pause · Once per opening
                    </Text>
                    <View style={styles.previewCard}>
                      <Text style={styles.previewMessage}>
                        {draft.reminder}
                      </Text>
                    </View>
                    <Text style={styles.h2}>Optional deletion protection</Text>
                    <Text style={styles.p}>
                      Adds a 60-second pause on Break’s uninstall screen. You
                      can continue uninstalling after the pause.
                    </Text>
                    <Toggle
                      label="Deletion protection"
                      value={draft.deletionProtection}
                      onChange={enabled =>
                        enabled
                          ? setConsent(true)
                          : edit({ deletionProtection: false })
                      }
                    />
                  </>
                )}
              </>
            )}
            {step === 5 && (
              <>
                <Text style={styles.welcomeTitle}>
                  {hasApps ? 'Your pauses are ready' : 'You’re all set'}
                </Text>
                <Text style={styles.welcomeBody}>
                  {hasApps
                    ? 'Your settings are saved and monitoring has started.'
                    : 'Monitoring is off. Choose “Set up opening pauses” on Home whenever you’re ready.'}
                </Text>
              </>
            )}
          </Animated.View>
          {error ? (
            <Text
              style={styles.p}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          {busy ? <ActivityIndicator color={T.ink} /> : null}
          {step === 0 && (
            <PillButton
              label="Get started"
              disabled={busy}
              onPress={() => go(1)}
            />
          )}
          {step === 1 && (
            <>
              <PillButton
                label={`Continue · ${draft.selections.length} selected`}
                disabled={
                  busy || !hasApps || installed.loading || !!installed.error
                }
                onPress={() => go(2)}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Continue without apps"
                disabled={busy}
                onPress={() => {
                  edit({ selections: [], deletionProtection: false });
                  go(4);
                }}
              >
                <Text style={styles.customOptionText}>
                  Continue without apps
                </Text>
              </TouchableOpacity>
            </>
          )}
          {step === 2 && (
            <PillButton
              label="Continue"
              disabled={busy || !draft.reminder.trim()}
              onPress={continuePause}
            />
          )}
          {step === 3 && repair && (
            <PillButton
              label="Return to Home"
              disabled={busy || !allGranted(permissions)}
              onPress={activate}
            />
          )}
          {step === 4 && (
            <PillButton
              label={hasApps ? 'Activate pauses' : 'Finish setup'}
              disabled={busy}
              onPress={activate}
            />
          )}
          {step === 5 && (
            <PillButton label="Go to Home" onPress={() => onComplete(draft)} />
          )}
        </View>
      </KeyboardAvoidingView>
      <DeletionInfoModal
        visible={consent}
        animationType={reducedMotion ? 'none' : 'fade'}
        onCancel={() => setConsent(false)}
        onConfirm={() => {
          setConsent(false);
          edit({ deletionProtection: true });
        }}
      />
    </SafeAreaView>
  );
}
