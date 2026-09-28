import { NativeModules } from 'react-native';

export const MESSAGE_PRESETS = [
  'Why am I opening this?',
  'What did I come here to do?',
];
export const EMPTY_DRAFT = {
  version: 1,
  completed: false,
  step: 0,
  selections: [],
  duration: 15,
  reminder: MESSAGE_PRESETS[0],
  deletionProtection: false,
};
export const parseSetup = raw => {
  const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    !state ||
    typeof state.completed !== 'boolean' ||
    !Array.isArray(state.selections)
  ) {
    throw new Error('Could not read setup. Please retry.');
  }
  return state;
};
export const allGranted = permissions =>
  permissions?.usage === true &&
  permissions?.overlay === true &&
  permissions?.accessibility === true;
export const checkPermissions = () =>
  NativeModules.VPNModule.checkPermissions();

export function previousStep(step, hasApps, permissions) {
  if (step === 4) return hasApps ? (allGranted(permissions) ? 2 : 3) : 1;
  return Math.max(0, step - 1);
}
