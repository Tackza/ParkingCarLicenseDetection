# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Mbus Register** — an Expo / React Native (SDK 51, RN 0.74) Android app used at Dhammakaya parking checkpoints, shown on the launcher as **Mbus Scan**. The workflow is: log in → connect the printer (the SUNMI's built-in one, else a Bluetooth ESC/POS printer) → photograph a vehicle's license plate (OCR on the device, falling back to an external service) → confirm vehicle/passenger details → save the check-in locally → upload to the API in the background → print a paper receipt.

**The device is a SUNMI V3 handheld POS terminal, not a tablet**: 6.75", 720×1600 px = **360×800 dp**, about 420 nits and used outdoors. Its built-in 58 mm thermal printer is driven through SUNMI's own print service (`SunmiPrinterModule.kt`), not Bluetooth — see **Receipt printing**. Design every screen for that width and brightness — a first round of mockups was drawn at 820×1180 because this file used to say "tablet", and all of it had to be redrawn.

The UI is hardcoded Thai (no i18n layer). Dates use the Buddhist calendar (`toLocaleString('th-TH-u-ca-buddhist')`). Code comments are mostly Thai — match that when editing a file that already uses it.

## The two systems

A working check-in at a checkpoint needs **two separate codebases** that talk to each other over HTTP. Neither one is useful alone, and they are versioned and deployed independently:

| | **Mbus Register** (this repo) | **Thai License Plate Recognition** (OCR service) |
|---|---|---|
| what | Expo / React Native Android app for the SUNMI V3 handheld, shown to operators as **Mbus Scan** | Python + Flask + YOLO (Ultralytics), two-stage detector |
| where | this repo / worktree | `/Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector` (**not a git repo**) |
| its own docs | this file | that folder's own `CLAUDE.md` (~350 lines, Thai) — **read it before touching the detector**; it covers models, class maps, Cloud Run config, and cost |
| deployed as | Android APK via EAS | Google Cloud Run `license-plate-service`, project `mbus-v2`, region `asia-southeast1` |
| talks to | Mbus API (`mbus.dhammakaya.network`) + OCR service | nothing — it is a stateless single-endpoint service |

There is also a **third** party neither repo owns: the **Mbus backend API** at `https://mbus.dhammakaya.network/api` (prod) / `https://mbus-test.dhammakaya.network/api` (test). The app is the only thing that talks to it; the OCR service never does.

```
 SUNMI V3 (this repo)                        Cloud Run                     Mbus backend
 ┌──────────────────┐   multipart image      ┌─────────────────┐
 │ (tabs)/_layout   │──── POST /detect ─────▶│ license-plate-  │
 │  camera q=0.8    │◀── {license_plate,     │ service         │
 │        ↓         │      province} ────────│ (YOLO 2-stage)  │
 │ (tabs)/scan.js   │                        └─────────────────┘
 │  manual fix-up   │
 │        ↓         │   local-first write
 │  SQLite check_ins│─────────────────────────── POST /api/lpr/checkins ──▶ ┌──────────┐
 │  CheckInSyncMgr  │◀────────────────────────── GET  /api/lpr/registers ── │ Mbus API │
 │        ↓         │                                                       └──────────┘
 │  receipt: SUNMI print service, else Bluetooth ESC/POS
 └──────────────────┘
```

### The `/detect` contract (now the fallback, not the primary path)

