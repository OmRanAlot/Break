import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import { MANAGED_APPS } from './manifest';

export const CATALOG_PACKAGES = MANAGED_APPS.map(app => app.pkg);

export async function loadInstalledApps() {
  const raw = await NativeModules.SettingsModule.getInstalledSupportedApps(
    CATALOG_PACKAGES,
  );
  const packages = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    !Array.isArray(packages) ||
    packages.some(pkg => typeof pkg !== 'string')
  ) {
    throw new Error('Could not check installed apps. Please retry.');
  }
  return MANAGED_APPS.filter(app => packages.includes(app.pkg));
}

/** Shared installed-only catalog. Lookup failure deliberately leaves the list empty. */
export function useInstalledApps() {
  const [state, setState] = useState({ apps: [], loading: true, error: null });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setState(previous => ({ ...previous, loading: true, error: null }));
    try {
      const apps = await loadInstalledApps();
      if (request === generation.current)
        setState({ apps, loading: false, error: null });
      return apps;
    } catch (error) {
      if (request === generation.current)
        setState({ apps: [], loading: false, error: error.message });
      return null;
    }
  }, []);
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
    };
    refresh();
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') refresh();
    });
    return () => {
      invalidate();
      sub.remove();
    };
  }, [refresh]);
  return { ...state, refresh };
}
