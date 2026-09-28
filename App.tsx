// App.tsx
// Root of Break. Checks permissions on mount, then renders a Stack
// navigator containing Home → Customize / Modes → Browser.
//
// Navigation architecture:
//   Stack: Home (initial) → Customize (via gear icon) | Modes (via layers icon) → Browser (via deep link or button)
//
// Native overlays (AppUsageMonitor + ReelsInterventionService) handle all app-blocking
// and Reels intervention UI directly via WindowManager. No JS-side modal is needed here.
//
// Deep linking: Break://browser/:platform → Browser screen (used by widget buttons)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  NativeModules,
  AppState,
  Button,
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Home from './components/Home/home';
import Customize from './components/Customize/customize';
import ModesScreen from './components/Modes/ModesScreen';
import PermissionsScreen from './components/Permissions/PermissionsScreen';
import { BrowserScreen } from './components/Browser/BrowserScreen';
import AppDetail from './components/AppDetail/AppDetail';
import ReflectionsScreen from './components/Reflections/ReflectionsScreen';
import ReflectionDetailScreen from './components/Reflections/ReflectionDetailScreen';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { allGranted, parseSetup } from './components/Permissions/setupState';

const { VPNModule, SettingsModule } = NativeModules;
const Stack = createNativeStackNavigator();

/**
 * navigationRef — allows navigation from outside React tree (e.g. native event callbacks).
 * Exported so other modules can call navigationRef.navigate() if needed.
 */
export const navigationRef = createNavigationContainerRef();

/**
 * Deep linking configuration for widget quick-launch buttons.
 * Maps Break://browser/:platform → Browser screen.
 * Works for both cold start and warm start (singleTask launchMode).
 */
const linking = {
  prefixes: ['Break://'],
  config: {
    screens: {
      // Browser is directly on the stack — deep link resolves correctly without tabs
      Browser: 'browser/:platform',
    },
  },
};

/**
 * MainNavigator — rendered only after permissions are confirmed.
 * Calls useUninstallLock unconditionally (satisfies React rules of hooks) and
 * intercepts the full screen when the 30-second delete delay is active.
 */
const MainNavigator = ({
  onSetup,
  canSetup,
}: {
  onSetup: () => Promise<void>;
  canSetup: boolean;
}) => {
  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} linking={linking}>
        <Stack.Navigator
          screenOptions={{ headerShown: false }}
          initialRouteName="Home"
        >
          <Stack.Screen name="Home">
            {props => (
              <Home {...props} onSetup={canSetup ? onSetup : undefined} />
            )}
          </Stack.Screen>
          <Stack.Screen name="Customize" component={Customize} />
          <Stack.Screen name="Modes" component={ModesScreen} />
          <Stack.Screen name="Browser" component={BrowserScreen} />
          <Stack.Screen name="AppDetail" component={AppDetail} />
          <Stack.Screen name="Reflections" component={ReflectionsScreen} />
          <Stack.Screen
            name="ReflectionDetail"
            component={ReflectionDetailScreen}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

const App = () => {
  const [route, setRoute] = useState<'loading' | 'setup' | 'repair' | 'home'>(
    'loading',
  );
  const [setup, setSetup] = useState<any>(null);
  const [error, setError] = useState('');
  const checking = useRef(false);
  const refresh = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    setError('');
    try {
      const state = parseSetup(await SettingsModule.getOnboardingState());
      setSetup(state);
      if (!state.completed) {
        setRoute('setup');
      } else if (
        state.requiresPermissions &&
        !allGranted(await VPNModule.checkPermissions())
      ) {
        setRoute('repair');
      } else {
        setRoute('home');
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not load setup. Please retry.',
      );
    } finally {
      checking.current = false;
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      // The setup/repair screen owns its Settings round trip and success screen.
      if (state === 'active' && route === 'home') refresh();
    });
    return () => sub.remove();
  }, [refresh, route]);
  const beginSetup = async () => {
    const state = parseSetup(await SettingsModule.beginAppSetup());
    setSetup(state);
    setRoute('setup');
  };
  if (error || route === 'loading') {
    return (
      <View style={splashStyles.container}>
        <Text style={splashStyles.wordmark}>Break</Text>
        {error ? (
          <>
            <Text accessibilityRole="alert">{error}</Text>
            <Button title="Retry" onPress={refresh} />
          </>
        ) : (
          <ActivityIndicator
            size="small"
            color="#757575"
            style={splashStyles.spinner}
          />
        )}
      </View>
    );
  }
  if (route === 'setup' || route === 'repair') {
    return (
      <SafeAreaProvider>
        <PermissionsScreen
          key={route}
          initialState={setup}
          repair={route === 'repair'}
          onComplete={refresh}
        />
      </SafeAreaProvider>
    );
  }
  return (
    <MainNavigator
      onSetup={beginSetup}
      canSetup={!setup.legacy && setup.selections.length === 0}
    />
  );
};

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 28,
    fontWeight: '300',
    color: '#1A1A1A',
    letterSpacing: 6,
  },
  spinner: {
    marginTop: 28,
  },
});

export default App;
