# Product Requirements Document — Camper Monitor

**Version:** 1.1  
**Date:** 2026-05-08  
**Status:** Implemented

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
| G5 | Display optimised for 1024×768 — Chromium kiosk on Pi Zero 2 W; framebuffer renderer on Pi Zero W |
| G6 | Each hardware reader is an independently replaceable module |

## 3. Non-Goals

- Cloud sync, remote access, or notifications
- Historical data storage or charting
- Control of battery or solar charger settings
- Support for more than one battery or one solar charger simultaneously

---

## 4. Architecture

### Pi Zero 2 W (ARMv8) — Chromium kiosk

```
┌─────────────────────────────────────────────────────┐
│                Raspberry Pi Zero 2 W                │
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

### Pi Zero W (ARMv6) — framebuffer renderer

Pi Zero W (ARM11) has no NEON SIMD extensions. Both Chromium and Epiphany/WebKit require NEON and crash at startup. The UI is instead rendered directly to `/dev/fb0` by `packages/ui-fb`, a Node.js process using `node-canvas` (Cairo). Cairo has no NEON dependency and compiles cleanly on ARMv6.

```
┌─────────────────────────────────────────────────────┐
│                Raspberry Pi Zero W                  │
│                                                     │
│  ┌──────────────────┐   ┌──────────────────────┐   │
│  │  reader-battery  │   │    reader-solar       │   │
│  └────────┬─────────┘   └──────────┬───────────┘   │
│           └──────────┬────────────┘               │
│                      ▼                             │
│              ┌───────────────┐                     │
│              │    server     │  Express + SSE      │
│              │  (port 3000)  │                     │
│              └──────┬────────┘                     │
│                     │ SSE /events                  │
│              ┌──────▼────────┐                     │
│              │    ui-fb      │  Node.js + Cairo    │
│              │ (node-canvas) │  → /dev/fb0         │
│              └───────────────┘                     │
└─────────────────────────────────────────────────────┘
```

### Communication

- Readers push `BatteryReading` / `SolarReading` events into the server via **EventEmitter**.
- Server aggregates the latest reading from each reader and broadcasts the combined state to all clients via **Server-Sent Events** (`/events`).
- The React UI connects to `/events` via the browser `EventSource` API.
- `ui-fb` connects to `/events` using raw `http.get` streaming (Node.js has no `EventSource`).
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
  battery:
    driver: ble          # 'ble' | 'mock'
  solar:
    driver: vedirect     # 'vedirect' | 'ble' | 'mock'
```

Adding a new reader (e.g. a different BMS brand) means creating a new package that exports `createReader` — nothing else changes.

---

## 6. Repository Structure

```
camper-monitor/
├── package.json               # npm workspaces root
├── settings.yaml              # runtime config (devices, ports, intervals)
├── .env                       # env var overrides (generated by configure.sh)
├── scripts/
│   ├── install.sh             # full system installer — auto-detects Pi model
│   └── configure.sh           # interactive config wizard — can be re-run any time
├── packages/
│   ├── reader-battery/        # JBD BMS reader
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js       # createReader factory → picks ble.js or mock.js
│   │       ├── ble.js         # noble BLE + JBD protocol parser
│   │       └── mock.js        # realistic SoC drift simulation
│   │
│   ├── reader-solar/          # Victron SmartSolar reader
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js       # createReader factory → picks vedirect / ble / mock
│   │       ├── vedirect.js    # serialport + VE.Direct text protocol parser
│   │       ├── ble.js         # AES-128-CTR Instant Readout decoder
│   │       └── mock.js        # sine-based day/night cycle simulation
│   │
│   ├── server/                # API + SSE server
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js       # wires readers → state → SSE
│   │       └── api.js         # Express routes: GET /events, GET /state
│   │
│   ├── ui/                    # React dashboard (Chromium / dev machine)
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   ├── tailwind.config.js
│   │   └── src/
│   │       ├── main.jsx
│   │       ├── App.jsx
│   │       ├── index.css
│   │       ├── hooks/
│   │       │   └── useLiveState.js   # EventSource SSE consumer
│   │       └── components/
│   │           ├── BatteryCard.jsx
│   │           ├── SolarCard.jsx
│   │           └── PowerFlow.jsx
│   │
│   └── ui-fb/                 # Framebuffer renderer (Pi Zero W / ARMv6 only)
│       ├── package.json
│       └── src/
│           ├── index.js       # SSE client + draw loop → /dev/fb0
│           ├── renderer.js    # Cairo canvas dashboard — matches React UI colours
│           └── framebuffer.js # /dev/fb0 writer; auto-converts BGRA→RGB565 for 16bpp
```