⚠️ **Android reads plates on the device first.** Since the `lpr` native module landed, the service is only reached when the module cannot answer — see [On-device OCR](#on-device-ocr-android). Everything below still describes the fallback exactly, and [utils/lprOcr.js](utils/lprOcr.js) makes both engines return the same shape so callers never branch on which one answered.

Called from [utils/lprOcr.js](utils/lprOcr.js) `detectPlate()` — **the URL is hardcoded there, it is not affected by the `environment` setting**, so test builds hit the production OCR service too.

`POST https://license-plate-service-833646348122.asia-southeast1.run.app/detect`
`multipart/form-data`, single field **`image`** (jpeg/png/gif/bmp/tiff, ≤16 MB), axios `timeout: 15000`.

Responses the app must handle — all four already are:

| case | HTTP | body | app behaviour |
|---|---|---|---|
| plate read | 200 | `{success:true, data:{license_plate:"นข2628", province:"สิงห์บุรี"}}` | fill form, TTS readback, cross-check `registers` |
| plate found, **no digits in it** | 200 | `data.license_plate: null` | `\|\| ''` → falls through to the manual-edit modal |
| **no plate in the photo** | **500** | `{success:false, error:"ไม่พบยานพาหนะในภาพ"}` | logged as `OCR_SERVER_ERROR`, manual-edit modal |
| network down / no response | — | — | `ocrConnected = 0`, logged `OCR_NO_RESPONSE`, manual-edit modal |

⚠️ **"No plate detected" is a 500, not a 200 with an empty result.** That is normal operation, not an outage — expect a steady trickle of `OCR_SERVER_ERROR` rows in `error_logs` that are really just bad photos. Don't treat that count as a service-health metric.

### ⚠️ 15 s timeout vs 20–27 s cold start — the one that bites in the field

Since on-device OCR, this only bites when a scan falls back to the service — iOS, an APK without the native module, or a failure inside it. The OCR service runs `min-instances=0`. Measured behaviour (recorded in the detector's own CLAUDE.md):

- **cold start ≈ 20–27 s** (loading torch + two YOLO models) — **longer than this app's 15 s timeout**, so the first scan against a cold instance *always* fails with `OCR_TIMEOUT` and drops the operator into manual entry
- **warm ≈ 0.9–2.2 s**, idle instances are reclaimed after **~15 min**
- a Cloud Scheduler job **`lpr-keepwarm`** pings `/health` every 5 min, **05:00–17:55 ICT only** — so scans before 05:00 or after ~18:10 hit a cold start by design
- `concurrency=1`, `maxScale=3` (Ultralytics is not thread-safe): **two devices scanning at the same second** means the second request waits ~22 s for a new instance to boot → also a 15 s timeout, even though the service is "up"

So a timeout report from the field is usually one of: outside keep-warm hours, first scan of the day, or several devices firing at once. Check those before assuming a bug. Raising `OCR_SERVER_TIMEOUT` in [utils/lprOcr.js](utils/lprOcr.js) past ~30 s is the app-side lever; raising `maxScale`/`min-instances` is the service-side one — and `min-instances=1` costs ~$34/month, which is why the ping exists.

### Shared vocabulary the two systems must agree on

- **Provinces.** [constants/provinces.js](constants/provinces.js) `THAI_PROVINCES` and the detector's `function/helper.py` (`data_province` + the `mapping` dict inside `get_thai_character`) currently hold the **same 78 labels, byte-identical** — that is 77 provinces **plus `เบตง`**, which is a district of Yala, not a province. Don't "clean up" `เบตง`; the model has a `BTG` class for it.
  `checkProvinceExists()` does an **exact string match** against that list and returns `''` on a miss, which forces the manual-edit modal. **Adding a province class to the model without adding the identical label here silently degrades every scan of that province to manual entry.** These two lists are a contract; change them together.
- **Plate strings.** The OCR model has classes for digits, Thai consonants and provinces only — **no hyphen**. A `32-1527` plate comes back as `321527`, and plates with no Thai consonant at all are legitimate. **Never validate "a plate must contain a Thai consonant" or "must match a pattern" on this side** — you would reject correct reads.
- The app stores the raw OCR output in `check_ins.detect_plate_no` / `detect_plate_province` and the operator-corrected values in `plate_no` / `plate_province`, with `is_plate_manual` marking the difference. Keep that split — it is how OCR accuracy is measured after the fact.

## Commands

```bash
npm start              # expo start --dev-client (requires a dev build, not Expo Go)
npm run android        # expo run:android — local native build
npm run ios            # expo run:ios
npm test               # jest --watchAll (preset: jest-expo) — watches, never exits
npm run test:ci        # jest --ci — runs every test once and exits
npm run lint           # expo lint
npm run reset-project  # scripts/reset-project.js — wipe to a clean Expo template (destructive)
```

Single test: `npx jest path/to/file.test.js` or `npx jest -t "test name"`.

### Tests

`npm run test:ci` runs **148 Jest tests in about a second**, all on the Mac — no device, no network, no API. They cover the data path, not the screens:

| file | what it pins down |
|---|---|
| [utils/__tests__/registerSync.test.js](utils/__tests__/registerSync.test.js) (16) | `fullResyncRegisters()` against a mocked `/lpr/registers` that pages 200 rows: the `(update_date, reg_id)` cursor, clearing only after every page arrived, old rows kept on a network or shape error, guards against a missing or repeating cursor, the shared lock held throughout and released on every exit, waiting out the loop's in-flight run and giving up after 30 s |
| [utils/__tests__/checkInUpload.test.js](utils/__tests__/checkInUpload.test.js) (40) | the pure upload logic in [utils/checkInUpload.js](utils/checkInUpload.js): every field sent and its server name, `lat`/`long` empty (never `0`) when missing, `seq_no` 0 kept, `ocr_connected` 0 sent as `"0"`; error classification (401/403 → stop batch at 3, 4xx → 4, 5xx → 3, timeout/offline → 3 + stop batch, duplicate → synced); the backoff table |
| [components/__tests__/CheckInSyncManager.test.js](components/__tests__/CheckInSyncManager.test.js) (11) | the **real** `CheckInSyncManager` rendered with `react-test-renderer`, server/DB/files/timer mocked, one cycle driven by fake timers: per-row outcomes, offline aborts the batch, 401 forces re-login, resized photo attached and its temp file deleted, a missing photo uploads without it, next cycle after 10 s |
| [utils/__tests__/routeTracking.test.js](utils/__tests__/routeTracking.test.js) (24) | which GPS fixes become route points (moved ≥5 m, else one a minute; no 0,0, no >100 m accuracy, no late/duplicate fixes), the row shape, the `/lpr/locations` body (one `comp_id`/`project_id` group per request, `lng`, integer `comp_id`, fallback machine code), the tracking-state store |
| [utils/__tests__/registerContacts.test.js](utils/__tests__/registerContacts.test.js) (20) | "รถที่เหลือ" contacts: ids grouped by project and chunked, `tel:` cleanup, driver → leader → coordinator, request/error shapes; the follow-up calls (claim, release as query params, save with `อื่นๆ` needing a note) and `CALL_RESULTS` matching the server |
| [utils/__tests__/speechUtils.test.js](utils/__tests__/speechUtils.test.js) (7) | the post-scan announcement text, and `speakAndWaitForStart()` holding the spinner until speech starts (capped at 1.5 s, never rejects) |
| [constants/__tests__/Database.migrations.test.js](constants/__tests__/Database.migrations.test.js) (29) | `setupDatabase()` on **real SQLite**: fresh install to the latest version, re-running is a no-op, upgrading v6–v10 keeps rows, `location_points` queue/mark/prune, a half-applied migration re-runs, v8 never overwrites a device's mode; `insertCheckIn` coordinate/`seq_no`/mileage handling; queue order, `next_retry_at`, the 50-row limit, backoff 1 → 5 min |
| `components/__tests__/ThemedText-test.tsx` (1) | leftover from the Expo template, tests dead code |

How the hard parts are faked — keep these when adding tests:

- **SQLite.** `expo-sqlite` is native, so the migration test mocks it with `node:sqlite` (SQLite 3.50, bundled with Node 22) behind an adapter exposing `execAsync` / `runAsync` / `getFirstAsync` / `getAllAsync` / `withTransactionAsync`. It is loaded with `process.getBuiltinModule('node:sqlite')` because Jest's resolver does not know the module. `Database.js` opens its database at import time, so each test reloads it with `jest.isolateModules` to get a fresh in-memory DB; `global.__testSqlite` is the raw handle for arranging state (e.g. dropping v10's columns and setting `user_version = 9` to simulate an old device). **A new migration needs a case here**, including the downgrade step in `downgradeTo()`.
- **FormData.** React Native's keeps parts in `_parts`; Node's does not, so the sync-manager test installs a minimal RN-style `FormData` for its run.
- **Timers.** `react-native-background-timer` is mocked onto `setTimeout`, which matches what it really is on Android (see below), so Jest fake timers drive the loops.
- `.claude/` worktree copies are excluded (`modulePathIgnorePatterns`) — their `package.json` collides in `jest-haste-map`.

Every suite was **mutation-checked**: re-introducing a known bug (sending `0` for missing coordinates, `||` for `seq_no`, clearing before fetching, not releasing the lock, a migration that forgets its version bump, IGNORE → REPLACE in v8, …) fails at least one test. Do the same when adding one — a test that passes against the broken code is not testing it.

**Not covered:** every screen and the scan → save → print flow, printing itself, on-device OCR (that has its own instrumented test, see **On-device OCR**), the registers *loop* in `(tabs)/_layout.js`, and anything against the real API. Those are still verified by hand on a SUNMI.

`postinstall` runs `patch-package`. There is currently no `patches/` directory, so `npm install` applies nothing; if you add a patch, it will start taking effect.

Check the OCR service is alive before debugging a scan problem:

```bash
curl -s https://license-plate-service-833646348122.asia-southeast1.run.app/health
```

### Build & deploy (EAS)

```bash
# Production Android APK
eas build --profile production --platform android --clear-cache

# OTA update to production channel
eas update --branch production --message "Updated text"
```

EAS profiles in [eas.json](eas.json): `development` (debug APK, channel `development`), `preview` (internal distribution), `production` (release APK, channel `production`). `APP_VARIANT` is read by [app.config.js](app.config.js) and switches the app name and Android/iOS bundle ID to `.dev` so dev and prod coexist on one device. OTA updates are on (`checkAutomatically: ON_LOAD`, `runtimeVersion` 2.0.0 — see **Versioning** below for why there are two lanes) and the Settings screen displays `Updates.updateId` / `channel` / `createdAt` for field debugging.

Note: `eas.json` sets `APP_URL_DETECTION` on the development profile, but **nothing reads it** — the OCR URL is hardcoded (see below).

The OCR service is **not** deployed from here — it ships separately with `gcloud run deploy license-plate-service --source . --region=asia-southeast1 --project=mbus-v2` from the detector folder.

### ⚠️ `android/` is committed, so `expo prebuild` never runs — and `app.config.js` does not reach Android

This is the single most expensive thing to forget in this repo. It has produced three separate live bugs.

`android/` is tracked in git (55 files), so EAS treats the project as **bare** and runs gradle on exactly these files. `expo prebuild` is what copies `app.config.js` into the native project, and it has not run since 29 Sep 2025. Anything it would have generated is frozen at whatever was committed that day.

**Setting a value only in `app.config.js` changes nothing on Android.** What actually shipped, and where the real value lives:

| what | `app.config.js` said | Android actually used | fix lives in |
|---|---|---|---|
| app name | "Mbus Register" | **`Packing_license_plate`** | `android/app/src/main/res/values/strings.xml` → `app_name` |
| launcher icon | `assets/images/c7.png` | **Expo's blank placeholder grid** (`c7.png` arrived 18 Oct, after prebuild last ran) | `android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png` |
| `runtimeVersion` | "1.0.0" | `1.0.0` from `strings.xml` — `AndroidManifest` points `EXPO_RUNTIME_VERSION` at `@string/expo_runtime_version` | `strings.xml` → `expo_runtime_version` |
| `versionCode` / `versionName` | — | `android/app/build.gradle` (EAS warns `cli.appVersionSource` is unset, so it reads the native value) | `build.gradle` |

Set **both** sides: the native file is what ships today, `app.config.js` covers iOS, EAS metadata and any future prebuild.

**Do not "fix" this by running `expo prebuild`.** It rewrites the whole `android/` folder and would drop the hand-registered `LprOcrPackage`, the release `abiFilters`, the `settings.gradle` dev-client exclusion the `noCompress` rule and the hand-registered `SunmiPrinterPackage` + its `<queries>` entry. Edit the native files directly, then confirm against a built APK rather than trusting the config:

```bash
cd android && ./gradlew :app:assembleRelease
aapt2 dump badging app/build/outputs/apk/release/app-release.apk | grep -E "^package:|^application-label:"
```

### Release-build specifics

- **expo-dev-client is excluded from release builds** in [android/settings.gradle](android/settings.gradle). Without it a release APK compiles, installs, then dies building React Native's module registry: `IllegalStateException: Native module ExpoDevMenuExtensions tried to override DevMenuExtension`. expo-dev-menu declares `debugOnly` for iOS but not Android, and its `DevMenuPackage` returns a `DevMenuExtension` in every variant. `settings.gradle` runs before variants exist, so the build type is inferred from the requested task names; override with `-Pmbus.excludeDevClient=true|false` when that guess is wrong (e.g. a bare `./gradlew assemble`, which builds both variants at once).
- **Release ships only `arm64-v8a` and `armeabi-v7a`** (`abiFilters` in `build.gradle`). The x86/x86_64 slices were ~75 MB of native libraries no checkpoint device will ever load — they exist for x86_64 emulators, which is a debug concern, so debug builds deliberately keep all four. Release APK is ~86 MB. Keep `armeabi-v7a`: the SUNMI V3 is arm64 but older fleet units may be 32-bit.
- **Local release builds need a working `git`** — see the Xcode note under Conventions.
- **Testing a local build on a fleet device without losing its data:** `./gradlew :app:assembleRelease -Pmbus.appIdSuffix=.dev` builds `com.donnytang.myapp.dev`, which installs *beside* the EAS-signed app. A plain local build is signed with the debug key and cannot update the EAS app; uninstalling that app to make room wipes its SQLite check-ins. The same property works for `connectedDebugAndroidTest`.
- **A local build can ship a stale expo-updates manifest.** Gradle sometimes treats `createReleaseUpdatesResources` as up to date and reuses an old `app.manifest`. The APK then carries an update id the device has already stored, so expo-updates launches the *previously installed* bundle — the new JS silently never runs. It showed up as Settings → เวอร์ชัน reading a weeks-old date. Delete `app/build/generated/assets/createReleaseUpdatesResources` and `app/build/intermediates/assets/release/app.manifest` before a release build, and check `unzip -p <apk> assets/app.manifest | head -c 80` shows a fresh `commitTime`.
- **A full rebuild needs ~5 GB free.** The Gradle cache corrupted when this Mac's disk filled, and the re-download took ~3 GB on top of the build. Gradle inside the Claude Code sandbox also failed with `No route to host` while `curl` worked; run it outside the sandbox.
- **`node_modules` must match the branch.** Switching to a branch with NativeWind without `npm install` fails the JS bundle step with `Cannot find module 'nativewind/metro'`.

### Versioning and getting a build onto fleet devices

Current: `versionCode` 4, `versionName` 2.2.0, `runtimeVersion` 2.2.0 — SUNMI print service, the ft1 OCR model and `expo-location`, all native. A 2.1.0 / `versionCode` 3 EAS build exists (24 Nov 2026) but was never distributed; it lacks `expo-location`, so it must not share a runtime with JS that imports it. 2.0.0 was `versionCode` 2; everything before that shipped `versionCode` 1, so older devices cannot be told apart by number. The version also lives in `app.json`, which is what `Constants.expoConfig.version` reports at runtime — keep it in step with `app.config.js`.

All EAS production builds use the same managed keystore (`qnchy5_CNe`), so a new APK **installs over the existing one — no uninstall, and SQLite check-ins, session and paired printer survive**. The exception is a device that has a locally built debug APK on it: different signing key, so that one must be uninstalled first (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).

**OTA cannot deliver a native change.** The on-device OCR is a native module, so `eas update` will never ship it — devices need the APK. `runtimeVersion` 2.0.0 also cuts off every update published on the `production` branch before it — all of them runtime 1.0.0, more than fifty, the newest on 24 Sep 2026 — which is deliberate: they predate the native module. The cost is that during a rollout there are two OTA lanes, 1.0.0 and 2.0.0, until every device has the new APK. **Bump `runtimeVersion` whenever native code changes.**

- **Two APKs carry the native module but runtime 1.0.0**: builds `eef5923` and `c2c3cde` (5 Sep 2026, before `97f20f3` bumped it). They take every 1.0.0 OTA, and the JS on that lane has no `utils/lprOcr.js`, so on those devices on-device OCR silently stops and scans go to the service. The SUNMI V3 used for testing on 24 Sep 2026 had one. Replace them with a 2.0.0 APK.
- **Check a device's runtime before trusting an OTA to reach it**, rather than inferring it from the label ("Mbus Scan" exists at both runtimes). Pull the APK with `adb shell pm path com.donnytang.myapp` + `adb pull`, then `aapt2 dump resources <apk> | grep -A1 expo_runtime_version`; the channel is the `expo-channel-name` header in `aapt2 dump xmltree --file AndroidManifest.xml <apk>`. To see what a device actually did, filter `adb logcat` for `dev.expo.updates`.
- `isOnDeviceOcrAvailable()` tests for `NativeModules.LprOcr`, so JS containing the on-device path also runs on an APK without the module — it falls back to the service.

Confirming a device actually updated:

```bash
adb shell dumpsys package com.donnytang.myapp | grep versionName   # expect 2.2.0
```

The decisive functional check is different: **turn the network off and scan.** If it reads the plate, the on-device path is live; if it falls back, it is not.

## Architecture

### Provider stack & startup

[app/_layout.tsx](app/_layout.tsx) wraps every screen in this exact provider order — order matters because inner providers read from outer ones:

```
EnvironmentProvider → AuthProvider → SyncProvider → ProjectProvider → ModeProvider → PrinterProvider
                                                                    ↳ <CheckInSyncManager />  (headless, mounted once)
```

`setupDatabase()` from [constants/Database.js](constants/Database.js) runs once on root mount (fire-and-forget — nothing awaits it, so the first queries race the migrations). `AuthProvider` and `ProjectProvider` each block rendering with a spinner while `EnvironmentProvider` is still loading, so the API base URL is always resolved before any request goes out. `EnvironmentProvider`'s own spinner is commented out, so it renders children immediately with `environment === null`; `AuthProvider`'s early return is what actually holds the tree back.

**That early return is load-bearing for more than the URL.** `ProjectProvider` calls `useEnvironment()` / `useAuth()`, then returns its spinner on `isEnvLoading`, and only *after* that return declares two `useCallback`s and a `useEffect`. Declaring hooks below a conditional return is a Rules-of-Hooks violation that would throw "rendered more hooks than during the previous render" the moment `isEnvLoading` flipped — it never fires only because `AuthProvider` returns *its* spinner first and never mounts `ProjectProvider`'s subtree while the environment is loading. Removing or reordering `AuthProvider`'s guard crashes `ProjectProvider`. Move those three hooks above the early return before touching either provider.

**`user` is never rehydrated from SQLite.** `setUser` is called only by `login()` and `logout()`, so on a cold start `useAuth().user` is `null` no matter what is in `sessions`. Consequences: [app/index.js](app/index.js) always redirects to `/login` (the real auto-login is `login.js` checking for a session row itself), and every `user_id` on an error log is `null` until someone logs in *within that process* — which is most of them, since the app normally resumes straight past the login screen.

**`SyncProvider` is mounted twice.** [app/(tabs)/_layout.js](app/(tabs)/_layout.js) wraps its own `TabLogic` in a *second* `SyncProvider`. Anything inside `(tabs)` that calls `useSync()` reads the inner instance; `CheckInSyncManager` reads the outer one, so nothing the check-in loop sets is readable from any tab screen. Adding shared sync state means picking which provider actually owns it. The one value that *is* live is `isOnline`, written by the registers loop in `(tabs)/_layout.js` and read by `main.js` (header pill, and the gate on the server-search button). A screen **outside** `(tabs)` — such as `checkin-detail.js` — reads the outer instance, where `isOnline` is stuck at its default `true`; do not gate anything on it there. (The `SyncStatus` widget that would have surfaced this is wired to `headerRight` but every `Tabs.Screen` sets `headerShown: false`, so it never renders — see dead code.)

### Routing (Expo Router, file-based)

- [app/index.js](app/index.js) — redirect: no user → `/login`, else `/scan`. In practice the `else` is unreachable (see `user` rehydration above), so this always lands on `/login`
- [app/login.js](app/login.js) — auto-skips to `/bluetooth-setup` if a session row exists (no token revalidation); otherwise `POST /lpr/login` → `saveSession()` → `syncProjectsWithApi()`
- [app/bluetooth-setup.js](app/bluetooth-setup.js) — the printer step after login; see **Printer connection** below. Requests `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` / `ACCESS_FINE_LOCATION` via `react-native-permissions`
- [app/(tabs)/_layout.js](app/(tabs)/_layout.js) — owns the **registers sync loop**; the Scan tab's `tabPress` is intercepted (`e.preventDefault()`) to launch the camera (`ImagePicker.launchCameraAsync({ quality: 0.8 })`) and pass `imageUri` as a route param
- [app/(tabs)/main.js](app/(tabs)/main.js) — local check-in history; tapping a card opens `checkin-detail`, its magnifier opens the server search
- [app/checkin-detail.js](app/checkin-detail.js) — one `check_ins` row read from SQLite (`getCheckInById`), with the sync history derived from its columns and a "ลองส่งใหม่" button for rejected rows. Reached with `router.push({ pathname: '/checkin-detail', params: { id } })`; it leaves with `router.back()` and jumps to Settings with `router.navigate('/settings')` — see the `router.push` wart below for why not `push`
- [app/(tabs)/scan.js](app/(tabs)/scan.js) — OCR → manual correction → register lookup → save/print (mode two) or hand off to passenger_count (mode one)
- [app/passenger_count.js](app/passenger_count.js) — mode-one only: passenger counters, then insert + print
- [app/(tabs)/settings.js](app/(tabs)/settings.js) — mode toggle, environment switch, machine code, DB export, sync counters, logout, OTA info, and the **"รถที่เหลือ"** list of not-yet-scanned vehicles

### `activeProject` is chosen by wall-clock time, not by the user

`getCurrentProject()` runs `SELECT * FROM projects WHERE datetime('now','localtime') BETWEEN start_time AND end_time LIMIT 1`. There is no project picker. Consequences worth remembering when debugging "nothing works":

- Outside every project's time window, `activeProject` is `null`, **both sync loops go idle**, and tapping Scan alerts `ไม่พบกิจกรรม`.
- `saveProjects()` does `DELETE FROM projects` then re-inserts, so a `/lpr/projects` response that omits a project removes it. It **refuses to touch the table when handed an empty list** — an empty `result` used to wipe every activity and report success, which takes the checkpoint offline instantly. Stale rows are harmless because of the time-window filter; losing them is not. It returns `{saved, replaced}` so callers can report what actually happened, and `settings.js` distinguishes "server sent nothing", "unexpected shape", "saved but no activity is in its window yet" (naming the next one via `getNextUpcomingProject()`) and real success.
- `getCurrentProject()` also decodes storage-level fields into JS types: `bus_types` JSON string → array, and the three flag columns → booleans. Read project flags through this function, not via raw SQL.

### On-device OCR (Android)

The same two YOLO models the Cloud Run service runs are embedded in the APK and executed by ONNX Runtime, so a checkpoint scans with no network at all.

| | |
|---|---|
| engine | [android/app/src/main/java/com/donnytang/myapp/lpr/LprOcr.kt](android/app/src/main/java/com/donnytang/myapp/lpr/LprOcr.kt) |
| bridge | `LprOcrModule.kt` → `NativeModules.LprOcr`, registered by hand in `MainApplication.kt` (it is not in `node_modules`, so autolinking never sees it) |
| JS entry | [utils/lprOcr.js](utils/lprOcr.js) — `detectPlate(uri)`, `warmUpOnDeviceOcr()` |
| weights | `android/app/src/main/assets/plate_{region,ocr}.fp16.onnx` + `labels.json` (12.1 MB total). Stage 2 is **`data_plate_ft1.pt`** (since 2.1.0): `data_plate.pt` fine-tuned on 4,380 field crops, same 125 classes, so `labels.json` is unchanged. Stage 1 is still `license_plate.pt`. Both exported with **dynamic H/W** |
| runtime | `onnxruntime-android:1.20.0`, **CPU provider, 4 intra-op threads** |

- **Rect letterbox, not a 640×640 square.** The long side goes to 640 and the other is padded only up to a multiple of 32 — ultralytics' rect inference, which is what `server.py` gets from a `.pt`. The first port padded to a full square, which misread wide plate crops (`นง70910` for `นง7010` with the old model; province `ฮกรุงเทพมหานคร` for `32-1527` with ft1). With rect padding both models match the `.pt` on 33/33 desktop images, and stage 2 runs faster because the crop tensor is smaller. It requires the dynamic export: a static 640×640 model rejects rect inputs. Export with `tools/ondevice-ocr/export_models.py --ocr-pt <pt> --out <dir>` (it never writes into the detector's `model/onnx`), compare with `compare_accuracy.py --ocr-pt <pt> --onnx-dir <dir>`, in the venv described in `tools/ondevice-ocr/README.md`.
- **`lpr_onnx.py` is the specification.** [tools/ondevice-ocr/lpr_onnx.py](tools/ondevice-ocr/lpr_onnx.py) and `LprOcr.kt` are the same algorithm written twice — letterbox, output decode, per-class NMS, box rescaling, left-to-right character ordering, single highest-confidence province, split at the last digit. Change one, change the other, then re-run `tools/ondevice-ocr/compare_accuracy.py` and the instrumented test.
- **The ORT version is pinned at 1.20.0 for a reason.** 1.21.0+ declare `minSdkVersion 24`; this app declares 23, and taking a newer ORT would silently drop Android 6.0 devices. Don't bump it without deciding that on purpose.
- **Do not enable NNAPI.** Measured on the checkpoint's SUNMI V3 it made FP32 3.5× slower and did nothing for FP16.
- **FP16 is shipped for size, not speed.** The SUNMI V3's Cortex-A73 is ARMv8.0 with no native FP16 arithmetic, so ORT widens back to FP32 anyway; FP16 just halves the APK cost. Full numbers in [tools/ondevice-ocr/android/DEVICE_RESULTS.md](tools/ondevice-ocr/android/DEVICE_RESULTS.md).
- **Models are warmed up at root mount** in [app/_layout.tsx](app/_layout.tsx) so the first scan of the day does not pay the ~0.4 s load.
- **Kill switch:** set `ON_DEVICE_OCR_ENABLED = false` in [utils/lprOcr.js](utils/lprOcr.js) to force every scan back through the service.
- **"No plate found" is not a fallback trigger.** Both engines run identical weights, so falling back would only cost the operator a 15 s wait before the same manual-entry prompt.

