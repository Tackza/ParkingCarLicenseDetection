# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The two systems

A working check-in at a checkpoint needs **two separate codebases** that talk to each other over HTTP. Neither one is useful alone, and they are versioned and deployed independently:

| | **Mbus Register** (this repo) | **Thai License Plate Recognition** (OCR service) |
|---|---|---|
| what | Expo / React Native tablet app | Python + Flask + YOLO (Ultralytics), two-stage detector |
| where | this repo / worktree | `/Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector` (**not a git repo**) |
| its own docs | this file | that folder's own `CLAUDE.md` (~350 lines, Thai) — **read it before touching the detector**; it covers models, class maps, Cloud Run config, and cost |
| deployed as | Android APK via EAS | Google Cloud Run `license-plate-service`, project `mbus-v2`, region `asia-southeast1` |
| talks to | Mbus API (`mbus.dhammakaya.network`) + OCR service | nothing — it is a stateless single-endpoint service |

There is also a **third** party neither repo owns: the **Mbus backend API** at `https://mbus.dhammakaya.network/api` (prod) / `https://mbus-test.dhammakaya.network/api` (test). The app is the only thing that talks to it; the OCR service never does.

```
 tablet (this repo)                          Cloud Run                     Mbus backend
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

The OCR service runs `min-instances=0`. Measured behaviour (recorded in the detector's own CLAUDE.md):

- **cold start ≈ 20–27 s** (loading torch + two YOLO models) — **longer than this app's 15 s timeout**, so the first scan against a cold instance *always* fails with `OCR_TIMEOUT` and drops the operator into manual entry
- **warm ≈ 0.9–2.2 s**, idle instances are reclaimed after **~15 min**
- a Cloud Scheduler job **`lpr-keepwarm`** pings `/health` every 5 min, **05:00–17:55 ICT only** — so scans before 05:00 or after ~18:10 hit a cold start by design
- `concurrency=1`, `maxScale=3` (Ultralytics is not thread-safe): **two tablets scanning at the same second** means the second request waits ~22 s for a new instance to boot → also a 15 s timeout, even though the service is "up"

So a timeout report from the field is usually one of: outside keep-warm hours, first scan of the day, or several tablets firing at once. Check those before assuming a bug. Raising `IMAGE_PROCESSING_TIMEOUT` ([app/(tabs)/scan.js:38](app/(tabs)/scan.js:38)) past ~30 s is the app-side lever; raising `maxScale`/`min-instances` is the service-side one — and `min-instances=1` costs ~$34/month, which is why the ping exists.

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

`postinstall` runs `patch-package`, so `npm install` applies any patches under `patches/`.

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

EAS profiles in [eas.json](eas.json): `development` (debug APK, channel `development`, `APP_VARIANT=development`), `preview` (internal distribution), `production` (release APK, channel `production`, `APP_VARIANT=production`). The `APP_VARIANT` env var is read by [app.config.js](app.config.js) and switches the app name and Android/iOS bundle ID to `.dev` so dev and prod can coexist on one device.

The OCR service is **not** deployed from here — it ships separately with `gcloud run deploy license-plate-service --source . --region=asia-southeast1 --project=mbus-v2` from the detector folder.

## Architecture

### Provider stack & startup

[app/_layout.tsx](app/_layout.tsx) wraps every screen in this exact provider order — order matters because inner providers read from outer ones:

```
EnvironmentProvider → AuthProvider → SyncProvider → ProjectProvider → ModeProvider
                                                  ↳ <CheckInSyncManager />  (mounted once, runs forever)