---

## 7. Data Contracts

### 7.1 BatteryReading

Source: JBD BMS via BLE (service `ff00`, write char `ff02`, notify char `ff01`)  
Command: `0xDD 0xA5 0x03 0x00 0xFF 0xFD 0x77` (basic info request)  
Checksum: `0x10000 - sum(data bytes)` masked to `0xFFFF`

| Field | Type | Unit | Source | Notes |
|-------|------|------|--------|-------|
| `soc` | `number` | % 0–100 | byte 19 | RSOC field |
| `voltage` | `number` | V | bytes 0–1 | `raw / 100` |
| `current` | `number` | A | bytes 2–3 | signed int16, `raw / 100`; positive = charging |
| `power` | `number` | W | derived | `abs(voltage × current)` |
| `status` | `string` | — | derived | `'charging'` / `'discharging'` / `'idle'` (±0.5 A threshold) |
| `temperature` | `number\|null` | °C | bytes 23+ | first NTC: `(raw - 2731) / 10`; null if no NTC |
| `ts` | `number` | ms | — | `Date.now()` at read time |

### 7.2 SolarReading

#### Primary: VE.Direct text protocol (serial, 19200 8N1)

Block framing: accumulate lines until `Checksum\t<byte>`; block sum mod 256 must equal 0.

| Field | Type | Unit | VE.Direct label | Notes |
|-------|------|------|-----------------|-------|
| `pvVoltage` | `number` | V | `VPV` | `raw / 1000` |
| `pvPower` | `number` | W | `PPV` | integer |
| `pvCurrent` | `number` | A | derived | `pvPower / pvVoltage`; 0 if `pvVoltage = 0` |
| `batteryCurrent` | `number` | A | `I` | `raw / 1000`; positive = into battery |
| `batteryVoltage` | `number` | V | `V` | `raw / 1000` |
| `mode` | `string` | — | `CS` | mapped from charge state code (§7.3) |
| `yieldToday` | `number` | kWh | `H20` | `raw / 100` |
| `ts` | `number` | ms | — | `Date.now()` at parse time |

#### Fallback: Victron BLE (Instant Readout)

Encryption: AES-128-CTR. Key: 32-char hex from VictronConnect → Product info → Advertisement key. IV: 2-byte counter from advertisement, zero-padded to 16 bytes.

| Available via BLE | Not available via BLE |
|-------------------|-----------------------|
| `pvPower`, `batteryCurrent`, `batteryVoltage`, `mode`, `yieldToday` | `pvVoltage`, `pvCurrent` (emitted as `null`) |

> **PV voltage is not transmitted in the BLE advertisement payload.** Use VE.Direct if PV voltage is required.

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
| API server | `express` | Minimal overhead; already used in solar-master |
| Real-time push | Server-Sent Events | One-way stream, browser-native, simpler than WebSocket |
| UI framework | React 18 + Vite | Matches solar-master; fast dev iteration |
| Styling | Tailwind CSS v3 | Matches solar-master design language exactly |
| Icons | `lucide-react` | Matches solar-master |
| Framebuffer UI | `node-canvas` (Cairo) | ARMv6-compatible canvas rendering; no NEON required |
| Config | `settings.yaml` + `.env` | Human-readable; env vars override yaml for quick testing |
| Process mgmt | systemd | No Docker; `npm start` entrypoint |

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
    port: /dev/ttyUSB0       # VE.Direct serial port
    macAddress: "11:22:33:44:55:66"           # BLE driver only
    advertisementKey: "aabbccddeeff..."       # 32-char hex, BLE driver only
    pollInterval: 2000

