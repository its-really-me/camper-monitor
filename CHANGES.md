# Change Review — Session 2026-05-13

Summary of all changes made in this session for review before release.

---

## 1. Bug fixes

### Bug-6 — Solar card overlay missing after update (Pi Zero 2W)
The React UI `dist/` had been built before the SolarCard overlay fix was committed, so the deployed bundle was stale. The dist was rebuilt and re-committed; the new bundle is `index-DKG7x__v.js` (162 kB, was `index-5l8D9OwU.js`).

**Files changed:** `packages/ui/dist/` (rebuilt bundle + updated `index.html`)

### Bug-7 — Solar reader emitted `[solar] connected` too early
The solar BLE reader (`reader-solar/src/ble.js`) emitted the `connected` event when the Bluetooth adapter powered on, not when a Victron device was first seen. This caused the overlay to disappear immediately even though no Victron data had arrived yet.

**Fix:** Removed `events.emit('connected')` from the `stateChange`/`poweredOn` handler. Added a one-shot `everConnected` flag — `connected` is now emitted only on the first successfully decrypted Victron advertisement.

**Files changed:** `packages/reader-solar/src/ble.js`

### Bug-8 — Starter battery BLE slow to connect / never connects
All three BLE readers (battery, solar, starter) share the same `@abandonware/noble` module singleton. When the battery reader called `noble.stopScanning()` to establish a GATT connection to the JBD BMS, it silenced the `discover` event for all other readers until scanning was manually resumed.

**Fix:** After each GATT connection is established (inside the characteristics callback), `noble.startScanning([], false)` is called to resume scanning for the other readers.

**Files changed:** `packages/reader-battery/src/ble.js`, `packages/reader-starter/src/ble.js`

### Bug-9 — Kiosk service restart timeout
`sudo systemctl restart kiosk` timed out with the default 90 s `TimeoutStopSec`. X11 + Firefox ESR take longer than the default to shut down.

**Fix:** Added `TimeoutStopSec=10` to the `[Service]` section in `configure.sh`'s kiosk service unit, so systemd kills the process after 10 s instead of waiting 90 s.

**Files changed:** `scripts/configure.sh`

---

## 2. FE-4 — German / English UI language support

Full internationalisation (i18n) for the React UI. Language is selected during `configure.sh` setup, stored in `settings.yaml`, served via the SSE state object, and applied client-side without a page reload.

### New file: `packages/ui/src/i18n.js`
- `strings` object with `en` and `de` dictionaries (all UI labels).
- `buildT(lang)` — returns a `t(key, vars)` translation function.
- `LangContext` / `useT()` hook — React Context for consuming the translation function in any component.
- `SOLAR_MODE_KEY` — maps Victron mode strings to i18n keys.

### `packages/ui/src/App.jsx`
- Reads `state?.language` from SSE, builds a `t` function via `buildT(lang)`.
- Wraps the entire UI in `<LangContext.Provider value={t}>`.
- Passes translated card labels to `<BatteryCard>` (`t('bodyBattery')`, `t('starterBattery')`).
- Removed a `Header` sub-component that would have opened a second SSE connection.

### `packages/ui/src/components/BatteryCard.jsx`
- Full rewrite using `useT()`.
- All stat labels translated: voltage, current, power, temp.
- Status badges (`CHARGING`, `DISCHARGING`, `IDLE`) translated via `STATUS_KEY` map.
- Overlay messages (`scanning`, `disconnected`, `lastDataAgo`, `noData`) translated with variable interpolation.

### `packages/ui/src/components/SolarCard.jsx`
- Full rewrite using `useT()` and `SOLAR_MODE_KEY`.
- PV input / battery side section labels translated.
- All MPPT mode badge labels translated.

### `packages/ui/src/components/PowerFlow.jsx`
- Full rewrite using `useT()`.
- Node labels (`PV`, `Battery`, `Load`) and card title translated.

### `packages/server/src/index.js`
- Added `language: cfg.ui?.language ?? 'en'` to the SSE state object.
- Added `language: this.language` to the `toJSON()` method.

### `scripts/configure.sh`
- Added a language question after the screen-blank timeout question:
  ```
  UI language — en (English) or de (Deutsch) (default: en):
  ```
- Validates input; unknown values default to `en`.
- Writes `ui:\n  language: <lang>` into `settings.yaml`.

---

## 3. Copyright headers

Added a copyright/description header to all 30 source files. Format by file type:

- **JS / JSX:** `/** \n * Camper Monitor — <filename>\n * <one-line description>\n *\n * © 2026 Kai Steuernagel\n */`
- **CSS:** `/* Camper Monitor — ... © 2026 Kai Steuernagel */`
- **HTML:** `<!-- Camper Monitor — ... © 2026 Kai Steuernagel -->`
- **Shell:** `# Camper Monitor — ... / © 2026 Kai Steuernagel` (after shebang)

**Files updated:**
`packages/reader-battery/src/ble.js`, `index.js`, `mock.js`  
`packages/reader-solar/src/ble.js`, `index.js`, `mock.js`, `vedirect.js`  
`packages/reader-starter/src/ble.js`, `index.js`, `mock.js`  
`packages/server/src/api.js`, `index.js`  
`packages/ui-fb/src/framebuffer.js`, `index.js`, `renderer.js`  
`packages/ui/src/App.jsx`, `main.jsx`, `index.css`  
`packages/ui/src/components/BatteryCard.jsx`, `CardOverlay.jsx`, `PowerFlow.jsx`, `SolarCard.jsx`  
`packages/ui/src/hooks/useLiveState.js`, `useStale.js`  
`packages/ui/index.html`, `tailwind.config.js`, `vite.config.js`, `postcss.config.js`  
`scripts/configure.sh`, `scripts/install.sh`

---

## 4. German README

A full German translation of the entire README was appended to `README.md` (below two `---` separators). It covers all sections: overview, local dev workflow, Pi installation, Victron BLE setup, MAC addresses, display modes, hardware wiring, troubleshooting, configuration reference, scripts, and adding a reader.

**File changed:** `README.md`

---

## 5. Documentation updates

| Document | Change |
|---|---|
| `Bug-fixes.md` | Added Bug-7 (solar connected early), Bug-8 (noble scan contention) |
| `PRD.md` | FE-4 status → Implemented; overall status → "Implemented and verified on hardware" |
| `README.md` | Added kiosk restart one-liner to diagnostics; added German translation |
