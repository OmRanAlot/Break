# Plan — Python Test Suite for Security, Vulnerabilities, and Core Features

> Feature: Extend `tests/static/` into a comprehensive Python harness that
> verifies the whole Breqk app — manifest wiring, JS↔Java bridge, prefs keys,
> security posture (OWASP Mobile Top 10 surface), and core feature integrity.
> Author: Claude (xhigh, Opus 4.7) — 2026-05-04
> Touches: `tests/`, `tests/static/`, `tests/static/_paths.py`,
> `tests/static/_harness.py`, plus ~30 new `test_NNN_*.py` files.
> Production code: **not modified** — diagnostic-only.

---

## 1. Restated Requirements

User wants a **runnable Python test harness** that, from a clean checkout, can:

1. **Verify core features still wire correctly** — manifest entries, services,
   accessibility configs, JS↔Java bridge methods, and SharedPreferences keys
   all line up with the documented architecture in `CLAUDE.md` and
   `docs/TASKS.md`.
2. **Surface vulnerabilities** — OWASP Mobile-style static checks: secrets,
   exported components, debuggable flag, cleartext HTTP, WebView JS, dynamic
   class loading, world-readable prefs, deep-link scheme abuse, runtime exec.
3. **Surface security risks** — release build with debug keystore (B8),
   `versionCode=1` (B5), ProGuard disabled, missing network-security-config,
   missing release signing, etc.
4. **Run on Windows** — the user's primary environment (PowerShell, no grep);
   reuses the existing `tests/static/run_all.py` runner and PowerShell shim.
5. **Stay zero-dependency by default** — pure Python 3.8+ stdlib, like the
   existing harness. Optional integrations with `bandit` / `semgrep` /
   `gradlew lint` skip cleanly when the binary or device is missing.

---

## 2. Why a Python Harness (and Not Jest / Junit / Detox)

Already established by `tests/static/`:

- Cross-cutting checks (manifest ↔ Java ↔ JS ↔ docs) sit **above** any single
  toolchain. Jest can't read AndroidManifest; Junit can't see JS bridges.
- A single Python script with stdlib `re` + `xml.etree` covers all of it
  without bringing pytest, gradle plugins, or RN test runners into scope.
- The existing harness pattern (one `RESULT: STATUS: reason` line per test,
  fast/slow tier, PowerShell shim, color-coded summary) already works. We
  **extend** it instead of inventing a parallel system.

Slow tier (`test_NNN >= 90`) cleanly hosts integrations that *do* require a
toolchain — `npm run lint`, `tsc --noEmit`, `gradlew assembleDebug`, `adb`
smoke checks — gated behind binary-availability `SKIP`s.

---

## 3. Existing Harness Inventory

```
tests/
└── static/
    ├── _paths.py               # PROJECT_ROOT, ANDROID_SRC, MANIFEST, …
    ├── _harness.py             # PASS/FAIL/WARN/SKIP, parse_manifest,
    │                           #   class_name_to_path, grep_java, grep_js
    ├── run_all.py              # discovers test_*.py, fast/slow filtering,
    │                           #   --strict / --filter / --verbose / --list
    ├── run_tests.ps1           # Windows PowerShell shim → run_all.py
    ├── test_001_manifest_services_have_classes.py
    └── test_002_manifest_classes_have_services.py
```

**Conventions to keep (and tighten):**

| Convention | Rule |
|---|---|
| File naming | `test_NNN_short_name.py` |
| Tier | NNN < 90 = fast; NNN ≥ 90 = slow (`--slow`) |
| Result | exactly one `RESULT: <PASS|FAIL|WARN|SKIP>: <reason>` line — last line of stdout |
| Imports | `from _harness import …`; `from _paths import …` |
| Header docstring | `WHAT / WHY / HOW / OUTPUTS / EXTEND` blocks (see §3.1) |
| Console output | Banner → step prints → per-finding prints → summary → RESULT (see §3.2) |
| Configurable surface | `ALLOWLIST` / threshold constants live at the top of the file in a `CONFIG` block, not buried in `main()` |
| Output for failures | print `MISSING:` / `ORPHAN:` / `LEAK:` lines before the RESULT |

### 3.1 Per-File Docstring Contract (mandatory)

Every `test_NNN_*.py` file MUST start with this docstring. The five
headings are required so a human or another agent can understand the test
without reading code:

```python
"""
test_NNN_short_name.py
======================

WHAT:
  One short paragraph in plain English describing the assertion.
  Example: "Verifies every <service> declared in AndroidManifest.xml has a
  matching Java class file on disk."

WHY:
  Why this check matters — what bug class it prevents, what fails in
  production if the assertion is broken. Reference real incidents where
  helpful (e.g. "ContentFilterService was added to the manifest before the
  Java file existed; the app crashed at runtime when Android tried to bind
  the accessibility service").

HOW:
  Numbered steps describing the algorithm:
    1. Parse AndroidManifest.xml with ElementTree.
    2. Iterate every <service android:name="…">.
    3. Convert the name to an expected file path (handles ".Short" + full).
    4. Assert the .java file exists on disk.

OUTPUTS:
  PASS — every <service> resolves to an existing Java file.
  FAIL — one or more <service> entries point at a missing class. Console
         lists each as: "MISSING: <serviceName> -> <expectedPath>".
  WARN — (not used by this test) — only used for non-blocking issues.
  SKIP — (not used by this test) — only used when a prerequisite is absent
         (e.g. binary not on PATH, optional config file missing).

EXTEND:
  - To skip a service deliberately, add its short name to ALLOWLIST below.
  - To check a different manifest, override _paths.MANIFEST.
  - To change Java path resolution, edit class_name_to_path() in _harness.py.
"""
```

