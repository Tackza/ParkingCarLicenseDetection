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
2. **Check-ins — push.** [components/CheckInSyncManager.js](components/CheckInSyncManager.js). 5 s initial delay, then every 10 s, with a 30 s per-request timeout. Selects `sync_status IN (0, 3, 4)` in batches of 50, **unattempted rows (`sync_status = 0`) first** then oldest-first — without that ordering a batch of permanently-rejected old rows would fill every cycle and new registrations would never upload. For each row it resizes the photo to 400 px wide at quality 0.7 (`expo-image-manipulator`), POSTs `/lpr/checkins` as **`multipart/form-data`** with the image attached as a `photo_file` part — not base64, not JSON — and deletes the resized temp file afterwards. A `duplicate` / `already exists` error from the server still marks the row synced (intentional — the server already has it). A `401`/`403` aborts the batch, keeps the row retryable, and forces re-login the same way the registers loop does.

Every field in the upload payload comes from the `check_ins` row itself — never recomputed from live state at upload time. That matters because a row can be uploaded hours after it was created, under a different active project. Keep that invariant when adding fields.

Unlike the registers loop, this effect has **no dependencies** — it starts one timer chain at mount and never restarts. That is deliberate: `getCurrentProject()` returns a fresh object every call and `main.js` calls `refreshCurrentProject()` on every focus, so depending on `activeProject` restarted the initial delay after every print and could starve the queue indefinitely. The sync function reads the project through `activeProjectRef` and reschedules itself even when there is no active project.

**`sync_status` on `check_ins`:** `0` = pending, `2` = success, `3` = retryable failure (network error, timeout, 5xx, auth), `4` = server rejected it (4xx or a `status != success` body). All three are retried; the Settings counters split them into "ยังไม่ได้ส่ง" (0, 3) and "พบปัญหา" (4).

The difference between `3` and `4` is **who is at fault**, and it drives the retry schedule:

- **`3` never backs off.** The data is fine, the network (or the token) is not. `next_retry_at` is cleared so the row goes out on the very next cycle once connectivity returns. On top of that, the first unreachable-network error aborts the rest of the batch — 50 queued rows cost one failed request per cycle while offline, not 50.
- **`4` backs off** through `SYNC_RETRY_BACKOFF_MINUTES` (1m → 5m → 15m → 1h → 3h → 6h, then held at 6h), tracked in `retry_count` / `next_retry_at`. Retrying a payload the server just rejected is pointless, so a permanently-rejected row costs ~5 requests a day instead of ~8,600. There is deliberately **no hard cap**: the row is never abandoned, in case the cause is fixed server-side later.

Both counters reset on success.

### How the registers pull stays (or fails to stay) in step with the server

The cursor is **derived from the data, not stored**: `getLastRegisterSyncState()` takes `MAX(updated_at, register_id)` over the rows already held for that project and sends them as `last_update` / `last_id`. That self-heals after a failed batch (the transaction rolls back, the cursor does not move), but it makes the whole scheme depend on three things:

1. **The server must use a compound cursor** — `updated_at > :last_update OR (updated_at = :last_update AND register_id > :last_id)`. If it compares `updated_at` alone, every row sharing the maximum timestamp is skipped forever, which is exactly what a bulk update on the server produces. **This has not been verified against the backend.**
2. **`update_date` must sort correctly as text.** `saveRegisters()` stores it verbatim with no normalization (unlike `saveProjects()`, which runs `formatDateToLocalSqlite`), and the cursor query is a plain `ORDER BY updated_at DESC`. Changing or mixing the server's date format silently picks the wrong maximum.
3. **Deletes must bump `update_date`.** Soft deletes ride the delta and `findRegisterByPlate()` filters `deleted_at IS NULL`, but a hard delete on the server can never reach the device.

`saveRegisters()` isolates failures per row: it skips a row outright when `reg_id`, `proj_id` or `update_date` is missing (none can be substituted — the first two are keys, the third is the cursor), defaults the remaining `NOT NULL` columns, catches anything that still fails, and returns `{saved, skipped}` while logging skips as `REGISTER_SAVE_SKIPPED`. Do not restore all-or-nothing behavior here: a single bad row used to roll back the batch, leave the cursor in place, and re-fetch the same rows every 30 s forever, with "ใบ C7 ไม่เพิ่มขึ้น" as the only symptom. Note that a schema `DEFAULT` does not protect a column — it applies only when the column is left out of the INSERT, not when NULL is bound to it.

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

Every query that scopes by mode goes through **`getScopeField()`** in [constants/Database.js](constants/Database.js), which returns `activity_id` only for the explicit string `'false'` and `project_id` for everything else. Never inline the `appMode` comparison again: the old `appMode == "true" ? 'project_id' : 'activity_id'` fell back the *opposite* way from `ModeContext` (which defaults `isModeOne = true`), so on a device that had never toggled the mode the UI said mode one while every count and the history list filtered on `activity_id` using a `project_id` value. Migration v8 additionally seeds `appMode` so the setting is never absent.

The mode also keys the `<Tabs>` element (`key={isModeOne ? ... }`), so toggling it remounts the whole tab navigator.

`passenger` is a pipe-delimited string, `adults|children|monks|novices` (default `'0|0|0|0'`), written by `passenger_count.js` and re-parsed by each receipt's `formatPassengerInfo`. Per-project flags `not_show_child_qty` / `not_show_novice_qty` hide counters, and `show_slip_section_2` (default **on**, hidden only when the API explicitly sends `false`) gates the second slip section.

### Receipt printing (Bluetooth ESC/POS)

