# Camper Monitor

Real-time dashboard for a 12V LiFePO4 camper battery and Victron SmartSolar MPPT 75/15, running on a Raspberry Pi Zero with an attached 1024×600 display.

![Dashboard](docs/screenshot.png)

## What it shows

**Body Battery — Aufbaubatterie (Eco-worthy JBD BMS via Bluetooth)**
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

**Starter Battery — Starterbatterie (intAct Battery-Guard / BM6, optional)**
- Voltage and State of Charge estimated from open-circuit voltage
- Temperature
- Status: Charging (when alternator is running, >13.2 V) / Idle

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
npm install --prefix packages/ui   # Vite and React dev deps (not in root workspace)
npm run dev
```

Open **http://localhost:5173** — mock data runs automatically, no devices needed.

> If Vite picks a different port it prints the URL in the terminal.

> If you ever run a bare `npm install` at the root again (e.g. after pulling new packages), re-run `npm install --prefix packages/ui` afterwards — the root install does not cover `packages/ui` since it is built separately for the Pi.

---

## Raspberry Pi installation

### Hardware

| Board | Display path | Notes |
|---|---|---|
| Pi Zero W | Framebuffer renderer (`ui-fb`) | ARMv6 — browsers require NEON (ARMv7+) and crash |
| Pi Zero 2 W | Firefox ESR kiosk | ARMv8 — full NEON support; Firefox ESR has no low-memory warning |

OS: Raspberry Pi OS Bookworm or Debian Trixie (tested on Trixie)  
Display: HDMI at 1024×600 (confirmed hardware resolution)

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

The installer works in the cloned directory (does not copy to `/opt`).

The installer will:
- Install Node.js 20 (via NodeSource)
- Set boot target to CLI and enable SSH
- Create a 512 MB swap file (if none exists — `dphys-swapfile` is unavailable on Trixie)
- Install Bluetooth, serial port, and X11 / Firefox ESR dependencies
- Auto-detect your Pi model and set up the framebuffer renderer (Pi Zero W) or **Firefox ESR** kiosk (Pi Zero 2 W)
- Run `npm install` (native modules compiled after configuration)
- Launch the **configuration wizard** (see below)
- Build the React UI (Pi Zero 2 W only, after wizard)

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
- **Starter battery** (optional) — `y/N`; if yes: BLE MAC address (BM6 encryption key is static, no entry needed)
- HTTP server port
- **Pi Zero W only:** touch device path
- Screen-blank idle timeout in minutes — both Pi Zero W and Pi Zero 2 W (`0` to disable)

It writes `settings.yaml`, `.env`, systemd service files (and `~/.xinitrc` on Pi Zero 2 W), then enables them.

> **Web-based setup alternative:** If `settings.yaml` is missing, the server automatically serves a setup form at `http://<pi-ip>:3000/setup`. Fill it in from any browser on the local network — no SSH required. The server writes the config and restarts into the dashboard automatically. The form is also accessible at `/setup` at any time to reconfigure.

### 5 — Reboot and verify

```sh
sudo reboot
```

After reboot the dashboard should appear on the display automatically. If something is wrong:

```sh
sudo journalctl -u camper-monitor -f   # server logs
sudo journalctl -u ui-fb -f            # Pi Zero W — framebuffer renderer logs
sudo journalctl -u kiosk -f            # Pi Zero 2 W — Firefox ESR kiosk logs
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
| Pi Zero W (ARMv6) | **Framebuffer renderer** (`ui-fb`) | No browser — browsers require NEON (ARMv7+) |
| Pi Zero 2 W (ARMv8) | **Firefox ESR kiosk** | Full NEON support; Firefox ESR has no low-memory warning on 512 MB RAM |

The install script detects the architecture automatically and sets up the right path.

### Pi Zero W — framebuffer renderer

`packages/ui-fb` is a Node.js process that connects to the server's SSE stream and draws the dashboard directly to `/dev/fb0` using `node-canvas` (Cairo). No X11, no browser, no NEON required.

> **Boot to CLI required.** If a desktop environment is installed, X11 will claim the framebuffer on boot and `ui-fb` won't be able to render. Set the Pi to boot to console:
> ```sh
> sudo raspi-config
> ```
> → System Options → Boot / Auto Login → **Console** (or Console Autologin).  
> Reboot after changing this setting.

The `canvas` npm package compiles from source on ARMv6 — this takes **5–15 minutes** on Pi Zero W hardware. The install script handles this automatically.

### Screen blanking (Pi Zero W)

`ui-fb` can blank the display after a period of inactivity and unblank it on touch. The `configure.sh` wizard asks for both values:

| Env var | Default | Description |
|---|---|---|
| `TOUCH_DEVICE` | `/dev/input/event0` | Path to the touch input device |
| `BLANK_TIMEOUT` | `3` | Idle minutes before blanking; `0` to disable |

To find your touch device path:
```sh
cat /proc/bus/input/devices | grep -A5 -i touch
# look for "event<N>" under the touchscreen entry
```

Blanking writes to `/sys/class/graphics/fb0/blank`, which requires root. `configure.sh` adds a targeted sudoers rule automatically:
```
camper ALL=(root) NOPASSWD: /usr/bin/tee /sys/class/graphics/fb0/blank
```

If you skip `configure.sh` and need to add this manually:
```sh
echo "camper ALL=(root) NOPASSWD: /usr/bin/tee /sys/class/graphics/fb0/blank" | sudo tee /etc/sudoers.d/camper-monitor-blank
sudo chmod 440 /etc/sudoers.d/camper-monitor-blank
```

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

### Pi Zero 2 W — Firefox ESR kiosk

Standard X11 + Firefox ESR setup. The install script installs Firefox ESR and writes `~/.xinitrc` and a `kiosk.service` automatically.

> **Chromium** was evaluated but shows a non-suppressible "less than 1 GB RAM" warning on Pi Zero 2 W (512 MB physical RAM). Firefox ESR has no such check.

The kiosk launches on VT7 (`-- vt7`) so it doesn't conflict with the getty login prompt on VT1. The `kiosk.service` uses `TTYPath=/dev/tty7`, `PAMName=login`, and `WantedBy=multi-user.target`.

### Screen blanking (Pi Zero 2 W)

`configure.sh` writes DPMS blanking commands into `~/.xinitrc` via `xset`. The wizard prompts for the idle timeout (minutes; `0` to disable), matching the Pi Zero W behaviour.

Example `~/.xinitrc` for a 3-minute blank:

```sh
xset s 180 180
xset dpms 0 0 180
openbox &
sleep 2
mkdir -p /tmp/firefox-kiosk
firefox-esr --kiosk --no-remote --profile /tmp/firefox-kiosk http://localhost:3000
```

No sudoers rule is needed — DPMS is handled entirely within X11. The Firefox profile is stored on tmpfs (`/tmp`) so it starts fresh after each reboot.

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

## Troubleshooting

### Data not showing on the display

Cards show a status overlay — **Scanning…**, **Disconnected**, or **No data** — when readings are unavailable. To dig deeper over SSH:

```sh
# Live server logs — connection events + 60-second diagnostic summaries
journalctl -u camper-monitor -f

