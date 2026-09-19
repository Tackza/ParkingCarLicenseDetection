# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Mbus Register** — an Expo / React Native (SDK 51, RN 0.74) Android-first tablet app used at Dhammakaya parking checkpoints. The workflow is: log in → connect a Bluetooth ESC/POS thermal printer → photograph a vehicle's license plate (OCR via an external service) → confirm vehicle/passenger details → save the check-in locally → upload to the API in the background → print a paper receipt.

The UI is hardcoded Thai (no i18n layer). Dates use the Buddhist calendar (`toLocaleString('th-TH-u-ca-buddhist')`). Code comments are mostly Thai — match that when editing a file that already uses it.

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

### Build & deploy (EAS)

```bash
# Production Android APK
eas build --profile production --platform android --clear-cache

# OTA update to production channel
eas update --branch production --message "Updated text"
```

EAS profiles in [eas.json](eas.json): `development` (debug APK, channel `development`), `preview` (internal distribution), `production` (release APK, channel `production`). `APP_VARIANT` is read by [app.config.js](app.config.js) and switches the app name and Android/iOS bundle ID to `.dev` so dev and prod coexist on one device. OTA updates are on (`checkAutomatically: ON_LOAD`, `runtimeVersion` 1.0.0) and the Settings screen displays `Updates.updateId` / `channel` / `createdAt` for field debugging.

Note: `eas.json` sets `APP_URL_DETECTION` on the development profile, but **nothing reads it** — the OCR URL is hardcoded (see below).

## Architecture

### Provider stack & startup

[app/_layout.tsx](app/_layout.tsx) wraps every screen in this exact provider order — order matters because inner providers read from outer ones:

```
EnvironmentProvider → AuthProvider → SyncProvider → ProjectProvider → ModeProvider
                                                  ↳ <CheckInSyncManager />  (headless, mounted once)
```

`setupDatabase()` from [constants/Database.js](constants/Database.js) runs once on root mount. `AuthProvider` and `ProjectProvider` each block rendering with a spinner while `EnvironmentProvider` is still loading, so the API base URL is always resolved before any request goes out.

**`SyncProvider` is mounted twice.** [app/(tabs)/_layout.js](app/(tabs)/_layout.js) wraps its own `TabLogic` in a *second* `SyncProvider`. Anything inside `(tabs)` that calls `useSync()` reads the inner instance; `CheckInSyncManager` reads the outer one. That's why the `SyncStatus` header widget reflects only the registers loop. Adding shared sync state means picking which provider actually owns it.

### Routing (Expo Router, file-based)

- [app/index.js](app/index.js) — redirect: no user → `/login`, else `/scan`
- [app/login.js](app/login.js) — auto-skips to `/bluetooth-setup` if a session row exists (no token revalidation); otherwise `POST /lpr/login` → `saveSession()` → `syncProjectsWithApi()`
- [app/bluetooth-setup.js](app/bluetooth-setup.js) — required after login. Auto-reconnects to `saved_printer`; on failure deletes the setting and rescans. Requests `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` / `ACCESS_FINE_LOCATION` via `react-native-permissions`
- [app/(tabs)/_layout.js](app/(tabs)/_layout.js) — owns the **registers sync loop**; the Scan tab's `tabPress` is intercepted (`e.preventDefault()`) to launch the camera and pass `imageUri` as a route param
- [app/(tabs)/main.js](app/(tabs)/main.js) — local check-in history, plus a server-side plate search modal that can reprint
- [app/(tabs)/scan.js](app/(tabs)/scan.js) — OCR → manual correction → register lookup → save/print (mode two) or hand off to passenger_count (mode one)
- [app/passenger_count.js](app/passenger_count.js) — mode-one only: passenger counters, then insert + print
- [app/(tabs)/settings.js](app/(tabs)/settings.js) — mode toggle, environment switch, machine code, DB export, sync counters, logout, OTA info

### `activeProject` is chosen by wall-clock time, not by the user

`getCurrentProject()` runs `SELECT * FROM projects WHERE datetime('now','localtime') BETWEEN start_time AND end_time LIMIT 1`. There is no project picker. Consequences worth remembering when debugging "nothing works":

- Outside every project's time window, `activeProject` is `null`, **both sync loops go idle**, and tapping Scan alerts `ไม่พบกิจกรรม`.
- `saveProjects()` does `DELETE FROM projects` then re-inserts, so a `/lpr/projects` response that omits a project silently removes it.
- `getCurrentProject()` also decodes storage-level fields into JS types: `bus_types` JSON string → array, and the three flag columns → booleans. Read project flags through this function, not via raw SQL.