Uses [`react-native-bluetooth-escpos-printer`](https://github.com/detanx/react-native-bluetooth-escpos-printer) (git fork). The pattern is **render-then-capture**, not text commands:

1. The receipt is rendered as a React Native view inside a `<ViewShot>` parked off-screen (`position: 'absolute', left: -10000`), mounted only while a print is pending.
2. A short `setTimeout` (~500 ms) lets React commit the new props — capturing too early prints stale data.
3. `captureRef(ref, { format: 'png', result: 'base64' })` → `BluetoothEscposPrinter.printPic(uri, { width: 520, left: 0 })` → a couple of `\r\n` to feed the paper.

`printed` is written optimistically at insert time, then reconciled with `updateCheckInPrintedStatus()` — set to `1` after the print resolves, or back to `0` if it throws. A failed print raises a retry/give-up alert that re-prints **the same row** rather than re-running the save, because a second `insertCheckIn` would create a new `uid` that the server cannot dedupe. Keep that shape when touching either print path: never re-enter the save handler to retry a print. (If the row happens to sync in the gap, the correction does not reach the server — printing resolves in ~1–2 s against a 10 s sync interval, so this is rare rather than impossible.)

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

Migrations run in `setupDatabase()` and are gated on `PRAGMA user_version`, **currently v8**: v1 initial schema, v2 `error_logs`, v3 mileage columns, v4 `projects.bus_types`, v5 `not_show_child_qty` / `not_show_novice_qty`, v6 `show_slip_section_2`, v7 `check_ins.retry_count` / `next_retry_at`, v8 seeds the `appMode` setting. Each block must set `user_version = N` itself; the single `PRAGMA user_version = ...` write at the end only fires when the value is `> 0`. Post-v1 migrations check `PRAGMA table_info(...)` before each `ALTER TABLE` so they are re-runnable.

Key tables:

- **`sessions`** — holds `lpr_token`. `getActiveSession()` is the canonical read (it joins `users`, so `user_id`, `username` etc. come back too).
- **`settings`** — KV store for `appMode`, `environment`, `saved_printer` (JSON), `machineCode`.
- **`projects`** — composite identity `(project_id, activity_id)`, plus the per-project feature flags and `bus_types`.
- **`registers`** — master plate records; `register_id` is the server PK and the `REPLACE INTO` key. `findRegisterByPlate()` ignores soft-deleted rows.
- **`check_ins`** — local-first, `uid` is a client-generated ULID, indexed on `sync_status`. `comp_id` is the `machineCode` setting.
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
- A row stuck in backoff is only visible as a number in the Settings "พบปัญหา" counter — there is no screen listing *which* rows are failing or why, and no way to force an immediate retry. `next_retry_at` would need to be cleared by hand (or by a new Settings action) to flush them early.
- `photo_path` points into the ImagePicker cache, which Android may evict, and the photo is never copied anywhere durable. A long-queued row can still lose its image; the upload now logs `PHOTO_MISSING` and proceeds without it rather than failing silently, but the photo is gone. Preventing it means copying the capture into `documentDirectory` at scan time and taking on the cleanup that implies.
- `CheckInSyncManager` reads `useAuth()` for `user?.id` on its error logs, but it is mounted above the login screen, so early-startup logs can carry a null user.
- **`AuthContext.logout()` is never called.** The Settings logout only does `clearSession()` on the database, so the context keeps the previous `user` until the app restarts — later error logs carry the stale id, and logging in as a different account hits the broken `saveSession(user.id, user.username)` call above.
- The Settings screen has **no `useFocusEffect`**: the counters load once at mount and on a mode change, so they are stale after scanning. Tapping a dashboard card calls `refreshCounts()`, but nothing tells the user that.
- Logging out does not warn when check-ins are still queued, even though the count is displayed directly above the button. Nothing is lost (the rows keep `sync_status` 0/3) but they stay stuck until someone logs back in. `getTotalUnsyncedCheckInsCount()` exists for exactly this warning — the environment switch already uses it.
- `handleSaveCode` does not validate the machine code, so it can be saved empty, and `comp_id` then goes into an `INTEGER NOT NULL` column as `""`.
- The master approval code `8989` is hardcoded at four separate call sites in `settings.js`.
- `handleClearRegisters` does not refresh the counters, so "ใบ C7" keeps showing the pre-delete number.
- `exportStartDate` / `exportEndDate` are dead state — the export modal never renders date inputs and `exportDatabaseFile()` takes no range. `exportDatabaseToJSON(start, end)` in [utils/exportUtils.js](utils/exportUtils.js) would accept one but is not imported.
- The destructive "clear registers" action is hidden behind a **long-press on the version row** in Settings. It also does not take `globalSyncLock`, so clearing while a register fetch is in flight lets `saveRegisters()` commit after the `DELETE` — leaving a partial set under a cursor that looks up to date, i.e. a permanent hole.
- The registers pull makes **one request per 30 s cycle with no drain loop**. If the server paginates, a first sync of N pages takes N × 30 s before the device holds complete data, and during that window `findRegisterByPlate()` reports "ไม่พบซีเจ็ด" for vehicles that are in fact registered. If it does not paginate, the initial pull arrives as one huge payload that `saveRegisters()` walks one `runAsync` at a time.
- Only the **currently active** project is pulled (`project_id=${activeProject.project_id}`), and `activeProject` is time-windowed, so nothing is pre-fetched for a project whose window has not opened. It starts from zero at the exact moment operators begin scanning.
- The registers URL is built by string interpolation, so `last_update` (a timestamp that normally contains a space) is not percent-encoded. Pass it through axios `params` instead.