server:
  port: 3000
```

Environment variables override yaml values at runtime:

| Env var | Overrides |
|---------|-----------|
| `BATTERY_DRIVER` | `readers.battery.driver` |
| `SOLAR_DRIVER` | `readers.solar.driver` |
| `SOLAR_PORT` | `readers.solar.port` |
| `PORT` | `server.port` |

---

## 10. Mock Mode

When a driver is set to `mock`, the reader generates **realistic, time-varying data** without any hardware:

- **Battery mock**: SoC drifts between 97 % (fully charged) and 20 % (floor); transitions between charging and discharging automatically.
- **Solar mock**: sine-based day curve — 0 W at night, peak ~120 W at solar noon (07:00–19:30 window). Charge mode transitions Bulk → Absorption → Float.
- Both mocks emit at the same `pollInterval` as their real counterparts.

In development (`npm run dev`), both drivers default to `mock` automatically.

---

## 11. UI Requirements

### Design Language

Match solar-master exactly:
- Background: `bg-slate-950`; card surface: `bg-slate-800/60 border border-slate-700`
- Labels: `text-xs uppercase tracking-wide`; values: `text-2xl font-bold`
- Icon library: `lucide-react`
- Color tokens: battery emerald `#34d399`, solar amber `#facc15`, current blue `#60a5fa`, load purple `#c084fc`, red `#f87171`

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
│  │   ☀ Solar ──→ 🔋 Battery ──→ Load      │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### BatteryCard

- Circular SoC gauge (270° SVG arc): emerald >50 %, amber 20–50 %, red <20 %
- `GAUGE_START = 135°` (bottom-left), sweeps clockwise to bottom-right
- Status badge: `CHARGING` (emerald) / `DISCHARGING` (amber) / `IDLE` (slate)

### SolarCard

- PV section: voltage, current, power (amber)
- Battery-side section: current (blue), voltage, yield today (emerald)
- Charge mode badge colour-coded per §7.3
- PV voltage and current show `—` when using BLE driver (not available in advertisement)

### PowerFlow

Animated dashed arrows, `stroke-dasharray` flow animation when power > 5 W threshold. Three nodes: PV Solar → Battery → Load.

### Framebuffer renderer (`ui-fb`)

Pixel-accurate Cairo re-implementation of the React layout. Same colour constants, same gauge geometry. Runs as a Node.js process, connects to the server SSE stream, redraws on every `data` event plus a 15 s heartbeat tick (keeps the clock current when data is static). Degrades gracefully (dry run, no crash) if `/dev/fb0` is not accessible (dev machine).

Framebuffer colour depth: auto-detected from `/sys/class/graphics/fb0/bits_per_pixel`. 32bpp: BGRA written directly. 16bpp: Cairo BGRA converted to RGB565 before write.

---

## 12. Development Workflow

```sh
# Install all workspace deps
npm install

# Start in mock mode (dev machine, no hardware needed)
npm run dev          # server on :3000 + Vite HMR on :5175

# Production (Pi, real hardware)
npm start            # reads settings.yaml, serves built UI from packages/ui/dist/

# Build React UI only
npm run build:ui
```

---

## 13. Deployment on Raspberry Pi

### Supported hardware

| Board | CPU | Display path | Browser |
|-------|-----|-------------|---------|
| Pi Zero W | ARMv6 (ARM11) — no NEON | `ui-fb` → `/dev/fb0` | None (browsers require NEON) |
| Pi Zero 2 W | ARMv8 | X11 + Chromium kiosk | Chromium |