### Two independent sync loops

Both are **self-scheduling `BackgroundTimer.setTimeout` chains** (each run schedules the next in its `finally`), not `setInterval`. Both guard against overlap with a lock plus a `currentSyncSessionId` ref: the effect stamps a new session id on every restart, and a run whose id no longer matches aborts — including mid-loop. Preserve that pattern; a plain interval will double-fire when `activeProject` changes.

1. **Registers (master plate data) — pull.** [app/(tabs)/_layout.js](app/(tabs)/_layout.js). 3 s initial delay, then every 30 s: `GET /lpr/registers?last_update=X&last_id=Y&project_id=Z` → `saveRegisters()`. Uses a module-level `globalSyncLock` (survives re-renders); the lock-skip path deliberately does *not* reschedule, leaving that to the in-flight run. A `401` here is the app's only session-expiry path: it clears the session, deletes `saved_printer`, and redirects to `/login`.
2. **Check-ins — push.** [components/CheckInSyncManager.js](components/CheckInSyncManager.js). 5 s initial delay, then every 10 s, with a 30 s per-request timeout. Selects `sync_status IN (0, 3, 4)` oldest-first, and for each row resizes the photo to 400 px wide at quality 0.7 (`expo-image-manipulator`) and POSTs `/lpr/checkins` as **`multipart/form-data`** with the image attached as a `photo_file` part — not base64, not JSON. A `duplicate` / `already exists` error from the server still marks the row synced (intentional — the server already has it). A `401`/`403` aborts the batch, keeps the row retryable, and forces re-login the same way the registers loop does.

Unlike the registers loop, this effect has **no dependencies** — it starts one timer chain at mount and never restarts. That is deliberate: `getCurrentProject()` returns a fresh object every call and `main.js` calls `refreshCurrentProject()` on every focus, so depending on `activeProject` restarted the initial delay after every print and could starve the queue indefinitely. The sync function reads the project through `activeProjectRef` and reschedules itself even when there is no active project.

**`sync_status` on `check_ins`:** `0` = pending, `2` = success, `3` = retryable failure (network error, timeout, 5xx, auth), `4` = failed on a 4xx or a `status != success` body. All of `0`, `3`, `4` are retried; the Settings counters still split them into "ยังไม่ได้ส่ง" (0, 3) and "พบปัญหา" (4). There is **no retry cap** — a row the server rejects permanently will be re-attempted every 10 s, and each attempt writes an `error_logs` row (see the warts list).

### The registers API uses short field names

`saveRegisters()` in [constants/Database.js](constants/Database.js) renames every column on the way in: `reg_id`→`register_id`, `proj_id`→`project_id`, `code`→`short_code`, `station`→`station_name`, `province`→`station_province`, `alert_msg`→`alert_message`, `chk_date`→`checkin_date`, `act1_date`/`act1_user`/`act1_name`/`act1_mile`→`activity1_*`, `chk_pno`/`act1_pno`/`act2_pno`→`*_printno`, `show_act2`→`show_activity2`, `update_date`→`updated_at`, `delete_date`→`deleted_at`. Adding a field to the registers payload means touching both the `REPLACE INTO` column list and the value array, in order.

High-water marks are derived from the table itself (`getLastRegisterSyncState()` = `ORDER BY updated_at DESC, register_id DESC LIMIT 1`), not stored in a cursor table. Clearing `registers` resets the sync to a full pull.

### The two operational modes fork the whole save path

`appMode` (`useMode()` → `isModeOne`, default `true`) is not just cosmetic:

| | Mode one (`isModeOne`, "ธรรมดา") | Mode two (`!isModeOne`, "ธุดงค์") |
|---|---|---|
| After scan.js validation | `router.push('/passenger_count', params)` — **scan.js does not insert** | inserts + prints in place |
| Insert + print site | [app/passenger_count.js](app/passenger_count.js) | [app/(tabs)/scan.js](app/(tabs)/scan.js) `executeSave` / `generateAndPrint` |
| Sticker number | forced `""` | required |
| Mileage | n/a | required when `activeProject.seq_no` is 1 or 2 and the register's matching `activity{1,2}_checkmile` is 1 |
| History / count queries | filtered by `project_id` | filtered by `activity_id` |

