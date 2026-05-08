# Product Requirements Document — Camper Monitor

**Version:** 1.0  
**Date:** 2026-05-07  
**Status:** Draft

---

## 1. Overview

Camper Monitor is a real-time dashboard running on a Raspberry Pi Zero with an attached 1024×768 display. It reads live data from two Bluetooth/serial devices — an Eco-worthy 12V LiFePO4 battery (JBD BMS) and a Victron SmartSolar MPPT 75/15 — and presents the data in a clear, always-on UI suitable for a camper van.

The system is also runnable on a developer's machine without any hardware (mock mode).

---

## 2. Goals

| # | Goal |
|---|------|
| G1 | Show battery State of Charge, power draw, current, voltage, and status in real time |
| G2 | Show solar charger PV voltage, PV current, PV power, battery-side current, and charge mode |
| G3 | Run on Raspberry Pi Zero (no Docker, installed via `npm install`) |
| G4 | Run on a developer Mac/Linux with simulated data (`MOCK=true`) |
| G5 | Display optimised for 1024×768 (kiosk mode in Chromium) |
| G6 | Each hardware reader is an independently replaceable module |

## 3. Non-Goals

- Cloud sync, remote access, or notifications
- Historical data storage or charting
- Control of battery or solar charger settings
- Support for more than one battery or one solar charger simultaneously

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│                Raspberry Pi Zero                    │
│                                                     │
│  ┌──────────────────┐   ┌──────────────────────┐   │
│  │  reader-battery  │   │    reader-solar       │   │
│  │  (JBD BMS / BLE) │   │ (Victron VE.Direct   │   │
│  └────────┬─────────┘   │  or BLE fallback)    │   │
│           │             └──────────┬───────────┘   │
│           └──────────┬────────────┘               │
│                      ▼                             │
│              ┌───────────────┐                     │
│              │    server     │  Express + SSE      │
│              │  (port 3000)  │  serves built UI    │
│              └──────┬────────┘                     │
│                     │ SSE /events                  │
│              ┌──────▼────────┐                     │
│              │      ui       │  Chromium kiosk     │
│              │ (React/Vite)  │  localhost:3000      │
│              └───────────────┘                     │
└─────────────────────────────────────────────────────┘
```

### Communication

- Readers push `BatteryReading` / `SolarReading` events into the server via **EventEmitter**.
- Server aggregates the latest reading from each reader and broadcasts the combined state to all browser clients via **Server-Sent Events** (`/events`).
- The UI connects to `/events` on page load and updates in place — no polling, no WebSocket handshake overhead.
- No MQTT broker is required.

---

## 5. Modularity Requirement

Every hardware reader **must** implement a common `Reader` interface. The server depends only on this interface, never on concrete implementations. Swapping a real reader for a mock (or for a different BMS brand) requires only a config change.

### Reader Interface

```js
// Each reader module exports a factory function:
function createReader(config) {
  return {
    // Starts polling / BLE scanning / serial reading
    start() {},
    // Stops and cleans up
    stop() {},
    // EventEmitter: emits 'data' with typed reading, 'error', 'connected', 'disconnected'
    events: EventEmitter
  }
}
```

### Module Registry

The server selects implementations at startup from `config.readers`:

```yaml
readers:
  battery: ble          # 'ble' | 'mock'
  solar:   vedirect     # 'vedirect' | 'ble' | 'mock'
