# Change Review

---

## Session 2026-05-18

### 1. Bug fixes

#### Bug-11 — ECO battery cell voltages wrong (cell 4 showing 3.328 V instead of ~3.43 V)

`parseCells()` in `reader-battery/src/protocol/eco.js` was reading each cell voltage as big-endian from payload offset 1. The ECO AA-frame BMS actually encodes cells as LE uint16 pairs starting from payload offset 0. Payload `65 0d 6c 0d 6d 0d 6a 0d …` decodes to cells 3429 / 3436 / 3437 / 3434 mV; the old BE-from-1 reading was producing the wrong cell values and using padding bytes as cell 4.

**Fix:** Rewrote `parseCells()` to read LE uint16 from index 0, stride 2.

**Files changed:** `packages/reader-battery/src/protocol/eco.js`

#### Bug-12 — Victron BLE solar decryption failing despite correct key

The solar BLE reader had a candidate-loop approach trying multiple `(ivOff, encOff)` combinations, but none of them matched the actual Victron Instant Readout format. The official Victron spec defines: IV = mfr[7:8] as LE uint16 zero-padded to 16 bytes; ciphertext starts at mfr[10] (12 bytes). The candidate loop tried encOff values 5–7 and never reached 10.

**Fix:** Removed the candidate loop entirely. Rewrote `decryptMfr()` with fixed offsets per the official spec. Added a key check: mfr[9] must equal key[0] (Victron transmits this byte unencrypted as a sanity check); if it doesn't match, emit an error immediately without attempting decryption. Record filter: mfr[2] = 0x10 (record marker), mfr[6] = 0x01 (solar charger type).

**Reference:** Victron "Extra Manufacturer Data" spec (2022-12-14), §Solar Charger record.

**Files changed:** `packages/reader-solar/src/ble.js`

#### Bug-13 — Battery BMS reads once after L2 hang, then stops permanently

BlueZ on Pi Zero silently stops emitting BLE `discover` events after an L2 connection failure (`p.connect()` callback never fires). Calling `noble.startScanning()` is a no-op if noble's internal state already believes scanning is running — it does not force a restart of the HCI scan.

**Fix:**
1. `scheduleReconnect()` now calls `noble.stopScanning()` then waits 500 ms before calling `noble.startScanning([], true)`, forcing a real restart.
2. Added a watchdog timer (60 s interval) that performs the same stop+start cycle whenever `writeChar === null` (not connected) — catches any silent BlueZ freeze that `scheduleReconnect()` misses.

**Files changed:** `packages/reader-battery/src/ble.js`

#### Bug-14 — BMS disconnects immediately after first successful connect

The ECO BMS firmware dropped the BLE connection when it received the three polling commands (CMD_INIT + CMD_21 + CMD_22) in rapid succession without any inter-command gap. The BMS could not queue or process them fast enough and closed the connection.

**Fix:** Added a 150 ms `setTimeout` delay between each command in `sendNext()` inside `poll()`.

**Files changed:** `packages/reader-battery/src/ble.js`

#### Bug-15 — Battery card displayed "null A" and "null W"

The ECO AA-frame BMS protocol does not include current or power in every read response. `battery.current` and `battery.power` were `null` at render time; JavaScript template literal interpolation produced the string `"null"`.

**Fix:** Changed rendering to use `battery.current ?? 0` and `battery.power ?? 0` in `BatteryCard.jsx`.

**Files changed:** `packages/ui/src/components/BatteryCard.jsx`

#### Bug-16 — `solar-test.js` producing false positive HIT lines

A previous widening of `isPlausible()` (to catch alternate voltage scalings) relaxed the battery current limit to 200 A and power limit to 10 000 W. These loose bounds caused garbage decryptions from wrong key/offset combos to pass the plausibility check and print false `*** HIT` lines.

**Fix:** Reverted `isPlausible()` to strict limits — `battV` from bytes[2:3]/100 only (11–16.5 V), `|battI| ≤ 100 A`, `pvPower ≤ 5000 W`. Also updated SAMPLES with a fresh mfr hex captured after the decryption fix landed.

**Files changed:** `solar-test.js`

---

### 2. Improvements

#### Graceful staleness UI

The `useStale` hook was reworked to distinguish two levels of data age:

- **Warn** (age ≥ 2 × pollInterval): card remains fully visible; a small grey age label appears next to the status badge.
- **Overlay** (age ≥ 5 × pollInterval): translucent overlay is shown over the still-visible last reading — the data never disappears until it is genuinely missing.

Previously, any disconnect immediately replaced the display with an overlay. The new behaviour keeps showing the last known values until the threshold is reached, which is much less disruptive for BLE devices that briefly go out of range.

**Staleness thresholds (poll interval → warn → overlay):**
| Reader | Poll interval | Warn | Overlay |
|--------|--------------|------|---------|
| Battery (ECO BMS, active BLE) | 15 s | 30 s | 75 s |
| Solar (Victron, passive BLE ads) | 120 s | 4 min | 10 min |
| Starter (BM6, active BLE) | 30 s | 60 s | 150 s |

**Files changed:** `packages/ui/src/hooks/useStale.js`, `packages/ui/src/components/BatteryCard.jsx`, `packages/ui/src/components/SolarCard.jsx`, `packages/ui/src/App.jsx`

#### Solar card — hide unavailable BLE fields

When the Victron BLE driver is active, `pvVoltage`, `pvCurrent`, and `mpptMode` are never available (not in the advertisement). Rather than showing `—` for these fields, they are now hidden entirely:

- PV section: if both `pvVoltage` and `pvCurrent` are `null`, the 3-column grid collapses to a single power value.
- Battery side: `mpptMode` row is hidden when `null`; `yieldToday` expands to full width.

**Files changed:** `packages/ui/src/components/SolarCard.jsx`

#### L2 hang exponential backoff

Consecutive L2 hang timeouts (where `p.connect()` never calls back) now back off exponentially: 5 s → 30 s → 60 s → 120 s (then stays at 120 s). The `consecutiveHangs` counter is reset to 0 on every successful GATT setup. Error messages include the hang count for diagnostics.

**Files changed:** `packages/reader-battery/src/ble.js`

---

## Session 2026-05-13

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