Verify a change with the instrumented test — it runs the real engine on the real device against plates whose correct reading is known, and needs no login:

```bash
adb shell mkdir -p /data/local/tmp/lprtest
adb push <detector>/license-car/338111_0.jpg /data/local/tmp/lprtest/   # and the other four
cd android && ./gradlew :app:connectedDebugAndroidTest -Pmbus.appIdSuffix=.dev   # suffix: see Release-build specifics
```

Last run (24 Nov 2026, ft1 + rect letterbox, SUNMI V3): 5/5, 591–840 ms per plate, model load 450 ms.

Mbus Plate Sync (`~/Documents/project/mbus-plate-sync`) carries its own copy of `LprOcr.kt` and its own assets; it still has the old model and square letterbox until it is updated the same way.

### Two independent sync loops

Both are **self-scheduling `BackgroundTimer.setTimeout` chains** (each run schedules the next in its `finally`), not `setInterval`. Both guard against overlap with a lock plus a `currentSyncSessionId` ref: the effect stamps a new session id on every restart, and a run whose id no longer matches aborts — including mid-loop. Preserve that pattern; a plain interval will double-fire when `activeProject` changes.

1. **Registers (master plate data) — pull.** [app/(tabs)/_layout.js](app/(tabs)/_layout.js). 3 s initial delay, then every 10 s: `GET /lpr/registers?last_update=X&last_id=Y&project_id=Z` → `saveRegisters()`. Uses the module-level lock in [utils/registerSync.js](utils/registerSync.js) (survives re-renders, shared with the resync button); the lock-skip path deliberately does *not* reschedule, leaving that to the in-flight run — **except** when the holder is a resync, which never schedules the loop, so the loop reschedules itself. A `401` here is one of two session-expiry paths: it clears the session and redirects to `/login`, leaving `saved_printer` alone.
2. **Check-ins — push.** [components/CheckInSyncManager.js](components/CheckInSyncManager.js). 5 s initial delay, then every 10 s, with a 30 s per-request timeout. Selects `sync_status IN (0, 3, 4)` in batches of 50, **unattempted rows (`sync_status = 0`) first** then oldest-first — without that ordering a batch of permanently-rejected old rows would fill every cycle and new registrations would never upload. For each row it resizes the photo to 400 px wide at quality 0.7 (`expo-image-manipulator`), POSTs `/lpr/checkins` as **`multipart/form-data`** with the image attached as a `photo_file` part — not base64, not JSON — and deletes the resized temp file afterwards. A `duplicate` / `already exists` error from the server still marks the row synced (intentional — the server already has it). A `401`/`403` aborts the batch, keeps the row retryable, and forces re-login the same way the registers loop does. The decisions (which fields, which status, whether to stop the batch) live in [utils/checkInUpload.js](utils/checkInUpload.js) so they can be tested; the component only does I/O.