`OUTPUTS` is the section the user explicitly asked for: every status the
test can emit, what it means, and what the human/agent reading the run will
see in the console.

### 3.2 Console Output Contract (mandatory)

Each test prints a small, structured "live" trace before the final
`RESULT:` line so a person — or another agent reading captured stdout —
can see what was checked, what was found, and where to look. The runner
(`run_all.py`) captures all of this and echoes it on FAIL/ERROR or when
`--verbose` is passed; in normal mode only the `RESULT:` line surfaces, so
the verbose trace is "free" — never noisy by default.

Required pattern:

```
[test_NNN_short_name] WHAT (one-line restatement of WHAT from docstring)
  step 1 …                     # one line per HOW step actually performed
  step 2 …
  scanned: 47 java files
  candidates: 3 services
  VIOLATION: foo.bar.MissingService -> .../java/com/breqk/foo/bar/MissingService.java
  VIOLATION: foo.bar.OtherMissing  -> .../java/com/breqk/foo/bar/OtherMissing.java
  summary: 2 violation(s) of 3 services scanned
RESULT: FAIL: 2 service(s) declared in manifest with no matching Java class
```

Conventions inside the trace:

| Prefix | Meaning |
|---|---|
| `[test_NNN_name]` | Banner line — first line of every test |
| `  ` (2-space indent) | Progress / step / scan output |
| `VIOLATION:` | A single found problem (one per line) — same format as `MISSING:`/`ORPHAN:`/`LEAK:` allowed by existing tests |
| `WARN-CANDIDATE:` | A soft finding that is being downgraded by the test (so reviewers can see what was almost a violation) |
| `SKIPPED:` | A subject that was deliberately not checked (allowlist hit) |
| `summary:` | Final aggregate counts before the RESULT line |
| `RESULT:` | Single mandatory final line (parsed by `run_all.py`) |

This works alongside `run_all.py`'s existing behavior: the runner captures
combined stdout/stderr and only echoes it on FAIL/ERROR or with
`--verbose`, so PASS runs stay quiet but a failure always shows the full
trace and the docstring's `OUTPUTS:` section is right there in the file
explaining what each line means.

---

## 4. Test Catalog (Proposed)

Numbering reserves blocks of 20 per concern so tests can be added later
without reshuffling the run order.

### 4.1 Manifest & Wiring (010 – 019, fast)

| # | File | Asserts |
|---|---|---|
| 010 | `test_010_required_permissions_declared.py` | All required `<uses-permission>` from `CLAUDE.md` are present (INTERNET, FOREGROUND_SERVICE, POST_NOTIFICATIONS, PACKAGE_USAGE_STATS, ACCESS_NETWORK_STATE, SYSTEM_ALERT_WINDOW, QUERY_ALL_PACKAGES, FOREGROUND_SERVICE_SPECIAL_USE, SCHEDULE_EXACT_ALARM, RECEIVE_BOOT_COMPLETED). WARN if extras appear that aren't in the allowlist. |
| 011 | `test_011_no_vpn_service_regression.py` | Guards B2 fix: no Java file `extends VpnService`; manifest has no `BIND_VPN_SERVICE` permission, no `<service>` with `foregroundServiceType="vpn"`, no VPN intent-filter `android.net.VpnService`. |
| 012 | `test_012_accessibility_service_xml_resources_exist.py` | For every `<service>` declaring `<meta-data android:name="android.accessibilityservice">`, the referenced `@xml/<resource>` file exists in `res/xml/` and parses as XML. |
| 013 | `test_013_accessibility_services_permission_guard.py` | Every accessibility `<service>` element has `android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"`. |
| 014 | `test_014_device_admin_permission_guard.py` | `BreqkDeviceAdminReceiver` has `android:permission="android.permission.BIND_DEVICE_ADMIN"` and a `<meta-data android:name="android.app.device_admin">` pointing to an existing `res/xml/device_admin.xml`. |
| 015 | `test_015_exported_components_justified.py` | For every `<activity|service|receiver android:exported="true">`: must have either a launcher intent-filter, `breqk` deep-link, BIND-flavoured permission, or be one of the AppWidget receivers. Lists violators. |
| 016 | `test_016_no_debuggable_attribute.py` | `<application>` does **not** set `android:debuggable="true"`. (Build types should drive this.) |
| 017 | `test_017_allow_backup_disabled.py` | `android:allowBackup="false"` and (warn-only) `android:fullBackupContent` not set. |
| 018 | `test_018_main_activity_launchmode_singletask.py` | `MainActivity` uses `android:launchMode="singleTask"` (deep-link routing depends on this). |
| 019 | `test_019_deep_link_scheme_locked_down.py` | The only deep-link `<intent-filter>` uses `scheme="breqk"` AND a non-empty `host` (no wildcard hosts; no `http`/`https` deep links accepted by `MainActivity`). |

### 4.2 JS ↔ Java Bridge Consistency (020 – 029, fast)

