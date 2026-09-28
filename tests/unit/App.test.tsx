import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';
import App from '../../App';
import { EMPTY_DRAFT } from '../../components/Permissions/setupState';

jest.mock('../../components/Permissions/PermissionsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return (props: any) => (
    <Text testID={props.repair ? 'repair' : 'setup'}>
      {props.initialState.step}
    </Text>
  );
});
jest.mock('../../components/Home/home', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return () => <Text testID="home">Home</Text>;
});
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: any) => children[0],
    Screen: ({ children }: any) => children({}),
  }),
}));
jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({}),
  NavigationContainer: ({ children }: any) => children,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
}));
const settings = NativeModules.SettingsModule;
const vpn = NativeModules.VPNModule;
let renderer: Renderer.ReactTestRenderer;
afterEach(async () => {
  await act(async () => renderer?.unmount());
});
async function render(state: any, granted = true) {
  settings.getOnboardingState.mockResolvedValue(JSON.stringify(state));
  vpn.checkPermissions.mockResolvedValue({
    usage: granted,
    overlay: granted,
    accessibility: granted,
  });
  await act(async () => {
    renderer = Renderer.create(<App />);
  });
}
test('incomplete setup resumes despite already granted permissions', async () => {
  await render({ ...EMPTY_DRAFT, step: 2 });
  expect(
    renderer.root.findAllByProps({ testID: 'setup' }).length,
  ).toBeGreaterThan(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('2');
});
test('completed setup with missing permissions routes to repair', async () => {
  await render(
    { ...EMPTY_DRAFT, completed: true, requiresPermissions: true },
    false,
  );
  expect(
    renderer.root.findAllByProps({ testID: 'repair' }).length,
  ).toBeGreaterThan(0);
});
test('completed without apps enters Home without monitoring permissions', async () => {
  await render(
    { ...EMPTY_DRAFT, completed: true, requiresPermissions: false },
    false,
  );
  expect(
    renderer.root.findAllByProps({ testID: 'home' }).length,
  ).toBeGreaterThan(0);
});
test('legacy completed setup enters Home when permissions are granted', async () => {
  await render({
    ...EMPTY_DRAFT,
    completed: true,
    legacy: true,
    requiresPermissions: true,
  });
  expect(
    renderer.root.findAllByProps({ testID: 'home' }).length,
  ).toBeGreaterThan(0);
});
test('a storage read failure presents Retry rather than entering Home', async () => {
  settings.getOnboardingState.mockRejectedValueOnce(
    new Error('Storage unavailable'),
  );
  await act(async () => {
    renderer = Renderer.create(<App />);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('Storage unavailable');
  expect(renderer.root.findAllByProps({ testID: 'home' })).toHaveLength(0);
});
