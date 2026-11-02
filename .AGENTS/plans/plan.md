# Implementation Plan: Typed Phrase Confirmation Before Deletion

**Date**: 2026-10-12 | **Spec**: User request — add a toggleable, user-defined typing requirement before deleting the app

## Summary

Add an opt-in “Require phrase to delete” setting to the existing Deletion Prevention controls. When enabled, the user configures a non-empty phrase in the React Native Customize screen. The phrase is stored locally through the existing `SettingsModule`/`BreakPrefs` preference boundary and is consumed by the Android uninstall overlay. On a detected Break uninstall flow, the existing 60-second pause remains unchanged; after the pause, the user must type the configured phrase exactly before the overlay exposes the action that allows the operating-system uninstall flow to continue. When the new toggle is disabled, the current deletion-prevention behavior remains unchanged.

The phrase must never be logged, included in accessibility diagnostics, or sent off-device. Native validation should be authoritative so the requirement cannot be bypassed by manipulating only the React Native UI.

## Technical Context

**Language/Version**: React Native 0.80 / React 19 / TypeScript-compatible JavaScript UI; Android Java
**Primary Dependencies**: React Native `NativeModules`, Android `SharedPreferences`, existing accessibility overlay and service
**Storage**: Existing `Break_prefs` `SharedPreferences` file via `BreakPrefs`; no new database or network path
**Testing**: Jest unit tests for settings/phrase UI behavior; Android JVM tests for phrase validation; existing Python static checks and Android build/test
**Target Platform**: Android; React Native iOS project is out of scope because deletion detection is Android-specific
**Performance Goals**: No additional accessibility tree scans or background work; phrase validation is local and event-driven
**Constraints**:
- Existing Deletion Prevention behavior must remain unchanged when the new toggle is off.
- The phrase is user-configured, non-empty, and stored only on-device.
- Native code must enforce the final confirmation; JS-side validation is only for immediate UX feedback.
- The phrase and typed input must not be logged.
- Existing settings-lock and five-minute disable-pause behavior must continue to apply to the existing deletion-prevention toggle.

## Constitution Check

No repository constitution artifact was present in the inspected workspace. The plan therefore applies the project conventions visible in the README and existing code:

- **Local-first privacy** — PASS: use existing local preferences; do not add synchronization, analytics, or network calls.
- **Centralized preference keys** — PASS: add keys and accessors only in `BreakPrefs`.
- **Native-module wiring symmetry** — PASS: add paired React Native read/write methods and static wiring tests.
- **Opt-in compatibility** — PASS: default the new requirement to disabled and retain current overlay behavior unless enabled.
- **Testable behavior** — PASS: isolate phrase matching in a pure helper and cover both UI and Android JVM paths.

## Applied Guidelines

- **Existing preference pattern**: add new keys to `BreakPrefs` and expose them through `SettingsModule`; do not access `SharedPreferences` directly from React components.
- **Existing uninstall overlay pattern**: extend `UninstallLockOverlay` and `overlay_uninstall_lock.xml`; keep detection in `UninstallScreenDetector` unchanged because phrase confirmation is a post-detection interaction, not a detection signal.
- **Existing saved-settings UX**: use the Customize screen’s existing saved-state/debounced-write conventions and mark the screen dirty when the phrase setting changes.
- **Existing validation conventions**: add focused Jest and Android JVM tests, then run the repository’s `npm run test:jest`, `npm run test:static`, and relevant Android tests.

## Implementation Steps

### Step 1: [Cross-cutting] Define the persisted phrase-confirmation contract
- **Requirements**: REQ-001, REQ-002, REQ-003, REQ-004
- **Design inputs**: Existing deletion-prevention state in `BreakPrefs`, `SettingsModule`, and `UninstallLockOverlay`
- **Description**:
  - Add a boolean preference key for the feature toggle, a string preference key for the configured phrase, and a version/default constant if needed for future migrations.
  - Define the contract explicitly: absent toggle defaults to `false`; absent phrase defaults to empty; outer whitespace is trimmed for storage and comparison; matching is case-sensitive and otherwise exact.
  - Add native helpers for reading/writing the toggle and phrase. Reject or safely ignore blank phrases rather than persisting an enabled feature that can never be completed.
  - Preserve the existing deletion-prevention preference and behavior independently from the new phrase requirement.

