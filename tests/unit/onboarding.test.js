import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import {
  AccessibilityInfo,
  AppState,
  BackHandler,
  NativeModules,
  TextInput,
} from 'react-native';
import PermissionsScreen from '../../components/Permissions/PermissionsScreen';
import {
  AppSelectRow,
  PillButton,
  Segmented,
} from '../../components/Permissions/onboarding/components';
import { EMPTY_DRAFT } from '../../components/Permissions/setupState';
import { loadInstalledApps } from '../../components/managedApps/installedApps';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../../components/Customize/DeletionInfoModal', () => () => null);
const { SettingsModule: settings, VPNModule: vpn } = NativeModules;
const youtube = 'com.google.android.youtube';
const instagram = 'com.instagram.android';
let renderer;
let listeners;
let hardwareBack;
const render = async (initialState = EMPTY_DRAFT, props = {}) => {
  await act(async () => {
    renderer = Renderer.create(
      <PermissionsScreen
        initialState={initialState}
        onComplete={jest.fn()}
        {...props}
      />,
    );
  });
};
const button = label =>
  renderer.root
    .findAllByType(PillButton)
    .find(node => node.props.label === label);
const press = async label => {
  await act(async () => {
    await button(label).props.onPress();
  });
};
const text = () => JSON.stringify(renderer.toJSON());
beforeEach(() => {
  jest.clearAllMocks();
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, cb) => {
    listeners.push(cb);
    return { remove: jest.fn() };
  });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, cb) => {
    hardwareBack = cb;
    return { remove: jest.fn() };
  });
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  settings.getInstalledSupportedApps.mockResolvedValue(
    JSON.stringify([youtube]),
  );
  settings.saveOnboardingDraft.mockImplementation(async raw => raw);
  settings.completeOnboarding.mockImplementation(async raw =>
    JSON.stringify({ ...JSON.parse(raw), completed: true, step: 5 }),
  );
  vpn.checkPermissions.mockResolvedValue({
    usage: true,
    overlay: true,
    accessibility: true,
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  jest.restoreAllMocks();
});