Neither loop notifies the UI. [app/(tabs)/main.js](app/(tabs)/main.js) re-runs `loadHistory` on a 5 s interval **while focused only** (plain `setInterval`, not `BackgroundTimer` — refreshing a screen nobody is looking at is pointless) and offers pull-to-refresh; the list is always rendered with `ListEmptyComponent` so the gesture works when empty too. The list is **paged**: `getScanHistory(id, query, limit)` returns the newest `HISTORY_PAGE_SIZE` (30) rows, `onEndReached` widens the window by another page, and the 5 s tick re-reads only that window, never the whole table. `mergeHistory()` reuses the previous object for every row whose displayed fields are unchanged (and returns the previous array when nothing changed), and the callbacks passed to `HistoryItem` are `useCallback`-stable, so `React.memo` skips every card that did not change. Keep both halves: before this, a single row changing sync status (every 10 s while uploading) produced a new object for every row, so every mounted card re-rendered on every tick — that, not the row count, is why the list used to be capped at 5. `windowSize` is 7 instead of FlatList's default 21, which keeps about a third as many cards (each with a photo) mounted. `checkin-detail.js` does the same on its own 5 s focused interval. Settings refreshes its counters via `useFocusEffect`. The proper fix — having the sync manager signal the screens — is blocked by the double `SyncProvider` above.

