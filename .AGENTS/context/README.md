# Break

**A digital-wellbeing app that helps make scrolling more intentional.** Break monitors selected app use, adds a pause before opening distracting apps, and can interrupt short-form video feeds. It combines a React Native interface with Android services for features that need to work outside the app.

> **Platform:** Android. The iOS directory is present in the React Native project, but the app's monitoring and intervention features are implemented for Android.

## What it does

- **App open intercepts:** Choose apps to monitor and add a configurable pause when opening them.
- **Short-form feed interventions:** Detects supported Reels, Shorts, and similar feeds, then presents an in-context intervention. Detection is implemented for Instagram, YouTube, TikTok, Facebook, and Snapchat; behavior depends on the current app UI and Android accessibility service.
- **Modes and schedules:** Create modes with per-app overrides and schedules, then switch modes manually or let them activate on a schedule.
- **Scroll budgets:** Set limits for supported feeds and track feed activity.
- **Restricted-site reflection gate:** Block configured domains in Break's browser and require a saved reflection before continuing. Reflections remain in a private, on-device database.
- **Usage overview:** View screen-time and app-usage information available from Android's usage statistics.
- **Privacy and safety controls:** Configure optional settings and uninstall locks; the app does not require a VPN connection for monitoring.

## Technical overview

- **Mobile UI:** React Native 0.80, React 19, TypeScript, and React Navigation 7.
- **Android:** Native Java/Kotlin services and modules connected to React Native through the native-module bridge.
- **Intervention system:** Android Accessibility Service observes supported app UI; dedicated detectors and filter handlers identify short-form surfaces, while native overlays handle interventions.
- **Background monitoring:** A foreground service monitors app usage. Modes and schedules use Android's alarm and boot receiver APIs.
- **Local data:** Preferences and mode configuration are stored on device; reflections use a Room database. Android app backup is disabled.
- **Testing:** Jest tests cover JavaScript logic and app routing. Python static checks validate native/JS wiring, manifest declarations, and other project invariants.

## Run locally

### Requirements

- Node.js 18 or newer
- Android Studio with an Android SDK and emulator, or a USB-connected Android device
- JDK compatible with the Android Gradle Plugin in this project

### Install and launch

```bash
npm install
npm start
```

In a second terminal, launch the Android app:

```bash
npm run android
```

Some features need user-granted Android access, including Usage Access, Accessibility, and display-over-other-apps access. Follow the in-app setup flow on the device. Monitoring and feed detection should be validated on a real device with the target apps installed; emulator behavior may differ.

## Useful commands

```bash
npm test            # Jest and Python static checks
npm run test:jest   # JavaScript unit tests
npm run test:static # Python static checks
npm run lint        # ESLint
```

## Project layout

```text
App.tsx                              React Native entry point and navigation
components/                          Screens and shared UI
android/app/src/main/java/com/breqk/ Native Android services, modules, and detectors
tests/unit/                          Jest unit tests
tests/static/                        Static architecture and wiring checks
docs/                                Architecture notes, installation, and task history
```

## Project status

Break is an actively developed project. The Android app and core flows are implemented, while reliability of accessibility-based detection can vary as supported apps update their interfaces. Automated tests cover selected logic and project wiring; they do not replace device testing. Store release readiness and iOS feature parity are not claimed.

## Privacy

Usage monitoring and intervention are performed on device. Reflection data is stored in the app's private Room database; the feature has no synchronization path, and attempted URLs are not persisted. See [the reflection privacy notes](docs/REFLECTIONS.md) for details.

## License

This repository is private and proprietary.