| # | File | Asserts |
|---|---|---|
| 020 | `test_020_vpnmodule_methods_exist_in_java.py` | Every `NativeModules.VPNModule.<x>(` invocation in `components/**` and `App.tsx` has a matching `@ReactMethod ... <x>(` in `bridge/VPNModule.java`. Reports `MISSING_JAVA: foo()`. |
| 021 | `test_021_settingsmodule_methods_exist_in_java.py` | Same check against `bridge/SettingsModule.java`. |
| 022 | `test_022_no_orphan_react_methods.py` | WARN: every `@ReactMethod` in `bridge/*.java` is called at least once from JS. Catches dead bridge code. |
| 023 | `test_023_module_names_match.py` | `getName()` return value in each `*Module.java` matches both the `MODULE_NAME` constant *and* the JS `NativeModules.<Name>` access string. |

Helper to add to `_harness.py`:

```python
def find_react_methods(java_file: Path) -> list[str]:
    """Return method names declared with @ReactMethod in a Java file."""
    text = java_file.read_text(encoding="utf-8", errors="ignore")
    return re.findall(
        r"@ReactMethod\s*(?:\([^)]*\))?\s*(?:public\s+)?(?:final\s+)?\s*\w[\w<>\[\] ]*\s+(\w+)\s*\(",
        text,
    )

def find_js_bridge_calls(root: Path, module: str) -> set[str]:
    """Return method names called as NativeModules.<module>.<name>(...) anywhere in JS/TS."""
    pat = re.compile(rf"(?:NativeModules\.)?{re.escape(module)}\.(\w+)\s*\(")
    found = set()
    for hit in grep_js(root, pat.pattern):
        found.add(pat.search(hit[2]).group(1))
    return found
```

### 4.3 SharedPreferences Key Hygiene (040 – 049, fast)

| # | File | Asserts |
|---|---|---|
| 040 | `test_040_pref_keys_centralized.py` | Java files outside `BreqkPrefs.java` and `WidgetPrefs.java` should not contain raw string literals matching keys defined in `BreqkPrefs.KEY_*` (forces use of constants). Configurable allowlist for migration code. |
| 041 | `test_041_js_pref_keys_match_java.py` | Every key string passed to `SettingsModule.getSetting('xxx')` / `setSetting('xxx', …)` from JS exists as a `KEY_*` constant in `BreqkPrefs.java`. Reports JS key → no matching Java constant. |
| 042 | `test_042_single_prefs_file_name.py` | The literal string `"breqk_prefs"` only appears in `BreqkPrefs.java` (everyone else must call `BreqkPrefs.get(context)`). |

### 4.4 Code Structure & Documentation (060 – 069, fast)

| # | File | Asserts |
|---|---|---|
| 060 | `test_060_file_size_limit.py` | No file in `android/app/src/main/java/`, `components/`, or top-level TS/JS over 1500 lines. WARN at 800 lines. (Known WARN: `customize.js` at 1723 = B12.) |
| 061 | `test_061_logging_tags_in_dictionary.py` | Every `private static final String TAG = "X"` and `Log.d("X", …)` literal tag has a row in `docs/LOGGING.md`. |
| 062 | `test_062_no_println_in_production.py` | Java has zero `System.out.println(`. WARN on `console.log(` outside `tests/`, `__tests__/`, `*.test.js`. |
| 063 | `test_063_javadoc_on_public_classes.py` | Every Java file has either a `/** … */` block or `/* … */` description comment in its first 30 lines. |
| 064 | `test_064_strings_xml_used_for_user_strings.py` | WARN: hardcoded English strings (≥3 alpha words) in `res/layout/*.xml` should use `@string/`. |
| 065 | `test_065_no_orphan_java_classes.py` | WARN: every `*.java` is referenced from another Java file, the manifest, or `MainApplication.kt`. Allowlist for ReactPackage entries already wired by RN autolinking. |

### 4.5 Security — Static (080 – 094, fast)

OWASP Mobile Top 10 surface, restricted to what's detectable from source.