**Location.** `lat` / `long` used to be hardcoded `0` on every upload, so every check-in on the server sits at 0,0 in the Atlantic. Since 2.2.0 `scan.js` starts `getCheckInLocation()` ([utils/location.js](utils/location.js), `expo-location`) in parallel with OCR — last known fix if under 2 min old and within 100 m, else a fresh fix with a 4 s cap — and awaits it at save time. No permission, no fix or a timeout gives `null`, uploaded as an empty string (the server's rule is `nullable|numeric`). Never store `0` for "unknown". Mode one carries the three values through route params as strings; `insertCheckIn` normalises them. Rows uploaded before 2.2.0 still need cleaning up server-side.

Every field in the upload payload comes from the `check_ins` row itself — never recomputed from live state at upload time. That matters because a row can be uploaded hours after it was created, under a different active project. Keep that invariant when adding fields.

Unlike the registers loop, this effect has **no dependencies** — it starts one timer chain at mount and never restarts. That is deliberate: `getCurrentProject()` returns a fresh object every call and `main.js` calls `refreshCurrentProject()` on every focus, so depending on `activeProject` restarted the initial delay after every print and could starve the queue indefinitely. The sync function reads the project through `activeProjectRef` and reschedules itself even when there is no active project.

**`sync_status` on `check_ins`:** `0` = pending, `2` = success, `3` = retryable failure (network error, timeout, 5xx, auth), `4` = server rejected it (4xx or a `status != success` body). All three are retried; the Settings counters split them into "ยังไม่ได้ส่ง" (0, 3) and "พบปัญหา" (4).

Field names differ between the local column and the wire format in two places — don't "fix" one side alone: local `is_plate_manual` → API `is_manual`, local `mileage` → API `mileage` but the insert payload from `scan.js` calls it `chk_mile` (`insertCheckIn` accepts either).

The difference between `3` and `4` is **who is at fault**, and it drives the retry schedule:

- **`3` never backs off.** The data is fine, the network (or the token) is not. `next_retry_at` is cleared so the row goes out on the very next cycle once connectivity returns. On top of that, the first unreachable-network error aborts the rest of the batch — 50 queued rows cost one failed request per cycle while offline, not 50.
- **`4` backs off** through `SYNC_RETRY_BACKOFF_MINUTES` (1m → 5m → 15m → 1h → 3h → 6h, then held at 6h), tracked in `retry_count` / `next_retry_at`. Retrying a payload the server just rejected is pointless, so a permanently-rejected row costs ~5 requests a day instead of ~8,600. There is deliberately **no hard cap**: the row is never abandoned, in case the cause is fixed server-side later.

Both counters reset on success.

### Both sync loops stop when the screen goes off

Despite the library's name, `react-native-background-timer` buys this app **nothing** in the background on Android. `BackgroundTimer.setTimeout()` maps to a native method that is only this:

```java
Handler handler = new Handler();
handler.postDelayed(runnable, (long) timeout);
```

No wake lock, no `AlarmManager`, no foreground service. The library *does* have a wake-lock-holding API — `start()` / `runBackgroundTimer()` — but the app never calls it (only `setTimeout` and `clearTimeout`), and `WAKE_LOCK` is not among the permissions in `android/app/src/main/AndroidManifest.xml`, so calling it would throw `SecurityException` anyway. Nothing anywhere holds a wake lock or keeps the screen on.

`postDelayed` schedules against `uptimeMillis()`, which stops advancing while the device is in deep sleep. So once the screen goes off and the device suspends, **both timer chains freeze** and resume only when the device wakes. Backgrounding the app with the screen still on is fine — it is the screen going off that stops the sync.

Nothing is lost when this happens: queued check-ins keep `sync_status` 0/3 and upload once the device wakes. What is lost is **freshness**, and that has teeth — the registers pull stalls, so `findRegisterByPlate()` answers "ไม่พบซีเจ็ด" for any vehicle registered during the gap, and mode one hard-disables saving without a C7.

The fix is operational, not code: set the device never to sleep — Developer options → Stay awake while charging if it sits on a charger during a shift, otherwise Display → Sleep → Never. On a battery-powered handheld like the SUNMI V3 the second option costs battery, which is the trade-off to decide on site. `expo-keep-awake@13.0.1` is already installed as a transitive dependency of `expo` (not declared in `package.json`) if that needs enforcing from inside the app instead. Genuine background execution would need a foreground service plus `WAKE_LOCK` — native changes, so a rebuild rather than an OTA, and `android/` is committed here so a config plugin will not apply itself.

Related: **`BackgroundTimer.clearTimeout()` does not cancel anything natively.** The native `clearTimeout` is commented out in the module, and the JS side only does `delete this.callbacks[id]`. The pending `Handler` still fires and still crosses the bridge; the emitter then finds no registered callback and drops it. The callback genuinely will not run, so the cleanup paths are correct — but a "cleared" timer still costs a wakeup, and clearing cannot stop a sync that has already passed its first `await`. That is what `currentSyncSessionId` is for.

All of the above is read from the library source and the manifest; it has **not** been verified on a physical device, and OEM battery managers (common on cheap Android hardware) can be more aggressive still.

### Route tracking

[components/LocationTracker.js](components/LocationTracker.js) (headless, mounted beside `CheckInSyncManager`) records the device's walking route for the back-office dashboard. It runs `Location.watchPositionAsync` every 10 s **only while** a session exists, a project is in its window and the app is in the foreground. Screen off or another app in front stops it — there is deliberately no foreground service (operators keep the screen on during a shift; background tracking would need `expo-task-manager`, "allow all the time" on every device and an APK). `expo-location` was already native in 2.2.0, so this ships by OTA.

- Which fixes are kept is decided in [utils/routeTracking.js](utils/routeTracking.js) `shouldRecordPoint()`: moved ≥5 m, or one point a minute while standing still; never 0,0, never accuracy >100 m, never a fix older than the last one. ~360 points/hour walking.
- Rows go to `location_points` (v11) with `comp_id` / `user_id` / `project_id` / `activity_id` read **when recorded**, the same invariant as check-ins. Synced rows are pruned after 2 days; unsynced ones after 14 days so the table cannot grow without bound when the endpoint is unreachable.
- **Uploads to `POST /lpr/locations`** in mbus_backend (`DeviceLocationController`, table `lpr_device_locations`, read by the admin `/yatra` page) every minute, ≤500 points. The server takes one `comp_id` (integer ≥1) and one `project_id` per request, so `nextLocationUpload()` sends the oldest `(comp_id, project_id)` group first; rows recorded before a machine code was set use the current one, and with none at all they wait. It dedupes on `(comp_id, recorded_at)`, so resending after a timeout is safe. Points are marked synced only on `status: "success"`. Live on mbus-test (505 points from the test SUNMI on 26 Nov 2026); **prod has no endpoint yet**, so Prod devices get a 404 each minute and keep points ≤14 days. `ROUTE_UPLOAD_ENABLED` is the kill switch. Contract in [docs/route-tracking-api.md](docs/route-tracking-api.md).
- Nothing on screen shows that tracking is on — the "เส้นทาง" pill in the `main.js` header was removed at the user's request (26 Nov 2026), only Android's own location icon in the status bar remains. That makes telling staff a PDPA matter for the org. `getTrackingState()` / `subscribeTrackingState()` in `routeTracking.js` still publish the state (a module-level store, not a Context — see the double `SyncProvider`) if an indicator comes back. Settings → ตั้งค่าเครื่อง → จุดเส้นทางรอส่ง shows the queue length.
- `hasSession` is re-read once a minute, so tracking starts up to a minute after login.

### How the registers pull stays (or fails to stay) in step with the server

The cursor is **derived from the data, not stored**: `getLastRegisterSyncState()` takes `MAX(updated_at, register_id)` over the rows already held for that project and sends them as `last_update` / `last_id`. That self-heals after a failed batch (the transaction rolls back, the cursor does not move), but it makes the whole scheme depend on three things:

1. **The server must use a compound cursor** — `updated_at > :last_update OR (updated_at = :last_update AND register_id > :last_id)`. If it compares `updated_at` alone, every row sharing the maximum timestamp is skipped forever, which is exactly what a bulk update on the server produces. **This has not been verified against the backend.**
2. **`update_date` must sort correctly as text.** `saveRegisters()` stores it verbatim with no normalization (unlike `saveProjects()`, which runs `formatDateToLocalSqlite`), and the cursor query is a plain `ORDER BY updated_at DESC`. Changing or mixing the server's date format silently picks the wrong maximum.
3. **Deletes must bump `update_date`.** Soft deletes ride the delta and `findRegisterByPlate()` filters `deleted_at IS NULL`, but a hard delete on the server can never reach the device.

`saveRegisters()` isolates failures per row: it skips a row outright when `reg_id`, `proj_id` or `update_date` is missing (none can be substituted — the first two are keys, the third is the cursor), defaults the remaining `NOT NULL` columns, catches anything that still fails, and returns `{saved, skipped}` while logging skips as `REGISTER_SAVE_SKIPPED`. Do not restore all-or-nothing behavior here: a single bad row used to roll back the batch, leave the cursor in place, and re-fetch the same rows every cycle forever, with "ใบ C7 ไม่เพิ่มขึ้น" as the only symptom. Note that a schema `DEFAULT` does not protect a column — it applies only when the column is left out of the INSERT, not when NULL is bound to it.

**There is no reconciliation of any kind.** Nothing compares the local row count against the server, there is no checksum and no periodic full refresh, and `getRegistersCount()` is dead code. If rows are ever missed the device cannot detect it.

The repair is Settings → **ดึงใบ C7 ใหม่ทั้งหมด** (confirm only, no code; long-press on the version row still opens it). `fullResyncRegisters()` in [utils/registerSync.js](utils/registerSync.js) takes the lock it shares with the 10 s loop (waiting out an in-flight run, so a late page can no longer land after the delete and leave a permanent hole), pages through `/lpr/registers` back to back via axios `params`, and only then clears and saves — a failure part-way leaves the old rows intact. It ends by showing the count received, to compare with the back office. The loop reschedules itself when it finds the lock held by a resync, because the resync does not schedule the loop's next run.

**The server deliberately sends fewer rows than it holds.** `Lpr/BusRegisterController@getUpdates` in `mbus_app_backend` (same code in `mbus_admin_backend`) uses an inner `join` on `BusTypes` and `Stations`, so a register without a valid bus type or station never reaches any device and scans as "ไม่พบซีเจ็ด" there. This is believed intentional — incomplete registrations should not check in — so do not "fix" it to a left join. It does mean the device count is expected to be lower than a raw `Registers` count; any future `total` in the response must be computed with the same joins. The server pages 200 rows per request and uses the compound `(UpdateDate, Id)` cursor correctly.

### The registers API uses short field names

`saveRegisters()` in [constants/Database.js](constants/Database.js) renames every column on the way in: `reg_id`→`register_id`, `proj_id`→`project_id`, `code`→`short_code`, `station`→`station_name`, `province`→`station_province`, `alert_msg`→`alert_message`, `chk_date`→`checkin_date`, `act1_date`/`act1_user`/`act1_name`/`act1_mile`→`activity1_*`, `chk_pno`/`act1_pno`/`act2_pno`→`*_printno`, `show_act2`→`show_activity2`, `update_date`→`updated_at`, `delete_date`→`deleted_at`. Adding a field to the registers payload means touching both the `REPLACE INTO` column list and the value array, in order.

High-water marks are derived from the table itself (`getLastRegisterSyncState()` = `ORDER BY updated_at DESC, register_id DESC LIMIT 1`), not stored in a cursor table. Clearing `registers` resets the sync to a full pull.

### The two operational modes fork the whole save path

`appMode` (`useMode()` → `isModeOne`, default `true`) is not just cosmetic:

| | Mode one (`isModeOne`, "ธรรมดา") | Mode two (`!isModeOne`, "ธุดงค์") |
|---|---|---|
| After scan.js validation | `router.push('/passenger_count', params)` — **scan.js does not insert** | inserts + prints in place |
| Insert + print site | [app/passenger_count.js](app/passenger_count.js) | [app/(tabs)/scan.js](app/(tabs)/scan.js) `executeSave` / `generateAndPrint` |
| Field source | route params (**all strings**; `null` arrives as `"null"` — normalize with `paramToIntOrNull`) | component state |
| Sticker number | forced `""` | required |
| Mileage | n/a | required when `activeProject.seq_no` is 1 or 2 and the register's matching `activity{1,2}_checkmile` is 1 |
| History / count queries | filtered by `project_id` | filtered by `activity_id` |

Mode scoping is a **matched pair** in [constants/Database.js](constants/Database.js), and getting one without the other is the bug it was written to prevent:

- **`getScopeField()`** (module-private, line ~591) picks the **column**. Returns `activity_id` only for the explicit string `'false'` *and* only when the active project actually has a non-null `activity_id` — otherwise `project_id`. Every scoped query inside `Database.js` calls it (`getScanHistory`, and all five `*CountForId` helpers).
- **`getScopeId(project)`** (exported, line ~611) picks the **value**, applying the same rule. Screens call this and pass the result in.

So a caller never names a column; it asks `getScopeId()` for the id and the query asks `getScopeField()` for the column, and the two agree because they read the same setting through the same fallback. Passing `activeProject.project_id` straight into `getScanHistory()` or a count helper reintroduces `WHERE activity_id = <project_id>` — silently empty history and zeroed counters, with the data itself perfectly fine. Both callers today are [settings.js](app/(tabs)/settings.js) and [main.js](app/(tabs)/main.js); match them.

Never inline the `appMode` comparison again: the old `appMode == "true" ? 'project_id' : 'activity_id'` fell back the *opposite* way from `ModeContext` (which defaults `isModeOne = true`), so on a device that had never toggled the mode the UI said mode one while every count and the history list filtered on `activity_id` using a `project_id` value. Migration v8 additionally seeds `appMode` so the setting is never absent.

The mode also keys the `<Tabs>` element (`key={isModeOne ? ... }`), so toggling it remounts the whole tab navigator.

`passenger` is a pipe-delimited string, `adults|children|monks|novices` (default `'0|0|0|0'`), written by `passenger_count.js` and re-parsed by each receipt's `formatPassengerInfo`. Per-project flags `not_show_child_qty` / `not_show_novice_qty` hide counters, and `show_slip_section_2` (default **on**, hidden only when the API explicitly sends `false`) gates the second slip section.

### The "รถที่เหลือ" list

`getUnscannedRegisters(currentId, seqNo)` backs a menu in Settings that lists the registered vehicles nobody has scanned yet — the roster minus the ones already seen. Staff otherwise have no end condition for sweeping the parking area, and at close of day the leftovers are the "did not arrive" list.

Three things about it are load-bearing:

1. **It reads `registers`, not `check_ins`.** `checkin_date` / `activity1_date` / `activity2_date` come from the server, so the list reflects scans from *every* device rather than just this one — which is the whole point, since lanes work in parallel. The cost is that it is only as fresh as the last registers pull, and goes stale outright when the device is asleep or offline (see **Both sync loops stop when the screen goes off**). The screen states the sync cadence for that reason.
2. **The date column must track `scan.js`.** `getScanDateField()` mirrors the duplicate-scan guard in [app/(tabs)/scan.js](app/(tabs)/scan.js) exactly — `!seqNo || 0` → `checkin_date`, `1` → `activity1_date`, `2` → `activity2_date`, truthy test so `''` counts as unscanned. If the two ever disagree, a row reads as unscanned here and then warns "ลงทะเบียนแล้ว" at the vehicle, and staff stop trusting the screen. Change them together.
3. **Scoping matches `getRegistersCountForId()`**, including the activity-mode detour: `registers` stores only `project_id`, so activity mode has to map `activity_id` → the set of `project_id`s first. Sharing that logic is what keeps the new total and the "ใบ C7" counter on the same screen referring to the same base.

Rows are grouped by `station_name` because vehicles from one station travel together and park together, so the ones already found narrow down where the missing ones are.

**Phones are fetched live, never stored.** `registers` has no phone or driver-name column (`activity1_user` / `activity1_name` are the staff member who performed activity 1), and the `/lpr/registers` payload carries none — nor `note` / `alert_msg`, despite `saveRegisters()` reading them. Contacts live server-side in `RegisterContacts` (`ContactType` 1 ผู้ประสานงาน, 2 ผู้นำรถ, 3 คนขับ). When the list opens or is refreshed, `loadRemainingContacts()` in `settings.js` calls **`GET /lpr/registers/contacts?project_id=&ids=1,2,3`** through [utils/registerContacts.js](utils/registerContacts.js) — ids grouped by `project_id` (activity mode spans several), ≤300 per request — and renders driver → leader → coordinator, each with a call button, plus the register's note. Offline or against a server without the endpoint, the vehicle list still renders and each card says the phones could not be loaded. Keeping them out of SQLite is deliberate: they stay current when edited on the server and never ride along in the DB export (PDPA). The endpoint is `BusRegisterController@contacts` in mbus_backend, branch `feature/lpr-register-contacts` (26 Nov 2026), mirroring `YatraDashboard::unscanned` of the admin `/yatra` page. Devices without a SIM cannot dial, so numbers stay readable and `selectable` rather than living only behind the button.

**Who is calling, and what happened** — the same follow-up as the admin `/yatra` page, on the same table (`yatra_followups`, created by mbus_app_backend), so a claim made on the web shows on every scanner and vice versa. `contacts` returns a `followup` per register for the round `seq_no` (null check-in, 1/2 activities): `calling {by, at, mine}`, last `reason` / `note` / `noted_by` / `noted_at` / `attempts`. "ฉันจะโทรคันนี้" (`POST /lpr/registers/{id}/calling`) claims the car and fails with the other person's name if someone else holds it; a claim lapses after 10 minutes; tapping a phone number claims too. While you hold it the card shows ติดต่อสำเร็จแล้ว / ไม่รับสาย / โทรไม่ติด / อื่นๆ (อื่นๆ needs a note) → `POST …/followup`, which records the result and releases the claim; เลิกโทร is `DELETE …/calling`. Server side is `App\Services\LprFollowups` in mbus_backend, a copy of `YatraFollowups` in mbus_app_backend — **their rules and `REASONS` must stay identical**, and so must `CALL_RESULTS` in `utils/registerContacts.js`. The card shows the driver first and folds the other contacts behind "ผู้ติดต่ออื่น".


### Printer connection

Login goes `login → bluetooth-setup → main` and **the printer screen is never meant to be interacted with**. **On a SUNMI it does nothing at all:** if `isInnerPrinterAvailable()` it marks the built-in printer connected and goes straight to `/main` — no Bluetooth, no permissions, no dialog. `PrinterProvider` does the same check at mount (a resumed session skips `bluetooth-setup`) and ignores `EVENT_CONNECTION_LOST`, so `main.js` never shows the not-connected banner there. Everything below is the Bluetooth path for other devices: it connects the saved printer, or — with none saved, or when the saved one is unreachable — scans and takes the **first device**, preferring an already-paired one, then saves it. Picking the first entry is what operators did manually every single time, so the list was a step to tap through, not a choice.

- Device lists arrive by event, so they cannot be read straight after `scanDevices()`. `pairedDevicesRef` / `foundDevicesRef` shadow the state and `waitForFirstDevice()` polls them for up to 8 s; the found ref is cleared on each scan so a device from a previous scan cannot be picked.
- Connecting is retried twice — a printer that has just been powered on often refuses the first attempt.
- It **always** ends on `router.replace('/main')`. Failing to connect must not block entry: recording check-ins matters more than printing.
- A centered dialog names the current step, and is held for `MIN_CONNECTING_DIALOG_MS` (3 s) ending on the outcome, because a saved printer reconnects too fast to read otherwise.

`saved_printer` is **never deleted automatically**. It used to be cleared on logout, on a `401` from either sync loop, and on an environment switch; a printer is hardware bound to the device, not to the user or the environment, and wiping it defeated auto-connect. `deleteSetting()` is consequently unused anywhere.

[contexts/PrinterContext.js](contexts/PrinterContext.js) holds `isConnected` / `printerName` / `hasSavedPrinter` and listens for `EVENT_CONNECTION_LOST` globally, so a printer leaving range mid-shift is noticed rather than only while the setup screen is open. It is mounted **once** at root — do not repeat the `SyncProvider` mistake. When not connected, `main.js` shows a persistent banner that opens `bluetooth-setup?manual=1`; that flag makes the screen show the picker instead of auto-connecting, and without it the picker would now be unreachable.

### Receipt printing

Every print site calls `printReceiptImage(base64)` in [utils/printer.js](utils/printer.js), which picks the transport:

- **SUNMI built-in printer** — [SunmiPrinterModule.kt](android/app/src/main/java/com/donnytang/myapp/sunmi/SunmiPrinterModule.kt) → `NativeModules.SunmiPrinter`, using `com.sunmi:printerlibrary:1.0.24` to bind SUNMI's print service (`woyou.aidlservice.jiuiv5`, declared in the manifest `<queries>`; Android 11+ package visibility hides it otherwise). It checks `updatePrinterState()` first, scales the image to the paper (384 dots on 58 mm), prints as a **transaction** and resolves only when the service reports the slip came out. Failures reject with `PRINTER_<state>` and a Thai message (`PRINTER_4` paper out, `PRINTER_6` cover open — codes from SUNMI's docs; 4 is confirmed on the V3). Registered by hand in `MainApplication.kt`, like `LprOcrPackage`.
- **Bluetooth ESC/POS** everywhere else — [`react-native-bluetooth-escpos-printer`](https://github.com/detanx/react-native-bluetooth-escpos-printer) (git fork), exactly as before. It cannot see paper or cover state, so a slip can still vanish silently on that path. The SUNMI's "InnerPrinter" (`00:11:22:33:44:55`) is a virtual Bluetooth device for the same printer; the app no longer uses it.

**An empty printer holds the operator instead of saving.** `waitForPrinterReady()` runs *before* `insertCheckIn()` in `scan.js` (mode two) and `passenger_count.js`, and before `print-slip` in `OnlineSearchModal` (which counts the print server-side the moment it is called). If the built-in printer is not ready it shows "เครื่องพิมพ์ไม่พร้อม … ยังไม่ได้บันทึกข้อมูล" with พิมพ์อีกครั้ง / ยกเลิก and loops until the printer is ready; cancel saves nothing. Paper running out *mid-slip* still lands in the retry alert below, with the row already saved. Settings → **ทดสอบเครื่องพิมพ์** prints a sample through the same path and says which transport answered, with no check-in data needed.

The printable width is the hardware's: 384 dots ≈ 48 mm of the 58 mm roll, ~5 mm unprintable each side. `Receipt.js` already has `padding: 0`, so the slip uses all of it.

The pattern is **render-then-capture**, not text commands:

1. The receipt is rendered as a React Native view inside a `<ViewShot>` parked off-screen (`position: 'absolute', left: -10000`), mounted only while a print is pending.
2. A short `setTimeout` (~500 ms) lets React commit the new props — capturing too early prints stale data.
3. `captureRef(ref, { format: 'png', result: 'base64' })` → `printReceiptImage(uri)`. On Bluetooth that is `printPic(uri, { width: 520 })`, which the library clamps to its 58 mm width (384), plus two `\r\n`; on SUNMI the module feeds two lines.

`printed` is written optimistically at insert time, then reconciled with `updateCheckInPrintedStatus()` — set to `1` after the print resolves, or back to `0` if it throws. A failed print raises a retry/give-up alert that re-prints **the same row** rather than re-running the save, because a second `insertCheckIn` would create a new `uid` that the server cannot dedupe. Keep that shape when touching either print path: never re-enter the save handler to retry a print. (If the row happens to sync in the gap, the correction does not reach the server — printing resolves in ~1–2 s against a 10 s sync interval, so this is rare rather than impossible.)

There are **three print sites and two receipt renderers**:
- [components/Receipt.js](components/Receipt.js) (`React.forwardRef`, 300 px wide) — used by `scan.js` (mode two) and by [components/OnlineSearchModal.js](components/OnlineSearchModal.js), which both `main.js` and `checkin-detail.js` mount.
- An inline receipt inside [app/passenger_count.js](app/passenger_count.js) — mode one, with the two-section slip. Edits to the mode-one receipt do **not** belong in `Receipt.js`.

Printing from the server search (`OnlineSearchModal`) calls `POST /lpr/checkins/print-slip` first and only prints if the server answers `status: "success"`, so the print count stays authoritative server-side. It is **not a reprint**: `handlePrint` returns immediately unless the search result has `printed === false`, and the button is only shown when that holds (plus `can_print`, a `register_id` and C7 station data). The app itself never decides to print a second slip; a **reprint is granted server-side**. An admin grants one on the `/yatra` page (mbus_app_backend, table `lpr_reprint_grants`, reasons กระดาษหมด / พิมพ์ไม่ชัด / ใบชำรุด, one grant = one slip, expires end of the project day); while a grant is open, `/lpr/checkins/search` answers `can_print: true, printed: false`, so this same button appears and `print-slip` consumes the grant (mbus_backend `dd561f4`, test only as of 26 Nov 2026). `print-slip` sends **this device's** `machineCode` as `comp_id` (falling back to the original row's when unset) because the server records it as the printing device. Requesting a reprint from the device itself is planned but waits on the role rules. The modal renders its own off-screen receipt *outside* its `<Modal>`, as `main.js` did, because `captureRef` has only ever been proven against views in the host screen.

