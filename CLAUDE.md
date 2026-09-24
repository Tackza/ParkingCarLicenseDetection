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
EnvironmentProvider → AuthProvider → SyncProvider → ProjectProvider → ModeProvider → PrinterProvider
                                                                    ↳ <CheckInSyncManager />  (headless, mounted once)
```

`setupDatabase()` from [constants/Database.js](constants/Database.js) runs once on root mount (fire-and-forget — nothing awaits it, so the first queries race the migrations). `AuthProvider` and `ProjectProvider` each block rendering with a spinner while `EnvironmentProvider` is still loading, so the API base URL is always resolved before any request goes out. `EnvironmentProvider`'s own spinner is commented out, so it renders children immediately with `environment === null`; `AuthProvider`'s early return is what actually holds the tree back.

**That early return is load-bearing for more than the URL.** `ProjectProvider` calls `useEnvironment()` / `useAuth()`, then returns its spinner on `isEnvLoading`, and only *after* that return declares two `useCallback`s and a `useEffect`. Declaring hooks below a conditional return is a Rules-of-Hooks violation that would throw "rendered more hooks than during the previous render" the moment `isEnvLoading` flipped — it never fires only because `AuthProvider` returns *its* spinner first and never mounts `ProjectProvider`'s subtree while the environment is loading. Removing or reordering `AuthProvider`'s guard crashes `ProjectProvider`. Move those three hooks above the early return before touching either provider.

**`user` is never rehydrated from SQLite.** `setUser` is called only by `login()` and `logout()`, so on a cold start `useAuth().user` is `null` no matter what is in `sessions`. Consequences: [app/index.js](app/index.js) always redirects to `/login` (the real auto-login is `login.js` checking for a session row itself), and every `user_id` on an error log is `null` until someone logs in *within that process* — which is most of them, since the app normally resumes straight past the login screen.

**`SyncProvider` is mounted twice.** [app/(tabs)/_layout.js](app/(tabs)/_layout.js) wraps its own `TabLogic` in a *second* `SyncProvider`. Anything inside `(tabs)` that calls `useSync()` reads the inner instance; `CheckInSyncManager` reads the outer one, so nothing the check-in loop sets is readable from any tab screen. Adding shared sync state means picking which provider actually owns it. (The `SyncStatus` widget that would have surfaced this is wired to `headerRight` but every `Tabs.Screen` sets `headerShown: false`, so it never renders — see dead code.)

### Routing (Expo Router, file-based)

- [app/index.js](app/index.js) — redirect: no user → `/login`, else `/scan`. In practice the `else` is unreachable (see `user` rehydration above), so this always lands on `/login`
- [app/login.js](app/login.js) — auto-skips to `/bluetooth-setup` if a session row exists (no token revalidation); otherwise `POST /lpr/login` → `saveSession()` → `syncProjectsWithApi()`
- [app/bluetooth-setup.js](app/bluetooth-setup.js) — the printer step after login; see **Printer connection** below. Requests `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` / `ACCESS_FINE_LOCATION` via `react-native-permissions`
- [app/(tabs)/_layout.js](app/(tabs)/_layout.js) — owns the **registers sync loop**; the Scan tab's `tabPress` is intercepted (`e.preventDefault()`) to launch the camera and pass `imageUri` as a route param
- [app/(tabs)/main.js](app/(tabs)/main.js) — local check-in history, plus a server-side plate search modal that can reprint
- [app/(tabs)/scan.js](app/(tabs)/scan.js) — OCR → manual correction → register lookup → save/print (mode two) or hand off to passenger_count (mode one)
- [app/passenger_count.js](app/passenger_count.js) — mode-one only: passenger counters, then insert + print
- [app/(tabs)/settings.js](app/(tabs)/settings.js) — mode toggle, environment switch, machine code, DB export, sync counters, logout, OTA info, and the **"รถที่เหลือ"** list of not-yet-scanned vehicles

### `activeProject` is chosen by wall-clock time, not by the user

`getCurrentProject()` runs `SELECT * FROM projects WHERE datetime('now','localtime') BETWEEN start_time AND end_time LIMIT 1`. There is no project picker. Consequences worth remembering when debugging "nothing works":

- Outside every project's time window, `activeProject` is `null`, **both sync loops go idle**, and tapping Scan alerts `ไม่พบกิจกรรม`.
- `saveProjects()` does `DELETE FROM projects` then re-inserts, so a `/lpr/projects` response that omits a project removes it. It **refuses to touch the table when handed an empty list** — an empty `result` used to wipe every activity and report success, which takes the checkpoint offline instantly. Stale rows are harmless because of the time-window filter; losing them is not. It returns `{saved, replaced}` so callers can report what actually happened, and `settings.js` distinguishes "server sent nothing", "unexpected shape", "saved but no activity is in its window yet" (naming the next one via `getNextUpcomingProject()`) and real success.
- `getCurrentProject()` also decodes storage-level fields into JS types: `bus_types` JSON string → array, and the three flag columns → booleans. Read project flags through this function, not via raw SQL.

### Two independent sync loops

Both are **self-scheduling `BackgroundTimer.setTimeout` chains** (each run schedules the next in its `finally`), not `setInterval`. Both guard against overlap with a lock plus a `currentSyncSessionId` ref: the effect stamps a new session id on every restart, and a run whose id no longer matches aborts — including mid-loop. Preserve that pattern; a plain interval will double-fire when `activeProject` changes.

1. **Registers (master plate data) — pull.** [app/(tabs)/_layout.js](app/(tabs)/_layout.js). 3 s initial delay, then every 30 s: `GET /lpr/registers?last_update=X&last_id=Y&project_id=Z` → `saveRegisters()`. Uses a module-level `globalSyncLock` (survives re-renders); the lock-skip path deliberately does *not* reschedule, leaving that to the in-flight run. A `401` here is one of two session-expiry paths: it clears the session and redirects to `/login`, leaving `saved_printer` alone.
2. **Check-ins — push.** [components/CheckInSyncManager.js](components/CheckInSyncManager.js). 5 s initial delay, then every 10 s, with a 30 s per-request timeout. Selects `sync_status IN (0, 3, 4)` in batches of 50, **unattempted rows (`sync_status = 0`) first** then oldest-first — without that ordering a batch of permanently-rejected old rows would fill every cycle and new registrations would never upload. For each row it resizes the photo to 400 px wide at quality 0.7 (`expo-image-manipulator`), POSTs `/lpr/checkins` as **`multipart/form-data`** with the image attached as a `photo_file` part — not base64, not JSON — and deletes the resized temp file afterwards. A `duplicate` / `already exists` error from the server still marks the row synced (intentional — the server already has it). A `401`/`403` aborts the batch, keeps the row retryable, and forces re-login the same way the registers loop does.

Neither loop notifies the UI. [app/(tabs)/main.js](app/(tabs)/main.js) re-runs `loadHistory` on a 5 s interval **while focused only** (plain `setInterval`, not `BackgroundTimer` — refreshing a screen nobody is looking at is pointless) and offers pull-to-refresh; the list is always rendered with `ListEmptyComponent` so the gesture works when empty too. `loadHistory` keeps the previous array reference when nothing changed, compared on `id`/`sync_status`/`printed`/`error_msg`, so a quiet tick causes no re-render. Settings refreshes its counters via `useFocusEffect`. The proper fix — having the sync manager signal the screens — is blocked by the double `SyncProvider` above.

Every field in the upload payload comes from the `check_ins` row itself — never recomputed from live state at upload time. That matters because a row can be uploaded hours after it was created, under a different active project. Keep that invariant when adding fields.

Unlike the registers loop, this effect has **no dependencies** — it starts one timer chain at mount and never restarts. That is deliberate: `getCurrentProject()` returns a fresh object every call and `main.js` calls `refreshCurrentProject()` on every focus, so depending on `activeProject` restarted the initial delay after every print and could starve the queue indefinitely. The sync function reads the project through `activeProjectRef` and reschedules itself even when there is no active project.

**`sync_status` on `check_ins`:** `0` = pending, `2` = success, `3` = retryable failure (network error, timeout, 5xx, auth), `4` = server rejected it (4xx or a `status != success` body). All three are retried; the Settings counters split them into "ยังไม่ได้ส่ง" (0, 3) and "พบปัญหา" (4).

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

The fix is operational, not code: a checkpoint tablet is plugged in anyway, so set it to never sleep (Display → Sleep → Never, or Developer options → Stay awake while charging). `expo-keep-awake@13.0.1` is already installed as a transitive dependency of `expo` (not declared in `package.json`) if that needs enforcing from inside the app instead. Genuine background execution would need a foreground service plus `WAKE_LOCK` — native changes, so a rebuild rather than an OTA, and `android/` is committed here so a config plugin will not apply itself.

Related: **`BackgroundTimer.clearTimeout()` does not cancel anything natively.** The native `clearTimeout` is commented out in the module, and the JS side only does `delete this.callbacks[id]`. The pending `Handler` still fires and still crosses the bridge; the emitter then finds no registered callback and drops it. The callback genuinely will not run, so the cleanup paths are correct — but a "cleared" timer still costs a wakeup, and clearing cannot stop a sync that has already passed its first `await`. That is what `currentSyncSessionId` is for.

All of the above is read from the library source and the manifest; it has **not** been verified on a physical tablet, and OEM battery managers (common on cheap Android tablets) can be more aggressive still.

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

**There is no driver phone column.** `registers` has 28 columns and none of them is a phone or a driver name (`activity1_user` / `activity1_name` are the staff member who performed activity 1). Until the backend sends one, the contact line falls back to `note` / `alert_message` — both synced to the device on every pull and, before this, displayed nowhere in the app. `extractPhone()` in `settings.js` pulls a Thai-format number out of either; a hit becomes a call button, anything else renders as text. Adding the real field means two edits: the `columns` list in `getUnscannedRegisters()` and the `candidates` array in `getContactInfo()`. Note that tablets without a SIM cannot dial, so the number is kept readable and `selectable` rather than living only behind the button — and that a phone column will also start riding along in the Settings DB export, which is a PDPA question for the org, not a technical one.

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
- [components/Receipt.js](components/Receipt.js) (`React.forwardRef`, 300 px wide) — used by `scan.js` (mode two) and by `main.js` reprint.
- An inline receipt inside [app/passenger_count.js](app/passenger_count.js) — mode one, with the two-section slip. Edits to the mode-one receipt do **not** belong in `Receipt.js`.

Reprint from `main.js` calls `POST /lpr/checkins/print-slip` first and only prints if the server answers `status: "success"`, so the print count stays authoritative server-side.

[components/SamplePrint.js](components/SamplePrint.js) is raw ESC/POS test-page commands and is the only consumer of the base64 logos in [components/dummy-logo.js](components/dummy-logo.js) and of `PRINT_DATA` in [components/printData.js](components/printData.js) — the real receipts have no logo. It is itself referenced only from the dead `components/oldFile/bluetooth.js`, so all four files are unreachable; see dead code.

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

[constants/Database.js](constants/Database.js) is a ~1480-line monolith — schema, migrations, and every query live here as plain exported async functions. `LicensePlateReader.db` is opened once into a module-level promise; every function starts with `await getDb()`.

Migrations run in `setupDatabase()` and are gated on `PRAGMA user_version`, **currently v8**: v1 initial schema, v2 `error_logs`, v3 mileage columns, v4 `projects.bus_types`, v5 `not_show_child_qty` / `not_show_novice_qty`, v6 `show_slip_section_2`, v7 `check_ins.retry_count` / `next_retry_at`, v8 seeds the `appMode` setting. Each block must set `user_version = N` itself; the single `PRAGMA user_version = ...` write at the end only fires when the value is `> 0`. (The v1 block is the exception — it sets nothing and is carried to 2 by the v2 block that always follows it on a fresh DB. Don't copy that shape; a new tail migration that forgets the assignment re-runs forever.) Post-v1 migrations check `PRAGMA table_info(...)` before each `ALTER TABLE` so they are re-runnable.

Key tables:

- **`sessions`** — holds `lpr_token`. `getActiveSession()` is the canonical read (it joins `users`, so `user_id`, `username` etc. come back too).
- **`settings`** — KV store for `appMode`, `environment`, `saved_printer` (JSON), `machineCode`.
- **`projects`** — composite identity `(project_id, activity_id)`, plus the per-project feature flags and `bus_types`.
- **`registers`** — master plate records; `register_id` is the server PK and the `REPLACE INTO` key. `findRegisterByPlate()` ignores soft-deleted rows. The v1 column `check_mileage` is vestigial — never written by `saveRegisters()` and never read; the live flags are `activity1_checkmile` / `activity2_checkmile` from v3.
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
- **Background timers** use `react-native-background-timer`, not `setTimeout`/`setInterval`. Match that in sync code for consistency, but do not believe the name: on Android it is a bare `Handler.postDelayed` with no wake lock, so it survives the app being backgrounded with the screen on and nothing more. See **Both sync loops stop when the screen goes off**.
- **Thai TTS** for plate readback maps characters to spoken words in [utils/speechUtils.js](utils/speechUtils.js) (`กค583` → "กอ ไก่ คอ ควาย ห้า แปด สาม"). Don't replace it with `Speech.speak()` of the raw plate.

## Dead code and known warts

Several files look live but aren't — check before editing:

- **[components/scan_normal.js](components/scan_normal.js)** (1073 lines) and **[components/oldFile/](components/oldFile)** — unreferenced older copies of the scan/bluetooth screens. The only mention of `scan_normal` in `(tabs)/_layout.js` is inside a commented-out block. Editing these changes nothing.
- **[components/OrderSlip.js](components/OrderSlip.js)** + **[components/base64Image.js](components/base64Image.js)** — an older hardcoded slip and its print harness; referenced only by each other.
- **[components/SamplePrint.js](components/SamplePrint.js)** + **[components/printData.js](components/printData.js)** + **[components/dummy-logo.js](components/dummy-logo.js)** — the ESC/POS test page, its hardcoded sample invoice (`PRINT_DATA`, a Chinese-commented sales receipt) and the base64 logos. `SamplePrint` is imported only by the dead `components/oldFile/bluetooth.js`, so the whole cluster is unreachable. Note `main.js` has local state also named `printData` — grepping the bare word finds live code that has nothing to do with this module.
- **[components/SyncStatus.js](components/SyncStatus.js)** — passed to `headerRight` on the settings tab (and in two commented-out blocks), but every `Tabs.Screen` in `(tabs)/_layout.js` sets `headerShown: false`, so no header exists to hold it. Nothing in the app displays sync state; the `useSync()` values `_layout.js` maintains are written and never read.
- **[components/styles.js](components/styles.js)** — imported by nothing.
- **Root [index.js](index.js)** imports `./app-default`, which does not exist. It's inert because `package.json` sets `main: expo-router/entry`.
- `components/.scan.js.swp`, `components/Untitled-1.ipynb`, and `eas-build-error-log.text` are stray artifacts checked into the repo.
- `contexts/AuthContext.js` calls `saveSession(user.id, user.username)` in a `useEffect`, but `saveSession(loginData)` takes a single object — that call rejects unhandled. The session is actually saved by `login.js` calling `saveSession(result.data)` correctly. Fix the `AuthContext` call rather than changing `saveSession`'s signature.
- A row stuck in backoff is only visible as a number in the Settings "พบปัญหา" counter — there is no screen listing *which* rows are failing, only the reason on each card in the history list. The one way to force an immediate retry is saving a machine code, which calls `backfillCheckInCompId()`; anything else needs `next_retry_at` cleared by hand.
- `photo_path` points into the ImagePicker cache, which Android may evict, and the photo is never copied anywhere durable. A long-queued row can still lose its image; the upload now logs `PHOTO_MISSING` and proceeds without it rather than failing silently, but the photo is gone. Preventing it means copying the capture into `documentDirectory` at scan time and taking on the cleanup that implies.
- `CheckInSyncManager` reads `useAuth()` for `user?.id` on its error logs, but it is mounted above the login screen, so early-startup logs can carry a null user.
- **`AuthContext.logout()` is never called.** The Settings logout only does `clearSession()` on the database, so the context keeps the previous `user` until the app restarts — later error logs carry the stale id, and logging in as a different account hits the broken `saveSession(user.id, user.username)` call above.
- Logging out does not warn when check-ins are still queued, even though the count is displayed directly above the button. Nothing is lost (the rows keep `sync_status` 0/3) but they stay stuck until someone logs back in. `getTotalUnsyncedCheckInsCount()` exists for exactly this warning — the environment switch already uses it.
- `settings.js` has an `if (loading) return <spinner>` roughly a third of the way down, with every hook above it. **A hook added below that line crashes the screen** with "rendered more hooks than during the previous render" the instant `loading` flips false — same trap as `ProjectProvider`, but here it fires for real rather than being masked by a guard higher up. The `useMemo` backing the "รถที่เหลือ" grouping sits just above the return for this reason.
- The master approval code `8989` is hardcoded at four separate call sites in `settings.js`.
- `handleClearRegisters` does not refresh the counters, so "ใบ C7" keeps showing the pre-delete number.
- `exportStartDate` / `exportEndDate` are dead state — the export modal never renders date inputs and `exportDatabaseFile()` takes no range. `exportDatabaseToJSON(start, end)` in [utils/exportUtils.js](utils/exportUtils.js) would accept one but is not imported.
- The destructive "clear registers" action is hidden behind a **long-press on the version row** in Settings. It also does not take `globalSyncLock`, so clearing while a register fetch is in flight lets `saveRegisters()` commit after the `DELETE` — leaving a partial set under a cursor that looks up to date, i.e. a permanent hole.
- The registers pull makes **one request per 30 s cycle with no drain loop**. If the server paginates, a first sync of N pages takes N × 30 s before the device holds complete data, and during that window `findRegisterByPlate()` reports "ไม่พบซีเจ็ด" for vehicles that are in fact registered. If it does not paginate, the initial pull arrives as one huge payload that `saveRegisters()` walks one `runAsync` at a time.
- Only the **currently active** project is pulled (`project_id=${activeProject.project_id}`), and `activeProject` is time-windowed, so nothing is pre-fetched for a project whose window has not opened. It starts from zero at the exact moment operators begin scanning.
- The registers URL is built by string interpolation, so `last_update` (a timestamp that normally contains a space) is not percent-encoded. Pass it through axios `params` instead.
- `clearScanState()` in `scan.js` deliberately leaves `setVehicleType(null)` commented out, so the vehicle type carries over to the next scan. When a C7 is found it is overwritten, but when one is not — and mode two allows saving anyway — the previous vehicle's type is pre-filled and easy to save by accident.
- Bangkok is stored inconsistently: `registers` and the mode-one path use `กทม.`, but mode two saves `province` raw from `scan.js`, so those check-ins carry `กรุงเทพมหานคร` and do not match either.
- Mode one hard-disables the save button unless `isVerified` (a C7 was found), so a vehicle missing from `registers` cannot be checked in at all. Read that together with the registers-pull gaps above: during an initial sync, operators may be unable to register anyone.
- When a C7 is found, `executeSave` overwrites `bus_type` with the register's value as its last step, so the vehicle-type dropdown is editable but ignored. `bus_type` also holds two different value spaces — the label via `convertBusTypeToLabel()` with no C7, the server's own value with one.
- The duplicate check reads the local `registers` table, which is up to 30 s stale, and each device generates its own `uid`, so two lanes scanning the same vehicle inside that window both succeed and the server cannot dedupe them.
- Auto-picking the first Bluetooth device assumes the printer sorts first among paired devices. A tablet paired with anything else could connect to the wrong device; filter by name or class if that shows up.