### Step 2: [Cross-cutting] Add the settings bridge and Customize controls
- **Requirements**: REQ-001, REQ-002, REQ-004
- **Design inputs**: Existing deletion controls in `customize.js`, `DeletionInfoModal.js`, and `SettingsModule`
- **Description**:
  - Load the new toggle and phrase alongside the existing uninstall-lock state when Customize mounts and regains focus.
  - Add a clearly labeled toggle under Deletion Prevention, disabled unless the existing deletion-prevention feature is enabled, with explanatory copy that the phrase is required after the pause.
  - Add a secure-looking phrase text input shown when the new toggle is enabled. The input must not display or log the phrase unnecessarily; use appropriate Android text-input configuration and accessible labels.
  - Require a non-empty phrase before enabling the new toggle. Keep the control’s error state visible and actionable instead of silently failing.
  - Persist changes through new `SettingsModule` methods, use the existing saved toast/dirty tracking, and avoid changing the existing five-minute flow for turning Deletion Prevention off.
  - Decide and document the UX for turning the phrase requirement off: direct toggle-off is allowed through the new control, while the existing Deletion Prevention toggle continues to use its current five-minute pause.

### Step 3: [US1] Enforce the phrase in the native uninstall overlay
- **Requirements**: REQ-001, REQ-003, REQ-004
- **Design inputs**: Existing timer/button flow in `UninstallLockOverlay.java` and `overlay_uninstall_lock.xml`
- **Description**:
  - Add a phrase input, validation message, and confirm/continue action to the overlay layout without exposing the configured phrase in the UI.
  - Keep the current 60-second wait and “Return to home” escape behavior. After the wait, if the phrase requirement is disabled, preserve the current delete/continue action exactly as it works today.
  - If enabled, keep the uninstall continuation action unavailable until the entered text matches the locally stored phrase according to the contract from Step 1.
  - Validate in native code at the point where the overlay would dismiss/suppress itself for uninstall continuation. Do not rely only on button enabled state or React Native state.
  - Clear input and transient validation state whenever a new overlay instance is shown or dismissed. Do not persist typed input.
  - Ensure the overlay remains usable with keyboard/insets and does not leak the phrase through logcat, accessibility diagnostics, crash messages, or analytics.

### Step 4: [US1] Add focused tests and static wiring coverage
- **Requirements**: REQ-003, REQ-004, REQ-005
- **Design inputs**: Existing `DeletionDisablePauseModal.test.js`, `UninstallScreenDetectorTest.java`, and static bridge/prefs tests
- **Description**:
  - Extract or expose a pure native phrase-matching helper that can be tested without Android UI dependencies.
  - Add Android JVM tests for exact match, empty input, whitespace normalization, case mismatch, extra/missing characters, and null-safe inputs.
  - Add Jest coverage for loading the new settings, enabling only with a valid phrase, saving phrase/toggle changes, and preserving disabled behavior.
  - Extend static tests that verify React Native method names match `SettingsModule`, preference keys are centralized, and the native methods exist.
  - Add a regression test proving the existing uninstall detector remains responsible only for screen detection and is not made phrase-dependent.