# Full diagnostic snapshot for both readers
curl -s localhost:3000/diagnostics | python3 -m json.tool
```

### BLE not connecting (`nobleState: poweredOff`)

The Bluetooth adapter exists but is not powered on.

```sh
# Check adapter state
hciconfig

# Unblock and bring up manually
sudo rfkill unblock bluetooth
sudo hciconfig hci0 up

# Permanent fix — should be set by configure.sh, but if missing:
sudo sed -i 's/#AutoEnable=true/AutoEnable=true/' /etc/bluetooth/main.conf
sudo systemctl restart bluetooth
```

### BLE scanning but device not found

Check what addresses are actually visible during the scan:

```sh
# Devices seen by the battery reader
curl -s localhost:3000/diagnostics | python3 -c \
  "import sys,json; [print(x) for x in json.load(sys.stdin)['battery']['devicesSeenInScan']]"

# Devices seen by the solar reader
curl -s localhost:3000/diagnostics | python3 -c \
  "import sys,json; [print(x) for x in json.load(sys.stdin)['solar']['recentDevices']]"
```

If the target device appears but with a different MAC than configured, re-run `sudo bash scripts/configure.sh` to update `settings.yaml`.

### Solar BLE — no Victron advertisements (`victron=0`)

`adv=N victron=0` means N advertisements were received but none matched the Victron company ID. Causes:

- Solar charger is off or out of BLE range (~10 m)
- Wrong MAC configured — run the scan check above
- `adv=0` — BLE adapter not scanning (check `nobleState` first)

### Service restart not reliable

A full reboot is more reliable than `systemctl restart` when the BLE stack is involved:

```sh
sudo reboot
```

### Deploying updates

After pulling new code, rsync it to the install directory and restart both services. On the Pi Zero 2 W, the kiosk must be restarted too — Firefox holds the old JS bundle in memory until the page reloads, and restarting `camper-monitor` alone does not trigger a reload:

```sh
cd ~/camper-monitor && git pull && \
  sudo rsync -a --exclude=node_modules --exclude=settings.yaml \
    ~/camper-monitor/ /opt/camper-monitor/ && \
  sudo systemctl restart camper-monitor kiosk
```

On the Pi Zero W (framebuffer renderer), replace `kiosk` with `ui-fb`.

### `kiosk` restart times out

By default systemd waits 90 s for X11 and Firefox to exit gracefully before killing them. Add `TimeoutStopSec=10` so systemd force-kills the process group after 10 s instead:

```sh
sudo sed -i '/^RestartSec=5/a TimeoutStopSec=10' /etc/systemd/system/kiosk.service
sudo systemctl daemon-reload
```

`configure.sh` writes this automatically from now on, so re-running the wizard also fixes it.

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
| `readers.starter.driver` | `settings.yaml` | `bm6` or `mock` — omit entire `starter:` block to disable |
| `readers.starter.macAddress` | `settings.yaml` | BLE MAC of intAct Battery-Guard / BM6 device |
| `readers.starter.pollInterval` | `settings.yaml` | Poll interval in ms (default 5000) |
| `server.port` | `settings.yaml` | HTTP port (default 3000) |
| `BATTERY_DRIVER` | `.env` | Overrides `readers.battery.driver` |
| `SOLAR_DRIVER` | `.env` | Overrides `readers.solar.driver` |
| `SOLAR_PORT` | `.env` | Overrides `readers.solar.port` |
| `STARTER_DRIVER` | `.env` | Overrides `readers.starter.driver` |
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