Architecture is auto-detected by `uname -m` in the install/configure scripts.

### Install (one command)

```sh
git clone https://github.com/its-really-me/camper-monitor.git /opt/camper-monitor
sudo bash /opt/camper-monitor/scripts/install.sh
```

Or without cloning first:

```sh
curl -fsSL https://raw.githubusercontent.com/its-really-me/camper-monitor/main/scripts/install.sh | sudo bash
```

`install.sh` will:
1. Install Node.js 20 via NodeSource
2. Install BlueZ and set BLE capability (`setcap cap_net_raw+eip` on node binary)
3. Add user to `dialout` (VE.Direct serial)
4. **Pi Zero W**: install Cairo system libs, add user to `video` group — canvas compiles from source (~5–15 min on ARMv6)
5. **Pi Zero 2 W**: install X11 + Chromium, build React UI
6. Run `configure.sh` (interactive wizard)

### Configure (re-runnable at any time)

```sh
sudo bash /opt/camper-monitor/scripts/configure.sh
```

Prompts for battery driver + MAC, solar driver + port/MAC/key, HTTP port. Writes:
- `settings.yaml`
- `.env`
- systemd service files
- `.xinitrc` (Pi Zero 2 W only)

### systemd services

| Service | Pi Zero W | Pi Zero 2 W |
|---------|-----------|-------------|
| `camper-monitor` | ✅ | ✅ |
| `ui-fb` | ✅ | — |
| `kiosk` | — | ✅ |

### Log monitoring

```sh
sudo journalctl -u camper-monitor -f
sudo journalctl -u ui-fb -f          # Pi Zero W only
sudo journalctl -u kiosk -f          # Pi Zero 2 W only
```

---

## 14. Future Enhancements

| # | Idea | Notes |
|---|------|-------|
| FE-1 | Cross-compile native modules on Mac | Build `canvas` and `@abandonware/noble` for `linux/arm/v6` inside a Docker + QEMU container on the dev machine. Extract the compiled `.node` files and `scp` them to the Pi, eliminating the 5–15 min on-device compilation. Worth implementing if reinstalls become frequent. Requires `docker buildx` with `linux/arm/v6` platform support. |
| FE-2 | Custom Pi Zero 2 W OS image | Pre-bake Node.js, compiled native modules, the repo, and systemd services into a flashable `.img` for Pi Zero 2 W (ARMv8). User flashes with Pi Imager and it runs on first boot — no SSH or install script needed. Built with `pi-gen` or by scripting against a base Raspberry Pi OS image. Not worth doing for Pi Zero W (ARMv6 compilation is hard to pre-bake and the audience is smaller). |
| FE-3 | Web-based first-run configuration UI | When `settings.yaml` is missing or incomplete, the Express server serves a setup page at `http://<pi-ip>/setup`. User enters MAC addresses, advertisement key, and driver choices from any browser on the local network. On Pi Zero 2 W, Chromium itself could open this page on first boot before switching to the dashboard. Server writes `settings.yaml` and restarts readers — no SSH or `configure.sh` needed. Pi Zero 2 W only (Pi Zero W has no browser). |

---

## 15. Resolved Issues

| # | Topic | Resolution |
|---|-------|------------|
| OI-1 | Victron BLE advertisement key | Retrieved from VictronConnect app → tap device name → Product info → Advertisement key (32-char hex). Key is per-device and never changes unless factory reset. |
| OI-2 | JBD BMS MAC address | Discovered via `sudo bluetoothctl; scan on` on Pi; entered in `configure.sh` wizard. |
| OI-3 | Pi Zero W display | Chromium and Epiphany both require NEON SIMD (ARMv7+) and crash on ARMv6. Resolved with `packages/ui-fb` — Cairo-based framebuffer renderer, no NEON dependency. |
| OI-4 | BLE without root | `sudo setcap cap_net_raw+eip $(which node)` applied by `install.sh`; no need to run server as root. |