| # | File | Asserts |
|---|---|---|
| 080 | `test_080_no_hardcoded_secrets.py` | Regex scan across Java/JS/Kotlin for: `AKIA[0-9A-Z]{16}` (AWS), `AIza[0-9A-Za-z\-_]{35}` (Google), `xox[abp]-[0-9A-Za-z-]+` (Slack), `sk_live_…`, `-----BEGIN (?:RSA |EC )?PRIVATE KEY-----`, JWTs, GitHub PATs, generic `(?i)(api[_-]?key|secret|password|token)\s*[=:]\s*["'][^"']{12,}`. Skips test fixture files. |
| 081 | `test_081_no_cleartext_http.py` | No `http://` URLs in source — except localhost / `127.0.0.1` / `10.0.2.2` (Android emulator host). |
| 082 | `test_082_proguard_release_minify.py` | `enableProguardInReleaseBuilds = true` in `android/app/build.gradle`. **Currently false → expected FAIL** (security baseline). |
| 083 | `test_083_release_signing_not_debug.py` | Release build does not reuse `signingConfigs.debug`. **Currently does → expected FAIL (B8).** Detect by parsing `build.gradle` for `release { … signingConfig signingConfigs.debug }`. |
| 084 | `test_084_versioncode_launch_ready.py` | `versionCode >= 100`. **Currently 1 → expected FAIL (B5).** |
| 085 | `test_085_webview_javascript_audit.py` | `react-native-webview` usage: WARN for any `<WebView … javaScriptEnabled` not paired with `originWhitelist=` or `onShouldStartLoadWithRequest=`. |
| 086 | `test_086_dangerous_js_patterns.py` | Forbid in JS: `eval(`, `new Function(`, `dangerouslySetInnerHTML`, direct `innerHTML =` writes. |
| 087 | `test_087_runtime_exec_forbidden.py` | Forbid in Java: `Runtime.getRuntime().exec(`, `new ProcessBuilder(`. |
| 088 | `test_088_world_readable_prefs.py` | Forbid `MODE_WORLD_READABLE`, `MODE_WORLD_WRITEABLE`, `Context.MODE_WORLD_*`. |
| 089 | `test_089_dynamic_classloading_audit.py` | WARN for any `Class.forName(` whose argument isn't a string literal (string-concatenation = potential injection vector). |
| 090 | `test_090_no_committed_secret_files.py` | Walks the repo (skipping `node_modules/`, `android/build/`, `android/.gradle/`, `.git/`) and FAILs on any `*.pem`, `*.key`, `*.p12`, `*.jks` (other than `android/app/debug.keystore`), `*.env`, `id_rsa*`. (Slow tier number 090 reserved by harness convention; this test runs fast — keep at 090 to align with harness slow threshold but mark `--fast` via in-file SLOW=False flag, OR renumber to 075 if strict.) |
| 091 | `test_091_dependency_lockfile_present.py` | `package-lock.json` exists at repo root and is non-empty. |
| 092 | `test_092_network_security_config_present.py` | WARN if `res/xml/network_security_config.xml` is absent (means cleartext is allowed by default on `targetSdk < 28` paths). If present, parse and require `cleartextTrafficPermitted="false"` on the base config. |
| 093 | `test_093_unsafe_intent_filter_audit.py` | Activities with intent-filter must use scheme=`breqk` only. WARN on any `http`/`https` data scheme; FAIL on any wildcard host or empty scheme. |
| 094 | `test_094_accessibility_service_data_minimization.py` | Audit each `res/xml/<accessibility>.xml`: `accessibilityFlags` doesn't grant more than needed; `canRetrieveWindowContent="true"` is intentional (we use it; surface as INFO so reviewers eyeball it on every change). Implemented as a documenting WARN that prints the resolved attribute set. |

> **Numbering note:** 090 collides with the existing slow-tier threshold in
> `run_all.py` (`SLOW_THRESHOLD = 90`). Either renumber the security FS-walk
> test to 075 (recommended), or bump `SLOW_THRESHOLD` to 100. The plan picks
> **renumber 090 → 075** during execution to keep the slow threshold meaningful.

### 4.6 Build / Toolchain Verification (100 – 119, slow tier — `--slow`)

These shell out to project tooling. Each SKIPs cleanly if the binary is
missing on PATH or if `node_modules/` / `android/gradle/` aren't installed
yet.

| # | File | Asserts |
|---|---|---|
| 100 | `test_100_npm_lint.py` | `npm run lint --silent` exits 0. SKIP if `node_modules/` absent. |
| 101 | `test_101_typescript_noemit.py` | `npx --no-install tsc --noEmit` exits 0. SKIP if `tsc` not installed. |
| 102 | `test_102_jest_smoke.py` | `npm test --silent -- --passWithNoTests --watchAll=false` exits 0. SKIP if jest not configured. |
| 103 | `test_103_gradle_assemble_debug.py` | `./gradlew assembleDebug --no-daemon -q` exits 0 (uses `gradlew.bat` on Windows). SKIP if Java/`gradlew` missing. Long timeout (10 min). |
| 104 | `test_104_android_lint.py` | `./gradlew lintDebug` and parse the resulting XML report under `app/build/reports/lint-results-debug.xml`. FAIL on any `Severity="Error"`; WARN on aggregate of >5 warnings of severity `Warning`. SKIP if gradle absent. |
| 105 | `test_105_react_native_doctor.py` | `npx --no-install react-native doctor --silent` for environment health. WARN-only (informational). |

Gradle's own Android Lint already covers a lot of native security ground
(unused permissions, exported-without-permission, hardcoded text) so 104 is
the highest-leverage slow test.

### 4.7 Optional Dynamic / Device Tests (120 – 139, slow tier)

All SKIP cleanly if `adb` is not on PATH or no device is attached. Used
during pre-release smoke testing.