```

`setupDatabase()` from [constants/Database.js](constants/Database.js) runs once on root mount and applies SQLite migrations via `PRAGMA user_version` (**currently v6**; v4 added `projects.bus_types`, v5 `not_show_child_qty`/`not_show_novice_qty`, v6 `show_slip_section_2`). Migrations are additive and guarded by `PRAGMA table_info` checks, so adding a column means appending a new `if (user_version < N)` block, never editing an old one. [`CheckInSyncManager`](components/CheckInSyncManager.js) is a headless component mounted at the root that polls every 10 s and uploads pending check-ins — there is no separate worker process.

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
- **FP16 is shipped for size, not speed.** That tablet's Cortex-A73 is ARMv8.0 with no native FP16 arithmetic, so ORT widens back to FP32 anyway; FP16 just halves the APK cost. Full numbers in [tools/ondevice-ocr/android/DEVICE_RESULTS.md](tools/ondevice-ocr/android/DEVICE_RESULTS.md).
- **Models are warmed up at root mount** in [app/_layout.tsx](app/_layout.tsx) so the first scan of the day does not pay the ~0.4 s load.
- **Kill switch:** set `ON_DEVICE_OCR_ENABLED = false` in [utils/lprOcr.js](utils/lprOcr.js) to force every scan back through the service.
- **"No plate found" is not a fallback trigger.** Both engines run identical weights, so falling back would only cost the operator a 15 s wait before the same manual-entry prompt.

Verify a change with the instrumented test — it runs the real engine on the real device against plates whose correct reading is known, and needs no login:

```bash
adb shell mkdir -p /data/local/tmp/lprtest
adb push <detector>/license-car/338111_0.jpg /data/local/tmp/lprtest/   # and the other four
cd android && ./gradlew :app:connectedDebugAndroidTest
```

### Routing (Expo Router, file-based)

- [app/index.js](app/index.js) — entry redirect
- [app/login.js](app/login.js) — POST `/api/lpr/login`, session saved to SQLite
- [app/bluetooth-setup.js](app/bluetooth-setup.js) — required after login; selected printer is persisted to `settings` table
- [app/(tabs)/_layout.js](app/(tabs)/_layout.js) — owns the **registers sync loop** (30 s interval, separate from check-in sync) **and the camera**: the scan tab has no screen of its own, its `tabPress` listener opens `ImagePicker.launchCameraAsync({ quality: 0.8 })` and routes to `/scan` with the photo URI as a param
- [app/(tabs)/main.js](app/(tabs)/main.js) — check-in history list with search; reprint goes through `POST /api/lpr/checkins/print-slip` **before** printing
- [app/(tabs)/scan.js](app/(tabs)/scan.js) — receives the photo URI → OCR call → manual correction → cross-check `registers` → insert into `check_ins` → print
- [app/passenger_count.js](app/passenger_count.js) — **mode-one only**; `scan.js` hands off here instead of inserting, and *this* screen calls `insertCheckIn()` after the operator enters adult/child/monk/novice counts (stored as a `a|b|c|d` pipe string in `check_ins.passenger`)
- [app/(tabs)/settings.js](app/(tabs)/settings.js) — mode toggle, environment switch, DB export, sync status counters

`components/scan_normal.js` and `components/oldFile/` are **dead code** — `scan_normal` is only referenced inside a commented-out `<Tabs.Screen>` block, and `oldFile/LicensePlateData.js` still points at a decommissioned OCR host. Don't use them as reference; [app/(tabs)/scan.js](app/(tabs)/scan.js) is the live implementation.

Two operational modes (`appMode` setting) change which tabs / fields are visible. Two environments (`environment` setting) switch the **Mbus API** base URL between `https://mbus.dhammakaya.network/api` (prod) and `https://mbus-test.dhammakaya.network/api` (test) — the OCR URL is not switched.

### Mbus API surface used by the app

Every call sends `Authorization: Bearer <sessions.lpr_token>`.

| endpoint | where |
|---|---|
| `POST /api/lpr/login` | [app/login.js](app/login.js) |
| `POST /api/lpr/logout` | [contexts/AuthContext.js](contexts/AuthContext.js) |
| `GET /api/lpr/projects` | [contexts/ProjectContext.js](contexts/ProjectContext.js), settings |
| `GET /api/lpr/registers?last_update=X&last_id=Y&project_id=Z` | registers pull loop |
| `POST /api/lpr/checkins` | check-in push loop |
| `GET /api/lpr/checkins/search` | history search |
| `POST /api/lpr/checkins/print-slip` | reprint from history |

### Two independent sync loops

Anything touching sync needs to know there are **two separate loops**, each with their own interval, lock, and state:

1. **Registers (master plate data) — pull.** Lives in [app/(tabs)/_layout.js](app/(tabs)/_layout.js). Every 30 s calls `GET /api/lpr/registers?last_update=X&last_id=Y&project_id=Z` and upserts into the `registers` table. Tracks high-water marks per project. Uses a `globalSyncLock` module variable + a `currentSyncSessionId` ref to prevent overlap when the user switches projects mid-fetch.
2. **Check-ins — push.** Lives in [components/CheckInSyncManager.js](components/CheckInSyncManager.js). Every 10 s selects rows where `sync_status IN (0, 3, 4)` and POSTs them **one at a time** to `/api/lpr/checkins` as `multipart/form-data` — scalar fields plus a **`photo_file`** part, the photo first resized to **400 px wide, JPEG, `compress: 0.7`** with `expo-image-manipulator` (not base64, not the original file). If the original file is gone the row still uploads without a photo. On a `duplicate` / `already exists` error from the server it still marks the row as synced (intentional — `uid` is a client-generated ULID, so the server already has it).

`sync_status` values for `check_ins`: `0 = pending`, `2 = success`, `3 = pending_update`, `4 = error`. The Settings screen surfaces counts for each.

Field names differ between the local column and the wire format in two places — don't "fix" one side alone: local `is_plate_manual` → API `is_manual`, local `mileage` → API `mileage` but the insert payload from `scan.js` calls it `chk_mile` (`insertCheckIn` accepts either).

### Database (SQLite, expo-sqlite, WAL mode)