### Step 5: [Cross-cutting] Validate documentation, build, and device behavior
- **Requirements**: REQ-005, REQ-006
- **Design inputs**: README platform/testing guidance and existing uninstall feature documentation/comments
- **Description**:
  - Update [README.md](/C:/Users/omran/code/DoomScrollStopper/README.md) to describe the optional typed-phrase deletion safeguard, local-only storage, and Android-only limitation.
  - Update relevant inline native/UI comments so the new toggle and enforcement boundary are discoverable without documenting the actual user’s phrase.
  - Run `npm run test:jest`, `npm run test:static`, `npm run lint`, and the relevant Android unit tests/build.
  - On a real Android device, verify: toggle off preserves current flow; toggle on requires the configured phrase; wrong/case-mismatched/blank input cannot continue; correct input permits the existing uninstall continuation; disabling the feature restores the old flow; app restart retains the toggle and phrase.
  - Verify logs and accessibility output contain no phrase or typed input.

## Project Structure

```text
components/Customize/customize.js
components/Customize/DeletionInfoModal.js
components/Customize/customize.styles.js
android/app/src/main/java/com/breqk/bridge/SettingsModule.java
android/app/src/main/java/com/breqk/prefs/BreakPrefs.java
android/app/src/main/java/com/breqk/uninstall/UninstallLockOverlay.java
android/app/src/main/res/layout/overlay_uninstall_lock.xml
android/app/src/test/java/com/breqk/uninstall/UninstallLockOverlayTest.java
tests/unit/customizeDeletionPhrase.test.js
tests/static/test_021_settingsmodule_methods_exist_in_java.py
tests/static/test_041_js_pref_keys_match_java.py
README.md
```

## Testing Strategy

- **appType**: Mobile UI with Android native accessibility-service integration
- **Critical user journeys**:
  1. User enables Deletion Prevention and configures a non-empty typed phrase.
  2. User opens the Break uninstall screen with phrase protection disabled and experiences the existing pause/continue flow.
  3. User opens the Break uninstall screen with phrase protection enabled; incorrect input remains blocked and exact correct input enables continuation.
  4. User restarts the app and verifies the toggle and phrase remain configured locally.
  5. User disables phrase protection and verifies the old deletion-prevention flow returns.
- **primaryValidationStack**: Jest for React Native behavior, Android JVM tests for pure native validation, Gradle Android unit/build checks, then real-device accessibility flow validation.
- **fallbackMatrix**:
  - `native-tier`: Android JVM/Gradle tests → static source checks if an emulator/device is unavailable. Prerequisite: Android SDK/JDK/Gradle environment.
  - `device-tier`: real Android device with Accessibility permission → emulator smoke test for layout/state only. Prerequisite: target Android settings/package installer.
- **Environment requirements**: Node.js 18+, installed npm dependencies, Android SDK/JDK compatible with the project, and a real Android device for final accessibility/uninstall verification.
- **knownGaps**: OEM Settings/package-installer labels and keyboard/inset behavior may vary; static/JVM tests cannot prove every OEM overlay layout or uninstall navigation path.
- **Test data strategy**: Use deterministic phrases such as `DELETE BREAK NOW` in tests; reset `SharedPreferences` between native tests; never use or print a real user phrase.
- **Acceptance criteria**:
  - Feature is off by default and does not alter existing deletion prevention.
  - The settings screen can save and reload a non-empty user phrase.
  - Native uninstall continuation is blocked for every non-exact phrase and enabled only for the exact configured phrase.
  - No phrase or typed input appears in logs or persisted transient state.
  - Existing test suites and static wiring checks pass.
- **Validation review expectations**: Confirm the final gate is native, persistence defaults are backward-compatible, the toggle dependency is clear, and the device flow does not provide an accidental bypass.

## Task Breakdown

### Phase 1: Foundational preference and bridge work

- [ ] T001 [Plan:1.1] Add phrase-protection preference keys, defaults, normalization rules, and accessors in `android/app/src/main/java/com/breqk/prefs/BreakPrefs.java`.
- [ ] T002 [P] [Plan:1.1] Add `SettingsModule` React Native methods to get/set the phrase-protection toggle and configured phrase in `android/app/src/main/java/com/breqk/bridge/SettingsModule.java`.
- [ ] T003 [P] [Plan:1.1] Extend bridge and preference static checks for the new methods and keys in `tests/static/test_021_settingsmodule_methods_exist_in_java.py` and `tests/static/test_041_js_pref_keys_match_java.py`.