test('filters catalog packages, including preinstalled YouTube, and never substitutes on lookup failure', async () => {
  settings.getInstalledSupportedApps.mockResolvedValue(
    JSON.stringify([youtube, 'unknown.package']),
  );
  expect((await loadInstalledApps()).map(app => app.pkg)).toEqual([youtube]);
  settings.getInstalledSupportedApps.mockRejectedValue(
    new Error('Lookup failed'),
  );
  await expect(loadInstalledApps()).rejects.toThrow('Lookup failed');
});
test('offers only installed apps without any automatic selections', async () => {
  await render({ ...EMPTY_DRAFT, step: 1 });
  const rows = renderer.root.findAllByType(AppSelectRow);
  expect(rows.map(row => row.props.app.pkg)).toEqual([youtube]);
  expect(rows[0].props.selected).toBe(false);
  expect(button('Continue · 0 selected').props.disabled).toBe(true);
});
test('shows retry after lookup failure and supports an empty device', async () => {
  settings.getInstalledSupportedApps.mockRejectedValueOnce(
    new Error('Lookup failed'),
  );
  await render({ ...EMPTY_DRAFT, step: 1 });
  expect(renderer.root.findAllByType(AppSelectRow)).toHaveLength(0);
  settings.getInstalledSupportedApps.mockResolvedValue('[]');
  await press('Retry app lookup');
  expect(text()).toContain('No supported apps are installed');
});
test('restores duration and reminder, saves before navigation, and skips granted permissions', async () => {
  await render({
    ...EMPTY_DRAFT,
    step: 2,
    selections: [youtube],
    duration: 30,
    reminder: 'Find a tutorial',
  });
  expect(renderer.root.findByType(Segmented).props.value).toBe(30);
  expect(renderer.root.findByType(TextInput).props.value).toBe(
    'Find a tutorial',
  );
  await press('Continue');
  expect(text()).toContain('Review and activate');
  expect(
    JSON.parse(settings.saveOnboardingDraft.mock.calls.at(-1)[0]),
  ).toMatchObject({ step: 4, duration: 30, reminder: 'Find a tutorial' });
  await act(async () => {
    hardwareBack();
  });
  expect(renderer.root.findByType(TextInput).props.value).toBe(
    'Find a tutorial',
  );
});
test('save failure keeps the current step and permits retry', async () => {
  await render();
  settings.saveOnboardingDraft.mockRejectedValueOnce(
    new Error('Storage failed'),
  );
  await press('Get started');
  expect(text()).toContain('Storage failed');
  expect(button('Get started')).toBeDefined();
  await press('Get started');
  expect(renderer.root.findAllByType(AppSelectRow)).toHaveLength(1);
});
test('permission denial stays pending; Settings return rechecks and advances', async () => {
  vpn.checkPermissions.mockResolvedValue({
    usage: true,
    overlay: false,
    accessibility: true,
  });
  await render({ ...EMPTY_DRAFT, step: 3, selections: [youtube] });
  expect(button('Enable Display Over Apps')).toBeDefined();
  await press('Check permissions again');
  expect(button('Enable Display Over Apps')).toBeDefined();
  vpn.checkPermissions.mockResolvedValue({
    usage: true,
    overlay: true,
    accessibility: true,
  });
  await act(async () => {
    for (const listener of listeners) listener('active');
  });
  expect(text()).toContain('Review and activate');
});
test('activation failure retains review and a successful retry alone shows success', async () => {
  await render({ ...EMPTY_DRAFT, step: 4, selections: [youtube] });
  settings.completeOnboarding.mockRejectedValueOnce(
    new Error('Service start failed'),
  );
  await press('Activate pauses');
  expect(text()).toContain('Service start failed');
  expect(text()).not.toContain('Your pauses are ready');
  await press('Activate pauses');
  expect(text()).toContain('Your pauses are ready');
});
test('duplicate activation taps submit only once', async () => {
  await render({ ...EMPTY_DRAFT, step: 4, selections: [youtube] });
  const activate = button('Activate pauses').props.onPress;
  await act(async () => {
    await Promise.all([activate(), activate()]);
  });
  expect(settings.completeOnboarding).toHaveBeenCalledTimes(1);
});
test('uninstalling a selection before activation returns to app selection without saving policies', async () => {
  settings.getInstalledSupportedApps.mockResolvedValue(
    JSON.stringify([youtube, instagram]),
  );
  await render({ ...EMPTY_DRAFT, step: 4, selections: [youtube, instagram] });
  settings.getInstalledSupportedApps.mockResolvedValue(
    JSON.stringify([youtube]),
  );
  await press('Activate pauses');
  expect(settings.completeOnboarding).not.toHaveBeenCalled();
  expect(button('Continue · 1 selected')).toBeDefined();
  expect(text()).toContain('no longer available');
});
test('no-app completion skips app configuration and permissions, even when lookup fails', async () => {
  settings.getInstalledSupportedApps.mockRejectedValue(
    new Error('Lookup failed'),
  );
  const onComplete = jest.fn();
  await render({ ...EMPTY_DRAFT, step: 1 }, { onComplete });
  const skip = renderer.root.findAllByProps({
    accessibilityLabel: 'Continue without apps',
  })[0];
  await act(async () => {
    skip.props.onPress();
  });
  await press('Finish setup');
  expect(vpn.checkPermissions).not.toHaveBeenCalled();
  expect(vpn.startMonitoring).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
  await press('Go to Home');
  expect(onComplete).toHaveBeenCalled();
});
test('permission repair does not write drafts or reset settings', async () => {
  settings.getOnboardingState.mockResolvedValue(
    JSON.stringify({ ...EMPTY_DRAFT, completed: true, selections: [youtube] }),
  );
  settings.getMonitoringEnabled.mockImplementation(cb => cb(true));
  await render({ ...EMPTY_DRAFT, completed: true }, { repair: true });
  await press('Return to Home');
  expect(settings.saveOnboardingDraft).not.toHaveBeenCalled();
  expect(settings.completeOnboarding).not.toHaveBeenCalled();
  expect(vpn.startMonitoring).toHaveBeenCalledTimes(1);
});
