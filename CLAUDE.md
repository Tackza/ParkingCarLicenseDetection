# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Mbus Register** — an Expo / React Native (SDK 51, RN 0.74) Android-first tablet app used at Dhammakaya parking checkpoints. The workflow is: log in → connect a Bluetooth ESC/POS thermal printer → scan a vehicle's license plate (OCR via external service) → confirm passenger counts → save the check-in locally → upload to the API in the background → print a paper receipt.

The app is bilingual in name but the UI is hardcoded Thai. Dates use the Buddhist calendar (`toLocaleString('th-TH-u-ca-buddhist')`).

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

### Build & deploy (EAS)

```bash
# Production Android APK
eas build --profile production --platform android --clear-cache

# OTA update to production channel
eas update --branch production --message "Updated text"
```

EAS profiles in [eas.json](eas.json): `development` (debug APK, channel `development`, `APP_VARIANT=development`), `preview` (internal distribution), `production` (release APK, channel `production`, `APP_VARIANT=production`). The `APP_VARIANT` env var is read by [app.config.js](app.config.js) and switches the app name and Android/iOS bundle ID to `.dev` so dev and prod can coexist on one device.

## Architecture

### Provider stack & startup

[app/_layout.tsx](app/_layout.tsx) wraps every screen in this exact provider order — order matters because inner providers read from outer ones:

```
EnvironmentProvider → AuthProvider → SyncProvider → ProjectProvider → ModeProvider
                                                  ↳ <CheckInSyncManager />  (mounted once, runs forever)
```

`setupDatabase()` from [constants/Database.js](constants/Database.js) runs once on root mount and applies SQLite migrations via `PRAGMA user_version` (currently v3). [`CheckInSyncManager`](components/CheckInSyncManager.js) is a headless component mounted at the root that polls every 10 s and uploads pending check-ins — there is no separate worker process.

### Routing (Expo Router, file-based)

- [app/index.js](app/index.js) — entry redirect
- [app/login.js](app/login.js) — POST `/api/lpr/login`, session saved to SQLite
- [app/bluetooth-setup.js](app/bluetooth-setup.js) — required after login; selected printer is persisted to `settings` table
- [app/(tabs)/_layout.js](app/(tabs)/_layout.js) — owns the **registers sync loop** (30 s interval, separate from check-in sync)
- [app/(tabs)/main.js](app/(tabs)/main.js) — check-in history list with search
- [app/(tabs)/scan.js](app/(tabs)/scan.js) — camera capture → OCR call → manual correction → insert into `check_ins` → print
- [app/(tabs)/settings.js](app/(tabs)/settings.js) — mode toggle, environment switch, DB export, sync status counters

Two operational modes (`appMode` setting) change which tabs / fields are visible. Two environments (`environment` setting) switch the API base URL between `https://mbus.dhammakaya.network/api` (prod) and `https://mbus-test.dhammakaya.network/api` (test).

### Two independent sync loops

Anything touching sync needs to know there are **two separate loops**, each with their own interval, lock, and state:

1. **Registers (master plate data) — pull.** Lives in [app/(tabs)/_layout.js](app/(tabs)/_layout.js). Every 30 s calls `GET /api/lpr/registers?last_update=X&last_id=Y&project_id=Z` and upserts into the `registers` table. Tracks high-water marks per project. Uses a `globalSyncLock` module variable + a `currentSyncSessionId` ref to prevent overlap when the user switches projects mid-fetch.
2. **Check-ins — push.** Lives in [components/CheckInSyncManager.js](components/CheckInSyncManager.js). Every 10 s selects rows where `sync_status IN (0, 3, 4)`, compresses the photo with `expo-image-manipulator`, and POSTs `/api/lpr/check-ins`. On a `duplicate` error from the server it still marks the row as synced (intentional — server already has it). Photo is sent as base64 in the JSON body.

`sync_status` values for `check_ins`: `0 = pending`, `2 = success`, `3 = pending_update`, `4 = error`. The Settings screen surfaces counts for each.

### Database (SQLite, expo-sqlite, WAL mode)

[constants/Database.js](constants/Database.js) is a ~990-line monolith — all schema, migrations, and queries live here. The whole DB layer is callable functions, not a query builder. Key tables:

- **`sessions`** — auth token (`lpr_token`) used as `Authorization: Bearer ...` for every API call. `getActiveSession()` is the canonical way to get it.
- **`settings`** — KV store for `appMode`, `environment`, `saved_printer`, `machineCode`.
- **`projects`** — composite identity `(project_id, activity_id)`; activities belong to a project.
- **`registers`** — master license-plate records pulled from server; `register_id` is the server PK.
- **`check_ins`** — local-first transactions, the queue for upload. Indexed on `sync_status`.
- **`error_logs`** — every API/DB/camera error funnels here via `insertErrorLog()`; the Settings screen can export it for debugging.

Always wrap DB ops in `try/catch` and log to `error_logs` — that's the existing pattern across the codebase, and the Settings screen relies on it for observability. Before exporting the DB, call `checkpointDatabase()` to flush WAL to the main file.

### Receipt printing (Bluetooth ESC/POS)

Uses [`react-native-bluetooth-escpos-printer`](https://github.com/detanx/react-native-bluetooth-escpos-printer) (git fork). The pattern is **render-then-capture**, not text commands:

1. [components/Receipt.js](components/Receipt.js) renders the receipt as a React Native view (uses `React.forwardRef`).
2. `react-native-view-shot` captures that view to a PNG.
3. The PNG is sent to the printer via `BluetoothEscposPrinter.printPic(...)`.

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
