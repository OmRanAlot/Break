/* eslint-env jest */
/**
 * jest.setup.js
 * -------------
 * Global Jest setup for the Breqk app.
 *
 * The app's components grab custom native modules (VPNModule, SettingsModule)
 * at module scope — e.g. components/Home/home.js constructs a
 * NativeEventEmitter(VPNModule) on import. Those modules only exist on a real
 * Android device, so Jest must provide mocks before any component is imported.
 */
import { NativeModules } from 'react-native';
import 'react-native-gesture-handler/jestSetup';

// react-native-webview registers a TurboModule (RNCWebViewModule) that only
// exists in the native binary — replace the whole library with a plain View.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = props => React.createElement(View, props);
  return { WebView: MockWebView, default: MockWebView };
});

// react-native-reanimated: minimal stub — the mock.js bundled with v3 requires
// an internal './src/mock' path that is absent from the installed build.
// We only need the stubs that react-native-keyboard-controller transitively
// imports (Animated wrappers + worklet helpers); components under test do not
// use reanimated directly.
jest.mock('react-native-reanimated', () => {
  const Animated = require('react-native').Animated;
  function passthrough(val) { return val; }
  return {
    __esModule: true,
    default: {
      View: Animated.View,
      Text: Animated.Text,
      Image: Animated.Image,
      ScrollView: Animated.ScrollView,
      Value: Animated.Value,
      createAnimatedComponent: Animated.createAnimatedComponent,
    },
    // Worklet helpers — used by keyboard-controller internally.
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => fn(),
    withTiming: passthrough,
    withSpring: passthrough,
    withDecay: passthrough,
    withRepeat: passthrough,
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    cancelAnimation: () => {},
    useDerivedValue: (fn) => ({ value: fn() }),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => ({ current: null }),
    useAnimatedGestureHandler: () => () => {},
    interpolate: (v) => v,
    Extrapolate: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    Easing: { linear: passthrough, ease: passthrough, in: (e) => e, out: (e) => e },
  };
});

// react-native-keyboard-controller: stub out the native module and hooks.
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react');
  const { View, ScrollView } = require('react-native');
  return {
    KeyboardProvider: ({ children }) => React.createElement(View, null, children),
    KeyboardAwareScrollView: ScrollView,
    KeyboardAvoidingView: View,
  };
});

/**
 * Build a self-populating native-module mock: any method accessed returns a
 * jest.fn resolving to the given default value. Keeps the mock in sync with
 * the bridge automatically as new @ReactMethods are added.
 *
 * @param {Record<string, unknown>} overrides - explicit per-method return values
 */
function autoNativeModuleMock(overrides = {}) {
  const target = {
    // Required by NativeEventEmitter's invariant checks
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  for (const [name, value] of Object.entries(overrides)) {
    target[name] = jest.fn(() => Promise.resolve(value));
  }
  return new Proxy(target, {
    get(obj, prop) {
      if (!(prop in obj) && typeof prop === 'string') {
        obj[prop] = jest.fn(() => Promise.resolve(null));
      }
      return obj[prop];
    },
  });
}

NativeModules.VPNModule = autoNativeModuleMock({
  // Permission / state checks default to safe booleans
  checkPermissions: { usage: true, overlay: true, accessibility: true },
  checkOverlayPermission: true,
  checkUsageStatsPermission: true,
  isAccessibilityServiceEnabled: true,
  isMonitoringEnabled: false,
  // JSON-string returning methods must be parseable
  getBlockedApps: '[]',
  getInstalledApps: '[]',
});

NativeModules.SettingsModule = autoNativeModuleMock({
  getAppPolicies: '{}',
  getModes: '[]',
});