[components/SamplePrint.js](components/SamplePrint.js) is raw ESC/POS test-page commands and is the only consumer of the base64 logos in [components/dummy-logo.js](components/dummy-logo.js) and of `PRINT_DATA` in [components/printData.js](components/printData.js) — the real receipts have no logo. It is itself referenced only from the dead `components/oldFile/bluetooth.js`, so all four files are unreachable; see dead code.

### OCR

`scan.js` calls `detectPlate()` in [utils/lprOcr.js](utils/lprOcr.js): the on-device engine first (Android with the native module — see **On-device OCR (Android)**), then the Cloud Run service at a **hardcoded** URL with `OCR_SERVER_TIMEOUT` 15 s (see **The two systems**). Both return `{ data: { license_plate, province } }`. An on-device "no plate found" is a real answer and does not fall back. When the service is reached and times out or fails, `scan.js` opens the manual-entry modal and records `ocr_connected = 0` on the check-in, so a checkpoint keeps working without OCR. The detected province is only accepted if it matches `THAI_PROVINCES` in [constants/provinces.js](constants/provinces.js). The original OCR values are preserved in `detect_plate_no` / `detect_plate_province` alongside the corrected `plate_no` / `plate_province`, with `is_plate_manual` recording whether a human edited them.

### API surface