[constants/Database.js](constants/Database.js) is a ~1,070-line monolith — all schema, migrations, and queries live here. The whole DB layer is callable functions, not a query builder. Key tables:

- **`sessions`** — auth token (`lpr_token`) used as `Authorization: Bearer ...` for every API call. `getActiveSession()` is the canonical way to get it.
- **`settings`** — KV store for `appMode`, `environment`, `saved_printer`, `machineCode`.
- **`projects`** — composite identity `(project_id, activity_id)`; activities belong to a project. Also carries the per-project feature flags `bus_types`, `not_show_child_qty`, `not_show_novice_qty`, `show_slip_section_2`.
- **`registers`** — master license-plate records pulled from server; `register_id` is the server PK. Looked up by `findRegisterByPlate(project_id, plate, province)` — note the app rewrites `กรุงเทพมหานคร` → `กทม.` before this lookup, because that is how the backend stores it.
- **`check_ins`** — local-first transactions, the queue for upload. `uid` is a locally generated **ULID** and is the server-side idempotency key. Indexed on `sync_status`.
- **`error_logs`** — every API/DB/camera error funnels here via `insertErrorLog()`; the Settings screen can export it for debugging.

Always wrap DB ops in `try/catch` and log to `error_logs` — that's the existing pattern across the codebase, and the Settings screen relies on it for observability. Before exporting the DB, call `checkpointDatabase()` to flush WAL to the main file.

### Receipt printing (Bluetooth ESC/POS)

Uses [`react-native-bluetooth-escpos-printer`](https://github.com/detanx/react-native-bluetooth-escpos-printer) (git fork). The pattern is **render-then-capture**, not text commands:

1. [components/Receipt.js](components/Receipt.js) renders the receipt as a React Native view (uses `React.forwardRef`).
2. `react-native-view-shot` captures that view to a PNG.
3. The PNG is sent to the printer via `BluetoothEscposPrinter.printPic(...)` at `width: 520`.

[components/SamplePrint.js](components/SamplePrint.js) holds raw ESC/POS command examples for printer test pages — that path is separate from the receipt flow.

### State management

React Context only — no Redux, no Zustand. Each provider exports a `use*` hook:

- `useAuth()` → user, login(), logout()
- `useProject()` → activeProject, syncProjectsWithApi(), refreshCurrentProject()
- `useSync()` → isOnline, isSyncing, lastSyncTime (status flags only; the sync managers do the work)
- `useMode()` → isModeOne, toggleMode()
- `useEnvironment()` → environment, updateEnvironment() — controls API base URL

When sync code is wired into screens, callbacks are wrapped in `useCallback` and gated by refs (see `_layout.js`) to avoid recreating functions across renders and re-triggering polling timers.

## Conventions worth knowing

- **JS by default, TS only at the edges.** `tsconfig.json` is present and `@/*` path aliases work, but most files are `.js`. Only `app/_layout.tsx`, hooks, and `constants/Colors.ts` are TS. Don't convert files to TS as a side-quest.
- **Imports use the `@/` alias** rooted at the repo. Mix of `@/contexts/...` and relative `../contexts/...` exists — match whatever the file already uses.
- **No `.env` files.** Runtime config (API base URL, mode) lives in the SQLite `settings` table, not env vars. Build-time variants come from `APP_VARIANT` in eas.json.
- **Thai TTS** for license-plate readback uses character → word mappings in [utils/speechUtils.js](utils/speechUtils.js) — don't replace with raw `Speech.speak()` of the plate string.
- **Logo is base64-embedded** in [components/dummy-logo.js](components/dummy-logo.js) (not loaded from assets) because it's drawn into the receipt PNG.
- **Background timers** use `react-native-background-timer`, not `setTimeout`/`setInterval` — required for the sync loops to keep running when the app is backgrounded.

## Known cross-system gotchas

- **`ocr_connected` is always uploaded as `1`.** [components/CheckInSyncManager.js:86](components/CheckInSyncManager.js:86) `checkOCRConnection()` returns the *strings* `"0"`/`"1"`, and the caller does `checkOCRConnection(checkIn) ? '1' : '0'` — `"0"` is truthy, so the branch can never yield `'0'`. Its guard also tests `!data.detect_plate_no && !data.detect_plate_no` (the same term twice; the second was presumably meant to be `detect_plate_province`). The value `scan.js` correctly computed and stored in `check_ins.ocr_connected` is never read. Server-side "was the OCR reachable?" reporting is therefore meaningless today.
- **The OCR URL is hardcoded and environment-independent** — switching to the test environment in Settings does *not* point scans at a test OCR service. There is only one.
- **The detector folder is not under version control.** Changes there have no history and no rollback; the deployed image in Artifact Registry is the only other copy. Its CLAUDE.md documents the models, class maps and Cloud Run/cost setup in detail — read it first rather than inferring from variable names (the detector's `vehicle_model` / `car_roi` are misnamed and detect **plates**, not vehicles).