```

Adding a new reader (e.g. a different BMS brand) means creating a new package that exports `createReader` — nothing else changes.

---

## 6. Repository Structure

```
camper-monitor/
├── package.json               # npm workspaces root
├── settings.yaml              # runtime config (devices, ports, intervals)
├── .env.example               # env var template
├── packages/
│   ├── reader-battery/        # JBD BMS reader
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js       # createReader factory → picks ble.js or mock.js
│   │       ├── ble.js         # noble BLE + JBD protocol parser
│   │       └── mock.js        # deterministic mock with realistic variation
│   │
│   ├── reader-solar/          # Victron SmartSolar reader
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js       # createReader factory → picks vedirect / ble / mock
│   │       ├── vedirect.js    # serialport + VE.Direct text protocol parser
│   │       ├── ble.js         # noble BLE + Victron advertisement decoder
│   │       └── mock.js        # mock with day/night cycle simulation
│   │
│   ├── server/                # API + SSE server
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js       # wires readers → state → SSE
│   │       └── api.js         # Express routes: GET /events, GET /state
│   │
│   └── ui/                    # React dashboard
│       ├── package.json
│       ├── index.html
│       ├── vite.config.js
│       ├── tailwind.config.js
│       └── src/
│           ├── main.jsx
│           ├── App.jsx
│           ├── index.css
│           ├── hooks/
│           │   └── useLiveState.js   # SSE consumer
│           └── components/
│               ├── BatteryCard.jsx
│               ├── SolarCard.jsx
│               └── PowerFlow.jsx
```

---

## 7. Data Contracts

### 7.1 BatteryReading

Source: JBD BMS via BLE (characteristic `0000ff01` / service `0000ff00`)  
Command: `0xDD 0xA5 0x03 0x00 0xFF 0xFD 0x77` (basic info request)

| Field | Type | Unit | Source bytes | Notes |
|-------|------|------|-------------|-------|
| `soc` | `number` | % 0–100 | byte 23 | RSOC field |
| `voltage` | `number` | V | bytes 4–5 | `raw / 100` (10 mV units) |
| `current` | `number` | A | bytes 6–7 | signed int16, `raw / 100` (10 mA units); positive = charging |
| `power` | `number` | W | derived | `abs(voltage × current)` |
| `status` | `string` | — | derived | `'charging'` / `'discharging'` / `'idle'` (threshold ±0.5 A) |
| `temperature` | `number\|null` | °C | bytes 27+ | first NTC: `(raw - 2731) / 10`, null if no NTC |
| `ts` | `number` | ms | — | `Date.now()` at read time |

### 7.2 SolarReading

#### Primary: VE.Direct text protocol (serial, 19200 8N1)

| Field | Type | Unit | VE.Direct label | Notes |
|-------|------|------|-----------------|-------|
| `pvVoltage` | `number` | V | `VPV` | `raw / 1000` |
| `pvPower` | `number` | W | `PPV` | integer |
| `pvCurrent` | `number` | A | derived | `pvPower / pvVoltage`; 0 if `pvVoltage = 0` |
| `batteryCurrent` | `number` | A | `I` | `raw / 1000` (mA → A); positive = into battery |
| `batteryVoltage` | `number` | V | `V` | `raw / 1000` |
| `mode` | `string` | — | `CS` | mapped from charge state code (see §7.3) |
| `mpptMode` | `string` | — | `MPPT` | `'off'` / `'limited'` / `'active'` |
| `yieldToday` | `number` | kWh | `H20` | `raw / 100` (0.01 kWh units) |
| `ts` | `number` | ms | — | `Date.now()` at parse time |

#### Fallback: Victron BLE (Instant Readout)

When VE.Direct is not available (no serial adapter) the BLE reader provides a subset:

| Field available via BLE | Missing via BLE |
|-------------------------|-----------------|
| `pvPower`, `batteryCurrent`, `batteryVoltage`, `mode`, `yieldToday` | `pvVoltage`, `pvCurrent` (shown as `null`) |

### 7.3 Victron Charge State Codes → `mode`

| CS | Mode string |
|----|-------------|
| 0 | `Off` |
| 2 | `Fault` |
| 3 | `Bulk` |
| 4 | `Absorption` |
| 5 | `Float` |
| 7 | `Equalize` |
| 245 | `Starting Up` |
| 247 | `Auto Equalize` |
| 252 | `External Control` |

---

## 8. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20 LTS | Works on Pi Zero, no recompile needed for JS packages |
| BLE | `@abandonware/noble` | Maintained noble fork, works on Pi's BlueZ stack |
| Serial | `serialport` | Standard; works with USB–VE.Direct cable on Pi |
| API server | `express` | Already used in solar-master; minimal overhead |
| Real-time push | Server-Sent Events | One-way stream, browser-native, simpler than WebSocket for this use case |
| UI framework | React 18 + Vite | Matches solar-master; fast dev iteration |
| Styling | Tailwind CSS v3 | Matches solar-master design language exactly |
| Icons | `lucide-react` | Matches solar-master |
| Config | `settings.yaml` + `dotenv` | Human-readable config file like solar-master |
| Process mgmt (Pi) | systemd | No Docker; simple `npm start` entrypoint |

---

## 9. Configuration (`settings.yaml`)

```yaml
readers:
  battery:
    driver: ble              # 'ble' | 'mock'
    macAddress: "AA:BB:CC:DD:EE:FF"
    pollInterval: 5000       # ms

  solar:
    driver: vedirect         # 'vedirect' | 'ble' | 'mock'
    # VE.Direct serial options (driver: vedirect)
    port: /dev/ttyUSB0
    # BLE options (driver: ble)
    macAddress: "11:22:33:44:55:66"
    advertisementKey: "aabbccddeeff00112233445566778899"

server:
  port: 3000