The mode also keys the `<Tabs>` element (`key={isModeOne ? ... }`), so toggling it remounts the whole tab navigator.

`passenger` is a pipe-delimited string, `adults|children|monks|novices` (default `'0|0|0|0'`), written by `passenger_count.js` and re-parsed by each receipt's `formatPassengerInfo`. Per-project flags `not_show_child_qty` / `not_show_novice_qty` hide counters, and `show_slip_section_2` (default **on**, hidden only when the API explicitly sends `false`) gates the second slip section.

### Receipt printing (Bluetooth ESC/POS)

Uses [`react-native-bluetooth-escpos-printer`](https://github.com/detanx/react-native-bluetooth-escpos-printer) (git fork). The pattern is **render-then-capture**, not text commands:

1. The receipt is rendered as a React Native view inside a `<ViewShot>` parked off-screen (`position: 'absolute', left: -10000`), mounted only while a print is pending.
2. A short `setTimeout` (~500 ms) lets React commit the new props — capturing too early prints stale data.
3. `captureRef(ref, { format: 'png', result: 'base64' })` → `BluetoothEscposPrinter.printPic(uri, { width: 520, left: 0 })` → a couple of `\r\n` to feed the paper.

There are **three print sites and two receipt renderers**:
- [components/Receipt.js](components/Receipt.js) (`React.forwardRef`, 300 px wide) — used by `scan.js` (mode two) and by `main.js` reprint.
- An inline receipt inside [app/passenger_count.js](app/passenger_count.js) — mode one, with the two-section slip. Edits to the mode-one receipt do **not** belong in `Receipt.js`.

Reprint from `main.js` calls `POST /lpr/checkins/print-slip` first and only prints if the server answers `status: "success"`, so the print count stays authoritative server-side.

[components/SamplePrint.js](components/SamplePrint.js) is raw ESC/POS test-page commands and is the only consumer of the base64 logos in [components/dummy-logo.js](components/dummy-logo.js) — the real receipts have no logo.

### OCR

`scan.js` POSTs the photo as multipart to a **hardcoded** endpoint: `https://license-plate-service-833646348122.asia-southeast1.run.app/detect`, 15 s timeout, reading `response.data.data.{license_plate, province}`. On timeout or any failure it opens the manual-entry modal and records `ocr_connected = 0` on the check-in, so a checkpoint keeps working offline-of-OCR. The detected province is only accepted if it matches `THAI_PROVINCES` in [constants/provinces.js](constants/provinces.js). The original OCR values are preserved in `detect_plate_no` / `detect_plate_province` alongside the corrected `plate_no` / `plate_province`, with `is_plate_manual` recording whether a human edited them.

### API surface

All under the environment base URL, `Authorization: Bearer <lpr_token>` from `getActiveSession()`:

| Endpoint | Caller |
|---|---|
| `POST /lpr/login` | `contexts/AuthContext.js` |
| `POST /lpr/logout` | `app/(tabs)/settings.js` |
| `GET /lpr/projects` | `contexts/ProjectContext.js`, `settings.js` |
| `GET /lpr/registers` | `app/(tabs)/_layout.js` |
| `POST /lpr/checkins` (multipart) | `components/CheckInSyncManager.js` |
| `GET /lpr/checkins/search` | `app/(tabs)/main.js` |
| `POST /lpr/checkins/print-slip` | `app/(tabs)/main.js` |

### Database (SQLite, expo-sqlite, WAL mode)

[constants/Database.js](constants/Database.js) is a ~1070-line monolith — schema, migrations, and every query live here as plain exported async functions. `LicensePlateReader.db` is opened once into a module-level promise; every function starts with `await getDb()`.

Migrations run in `setupDatabase()` and are gated on `PRAGMA user_version`, **currently v6**: v1 initial schema, v2 `error_logs`, v3 mileage columns, v4 `projects.bus_types`, v5 `not_show_child_qty` / `not_show_novice_qty`, v6 `show_slip_section_2`. Each block must set `user_version = N` itself; the single `PRAGMA user_version = ...` write at the end only fires when the value is `> 0`. Post-v1 migrations check `PRAGMA table_info(...)` before each `ALTER TABLE` so they are re-runnable.

Key tables:

- **`sessions`** — holds `lpr_token`. `getActiveSession()` is the canonical read (it joins `users`, so `user_id`, `username` etc. come back too).
- **`settings`** — KV store for `appMode`, `environment`, `saved_printer` (JSON), `machineCode`.
- **`projects`** — composite identity `(project_id, activity_id)`, plus the per-project feature flags and `bus_types`.
- **`registers`** — master plate records; `register_id` is the server PK and the `REPLACE INTO` key. `findRegisterByPlate()` ignores soft-deleted rows.
- **`check_ins`** — local-first, `uid` is a client-generated ULID, indexed on `sync_status`. `comp_id` is the `machineCode` setting.
- **`error_logs`** — every API/DB/camera/print/sync error funnels here via `insertErrorLog()`; Settings exports it.

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
- **The API base URL is duplicated as an inline ternary in seven files** — `contexts/AuthContext.js`, `contexts/ProjectContext.js`, `components/CheckInSyncManager.js`, `app/(tabs)/_layout.js`, `app/(tabs)/scan.js`, `app/(tabs)/main.js`, `app/(tabs)/settings.js`. Changing or adding an environment means editing all of them (or centralizing them deliberately, in one change).
- **No `.env` files.** Runtime config (environment, mode, machine code, printer) lives in the SQLite `settings` table. Build-time variants come from `APP_VARIANT` in eas.json. Default environment is `prod`.
- **Imports mix `@/...` and relative paths** within the same directory. Match whatever the file already uses.
- **Background timers** use `react-native-background-timer`, not `setTimeout`/`setInterval` — required for the sync loops to keep running when the app is backgrounded.
- **Thai TTS** for plate readback maps characters to spoken words in [utils/speechUtils.js](utils/speechUtils.js) (`กค583` → "กอ ไก่ คอ ควาย ห้า แปด สาม"). Don't replace it with `Speech.speak()` of the raw plate.

## Dead code and known warts

Several files look live but aren't — check before editing:

- **[components/scan_normal.js](components/scan_normal.js)** (1073 lines) and **[components/oldFile/](components/oldFile)** — unreferenced older copies of the scan/bluetooth screens. The only mention of `scan_normal` in `(tabs)/_layout.js` is inside a commented-out block. Editing these changes nothing.
- **[components/OrderSlip.js](components/OrderSlip.js)** + **[components/base64Image.js](components/base64Image.js)** — an older hardcoded slip and its print harness; referenced only by each other.
- **Root [index.js](index.js)** imports `./app-default`, which does not exist. It's inert because `package.json` sets `main: expo-router/entry`.
- `components/.scan.js.swp`, `components/Untitled-1.ipynb`, and `eas-build-error-log.text` are stray artifacts checked into the repo.
- `contexts/AuthContext.js` calls `saveSession(user.id, user.username)` in a `useEffect`, but `saveSession(loginData)` takes a single object — that call rejects unhandled. The session is actually saved by `login.js` calling `saveSession(result.data)` correctly. Fix the `AuthContext` call rather than changing `saveSession`'s signature.
- `CheckInSyncManager.js` calls `insertErrorLog()` for **every failed row on every cycle**, with no throttling, and nothing ever prunes `error_logs`. A checkpoint left offline with a large queue writes thousands of rows an hour. Now that `sync_status = 4` is retried too, a permanently-rejected row does the same thing indefinitely — a retry cap (needs a schema column) or log de-duplication is the next thing to fix here.
- `printed` is written at insert time in both `scan.js` and `passenger_count.js`, **before** the print actually runs, and nothing updates it afterwards. A failed print still reports `printed = 1` to the server.
- The print block in [app/passenger_count.js](app/passenger_count.js) runs inside a `setTimeout` with no `try/catch`, so the surrounding handler can't catch it: a print failure leaves no alert, no navigation, and `isSubmitting` stuck `true`, which deadlocks the confirm button.
- `passenger_count.js` does not forward `activity_id` or `ocr_connected` from its route params into `insertCheckIn`, so every mode-one check-in uploads with an empty activity and `ocr_connected = 1`.
- `CheckInSyncManager.js` sends `seq_no` from the *currently active* project rather than from the row (`checkIn.seq_no`), so a check-in synced after the activity rolls over carries the wrong value.
- `checkOCRConnection()` returns the strings `"0"`/`"1"`, and the call site does `checkOCRConnection(checkIn) ? '1' : '0'` — both strings are truthy, so the uploaded `ocr_connected` is always `1`. Its inner condition also tests `detect_plate_no` twice, where the second was presumably meant to be `detect_plate_province`.