All under the environment base URL, `Authorization: Bearer <lpr_token>` from `getActiveSession()`:

| Endpoint | Caller |
|---|---|
| `POST /lpr/login` | `contexts/AuthContext.js` |
| `POST /lpr/logout` | `app/(tabs)/settings.js` |
| `GET /lpr/projects` | `contexts/ProjectContext.js`, `settings.js` |
| `GET /lpr/registers` | `app/(tabs)/_layout.js` |
| `POST /lpr/checkins` (multipart) | `components/CheckInSyncManager.js` |
| `GET /lpr/checkins/search` | `components/OnlineSearchModal.js` |
| `POST /lpr/checkins/print-slip` | `components/OnlineSearchModal.js` |
| `POST /lpr/locations` | `components/LocationTracker.js` (route points) |
| `GET /lpr/registers/contacts` | `app/(tabs)/settings.js` ("รถที่เหลือ" phones — see that section) |

### Database (SQLite, expo-sqlite, WAL mode)

[constants/Database.js](constants/Database.js) is a ~1480-line monolith — schema, migrations, and every query live here as plain exported async functions. `LicensePlateReader.db` is opened once into a module-level promise; every function starts with `await getDb()`.

Migrations run in `setupDatabase()` and are gated on `PRAGMA user_version`, **currently v11**: v1 initial schema, v2 `error_logs`, v3 mileage columns, v4 `projects.bus_types`, v5 `not_show_child_qty` / `not_show_novice_qty`, v6 `show_slip_section_2`, v7 `check_ins.retry_count` / `next_retry_at`, v8 seeds the `appMode` setting, v9 indexes `check_ins` on `(project_id, created_at)` and `(activity_id, created_at)` for the history list, v10 adds `check_ins.latitude` / `longitude` / `location_accuracy`, v11 creates `location_points` (route tracking). Each block must set `user_version = N` itself; the single `PRAGMA user_version = ...` write at the end only fires when the value is `> 0`. (The v1 block is the exception — it sets nothing and is carried to 2 by the v2 block that always follows it on a fresh DB. Don't copy that shape; a new tail migration that forgets the assignment re-runs forever.) Post-v1 migrations check `PRAGMA table_info(...)` before each `ALTER TABLE` so they are re-runnable.

Key tables:

- **`sessions`** — holds `lpr_token`. `getActiveSession()` is the canonical read (it joins `users`, so `user_id`, `username` etc. come back too).
- **`settings`** — KV store for `appMode`, `environment`, `saved_printer` (JSON), `machineCode`.
- **`projects`** — composite identity `(project_id, activity_id)`, plus the per-project feature flags and `bus_types`.
- **`registers`** — master plate records; `register_id` is the server PK and the `REPLACE INTO` key. `findRegisterByPlate()` ignores soft-deleted rows; `scan.js` rewrites `กรุงเทพมหานคร` → `กทม.` before the lookup because that is how the backend stores it. The v1 column `check_mileage` is vestigial — never written by `saveRegisters()` and never read; the live flags are `activity1_checkmile` / `activity2_checkmile` from v3.
- **`check_ins`** — local-first, `uid` is a client-generated ULID, indexed on `sync_status` and (v9) on `(project_id, created_at)` / `(activity_id, created_at)`. The table is never pruned, so before v9 every history refresh scanned every row of every past activity and sorted it in a temp b-tree. `comp_id` is the `machineCode` setting.
- **`error_logs`** — every API/DB/camera/print/sync error funnels here; Settings exports it. Use `insertErrorLog()` for one-shot, user-triggered errors and **`insertErrorLogThrottled()` for anything inside a polling loop** — the latter collapses identical errors (same type/code/page/action/message prefix) into one row per 5 minutes and records how many were folded in. `pruneErrorLogs()` runs once from `setupDatabase()` and keeps 14 days / 5000 rows.

Always wrap DB ops in `try/catch` and log to `error_logs` — that's the pattern throughout, and Settings is the only field-debugging channel. `insertErrorLog()` accepts a string, `Error`, or object for `error_message` and truncates at 5000 chars. Before exporting the DB, call `checkpointDatabase()` (`PRAGMA wal_checkpoint(TRUNCATE)`) to flush WAL — [utils/exportUtils.js](utils/exportUtils.js) already does.

### State management

React Context only — no Redux, no Zustand. Each provider exports a `use*` hook:

- `useAuth()` → user, login(), logout()
- `useProject()` → activeProject, isLoading, syncProjectsWithApi(), refreshCurrentProject()
- `useSync()` → isOnline, isSyncing, lastSyncTime + setters (status flags only; the sync managers do the work) — see the double-mount note above
- `useMode()` → isModeOne, toggleMode()
- `useEnvironment()` → environment, updateEnvironment()

In sync code, callbacks are `useCallback`-wrapped and long-lived values are read through refs (`activeProjectRef`, `currentSyncSessionId`) specifically to keep the callback identity stable so the polling chain isn't torn down and restarted on every render.

## Conventions worth knowing

- **JS by default, TS only at the edges.** `tsconfig.json` is present with `strict` and `@/*` aliases, but nearly everything is `.js`. Only `app/_layout.tsx`, the template components, `hooks/`, and `constants/Colors.ts` are TS. Don't convert files to TS as a side-quest.
- **The API base URL is duplicated as an inline ternary in seven files** — `contexts/AuthContext.js`, `contexts/ProjectContext.js`, `components/CheckInSyncManager.js`, `app/(tabs)/_layout.js`, `app/(tabs)/scan.js`, `components/OnlineSearchModal.js`, `app/(tabs)/settings.js`. Changing or adding an environment means editing all of them (or centralizing them deliberately, in one change).
- **No `.env` files.** Runtime config (environment, mode, machine code, printer) lives in the SQLite `settings` table. Build-time variants come from `APP_VARIANT` in eas.json. Default environment is `prod`.
- **Imports mix `@/...` and relative paths** within the same directory. Match whatever the file already uses.
- **Background timers** use `react-native-background-timer`, not `setTimeout`/`setInterval`. Match that in sync code for consistency, but do not believe the name: on Android it is a bare `Handler.postDelayed` with no wake lock, so it survives the app being backgrounded with the screen on and nothing more. See **Both sync loops stop when the screen goes off**.
- **Thai TTS** for plate readback maps characters to spoken words in [utils/speechUtils.js](utils/speechUtils.js) (`กค583` → "กอ ไก่ คอ ควาย ห้า แปด สาม"). Don't replace it with `Speech.speak()` of the raw plate.
- **On this Mac, `/usr/bin/git` and `/usr/bin/python3` are broken.** Xcode 16.2 is too old for macOS 26.6, so its shims abort with `dlopen(@rpath/libxcodebuildLoader.dylib): Symbol not found: _XPCTypeBool`. It bites anything that shells out to git, including `eas build`. Interactive shells are covered by `~/.local/bin/git` (already first on PATH), which is a **wrapper script**, not a symlink:

  ```sh
  #!/bin/sh
  exec /Library/Developer/CommandLineTools/usr/bin/git "$@"
  ```

  A symlink there looks like it works and then breaks `push`/`fetch`: git derives `--exec-path` from the path it was invoked through, so it hunts for `git-remote-https` in `~/.local/libexec/git-core` and fails with `git: 'remote-https' is not a git command`. Built-ins like `status` and `commit` keep working, which makes it easy to miss. For one-off commands, `DEVELOPER_DIR=/Library/Developer/CommandLineTools` fixes every shim at once. Do **not** reach for `EAS_NO_VCS=1` — it uploads the whole working directory, `node_modules` and build output included. The real fix is updating Xcode, which needs admin rights.

### OTA updates from inside the app

`checkAutomatically: ON_LOAD` downloads an update in the background but only *applies* it on the next launch, so in the field it took two restarts and nobody could tell whether it had arrived. Settings → **ตรวจหาอัปเดต** runs `checkForUpdateAsync` → `fetchUpdateAsync` → `reloadAsync` and says which happened. Restarting loses nothing: check-ins are in SQLite and the queue resumes. An update only reaches devices on the same `runtimeVersion`.

## Dead code and known warts

Several files look live but aren't — check before editing:

- **[components/scan_normal.js](components/scan_normal.js)** (1073 lines) and **[components/oldFile/](components/oldFile)** — unreferenced older copies of the scan/bluetooth screens. The only mention of `scan_normal` in `(tabs)/_layout.js` is inside a commented-out block, and `oldFile/LicensePlateData.js` still points at a decommissioned OCR host. Editing these changes nothing; [app/(tabs)/scan.js](app/(tabs)/scan.js) is the live implementation.
- **[components/OrderSlip.js](components/OrderSlip.js)** + **[components/base64Image.js](components/base64Image.js)** — an older hardcoded slip and its print harness; referenced only by each other.
- **[components/SamplePrint.js](components/SamplePrint.js)** + **[components/printData.js](components/printData.js)** + **[components/dummy-logo.js](components/dummy-logo.js)** — the ESC/POS test page, its hardcoded sample invoice (`PRINT_DATA`, a Chinese-commented sales receipt) and the base64 logos. `SamplePrint` is imported only by the dead `components/oldFile/bluetooth.js`, so the whole cluster is unreachable. Note `OnlineSearchModal.js` has local state also named `printData` — grepping the bare word finds live code that has nothing to do with this module.
- **[components/SyncStatus.js](components/SyncStatus.js)** — passed to `headerRight` on the settings tab (and in two commented-out blocks), but every `Tabs.Screen` in `(tabs)/_layout.js` sets `headerShown: false`, so no header exists to hold it. Of the `useSync()` values `_layout.js` maintains, only `isOnline` is read (by `main.js`); `isSyncing` and `lastSyncTime` are written and never read.
- **[components/styles.js](components/styles.js)** — imported by nothing.
- **Root [index.js](index.js)** imports `./app-default`, which does not exist. It's inert because `package.json` sets `main: expo-router/entry`.
- `components/.scan.js.swp`, `components/Untitled-1.ipynb`, and `eas-build-error-log.text` are stray artifacts checked into the repo.
- `contexts/AuthContext.js` calls `saveSession(user.id, user.username)` in a `useEffect`, but `saveSession(loginData)` takes a single object — that call rejects unhandled. The session is actually saved by `login.js` calling `saveSession(result.data)` correctly. Fix the `AuthContext` call rather than changing `saveSession`'s signature.
- There is still no screen listing *which* rows are failing — the Settings "พบปัญหา" counter is a number, and the history list pages through rows 30 at a time without a filter by status. A single row can be inspected by tapping its card (`checkin-detail.js`), and its "ลองส่งใหม่" button calls `retryCheckInNow()`, which clears `next_retry_at` and resets `retry_count` so the next 10 s cycle picks it up. The button appears only for `sync_status = 4` rows that have a `comp_id`, since a row without one would be rejected again immediately. Saving a machine code (`backfillCheckInCompId()`) remains the bulk version of the same thing.
- `photo_path` points into the ImagePicker cache, which Android may evict, and the photo is never copied anywhere durable. A long-queued row can still lose its image; the upload logs `PHOTO_MISSING` and proceeds without it, but the photo is gone. Until `ba3fc39` it did *not* proceed: the "could not resize" fallback attached the original path whenever `photo_path` was set, without checking the file existed. React Native fails a multipart part it cannot open (`Could not retrieve file for uri`) as a request error, axios reports `ERR_NETWORK`, and the loop treated it as offline — the row went back to 3 and the rest of the batch was abandoned, every cycle, so everything queued behind it stalled. Preventing it means copying the capture into `documentDirectory` at scan time and taking on the cleanup that implies.
- `CheckInSyncManager` reads `useAuth()` for `user?.id` on its error logs, but it is mounted above the login screen, so early-startup logs can carry a null user.
- **`AuthContext.logout()` is never called.** The Settings logout only does `clearSession()` on the database, so the context keeps the previous `user` until the app restarts — later error logs carry the stale id, and logging in as a different account hits the broken `saveSession(user.id, user.username)` call above.
- Logging out does not warn when check-ins are still queued, even though the count is displayed directly above the button. Nothing is lost (the rows keep `sync_status` 0/3) but they stay stuck until someone logs back in. `getTotalUnsyncedCheckInsCount()` exists for exactly this warning — the environment switch already uses it.
- `settings.js` has an `if (loading) return <spinner>` roughly a third of the way down, with every hook above it. **A hook added below that line crashes the screen** with "rendered more hooks than during the previous render" the instant `loading` flips false — same trap as `ProjectProvider`, but here it fires for real rather than being masked by a guard higher up. The `useMemo` backing the "รถที่เหลือ" grouping sits just above the return for this reason.
- The master approval code `8989` is hardcoded at four separate call sites in `settings.js`.
- `exportStartDate` / `exportEndDate` are dead state — the export modal never renders date inputs and `exportDatabaseFile()` takes no range. `exportDatabaseToJSON(start, end)` in [utils/exportUtils.js](utils/exportUtils.js) would accept one but is not imported.
- The registers *loop* makes **one request per cycle with no drain loop**, and the server pages 200 rows, so a first sync of N pages takes N × 10 s before the device holds complete data; during that window `findRegisterByPlate()` reports "ไม่พบซีเจ็ด" for vehicles that are in fact registered. The resync button drains back to back and is the faster route.
- Only the **currently active** project is pulled (`project_id=${activeProject.project_id}`), and `activeProject` is time-windowed, so nothing is pre-fetched for a project whose window has not opened. It starts from zero at the exact moment operators begin scanning.
- The registers loop's URL is built by string interpolation, so `last_update` is not percent-encoded. `fullResyncRegisters()` already uses axios `params`; the loop should too. The environment switch also clears `registers` without taking the shared lock.
- `clearScanState()` in `scan.js` deliberately leaves `setVehicleType(null)` commented out, so the vehicle type carries over to the next scan. When a C7 is found it is overwritten, but when one is not — and mode two allows saving anyway — the previous vehicle's type is pre-filled and easy to save by accident.
- Bangkok is stored inconsistently: `registers` and the mode-one path use `กทม.`, but mode two saves `province` raw from `scan.js`, so those check-ins carry `กรุงเทพมหานคร` and do not match either.
- Mode one hard-disables the save button unless `isVerified` (a C7 was found), so a vehicle missing from `registers` cannot be checked in at all. Read that together with the registers-pull gaps above: during an initial sync, operators may be unable to register anyone.
- `bus_type` is whatever the vehicle-type control shows at save time: the dropdown's `value`, which is the project's `bus_types[].short_name` (`พัดลม`, not `รถบัสพัดลม`), or the free text for 'Other'. A C7 match pre-fills it from the register — as the dropdown value when the register's string matches one, otherwise as 'Other' plus that string — and since `d80fffb` the operator's change is honoured and matches what both slips print. Before that, a C7 match overwrote the choice at save time and rows without one stored the full label via `convertBusTypeToLabel()`, so older rows on the server carry a different format for the same vehicle type.
- The duplicate check reads the local `registers` table, which is up to one sync cycle stale, and each device generates its own `uid`, so two lanes scanning the same vehicle inside that window both succeed and the server cannot dedupe them.
- **`router.push('/main')` from a root-stack screen stacks a second `(tabs)`.** In expo-router 3.5.12, `push` onto a stack navigator becomes a `NAVIGATE` with a fresh random key (`build/global-state/routing.js`, `getNavigateAction`), so it never returns to the existing `(tabs)` route — it adds a new one. [app/passenger_count.js](app/passenger_count.js) does exactly this after every mode-one save, so the root stack grows by `passenger_count` + `(tabs)` per check-in, each extra `(tabs)` mounting its own `_layout.js` registers loop (the lock-skip path does not reschedule, which is the only reason those chains die off — but a chain that hits the skip *during a resync* does reschedule, so a resync can keep such extra chains alive). Use `router.navigate('/main')` or `router.back()` from outside `(tabs)`. Read from the library source; not yet observed on a device.
- Auto-picking the first Bluetooth device assumes the printer sorts first among paired devices. A device paired with anything else could connect to the wrong one; filter by name or class if that shows up.

## Known cross-system gotchas

- **The OCR URL is hardcoded and environment-independent** — switching to the test environment in Settings does *not* point scans at a test OCR service. There is only one.
- **The detector folder is not under version control.** Changes there have no history and no rollback; the deployed image in Artifact Registry is the only other copy. Its CLAUDE.md documents the models, class maps and Cloud Run/cost setup in detail — read it first rather than inferring from variable names (the detector's `vehicle_model` / `car_roi` are misnamed and detect **plates**, not vehicles).
- **Only values that cross the RN bridge are type-checked by reality, not by tests.** `warmUp()` shipped resolving a Kotlin `Long`, which the bridge cannot marshal (`Cannot convert argument of type class java.lang.Long`), so it rejected on every launch. The instrumented test never caught it because it calls `LprOcr` directly and never crosses the bridge. Keep bridge payloads to Double/Int/String/Boolean/Map/Array, and verify native changes by launching an installed APK, not only by running the test.
- **The dev variant shares `strings.xml` with production**, so both show the label "Mbus Scan" rather than "Mbus Scan (Dev)". They still install side by side — `applicationId` differs (`com.donnytang.myapp.dev`) — only the label collides.
- **The icon artwork still reads "Register-Mbus"**, which no longer matches the app name. Cosmetic, and it needs a new source image in `assets/images/` plus regenerated mipmaps (see the prebuild section).