```

Environment variables override yaml values:  
`BATTERY_DRIVER=mock` / `SOLAR_DRIVER=mock` enable full mock mode for dev.

---

## 10. Mock Mode

When a driver is set to `mock`, the reader generates **realistic, time-varying data** without any hardware:

- **Battery mock**: SoC slowly drains from 85 % to 75 % over 30 minutes when discharging, recharges when a simulated "solar on" phase triggers.
- **Solar mock**: follows a sine-based day curve (0 W at night, peak ~120 W at noon), charge mode transitions through Bulk → Absorption → Float.
- Both mocks emit at the same `pollInterval` as their real counterparts.

Start in mock mode:
```sh
BATTERY_DRIVER=mock SOLAR_DRIVER=mock npm start
```

---

## 11. UI Requirements

### Design Language

Match solar-master exactly:
- Background: `bg-slate-950`; card surface: `bg-slate-800/60 border border-slate-700`
- Font weights and sizing: `text-xs uppercase tracking-wide` for labels, `text-2xl font-bold` for values
- Icon library: `lucide-react` (Battery, Sun, Zap icons)
- Color tokens: battery emerald (`#34d399`), solar amber (`#facc15`), current blue (`#60a5fa`), status red (`#f87171`)

### Layout (1024×768)

```
┌──────────────────────────────────────────────┐
│  Camper Monitor              ● Live  12:34:01 │  ← header
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────┐  ┌────────────────────┐  │
│  │  BATTERY       │  │  SOLAR             │  │
│  │                │  │                    │  │
│  │   ◯ 85%        │  │  PV   18.3 V       │  │
│  │                │  │       0.87 A       │  │
│  │  12.8 V        │  │       15 W         │  │
│  │  +2.5 A        │  │                    │  │
│  │  32 W          │  │  Batt  1.2 A       │  │
│  │  [CHARGING]    │  │  [Float]           │  │
│  │                │  │  Today  0.3 kWh    │  │
│  └────────────────┘  └────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │        Power Flow Diagram              │  │
│  │   Solar ──→ Battery ──→ (load)         │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### BatteryCard

- Circular SoC gauge (SVG arc): emerald, turns amber <30 %, red <15 %
- Large centre label: `85%`
- Stat row: voltage · current (signed, A) · power (W)
- Status badge: `CHARGING` (emerald) / `DISCHARGING` (amber) / `IDLE` (slate)

### SolarCard

- PV voltage, current, power in a stat grid (amber colour)
- Battery-side current (blue)
- Charge mode badge (colour-coded: green=Float, yellow=Bulk/Absorption, red=Fault/Off)
- Yield today

### PowerFlow

Animated SVG flow diagram (adapted from solar-master pattern):

```
        ☀️ Solar
          │
          ▼ pvPower W
        🔋 Battery ──→ load (implied)
```

Arrows animated with `stroke-dasharray` flow when power > threshold (5 W).

### Connectivity

- Green dot + "Live" when SSE stream is open and data age < 15 s
- Red dot + "Stale" / "Disconnected" otherwise
- Per-device connection badge (battery · solar) — grey if reader reports `disconnected`

---

## 12. Development Workflow

```sh
# Install all workspace deps (one command, no Docker)
npm install

# Start everything in mock mode (dev machine, no hardware)
npm run dev              # starts server + Vite dev server with HMR

# Start on Pi (production, reads real hardware)
npm start                # builds UI then starts server on port 3000
```

### Startup sequence (`npm run dev`)

1. `reader-battery` and `reader-solar` start in parallel (mock or real)
2. `server` starts Express on port 3000, begins SSE endpoint
3. `ui` Vite dev server on port 5173 proxies `/events` and `/state` to port 3000

---

## 13. Deployment on Raspberry Pi Zero

### Prerequisites

- Raspberry Pi OS Lite (64-bit) or Bookworm
- Node.js 20 installed via `nvm` or NodeSource repo
- (For BLE) BlueZ running: `sudo systemctl enable bluetooth`
- (For VE.Direct) USB–VE.Direct cable; device appears as `/dev/ttyUSB0`

### Install

```sh
git clone <repo> /opt/camper-monitor
cd /opt/camper-monitor
npm install --omit=dev
npm run build:ui        # Vite build → packages/ui/dist/
```

### systemd service

```ini
[Unit]
Description=Camper Monitor
After=bluetooth.target

[Service]
WorkingDirectory=/opt/camper-monitor
ExecStart=/usr/bin/node packages/server/src/index.js
Restart=always
EnvironmentFile=/opt/camper-monitor/.env

[Install]
WantedBy=multi-user.target
```

Chromium kiosk (added to `/etc/xdg/lxsession/LXDE-pi/autostart`):
```
@chromium-browser --kiosk --app=http://localhost:3000
```

---

## 14. Open Issues / Decisions Needed

| # | Topic | Options |
|---|-------|---------|
| OI-1 | Victron BLE key retrieval | Extract from VictronConnect app SQLite DB, or use VE.Direct as primary and skip BLE entirely |
| OI-2 | JBD BMS MAC address | Must be discovered via BLE scan at first run; needs `npm run scan` helper script |
| OI-3 | Pi Zero RAM | Pi Zero 1 has 512 MB — confirm Chromium is feasible, or switch to framebuffer canvas renderer |
| OI-4 | BLE + serial concurrency | `@abandonware/noble` may require root on Pi unless BlueZ capabilities are set; document `sudo setcap` step |
