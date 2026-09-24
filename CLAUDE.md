# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Mbus Register** — an Expo / React Native (SDK 51, RN 0.74) Android app used at Dhammakaya parking checkpoints, shown on the launcher as **Mbus Scan**. The workflow is: log in → connect a Bluetooth ESC/POS thermal printer → photograph a vehicle's license plate (OCR on the device, falling back to an external service) → confirm vehicle/passenger details → save the check-in locally → upload to the API in the background → print a paper receipt.

**The device is a SUNMI V3 handheld POS terminal, not a tablet**: 6.75", 720×1600 px = **360×800 dp**, about 420 nits and used outdoors. Its built-in thermal printer is reached over Bluetooth like an external one. Design every screen for that width and brightness — a first round of mockups was drawn at 820×1180 because this file used to say "tablet", and all of it had to be redrawn.

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
 │  Bluetooth ESC/POS receipt
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
npm test               # jest --watchAll (preset: jest-expo)
npm run lint           # expo lint
npm run reset-project  # scripts/reset-project.js — wipe to a clean Expo template (destructive)
```

Single test: `npx jest path/to/file.test.js` or `npx jest -t "test name"`.

There is effectively **no test suite** — the only test is `components/__tests__/ThemedText-test.tsx`, a leftover snapshot test from the Expo template. Don't assume `npm test` verifies anything about this app.

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

**Do not "fix" this by running `expo prebuild`.** It rewrites the whole `android/` folder and would drop the hand-registered `LprOcrPackage`, the release `abiFilters`, the `settings.gradle` dev-client exclusion and the `noCompress` rule. Edit the native files directly, then confirm against a built APK rather than trusting the config:

```bash
cd android && ./gradlew :app:assembleRelease
aapt2 dump badging app/build/outputs/apk/release/app-release.apk | grep -E "^package:|^application-label:"
```

### Release-build specifics

- **expo-dev-client is excluded from release builds** in [android/settings.gradle](android/settings.gradle). Without it a release APK compiles, installs, then dies building React Native's module registry: `IllegalStateException: Native module ExpoDevMenuExtensions tried to override DevMenuExtension`. expo-dev-menu declares `debugOnly` for iOS but not Android, and its `DevMenuPackage` returns a `DevMenuExtension` in every variant. `settings.gradle` runs before variants exist, so the build type is inferred from the requested task names; override with `-Pmbus.excludeDevClient=true|false` when that guess is wrong (e.g. a bare `./gradlew assemble`, which builds both variants at once).
- **Release ships only `arm64-v8a` and `armeabi-v7a`** (`abiFilters` in `build.gradle`). The x86/x86_64 slices were ~75 MB of native libraries no checkpoint device will ever load — they exist for x86_64 emulators, which is a debug concern, so debug builds deliberately keep all four. Release APK is ~86 MB. Keep `armeabi-v7a`: the SUNMI V3 is arm64 but older fleet units may be 32-bit.
- **Local release builds need a working `git`** — see the Xcode note under Conventions.

### Versioning and getting a build onto fleet devices

Current: `versionCode` 2, `versionName` 2.0.0, `runtimeVersion` 2.0.0. Everything before this shipped `versionCode` 1, so older devices cannot be told apart by number.

All EAS production builds use the same managed keystore (`qnchy5_CNe`), so a new APK **installs over the existing one — no uninstall, and SQLite check-ins, session and paired printer survive**. The exception is a device that has a locally built debug APK on it: different signing key, so that one must be uninstalled first (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).

**OTA cannot deliver a native change.** The on-device OCR is a native module, so `eas update` will never ship it — devices need the APK. `runtimeVersion` 2.0.0 also cuts off every update published on the `production` branch before it — all of them runtime 1.0.0, more than fifty, the newest on 24 Sep 2026 — which is deliberate: they predate the native module. The cost is that during a rollout there are two OTA lanes, 1.0.0 and 2.0.0, until every device has the new APK. **Bump `runtimeVersion` whenever native code changes.**

- **Two APKs carry the native module but runtime 1.0.0**: builds `eef5923` and `c2c3cde` (5 Sep 2026, before `97f20f3` bumped it). They take every 1.0.0 OTA, and the JS on that lane has no `utils/lprOcr.js`, so on those devices on-device OCR silently stops and scans go to the service. The SUNMI V3 used for testing on 24 Sep 2026 had one. Replace them with a 2.0.0 APK.
- **Check a device's runtime before trusting an OTA to reach it**, rather than inferring it from the label ("Mbus Scan" exists at both runtimes). Pull the APK with `adb shell pm path com.donnytang.myapp` + `adb pull`, then `aapt2 dump resources <apk> | grep -A1 expo_runtime_version`; the channel is the `expo-channel-name` header in `aapt2 dump xmltree --file AndroidManifest.xml <apk>`. To see what a device actually did, filter `adb logcat` for `dev.expo.updates`.
- `isOnDeviceOcrAvailable()` tests for `NativeModules.LprOcr`, so JS containing the on-device path also runs on an APK without the module — it falls back to the service.

Confirming a device actually updated:

```bash
adb shell dumpsys package com.donnytang.myapp | grep versionName   # expect 2.0.0
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
| weights | `android/app/src/main/assets/plate_{region,ocr}.fp16.onnx` + `labels.json` (11.7 MB total) |
| runtime | `onnxruntime-android:1.20.0`, **CPU provider, 4 intra-op threads** |

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
cd android && ./gradlew :app:connectedDebugAndroidTest
```

### Two independent sync loops

Both are **self-scheduling `BackgroundTimer.setTimeout` chains** (each run schedules the next in its `finally`), not `setInterval`. Both guard against overlap with a lock plus a `currentSyncSessionId` ref: the effect stamps a new session id on every restart, and a run whose id no longer matches aborts — including mid-loop. Preserve that pattern; a plain interval will double-fire when `activeProject` changes.

1. **Registers (master plate data) — pull.** [app/(tabs)/_layout.js](app/(tabs)/_layout.js). 3 s initial delay, then every 10 s: `GET /lpr/registers?last_update=X&last_id=Y&project_id=Z` → `saveRegisters()`. Uses a module-level `globalSyncLock` (survives re-renders); the lock-skip path deliberately does *not* reschedule, leaving that to the in-flight run. A `401` here is one of two session-expiry paths: it clears the session and redirects to `/login`, leaving `saved_printer` alone.
2. **Check-ins — push.** [components/CheckInSyncManager.js](components/CheckInSyncManager.js). 5 s initial delay, then every 10 s, with a 30 s per-request timeout. Selects `sync_status IN (0, 3, 4)` in batches of 50, **unattempted rows (`sync_status = 0`) first** then oldest-first — without that ordering a batch of permanently-rejected old rows would fill every cycle and new registrations would never upload. For each row it resizes the photo to 400 px wide at quality 0.7 (`expo-image-manipulator`), POSTs `/lpr/checkins` as **`multipart/form-data`** with the image attached as a `photo_file` part — not base64, not JSON — and deletes the resized temp file afterwards. A `duplicate` / `already exists` error from the server still marks the row synced (intentional — the server already has it). A `401`/`403` aborts the batch, keeps the row retryable, and forces re-login the same way the registers loop does.

Neither loop notifies the UI. [app/(tabs)/main.js](app/(tabs)/main.js) re-runs `loadHistory` on a 5 s interval **while focused only** (plain `setInterval`, not `BackgroundTimer` — refreshing a screen nobody is looking at is pointless) and offers pull-to-refresh; the list is always rendered with `ListEmptyComponent` so the gesture works when empty too. The list is **paged**: `getScanHistory(id, query, limit)` returns the newest `HISTORY_PAGE_SIZE` (30) rows, `onEndReached` widens the window by another page, and the 5 s tick re-reads only that window, never the whole table. `mergeHistory()` reuses the previous object for every row whose displayed fields are unchanged (and returns the previous array when nothing changed), and the callbacks passed to `HistoryItem` are `useCallback`-stable, so `React.memo` skips every card that did not change. Keep both halves: before this, a single row changing sync status (every 10 s while uploading) produced a new object for every row, so every mounted card re-rendered on every tick — that, not the row count, is why the list used to be capped at 5. `windowSize` is 7 instead of FlatList's default 21, which keeps about a third as many cards (each with a photo) mounted. `checkin-detail.js` does the same on its own 5 s focused interval. Settings refreshes its counters via `useFocusEffect`. The proper fix — having the sync manager signal the screens — is blocked by the double `SyncProvider` above.

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

### How the registers pull stays (or fails to stay) in step with the server

The cursor is **derived from the data, not stored**: `getLastRegisterSyncState()` takes `MAX(updated_at, register_id)` over the rows already held for that project and sends them as `last_update` / `last_id`. That self-heals after a failed batch (the transaction rolls back, the cursor does not move), but it makes the whole scheme depend on three things:

1. **The server must use a compound cursor** — `updated_at > :last_update OR (updated_at = :last_update AND register_id > :last_id)`. If it compares `updated_at` alone, every row sharing the maximum timestamp is skipped forever, which is exactly what a bulk update on the server produces. **This has not been verified against the backend.**
2. **`update_date` must sort correctly as text.** `saveRegisters()` stores it verbatim with no normalization (unlike `saveProjects()`, which runs `formatDateToLocalSqlite`), and the cursor query is a plain `ORDER BY updated_at DESC`. Changing or mixing the server's date format silently picks the wrong maximum.
3. **Deletes must bump `update_date`.** Soft deletes ride the delta and `findRegisterByPlate()` filters `deleted_at IS NULL`, but a hard delete on the server can never reach the device.

`saveRegisters()` isolates failures per row: it skips a row outright when `reg_id`, `proj_id` or `update_date` is missing (none can be substituted — the first two are keys, the third is the cursor), defaults the remaining `NOT NULL` columns, catches anything that still fails, and returns `{saved, skipped}` while logging skips as `REGISTER_SAVE_SKIPPED`. Do not restore all-or-nothing behavior here: a single bad row used to roll back the batch, leave the cursor in place, and re-fetch the same rows every cycle forever, with "ใบ C7 ไม่เพิ่มขึ้น" as the only symptom. Note that a schema `DEFAULT` does not protect a column — it applies only when the column is left out of the INSERT, not when NULL is bound to it.

**There is no reconciliation of any kind.** Nothing compares the local row count against the server, there is no checksum and no periodic full refresh, and `getRegistersCount()` is dead code. If rows are ever missed the device cannot detect or recover from it; the only repair is the hidden "clear registers" action followed by a full re-pull.

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

**There is no driver phone column.** `registers` has 28 columns and none of them is a phone or a driver name (`activity1_user` / `activity1_name` are the staff member who performed activity 1). Until the backend sends one, the contact line falls back to `note` / `alert_message` — both synced to the device on every pull and, before this, displayed nowhere in the app. `extractPhone()` in `settings.js` pulls a Thai-format number out of either; a hit becomes a call button, anything else renders as text. Adding the real field means two edits: the `columns` list in `getUnscannedRegisters()` and the `candidates` array in `getContactInfo()`. Note that devices without a SIM cannot dial, so the number is kept readable and `selectable` rather than living only behind the button — and that a phone column will also start riding along in the Settings DB export, which is a PDPA question for the org, not a technical one.

### Printer connection

Login goes `login → bluetooth-setup → main` and **the printer screen is never meant to be interacted with**. It connects the saved printer, or — with none saved, or when the saved one is unreachable — scans and takes the **first device**, preferring an already-paired one, then saves it. Picking the first entry is what operators did manually every single time, so the list was a step to tap through, not a choice.

- Device lists arrive by event, so they cannot be read straight after `scanDevices()`. `pairedDevicesRef` / `foundDevicesRef` shadow the state and `waitForFirstDevice()` polls them for up to 8 s; the found ref is cleared on each scan so a device from a previous scan cannot be picked.
- Connecting is retried twice — a printer that has just been powered on often refuses the first attempt.
- It **always** ends on `router.replace('/main')`. Failing to connect must not block entry: recording check-ins matters more than printing.
- A centered dialog names the current step, and is held for `MIN_CONNECTING_DIALOG_MS` (3 s) ending on the outcome, because a saved printer reconnects too fast to read otherwise.

`saved_printer` is **never deleted automatically**. It used to be cleared on logout, on a `401` from either sync loop, and on an environment switch; a printer is hardware bound to the device, not to the user or the environment, and wiping it defeated auto-connect. `deleteSetting()` is consequently unused anywhere.

[contexts/PrinterContext.js](contexts/PrinterContext.js) holds `isConnected` / `printerName` / `hasSavedPrinter` and listens for `EVENT_CONNECTION_LOST` globally, so a printer leaving range mid-shift is noticed rather than only while the setup screen is open. It is mounted **once** at root — do not repeat the `SyncProvider` mistake. When not connected, `main.js` shows a persistent banner that opens `bluetooth-setup?manual=1`; that flag makes the screen show the picker instead of auto-connecting, and without it the picker would now be unreachable.

### Receipt printing (Bluetooth ESC/POS)

Uses [`react-native-bluetooth-escpos-printer`](https://github.com/detanx/react-native-bluetooth-escpos-printer) (git fork). The pattern is **render-then-capture**, not text commands:

1. The receipt is rendered as a React Native view inside a `<ViewShot>` parked off-screen (`position: 'absolute', left: -10000`), mounted only while a print is pending.
2. A short `setTimeout` (~500 ms) lets React commit the new props — capturing too early prints stale data.
3. `captureRef(ref, { format: 'png', result: 'base64' })` → `BluetoothEscposPrinter.printPic(uri, { width: 520, left: 0 })` → a couple of `\r\n` to feed the paper.

`printed` is written optimistically at insert time, then reconciled with `updateCheckInPrintedStatus()` — set to `1` after the print resolves, or back to `0` if it throws. A failed print raises a retry/give-up alert that re-prints **the same row** rather than re-running the save, because a second `insertCheckIn` would create a new `uid` that the server cannot dedupe. Keep that shape when touching either print path: never re-enter the save handler to retry a print. (If the row happens to sync in the gap, the correction does not reach the server — printing resolves in ~1–2 s against a 10 s sync interval, so this is rare rather than impossible.)

There are **three print sites and two receipt renderers**:
- [components/Receipt.js](components/Receipt.js) (`React.forwardRef`, 300 px wide) — used by `scan.js` (mode two) and by [components/OnlineSearchModal.js](components/OnlineSearchModal.js), which both `main.js` and `checkin-detail.js` mount.
- An inline receipt inside [app/passenger_count.js](app/passenger_count.js) — mode one, with the two-section slip. Edits to the mode-one receipt do **not** belong in `Receipt.js`.

Printing from the server search (`OnlineSearchModal`) calls `POST /lpr/checkins/print-slip` first and only prints if the server answers `status: "success"`, so the print count stays authoritative server-side. It is **not a reprint**: `handlePrint` returns immediately unless the search result has `printed === false`, and the button is only shown when that holds (plus `can_print`, a `register_id` and C7 station data). No path in the app prints a second slip for a check-in that already has one — a "print again" button would bypass the server's count, so it is a product decision, not a UI one. The modal renders its own off-screen receipt *outside* its `<Modal>`, as `main.js` did, because `captureRef` has only ever been proven against views in the host screen.

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

### Database (SQLite, expo-sqlite, WAL mode)

[constants/Database.js](constants/Database.js) is a ~1480-line monolith — schema, migrations, and every query live here as plain exported async functions. `LicensePlateReader.db` is opened once into a module-level promise; every function starts with `await getDb()`.

Migrations run in `setupDatabase()` and are gated on `PRAGMA user_version`, **currently v9**: v1 initial schema, v2 `error_logs`, v3 mileage columns, v4 `projects.bus_types`, v5 `not_show_child_qty` / `not_show_novice_qty`, v6 `show_slip_section_2`, v7 `check_ins.retry_count` / `next_retry_at`, v8 seeds the `appMode` setting, v9 indexes `check_ins` on `(project_id, created_at)` and `(activity_id, created_at)` for the history list. Each block must set `user_version = N` itself; the single `PRAGMA user_version = ...` write at the end only fires when the value is `> 0`. (The v1 block is the exception — it sets nothing and is carried to 2 by the v2 block that always follows it on a fresh DB. Don't copy that shape; a new tail migration that forgets the assignment re-runs forever.) Post-v1 migrations check `PRAGMA table_info(...)` before each `ALTER TABLE` so they are re-runnable.

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
- `photo_path` points into the ImagePicker cache, which Android may evict, and the photo is never copied anywhere durable. A long-queued row can still lose its image; the upload now logs `PHOTO_MISSING` and proceeds without it rather than failing silently, but the photo is gone. Preventing it means copying the capture into `documentDirectory` at scan time and taking on the cleanup that implies.
- `CheckInSyncManager` reads `useAuth()` for `user?.id` on its error logs, but it is mounted above the login screen, so early-startup logs can carry a null user.
- **`AuthContext.logout()` is never called.** The Settings logout only does `clearSession()` on the database, so the context keeps the previous `user` until the app restarts — later error logs carry the stale id, and logging in as a different account hits the broken `saveSession(user.id, user.username)` call above.
- Logging out does not warn when check-ins are still queued, even though the count is displayed directly above the button. Nothing is lost (the rows keep `sync_status` 0/3) but they stay stuck until someone logs back in. `getTotalUnsyncedCheckInsCount()` exists for exactly this warning — the environment switch already uses it.
- `settings.js` has an `if (loading) return <spinner>` roughly a third of the way down, with every hook above it. **A hook added below that line crashes the screen** with "rendered more hooks than during the previous render" the instant `loading` flips false — same trap as `ProjectProvider`, but here it fires for real rather than being masked by a guard higher up. The `useMemo` backing the "รถที่เหลือ" grouping sits just above the return for this reason.
- The master approval code `8989` is hardcoded at four separate call sites in `settings.js`.
- `handleClearRegisters` does not refresh the counters, so "ใบ C7" keeps showing the pre-delete number.
- `exportStartDate` / `exportEndDate` are dead state — the export modal never renders date inputs and `exportDatabaseFile()` takes no range. `exportDatabaseToJSON(start, end)` in [utils/exportUtils.js](utils/exportUtils.js) would accept one but is not imported.
- The destructive "clear registers" action is hidden behind a **long-press on the version row** in Settings. It also does not take `globalSyncLock`, so clearing while a register fetch is in flight lets `saveRegisters()` commit after the `DELETE` — leaving a partial set under a cursor that looks up to date, i.e. a permanent hole.
- The registers pull makes **one request per cycle with no drain loop**. If the server paginates, a first sync of N pages takes N × 10 s before the device holds complete data, and during that window `findRegisterByPlate()` reports "ไม่พบซีเจ็ด" for vehicles that are in fact registered. If it does not paginate, the initial pull arrives as one huge payload that `saveRegisters()` walks one `runAsync` at a time.
- Only the **currently active** project is pulled (`project_id=${activeProject.project_id}`), and `activeProject` is time-windowed, so nothing is pre-fetched for a project whose window has not opened. It starts from zero at the exact moment operators begin scanning.
- The registers URL is built by string interpolation, so `last_update` (a timestamp that normally contains a space) is not percent-encoded. Pass it through axios `params` instead.
- `clearScanState()` in `scan.js` deliberately leaves `setVehicleType(null)` commented out, so the vehicle type carries over to the next scan. When a C7 is found it is overwritten, but when one is not — and mode two allows saving anyway — the previous vehicle's type is pre-filled and easy to save by accident.
- Bangkok is stored inconsistently: `registers` and the mode-one path use `กทม.`, but mode two saves `province` raw from `scan.js`, so those check-ins carry `กรุงเทพมหานคร` and do not match either.
- Mode one hard-disables the save button unless `isVerified` (a C7 was found), so a vehicle missing from `registers` cannot be checked in at all. Read that together with the registers-pull gaps above: during an initial sync, operators may be unable to register anyone.
- `bus_type` is whatever the vehicle-type control shows at save time: the dropdown's `value`, which is the project's `bus_types[].short_name` (`พัดลม`, not `รถบัสพัดลม`), or the free text for 'Other'. A C7 match pre-fills it from the register — as the dropdown value when the register's string matches one, otherwise as 'Other' plus that string — and since `d80fffb` the operator's change is honoured and matches what both slips print. Before that, a C7 match overwrote the choice at save time and rows without one stored the full label via `convertBusTypeToLabel()`, so older rows on the server carry a different format for the same vehicle type.
- The duplicate check reads the local `registers` table, which is up to one sync cycle stale, and each device generates its own `uid`, so two lanes scanning the same vehicle inside that window both succeed and the server cannot dedupe them.
- **`router.push('/main')` from a root-stack screen stacks a second `(tabs)`.** In expo-router 3.5.12, `push` onto a stack navigator becomes a `NAVIGATE` with a fresh random key (`build/global-state/routing.js`, `getNavigateAction`), so it never returns to the existing `(tabs)` route — it adds a new one. [app/passenger_count.js](app/passenger_count.js) does exactly this after every mode-one save, so the root stack grows by `passenger_count` + `(tabs)` per check-in, each extra `(tabs)` mounting its own `_layout.js` registers loop (the `globalSyncLock` skip path does not reschedule, which is the only reason those chains die off). Use `router.navigate('/main')` or `router.back()` from outside `(tabs)`. Read from the library source; not yet observed on a device.
- Auto-picking the first Bluetooth device assumes the printer sorts first among paired devices. A device paired with anything else could connect to the wrong one; filter by name or class if that shows up.

## Known cross-system gotchas

- **The OCR URL is hardcoded and environment-independent** — switching to the test environment in Settings does *not* point scans at a test OCR service. There is only one.
- **The detector folder is not under version control.** Changes there have no history and no rollback; the deployed image in Artifact Registry is the only other copy. Its CLAUDE.md documents the models, class maps and Cloud Run/cost setup in detail — read it first rather than inferring from variable names (the detector's `vehicle_model` / `car_roi` are misnamed and detect **plates**, not vehicles).
- **Only values that cross the RN bridge are type-checked by reality, not by tests.** `warmUp()` shipped resolving a Kotlin `Long`, which the bridge cannot marshal (`Cannot convert argument of type class java.lang.Long`), so it rejected on every launch. The instrumented test never caught it because it calls `LprOcr` directly and never crosses the bridge. Keep bridge payloads to Double/Int/String/Boolean/Map/Array, and verify native changes by launching an installed APK, not only by running the test.
- **The dev variant shares `strings.xml` with production**, so both show the label "Mbus Scan" rather than "Mbus Scan (Dev)". They still install side by side — `applicationId` differs (`com.donnytang.myapp.dev`) — only the label collides.
- **The icon artwork still reads "Register-Mbus"**, which no longer matches the app name. Cosmetic, and it needs a new source image in `assets/images/` plus regenerated mipmaps (see the prebuild section).
