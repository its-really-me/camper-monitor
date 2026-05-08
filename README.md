# Camper Monitor

Real-time dashboard for a 12V LiFePO4 camper battery and Victron SmartSolar MPPT 75/15, running on a Raspberry Pi Zero with an attached 1024×768 display.

![Dashboard](docs/screenshot.png)

## What it shows

**Battery (Eco-worthy JBD BMS via Bluetooth)**
- State of Charge with animated gauge
- Voltage, current, power
- Status: Charging / Discharging / Idle
- Temperature

**Solar Charger (Victron SmartSolar 75/15 via VE.Direct)**
- PV voltage, current, power
- Battery-side current and voltage
- Charge mode: Bulk / Absorption / Float / Off / …
- Yield today (kWh)
- Animated power flow diagram

---

## Local development (no hardware)

```sh
git clone <repo> camper-monitor
cd camper-monitor
npm install
npm run dev
```

Open **http://localhost:5175** — mock data runs automatically, no devices needed.

> If Vite picks a different port it prints the URL in the terminal.

---

## Raspberry Pi installation

### Tested on
- Raspberry Pi Zero 2 W (recommended)
- Raspberry Pi OS Bookworm Lite 64-bit
- Display: 1024×768 via HDMI

### 1 — Flash and first boot

Flash Raspberry Pi OS Bookworm (64-bit, Lite) with Raspberry Pi Imager. In the imager settings:
- Set hostname, SSH, and Wi-Fi before flashing so you can SSH in headlessly.

### 2 — SSH in and update

```sh
ssh pi@<your-pi-ip>
sudo apt update && sudo apt upgrade -y
```

### 3 — Install Node.js 20

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v20.x.x
```

### 4 — Install system dependencies

**For Bluetooth (JBD BMS reader):**
```sh
sudo apt install -y bluetooth bluez libbluetooth-dev
sudo systemctl enable bluetooth
sudo systemctl start bluetooth

# Allow Node.js to use BLE without running as root
sudo setcap cap_net_raw+eip $(which node)
```

**For VE.Direct serial (Victron solar reader):**
```sh
sudo apt install -y minicom   # optional, useful for testing the serial port
# Add your user to the dialout group so Node.js can open /dev/ttyUSB0
sudo usermod -aG dialout $USER
newgrp dialout
```

**For the kiosk display:**
```sh
sudo apt install -y --no-install-recommends \
  xserver-xorg x11-xserver-utils xinit openbox chromium-browser
```

### 5 — Clone and install

```sh
git clone <repo> /opt/camper-monitor
cd /opt/camper-monitor
npm install
```

### 6 — Configure

```sh
cp .env.example .env
nano .env          # remove the mock lines, set real drivers
nano settings.yaml # set your BLE MAC addresses and serial port
```

**`settings.yaml` — key values to update:**

```yaml
readers:
  battery:
    driver: ble
    macAddress: "AA:BB:CC:DD:EE:FF"   # your JBD BMS MAC (see §Finding MAC addresses)

  solar:
    driver: vedirect
    port: /dev/ttyUSB0                # adjust if your adapter appears elsewhere
```

**`.env` — production (leave empty or remove mock lines):**
```sh
# no BATTERY_DRIVER / SOLAR_DRIVER overrides → reads from settings.yaml
```

### 7 — Build the UI

```sh
cd /opt/camper-monitor
npm run build:ui
```

### 8 — systemd service

Create `/etc/systemd/system/camper-monitor.service`:

```ini
[Unit]
Description=Camper Monitor
After=network.target bluetooth.target

[Service]
WorkingDirectory=/opt/camper-monitor
ExecStart=/usr/bin/node packages/server/src/index.js
Restart=always
RestartSec=5
User=pi
EnvironmentFile=/opt/camper-monitor/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```sh
sudo systemctl daemon-reload
sudo systemctl enable camper-monitor
sudo systemctl start camper-monitor
sudo systemctl status camper-monitor   # should show "active (running)"
```

### 9 — Kiosk display (auto-start Chromium)

Create `/home/pi/.xinitrc`:

```sh
#!/bin/sh
xset s off
xset -dpms
xset s noblank
openbox &
sleep 2
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --app=http://localhost:3000
```

Create `/etc/systemd/system/kiosk.service`:

```ini
[Unit]
Description=Chromium Kiosk
After=camper-monitor.service graphical.target

[Service]
User=pi
Environment=DISPLAY=:0
ExecStart=/usr/bin/startx
Restart=always
RestartSec=3

[Install]
WantedBy=graphical.target
```

```sh
sudo systemctl enable kiosk
sudo systemctl start kiosk
```

### 10 — Reboot and verify

```sh
sudo reboot
```

After reboot the display should show the dashboard automatically. If something is wrong:

```sh
sudo journalctl -u camper-monitor -f   # server logs
sudo journalctl -u kiosk -f            # display logs
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

The BLE driver also needs the **advertisement key** from VictronConnect:

1. Open VictronConnect on your phone
2. Connect to the SmartSolar
3. Tap the device name → **Product info** → **Advertisement key**
4. Copy the 32-character hex key into `settings.yaml → readers.solar.advertisementKey`

> **Tip:** The VE.Direct driver (USB cable) gives more data (full PV voltage & current) and needs no key. Prefer it if you have a USB–VE.Direct cable.

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