### Phase 2: Settings user story — configure the safeguard

- [ ] T004 [US1] [Plan:2.1] Load phrase-protection state and phrase, add toggle/input validation, and persist changes through `SettingsModule` in `components/Customize/customize.js`.
- [ ] T005 [P] [US1] [Plan:2.1] Add accessible copy and styling for the phrase toggle/input and validation state in `components/Customize/customize.styles.js`.
- [ ] T006 [P] [US1] [Plan:2.1] Update deletion-prevention explanation to describe the optional phrase step without exposing stored values in `components/Customize/DeletionInfoModal.js`.
- [ ] T007 [US1] [Plan:2.1] Add Jest tests for configuration, blank-phrase rejection, persistence calls, reload behavior, and feature-off compatibility in `tests/unit/customizeDeletionPhrase.test.js`.

### Phase 3: Uninstall user story — enforce the configured phrase

- [ ] T008 [US1] [Plan:3.1] Add the phrase input, validation feedback, and post-wait confirmation controls to `android/app/src/main/res/layout/overlay_uninstall_lock.xml`.
- [ ] T009 [US1] [Plan:3.1] Enforce exact native phrase matching at uninstall continuation, reset transient input state, preserve the current timer/home escape, and avoid phrase logging in `android/app/src/main/java/com/breqk/uninstall/UninstallLockOverlay.java`.
- [ ] T010 [P] [US1] [Plan:3.1] Add a pure phrase-matching helper and Android JVM tests covering valid, invalid, blank, null, whitespace, and case-mismatch input in `android/app/src/test/java/com/breqk/uninstall/UninstallLockOverlayTest.java`.
- [ ] T011 [US1] [Plan:3.1] Add regression assertions that `android/app/src/main/java/com/breqk/uninstall/UninstallScreenDetector.java` remains detection-only and that the service gates the overlay using the existing toggle in `android/app/src/main/java/com/breqk/ReelsInterventionService.java`.

### Phase 4: Polish and validation

- [ ] T012 [P] [Plan:5.1] Update user-facing feature and privacy documentation in `README.md`.
- [ ] T013 [P] [Plan:5.1] Run targeted Jest, static, lint, Android unit, and Android build validation; record any device-only checks that require a real Settings/package-installer flow.
- [ ] T014 [Plan:5.1] Perform real-device acceptance testing for toggle-off compatibility, exact phrase enforcement, persistence across restart, keyboard/inset usability, and absence of phrase data in logs.

## Requirement Mapping

| REQ ID | Description | Plan Items | Implementation Evidence |
|--------|-------------|------------|------------------------|
| REQ-001 | Add a toggleable setting that controls whether deletion requires typing | 1.1, 2.1, 3.1 | `BreakPrefs.java`, `SettingsModule.java`, `customize.js`, `UninstallLockOverlay.java` |
| REQ-002 | Let the user set a non-empty phrase in Settings | 1.1, 2.1 | `BreakPrefs.java`, `SettingsModule.java`, `customize.js`, `customize.styles.js` |
| REQ-003 | Require the configured phrase before allowing deletion to continue | 3.1 | `overlay_uninstall_lock.xml`, `UninstallLockOverlay.java`, `UninstallLockOverlayTest.java` |
| REQ-004 | Persist the setting locally and preserve it across app restarts with safe defaults | 1.1, 2.1, 3.1 | `BreakPrefs.java`, `SettingsModule.java`, Customize reload tests, Android JVM tests |
| REQ-005 | Preserve existing deletion-prevention behavior when the new feature is disabled | 2.1, 3.1, 5.1 | Existing overlay/service flow, regression tests, device acceptance test |
| REQ-006 | Document and validate the feature without leaking phrase data | 5.1 | `README.md`, Jest/static/Android validation, device log review |

## Complexity Tracking

No constitution violations identified. No additional complexity exception is required.