| # | File | Asserts |
|---|---|---|
| 120 | `test_120_adb_device_present.py` | `adb devices` lists at least one device. SKIP otherwise. (Acts as the gate for everything below.) |
| 121 | `test_121_adb_app_installed.py` | `adb shell pm list packages com.breqk` returns `com.breqk`. |
| 122 | `test_122_adb_accessibility_enabled.py` | `adb shell settings get secure enabled_accessibility_services` contains `com.breqk/.ReelsInterventionService`. |
| 123 | `test_123_adb_logcat_smoke.py` | Run `adb logcat -d -s REELS_WATCH BreqkVpnService` and confirm at least one log line per Breqk tag has been emitted in the buffer (proves the services started at boot). |
| 124 | `test_124_adb_no_native_crashes.py` | `adb shell dumpsys dropbox --print` filtered for `data_app_native_crash` or `data_app_anr` tagged with `com.breqk` is empty (catches background ANRs you'd otherwise miss). |

### 4.8 Optional Third-Party Scanners (140 – 149, slow tier, all SKIP-by-default)

| # | File | Asserts |
|---|---|---|
| 140 | `test_140_bandit_scan.py` | `bandit -r tests/` (the Python harness itself). SKIP if `bandit` not installed. |
| 141 | `test_141_semgrep_scan.py` | `semgrep --config=p/owasp-top-ten --error .` scoped to Java/JS. SKIP if `semgrep` not installed. |
| 142 | `test_142_npm_audit.py` | `npm audit --omit=dev --audit-level=high --json` parsed; FAIL if any high/critical advisories. SKIP if `npm` missing. |
| 143 | `test_143_mobsf_scan.py` | If `MOBSF_URL` and `MOBSF_API_KEY` env vars are set, upload latest debug APK and assert score ≥ a configurable threshold. SKIP otherwise. |

---

## 5. Helper Additions

### 5.1 `_paths.py`

Add path constants used by new tests:

```python
RES_LAYOUT_DIR              = ANDROID_SRC / "res" / "layout"
NETWORK_SECURITY_CONFIG     = ANDROID_SRC / "res" / "xml" / "network_security_config.xml"
ACCESSIBILITY_REELS_CONFIG  = ANDROID_SRC / "res" / "xml" / "reels_intervention_service_config.xml"
ACCESSIBILITY_FILTER_CONFIG = ANDROID_SRC / "res" / "xml" / "content_filter_accessibility_config.xml"
DEVICE_ADMIN_XML            = ANDROID_SRC / "res" / "xml" / "device_admin.xml"
WIDGET_INFO_XML             = ANDROID_SRC / "res" / "xml" / "widget_breqk_info.xml"
APP_TSX                     = PROJECT_ROOT / "App.tsx"
DEBUG_KEYSTORE              = PROJECT_ROOT / "android" / "app" / "debug.keystore"
PACKAGE_LOCK                = PROJECT_ROOT / "package-lock.json"
SCAN_EXCLUDE_DIRS           = {
    "node_modules", ".git", "build", ".gradle",
    "android/.cxx", "android/build", "android/app/build",
    ".idea", ".bundle",
}
```

### 5.2 `_harness.py`

```python
def run_subprocess(args: list[str], cwd: Path, timeout: int = 600) -> tuple[int, str, str]:
    """Run a subprocess and return (returncode, stdout, stderr).
    Caller decides PASS/FAIL/SKIP. Returns (-1, '', 'binary missing') on FileNotFoundError."""

def binary_available(name: str) -> bool:
    """shutil.which() check, normalized for Windows .exe / .cmd / .bat lookup."""

def find_react_methods(java_file: Path) -> list[str]: ...
def find_js_bridge_calls(root: Path, module: str) -> set[str]: ...

def walk_source_files(
    extensions: tuple[str, ...] = (".java", ".kt", ".js", ".jsx", ".ts", ".tsx"),
    skip_dirs: set[str] | None = None,
) -> Iterable[Path]: ...

def parse_gradle_kv(gradle_text: str, key: str) -> str | None: ...
def parse_release_signing_config(gradle_text: str) -> str | None: ...
def parse_versioncode(gradle_text: str) -> int | None: ...
```

### 5.3 `tests/static/README.md` (new — the "overview MD")

This is the overview document the user asked for — humans and agents read
this first to understand the harness without reading every test file. It
will be created as part of Wave 1. Outline (each `##` is a section in the
final file):

```
# Breqk Static Test Harness

## What this is
One paragraph: the harness is a zero-dependency Python 3.8+ stack of small
self-contained tests under `tests/static/` that audit manifest wiring,
JS↔Java bridge consistency, prefs key hygiene, code structure, and a static
security surface. It exists alongside (not instead of) Jest/JUnit/Detox.

## Quick start
- Windows:  pwsh tests/static/run_tests.ps1
- Bash:     python tests/static/run_all.py
- Slow tier (toolchain + adb): add --slow
- Verbose:  add --verbose
- One test: add --filter <substring>
- List only: add --list

## What it covers (and what it does not)
| Category | Covered? |
|----------|----------|
| Manifest ↔ Java class wiring | ✅ tests 001/002/010-019 |
| JS ↔ Java bridge methods | ✅ tests 020-023 |
| SharedPreferences key hygiene | ✅ tests 040-042 |
| Code structure / docs / log tags | ✅ tests 060-065 |
| OWASP Mobile static surface | ✅ tests 075-094 |
| Build / lint (gradle, tsc, eslint) | ✅ tests 100-105 (slow) |
| Live device smoke (adb) | ✅ tests 120-124 (slow) |
| Optional 3rd-party scanners | ✅ tests 140-143 (slow, opt-in) |
| Espresso / Detox / Jest UI tests | ❌ out of scope |
| Real penetration testing | ❌ out of scope (MobSF in 143 is closest) |

## How to read the output
- `[test_NNN_name] …` — banner
- `  step …` — progress
- `VIOLATION: …` / `MISSING: …` / `ORPHAN: …` — one finding per line
- `summary: …` — aggregate counts
- `RESULT: PASS|FAIL|WARN|SKIP: <reason>` — final line, parsed by runner

Status meanings:
- PASS — assertion holds
- WARN — soft signal (e.g. file > 800 lines, optional config absent)
- FAIL — hard signal (real bug, secret leak, missing class)
- SKIP — prerequisite missing (binary not on PATH, no device attached)

The runner echoes the full trace on FAIL/ERROR or `--verbose`; PASS runs
stay quiet.

## Numbering scheme (reserve blocks of 20)
- 001-009  — original manifest tests
- 010-019  — manifest & wiring extensions
- 020-029  — JS↔Java bridge consistency
- 040-049  — SharedPreferences hygiene
- 060-069  — code structure & documentation
- 075-094  — security (static)
- 100-119  — build / toolchain (slow)
- 120-139  — adb device smoke (slow)
- 140-149  — optional third-party scanners (slow)

NNN ≥ 90 is "slow tier" by `run_all.py` convention — only runs with --slow.

## Anatomy of a test file
Every test follows the template at `tests/static/_template.py`. Required
sections in order:
  1. Module docstring with WHAT / WHY / HOW / OUTPUTS / EXTEND headings.
  2. CONFIG block (constants, allowlists) at the top of the module.
  3. main() that prints a banner, walks its inputs with progress prints,
     emits one VIOLATION/MISSING/ORPHAN line per finding, prints a summary,
     and ends with exactly one `result(STATUS, "…")` call.

## How to add a test (5 steps)
  1. Copy `tests/static/_template.py` to `test_NNN_<short_name>.py`.
  2. Fill in WHAT/WHY/HOW/OUTPUTS/EXTEND.
  3. Define your CONFIG constants (paths from `_paths`, allowlists).
  4. Implement main(): banner print → scan → per-finding prints → summary →
     `result(PASS|WARN|FAIL|SKIP, "…")`.
  5. Run `pwsh tests/static/run_tests.ps1 --filter <short_name> --verbose`
     to see the trace.

## How to allowlist a false positive
Each test exposes an `ALLOWLIST` constant near the top. Add the symbol /
file / class name there with a short comment explaining why. Allowlist
entries appear as `SKIPPED: <name>  # reason` in the verbose trace so the
exclusion is visible during review.

## Bug-to-test guard map
This table makes it explicit which test catches a regression of which bug.
Update whenever a P0 bug is fixed — the test should keep guarding it.

| Bug ID | Description | Guard test |
|--------|-------------|------------|
| B2     | BreqkVpnService extending VpnService | `test_011_no_vpn_service_regression.py` |
| B5     | versionCode = 1 (launch blocker) | `test_084_versioncode_launch_ready.py` |
| B8     | Release build uses debug keystore | `test_083_release_signing_not_debug.py` |
| B9     | Verbose logging in production | `test_062_no_println_in_production.py` |
| B12    | customize.js > 1500 lines | `test_060_file_size_limit.py` |
| (security baseline) | ProGuard disabled in release | `test_082_proguard_release_minify.py` |

## Known intentional reds
The harness will FAIL out-of-the-box on:
  082 (proguard release minify), 083 (release signing), 084 (versionCode).
These three correspond to documented launch blockers in `docs/TASKS.md`
(B5/B8/security baseline). Fix the production code, then the harness goes
green. The harness should never be made green by relaxing these tests.

## Extension points (for agents)
Agents iterating on this harness should:
  - Read this README, then `_template.py`, then any existing test in the
    target category for an example.
  - Add helpers to `_harness.py` rather than duplicating logic.
  - Add new path constants to `_paths.py` rather than hardcoding paths.
  - Never write a test that imports a third-party package without a SKIP
    fallback when that package is missing.
  - Never emit more than one `RESULT:` line.
```

### 5.4 `tests/static/_template.py` (new)

Authoritative template every new test starts from. Concrete content (this
file is committed verbatim — it's not a fragment):

```python
"""
test_NNN_short_name.py
======================

WHAT:
  <One short paragraph describing what this test asserts.>

WHY:
  <Why this check matters — what bug class it prevents.>

HOW:
  1. <step>
  2. <step>
  3. <step>

OUTPUTS:
  PASS — <what is true when the test passes>.
  WARN — <soft signal — what triggers it, why it isn't a hard fail>.
  FAIL — <hard signal — what triggers it, what to do about it>.
  SKIP — <prerequisite missing — when this fires>.

EXTEND:
  - To allowlist a false positive: add to ALLOWLIST below.
  - To change a threshold: edit constants in CONFIG below.
  - Source paths come from _paths.py — add new paths there, not here.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _harness import PASS, FAIL, WARN, SKIP, result
from _paths import PROJECT_ROOT  # plus whatever else you need

# ── CONFIG (mold these for your check) ─────────────────────────────────
ALLOWLIST: set[str] = set()       # symbols / files / classes to ignore
THRESHOLD: int = 0                # numeric threshold(s), if any
TEST_ID = Path(__file__).stem     # used in banner/print prefixes


def main() -> None:
    print(f"[{TEST_ID}] <one-line restatement of WHAT>")

    # ── HOW: step 1 ────────────────────────────────────────────────────
    # print("  step 1: <what we're doing>")

    # ── HOW: step 2 — gather candidates ────────────────────────────────
    candidates: list = []
    # print(f"  scanned: {n} files; candidates: {len(candidates)}")

    # ── HOW: step 3 — evaluate ─────────────────────────────────────────
    violations: list = []
    for c in candidates:
        if c in ALLOWLIST:
            print(f"  SKIPPED: {c}  # allowlisted")
            continue
        # if violated:
        #     violations.append(c)
        #     print(f"  VIOLATION: {c}")

    # ── summary ────────────────────────────────────────────────────────
    print(f"  summary: {len(violations)} violation(s) of {len(candidates)} scanned")

    # ── RESULT (exactly one) ───────────────────────────────────────────
    if not candidates:
        result(SKIP, "no candidates found (prerequisite missing)")
    elif violations:
        result(FAIL, f"{len(violations)} violation(s) — see VIOLATION lines above")
    else:
        result(PASS, f"all {len(candidates)} candidates passed the check")


if __name__ == "__main__":
    main()
```

### 5.5 Worked Example — Retrofit of `test_001` to the Contract

To show the contract is realistic, here is what `test_001_manifest_services_have_classes.py`
will look like after Wave 1 (existing logic preserved; docstring + console output upgraded):

```python
"""
test_001_manifest_services_have_classes.py
==========================================

WHAT:
  Every <service> declared in AndroidManifest.xml resolves to an existing
  .java file under android/app/src/main/java/.

WHY:
  A missing class causes Android to throw ClassNotFoundException at runtime
  and the service silently fails to register. This is the exact bug class
  that hit ContentFilterService when it was added to the manifest before the
  Java file existed.

HOW:
  1. Parse AndroidManifest.xml.
  2. Iterate every <service android:name="…">.
  3. Convert the name to an expected file path (.Short → com.breqk.Short).
  4. Assert that .java file exists on disk.

OUTPUTS:
  PASS — every <service> resolves to a real Java file.
  FAIL — at least one <service> points at a missing class. Console emits
         one "MISSING: <serviceName> -> <expectedPath>" line per offender.
  WARN — (not used).
  SKIP — (not used).

EXTEND:
  - To allow a service to skip the check, add its android:name to ALLOWLIST.
  - To check a different manifest, override _paths.MANIFEST.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _harness import PASS, FAIL, result, parse_manifest, android_attr, class_name_to_path
from _paths import MANIFEST, JAVA_SRC

ALLOWLIST: set[str] = set()       # service android:name values to skip
TEST_ID = Path(__file__).stem


def main() -> None:
    print(f"[{TEST_ID}] verifying every manifest <service> has a Java class on disk")
    print(f"  manifest: {MANIFEST}")
    print(f"  java root: {JAVA_SRC}")

    root = parse_manifest(MANIFEST)
    services = [s for s in root.iter("service") if android_attr(s, "name")]
    print(f"  scanned: {len(services)} <service> entries")

    missing: list = []
    for s in services:
        name = android_attr(s, "name")
        if name in ALLOWLIST:
            print(f"  SKIPPED: {name}  # allowlisted")
            continue
        expected = class_name_to_path(name, JAVA_SRC)
        if not expected.exists():
            missing.append((name, expected))
            print(f"  MISSING: {name} -> {expected}")

    print(f"  summary: {len(missing)} missing of {len(services)} services")

    if missing:
        result(FAIL, f"{len(missing)} service(s) declared in manifest with no matching Java class")
    else:
        result(PASS, "all manifest <service> entries resolve to a Java class")


if __name__ == "__main__":
    main()
```

---

## 6. Test Implementation Order

Order matters because helpers added early are reused later. Each row is one
PR-sized increment.

| Wave | Tests | New helpers |
|------|-------|-------------|
| 1 | 010, 011, 016, 017, 018, 019 | `parse_manifest_uses_permissions()`, `parse_intent_filters()` |
| 2 | 012, 013, 014, 015 | `iter_components()`, `is_exported()` |
| 3 | 060, 061, 062, 063, 065 | `walk_source_files()`, `extract_log_tags()` |
| 4 | 020, 021, 022, 023 | `find_react_methods()`, `find_js_bridge_calls()` |
| 5 | 040, 041, 042 | `extract_breqk_pref_keys()`, `extract_js_setting_keys()` |
| 6 | 080, 081, 086, 087, 088, 089, 075 (renumbered from 090) | secret regex bundle, source-walker exclusions |
| 7 | 082, 083, 084, 092 | `parse_gradle_kv()`, `parse_release_signing_config()`, `parse_versioncode()`, `parse_network_security_config()` |
| 8 | 064, 085, 093, 094, 091 | layout/string scanner, JSX prop parser |
| 9 | 100, 101, 102, 105 | `run_subprocess()`, `binary_available()` |
| 10 | 103, 104 | gradle invocation + lint XML parser |
| 11 | 120 – 124 | `adb()` wrapper |
| 12 | 140 – 143 | scanner-specific glue |

After Wave 7 the harness already covers every documented launch blocker
(B2 / B5 / B8 / B9 regression guards) and most of the OWASP Mobile static
surface. Waves 8-12 are nice-to-have.

---

## 7. Acceptance Criteria

A test is "done" when:

1. It has the **five-section docstring** (WHAT / WHY / HOW / OUTPUTS / EXTEND)
   per §3.1, with a concrete sentence under each heading. `OUTPUTS` lists
   every status the test can emit and what each one means.
2. It follows the **console output contract** in §3.2: a `[test_NNN_name]`
   banner, indented progress prints, one `VIOLATION:` / `MISSING:` /
   `ORPHAN:` / `LEAK:` / `SKIPPED:` line per finding, a `summary:` line, and
   exactly one final `RESULT:` line.
3. It exposes its `ALLOWLIST` and threshold knobs as **module-level constants**
   inside a labeled `CONFIG` block at the top of the file — never buried
   inside `main()`.
4. It runs ≤2 s in fast tier, ≤10 min in slow tier, and never raises an
   unhandled exception (catch + `result(FAIL, …)`).
5. It SKIPs cleanly if its prerequisite binary or input file is missing.
6. It is registered (just by existing in `tests/static/test_*.py`).
7. `pwsh tests/static/run_tests.ps1` (fast) and `pwsh tests/static/run_tests.ps1
   --slow` both complete locally; expected failures are exactly:
   - 082 `proguard release minify` → FAIL (security baseline)
   - 083 `release signing not debug` → FAIL (B8 launch blocker)
   - 084 `versioncode launch ready` → FAIL (B5 launch blocker)
   - 060 `file size limit` → WARN for `customize.js` (B12 known)
   - 092 `network security config present` → WARN unless we add the file

These three FAILs are *intentional* — they correspond to known launch
blockers in `docs/TASKS.md` and the harness should turn red until they're
fixed. After fixes land, re-running the harness goes green.

---

## 8. Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| **Regex-based secret scan false positives** (e.g., long Hermes hashes triggering `[A-Za-z0-9]{40,}`). | Tight, well-known patterns only (AKIA…, AIza…, `-----BEGIN…-----`, explicit `apikey=`). Each pattern has a unit-style assertion in the test docstring. Allowlist file `tests/static/_security_allowlist.txt` for first-line mitigation. |
| **Walking `node_modules/`** kills runtime. | Hard-coded `SCAN_EXCLUDE_DIRS` set; verified by spot-checking with `os.walk` `topdown=True` pruning. |
| **Slow tier on Windows + Gradle Daemon** can hang on first run. | Pass `--no-daemon -q` to `gradlew`; cap timeout at 600 s; SKIP cleanly if first run still hasn't downloaded toolchain. |
| **JS bridge regex misses dynamic dispatch** (e.g. `NativeModules[name].foo`). | Document the limitation in 020/021's `ERRORS:` block. WARN only (not FAIL) if a method appears unused — false negatives are acceptable; the goal is catching obvious drift. |
| **Tests claim FAIL for known launch blockers**. | This is by design (§7). Document at top of `tests/static/README.md`. Optional `--exclude-known-blockers` flag to `run_all.py` if user wants a "what's new" view; not in scope for the first wave. |
| **Future Java/JS file moves break path constants**. | All paths centralized in `_paths.py`; rename in one place. |
| **Adding pytest later might fight this harness**. | Keep them physically separate: pytest under `tests/unit/` and `tests/integration/` if/when it shows up; static auditing stays under `tests/static/`. |

---

## 9. Out of Scope (Explicit Non-Goals)

- Running real Espresso / Detox UI tests (these belong in `android/app/src/androidTest/` if ever added).
- Pen-testing the live binary (MobSF in 143 is the deepest we go without a
  paid service).
- Changing production code (every B5/B8/B9 etc. is documented in
  `docs/TASKS.md` as a P0 task, not part of this plan).
- Replacing or rewriting the existing 001/002 manifest tests.

---

## 10. Key Files Touched

| File | Operation | Purpose |
|------|-----------|---------|
| `tests/static/_paths.py` | extend | new path constants |
| `tests/static/_harness.py` | extend | shared regex / subprocess / parser helpers |
| `tests/static/README.md` | create | the "overview MD" — full §5.3 contents (covers / quickstart / output contract / numbering / how-to-add / bug-guard map / known intentional reds / extension points) |
| `tests/static/_template.py` | create | the canonical template every new test starts from (verbatim §5.4) |
| `tests/static/test_001_…py` | edit | retrofit to the new docstring + console contract (logic unchanged — see §5.5) |
| `tests/static/test_002_…py` | edit | same retrofit for the orphan-services check |
| `tests/static/test_010_…py` … `test_023_…py` | create | manifest + bridge wave |
| `tests/static/test_040_…py` … `test_065_…py` | create | prefs + structure wave |
| `tests/static/test_075_…py` … `test_094_…py` | create | security wave |
| `tests/static/test_100_…py` … `test_105_…py` | create | toolchain (slow tier) |
| `tests/static/test_120_…py` … `test_124_…py` | create | adb device (slow tier) |
| `tests/static/test_140_…py` … `test_143_…py` | create | optional scanners (slow tier) |
| `docs/current_task.md` | update | record current focus per project rule |
| `docs/TASKS.md` | optional update | add a "Test Harness Coverage" subsection cross-referencing each P0 bug to its guard test (e.g., `B2 → test_011`, `B5 → test_084`) |

No production code is modified.

---

## 11. SESSION_ID (for /ccg:execute)

- CODEX_SESSION: (skipped — wrapper not invoked on Windows; Opus xhigh produced this plan directly)
- GEMINI_SESSION: (skipped — same reason)

If the user wants a second-opinion pass via Codex/Gemini, that can be added
as a Phase 2 review before execution; the plan above is structured so each
wave (§6) is independently reviewable.
