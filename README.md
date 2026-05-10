# Camper Monitor

Real-time dashboard for a 12V LiFePO4 camper battery and Victron SmartSolar MPPT 75/15, running on a Raspberry Pi Zero with an attached 1024×768 display.

![Dashboard](docs/screenshot.png)

## What it shows

**Battery (Eco-worthy JBD BMS via Bluetooth)**
- State of Charge with animated gauge
- Voltage, current, power
- Status: Charging / Discharging / Idle
- Temperature

**Solar Charger (Victron SmartSolar 75/15 via VE.Direct or Bluetooth)**
- PV voltage, current, power
- Battery-side current and voltage
- Charge mode: Bulk / Absorption / Float / Off / …
- Yield today (kWh)
- Animated power flow diagram

---

## Local development (no hardware)

Requires **Node.js 20+**. Install it from [nodejs.org](https://nodejs.org) or via your package manager:

```sh
# macOS (Homebrew)
brew install node

# Debian / Ubuntu — apt splits Node and npm, install both explicitly:
sudo apt-get update
sudo apt-get install -y nodejs npm
```

Then clone and run:

```sh
git clone https://github.com/its-really-me/camper-monitor.git
cd camper-monitor
npm install
npm run dev
```

Open **http://localhost:5175** — mock data runs automatically, no devices needed.

> If Vite picks a different port it prints the URL in the terminal.

---

## Raspberry Pi installation

### Hardware

| Board | Browser | Notes |
|---|---|---|
| Pi Zero W | Epiphany | ARMv6 — Chromium requires NEON and will not run |
| Pi Zero 2 W | Chromium | ARMv8 — drop-in upgrade, full NEON support |

OS: Debian Trixie (or Raspberry Pi OS Bookworm)  
Display: 1024×768 via HDMI

### 1 — Flash and first boot

Flash Raspberry Pi OS Bookworm (64-bit, Lite) or Debian Trixie with Raspberry Pi Imager. Enable SSH and Wi-Fi in the imager settings before writing so you can log in headlessly.

### 2 — SSH in

```sh
ssh pi@<your-pi-ip>
```

### 3 — Clone and run the installer

```sh
git clone https://github.com/its-really-me/camper-monitor.git ~/camper-monitor
sudo bash ~/camper-monitor/scripts/install.sh
```

The installer copies the repo to `/opt/camper-monitor` and works from there.

The installer will:
- Install Node.js 20 (via NodeSource)
- Install Bluetooth, serial port, and X11 dependencies
- Auto-detect your Pi model and set up the framebuffer renderer (Pi Zero W) or **Chromium** kiosk (Pi Zero 2 W)
- Run `npm install` and build the UI
- Launch the **configuration wizard** (see below)

> **Alternative — no clone needed:**
> ```sh
> curl -fsSL https://raw.githubusercontent.com/its-really-me/camper-monitor/main/scripts/install.sh | sudo bash
> ```
> The script clones the repo itself if it isn't already there.

### 4 — Configuration wizard

The wizard runs automatically at the end of the installer. It can also be re-run at any time:

```sh
sudo bash /opt/camper-monitor/scripts/configure.sh
```

It will ask for:
- Battery driver (`ble` / `mock`) and BLE MAC address
- Solar driver (`vedirect` / `ble` / `mock`), serial port or BLE MAC + advertisement key
- HTTP server port

It writes `settings.yaml`, `.env`, `~/.xinitrc` (with the correct browser for your hardware), and the two systemd service files, then enables them.

### 5 — Reboot and verify

```sh
sudo reboot
```

After reboot the dashboard should appear on the display automatically. If something is wrong:

```sh
sudo journalctl -u camper-monitor -f   # server logs
sudo journalctl -u kiosk -f            # display logs
```

---

## Victron SmartSolar via Bluetooth

The SmartSolar 75/15 broadcasts live data over BLE using encrypted advertisements (Victron *Instant Readout*). No USB cable is needed, but the available data is slightly reduced compared to VE.Direct — see the comparison table below.

### Data available per transport

| Field | VE.Direct (USB) | Bluetooth |
|---|:---:|:---:|
| PV voltage | ✅ | ❌ |
| PV current (derived) | ✅ | ❌ |
| PV power | ✅ | ✅ |
| Battery current | ✅ | ✅ |
| Battery voltage | ✅ | ✅ |
| Charge mode | ✅ | ✅ |
| Yield today | ✅ | ✅ |

> PV voltage is not included in the BLE advertisement payload. If you need it, use VE.Direct.

### Step 1 — Get the advertisement key

The SmartSolar encrypts its BLE broadcasts with a per-device 128-bit key. Retrieve it from the **VictronConnect** app:

1. Open VictronConnect and connect to your SmartSolar.
2. Tap the device name at the top → **Product info**.
3. Scroll down to **Advertisement key** — copy the 32-character hex string (e.g. `a1b2c3d4e5f6...`).

> The key never changes unless you reset the device. Store it somewhere safe.

### Step 2 — Find the MAC address

On the Pi (or any Linux machine with BlueZ):

```sh
sudo bluetoothctl
> scan on
# The SmartSolar appears as "SmartSolar MPPT 75|15" or similar
> scan off
> quit
```

On macOS the Bluetooth address is shown as a UUID in `bluetoothctl` alternatives; use the VictronConnect device list to confirm.

### Step 3 — Configure `settings.yaml`

```yaml
readers:
  solar:
    driver: ble
    macAddress: "AA:BB:CC:DD:EE:FF"   # SmartSolar BLE MAC
    advertisementKey: "a1b2c3d4e5f6778899aabbccddeeff00"  # 32-char hex from VictronConnect
    pollInterval: 2000   # advertisements arrive ~every 1 s; this is the display refresh rate
```

### Step 4 — Enable Bluetooth on the Pi (if not already done)

```sh
sudo apt install -y bluetooth bluez
sudo systemctl enable --now bluetooth
sudo setcap cap_net_raw+eip $(which node)   # allow Node.js to scan BLE without root
```

### Switching between Bluetooth and VE.Direct

Change the `driver` value in `settings.yaml` — no code changes needed:

```yaml
# Bluetooth (no cable, reduced data)
solar:
  driver: ble

# VE.Direct USB cable (full data including PV voltage)
solar:
  driver: vedirect
  port: /dev/ttyUSB0
```

Or override at runtime without editing the file:

```sh
SOLAR_DRIVER=ble npm start
SOLAR_DRIVER=vedirect npm start
```

---

## Finding MAC addresses

### JBD BMS (battery)

On the Pi (or any Linux machine with BlueZ):

```sh
sudo bluetoothctl
> scan on
# wait ~10 s — your BMS will appear, name usually contains "JBD" or your battery model
> scan off
> quit
```

Copy the `AA:BB:CC:DD:EE:FF` address into `settings.yaml → readers.battery.macAddress`.

### Victron SmartSolar (BLE driver only)

See the [Victron SmartSolar via Bluetooth](#victron-smartsolar-via-bluetooth) section above for the full setup guide including how to retrieve the advertisement key and MAC address.

---

## Display: Pi Zero W vs Pi Zero 2 W

| Board | Approach | Why |
|---|---|---|
| Pi Zero W (ARMv6) | **Framebuffer renderer** (`ui-fb`) | No browser — Chromium and Epiphany both require NEON (ARMv7+) |
| Pi Zero 2 W (ARMv8) | **Chromium kiosk** | Full NEON support, browser works normally |

The install script detects the architecture automatically and sets up the right path.

### Pi Zero W — framebuffer renderer

`packages/ui-fb` is a Node.js process that connects to the server's SSE stream and draws the dashboard directly to `/dev/fb0` using `node-canvas` (Cairo). No X11, no browser, no NEON required.

> **Boot to CLI required.** If a desktop environment is installed, X11 will claim the framebuffer on boot and `ui-fb` won't be able to render. Set the Pi to boot to console:
> ```sh
> sudo raspi-config
> ```
> → System Options → Boot / Auto Login → **Console** (or Console Autologin).  
> Reboot after changing this setting.

The `canvas` npm package compiles from source on ARMv6. The install script installs the required Cairo libraries and warns you that compilation takes several minutes on Pi Zero W hardware.

System dependencies installed automatically by `scripts/install.sh`:
```sh
sudo apt install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev \
                   build-essential pkg-config fonts-dejavu-core
```

The `ui-fb` process runs as a systemd service:
```sh
sudo systemctl status ui-fb
sudo journalctl -u ui-fb -f
```

### Pi Zero 2 W — Chromium kiosk

Standard X11 + Chromium setup. The install script installs Chromium and writes `~/.xinitrc` and a `kiosk.service` automatically.

---

## Hardware wiring

### JBD BMS → Pi Zero

No wiring needed — Bluetooth is wireless. Ensure the BMS is powered and within ~10 m of the Pi.

### Victron SmartSolar → Pi Zero (VE.Direct)

You need a **VE.Direct to USB** cable (Victron part ASS030530010, ~€15).

```
SmartSolar VE.Direct port  →  USB cable  →  Pi Zero USB port
```

The cable appears as `/dev/ttyUSB0`. If you have other USB serial devices, check with:

```sh
ls /dev/ttyUSB*
dmesg | grep tty
```

---

## Configuration reference

| Setting | Where | Description |
|---|---|---|
| `readers.battery.driver` | `settings.yaml` | `ble` or `mock` |
| `readers.battery.macAddress` | `settings.yaml` | BLE MAC of JBD BMS |
| `readers.battery.pollInterval` | `settings.yaml` | Poll interval in ms (default 5000) |
| `readers.solar.driver` | `settings.yaml` | `vedirect`, `ble`, or `mock` |
| `readers.solar.port` | `settings.yaml` | Serial port for VE.Direct (default `/dev/ttyUSB0`) |
| `readers.solar.macAddress` | `settings.yaml` | BLE MAC of SmartSolar (BLE driver only) |
| `readers.solar.advertisementKey` | `settings.yaml` | 32-char hex key (BLE driver only) |
| `server.port` | `settings.yaml` | HTTP port (default 3000) |
| `BATTERY_DRIVER` | `.env` | Overrides `readers.battery.driver` |
| `SOLAR_DRIVER` | `.env` | Overrides `readers.solar.driver` |
| `SOLAR_PORT` | `.env` | Overrides `readers.solar.port` |
| `PORT` | `.env` | Overrides `server.port` |

---

## Scripts

```sh
npm run dev        # development: mock data + Vite HMR
npm start          # production: reads hardware, serves built UI
npm run build:ui   # build React UI into packages/ui/dist/
```

---

## Adding a new reader

Each reader is a package that exports `createReader(config)` returning `{ start(), stop(), events }`. Events emitted: `data`, `connected`, `disconnected`, `error`.

1. Create `packages/reader-<name>/`
2. Implement the interface (copy `packages/reader-battery/src/mock.js` as a template)
3. Register the driver key in the relevant `packages/reader-*/src/index.js`
4. Set the driver in `settings.yaml`

No changes to the server or UI are needed.
