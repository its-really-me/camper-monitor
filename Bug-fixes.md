# Bug Fixes

During fixing, all edits are approved. Fixed bugs are annotated with their resolution. Provide help for the testing. Wait for confirmation before marking them as resolved. Don't look after resolved when reiterating through the list.

---

## Bug-1 — Pi Zero W fails to run · Priority: Medium

Running `configure.sh` (again) on Raspberry Pi Zero W failed with:

```
npm ERR! code 1
npm ERR! path /opt/camper-monitor/node_modules/esbuild
npm ERR! command failed
npm ERR! command sh -c node install.js
npm ERR! Error: Command failed: /opt/camper-monitor/node_modules/esbuild/bin/esbuild --version
npm ERR!   signal: 'SIGILL'
```

After reboot the service log showed:

```
May 12 20:34:40 CamperMonitor node[1220]: Error: BLE driver requires @abandonware/noble — run: npm install @abandonware/noble
```

And the screen showed only the console login after reboot.

**Fix:** `esbuild` has no ARMv6 binary and crashes with `SIGILL` during its post-install binary check. It ends up in `package-lock.json` when `npm install` is run on a dev machine (hoisted from `packages/ui` dependencies). On armv6l, `configure.sh` now deletes `package-lock.json` before the workspace install so npm resolves fresh and esbuild is not pulled in. The `@abandonware/noble` error was a downstream symptom of the install failure — once esbuild is resolved, the full install succeeds and noble is available.

---

## Bug-2 — Formatting of this file · Priority: Low

This document was not properly formatted as Markdown.

**Fix:** Reformatted as standard Markdown.

---

## Bug-3 — Mock mode shows "Scanning…" overlay · Priority: High

Mock mode stopped working after BLE diagnostics and on-screen overlays were introduced. The overlay displayed "Scanning… — Looking for device" and never cleared.

**Fix:** The overlay condition `!battery` showed "Scanning…" regardless of the `connected` state. In mock mode, there is a brief window where `connected=true` but `battery` has not yet propagated through the SSE initial push. Changed the condition to `!connected && !battery` so "Scanning…" only appears when the reader is genuinely not connected (i.e. BLE is scanning). When connected but no data has arrived yet, no overlay is shown — the transient state resolves within milliseconds.


## Bug-4 — BLE not working · Priority: High

Something still wrong with Bluetooth/BLE:
1. So far I was never able to connect to the battery and solar charger in the camper.
2. Now, the same with the starter battery BM6.
3. All devices are fine when checked with their own app; all MAC addresses checked (assuming the serial number of BM6 is also the MAC address — format is correct and it is the one also used by the app).
4. Claude stated earlier that MAC address must be in capitals with `:` in between and configure scripts automatically do the case fix if entered otherwise. The question was for BlueZ — is it also true for noble?

**Fix:** Two issues were found.

*MAC address case (question 4):* noble on Linux receives addresses from the BlueZ kernel interface in lowercase-with-colons format (e.g. `aa:bb:cc:dd:ee:ff`). The reader code already normalises both the configured MAC and the reported address to lowercase with colons stripped before comparing, so case does not matter and the configure script's uppercase conversion is harmless.

*BLE never connects (questions 1–3):* `@abandonware/noble` on Linux uses a raw HCI socket to scan for and connect to BLE peripherals. Opening a raw socket as a non-root user requires the `CAP_NET_RAW` POSIX capability on the node binary. `install.sh` sets this once via `setcap`, but the capability is silently cleared whenever the node binary is replaced (OS package update, NodeSource reinstall, etc.). Because `configure.sh` can be re-run independently — and was re-run to resolve Bug-1 — the capability was not refreshed. Added the `setcap cap_net_raw+eip` call to the bluetooth section of `configure.sh` so every re-run keeps the capability current. Also added `libcap2-bin` (which provides `setcap`) to the `apt-get install` line in `install.sh` so the tool is always present.

``` bash
camper@CamperMonitor:~$ hciconfig
hci0:	Type: Primary  Bus: UART
	BD Address: 88:A2:9E:D3:DE:7D  ACL MTU: 1021:7  SCO MTU: 64:1
	UP RUNNING
	RX bytes:3476 acl:0 sco:0 events:292 errors:0
	TX bytes:49029 acl:0 sco:0 commands:292 errors:0

camper@CamperMonitor:~$ hcitool scan
Scanning ...
camper@CamperMonitor:~$ sudo bluetoothctl
[bluetoothctl]> list
Controller 88:A2:9E:D3:DE:7D CamperMonitor [default]
[bluetoothctl]> devices
[bluetoothctl]> scan on
SetDiscoveryFilter success
hci0 type 7 discovering on
Discovery started
[CHG] Controller 88:A2:9E:D3:DE:7D Discovering: yes
[NEW] Device 52:14:E6:69:44:1A 52-14-E6-69-44-1A
[NEW] Device 7D:9D:E0:7B:6D:17 7D-9D-E0-7B-6D-17
[NEW] Device 64:08:65:D0:84:E3 64-08-65-D0-84-E3
[NEW] Device 73:6E:D8:C6:55:D4 73-6E-D8-C6-55-D4
[NEW] Device 41:AB:23:5A:0B:CD 41-AB-23-5A-0B-CD
[NEW] Device 48:10:D6:F8:24:C5 48-10-D6-F8-24-C5
[NEW] Device 59:64:C5:7E:A0:19 59-64-C5-7E-A0-19
[NEW] Device 50:54:7B:81:F4:CC Battery Guard
[NEW] Device 4B:DB:B2:4F:44:26 4B-DB-B2-4F-44-26
[NEW] Device 6A:15:06:6C:9C:94 6A-15-06-6C-9C-94
[NEW] Device 50:31:CB:A3:57:A2 50-31-CB-A3-57-A2
[NEW] Device E6:3E:A7:21:B6:3D E6-3E-A7-21-B6-3D
[NEW] Device E0:EE:6C:18:3F:81 E0-EE-6C-18-3F-81
hci0 type 7 discovering off
hci0 type 7 discovering on
[CHG] Device 6A:15:06:6C:9C:94 RSSI: 0xffffffc3 (-61)
[CHG] Device 41:AB:23:5A:0B:CD ManufacturerData.Key: 0x004c (76)
[CHG] Device 41:AB:23:5A:0B:CD ManufacturerData.Value:
  0c 0e 08 15 b6 10 6e 41 27 b0 ca f5 46 83 db 15  ......nA'...F...
  10 06 40 1d bf a6 6a 48                          ..@...jH
[CHG] Device 52:14:E6:69:44:1A RSSI: 0xffffffda (-38)
[CHG] Device 52:14:E6:69:44:1A ManufacturerData.Key: 0x004c (76)
[CHG] Device 52:14:E6:69:44:1A ManufacturerData.Value:
  10 06 3d 1d d4 34 07 18                          ..=..4..
[CHG] Device 7D:9D:E0:7B:6D:17 RSSI: 0xffffffc1 (-63)
[CHG] Device 7D:9D:E0:7B:6D:17 TxPower: 0x000c (12)
[CHG] Device 7D:9D:E0:7B:6D:17 ManufacturerData.Key: 0x004c (76)
[CHG] Device 7D:9D:E0:7B:6D:17 ManufacturerData.Value:
  10 06 0c 1d c4 04 b0 68                          .......h
[CHG] Device 48:10:D6:F8:24:C5 ManufacturerData.Key: 0x004c (76)
[CHG] Device 48:10:D6:F8:24:C5 ManufacturerData.Value:
  0c 0e 08 15 b6 10 6e 41 27 b0 ca f5 46 83 db 15  ......nA'...F...
  10 06 40 1d bf a6 6a 48                          ..@...jH
[CHG] Device 64:08:65:D0:84:E3 RSSI: 0xffffffb5 (-75)
[CHG] Device 64:08:65:D0:84:E3 ManufacturerData.Key: 0x004c (76)
[CHG] Device 64:08:65:D0:84:E3 ManufacturerData.Value:
  01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 20  ...............
  00                                               .
[CHG] Device 4B:DB:B2:4F:44:26 TxPower: 0x000c (12)
[CHG] Device 4B:DB:B2:4F:44:26 ManufacturerData.Key: 0x004c (76)
[CHG] Device 4B:DB:B2:4F:44:26 ManufacturerData.Value:
  10 06 0c 1d c4 04 b0 68                          .......h
[CHG] Device 50:54:7B:81:F4:CC RSSI: 0xffffffca (-54)
[CHG] Device 50:31:CB:A3:57:A2 RSSI: 0xffffffd8 (-40)
[NEW] Device 5A:82:D9:B5:43:18 5A-82-D9-B5-43-18
hci0 type 7 discovering off
hci0 type 7 discovering on
[CHG] Device 41:AB:23:5A:0B:CD RSSI: 0xffffffd1 (-47)
[CHG] Device 50:31:CB:A3:57:A2 RSSI: 0xffffffcc (-52)
[CHG] Device 50:54:7B:81:F4:CC RSSI: 0xffffffb3 (-77)
[CHG] Device 52:14:E6:69:44:1A RSSI: 0xffffffd1 (-47)
[CHG] Device 64:08:65:D0:84:E3 ManufacturerData.Key: 0x004c (76)
[CHG] Device 64:08:65:D0:84:E3 ManufacturerData.Value:
  01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 20  ...............
  00                                               .
[CHG] Device 59:64:C5:7E:A0:19 RSSI: 0xffffffa3 (-93)
[CHG] Device 4B:DB:B2:4F:44:26 RSSI: 0xffffffbb (-69)
[CHG] Device 48:10:D6:F8:24:C5 RSSI: 0xffffffa9 (-87)
hci0 type 7 discovering off
hci0 type 7 discovering on
[CHG] Device 41:AB:23:5A:0B:CD RSSI: 0xffffffc3 (-61)
[CHG] Device 41:AB:23:5A:0B:CD ManufacturerData.Key: 0x004c (76)
[CHG] Device 41:AB:23:5A:0B:CD ManufacturerData.Value:
  0c 0e 08 18 b6 a7 ca f0 dc c5 40 31 32 63 2e a5  ..........@12c..
  10 06 40 1d bf a6 6a 48                          ..@...jH
[CHG] Device 4B:DB:B2:4F:44:26 RSSI: 0xffffffca (-54)
[CHG] Device 4B:DB:B2:4F:44:26 ManufacturerData.Key: 0x004c (76)
[CHG] Device 4B:DB:B2:4F:44:26 ManufacturerData.Value:
  0f 02 00 00 10 06 0c 1d c4 04 b0 68              ...........h
[CHG] Device 7D:9D:E0:7B:6D:17 ManufacturerData.Key: 0x004c (76)
[CHG] Device 7D:9D:E0:7B:6D:17 ManufacturerData.Value:
  0f 02 00 00 10 06 0c 1d c4 04 b0 68              ...........h
[CHG] Device 64:08:65:D0:84:E3 ManufacturerData.Key: 0x004c (76)
[CHG] Device 64:08:65:D0:84:E3 ManufacturerData.Value:
  01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 20  ...............
  00                                               .
[CHG] Device 50:31:CB:A3:57:A2 RSSI: 0xffffffc3 (-61)
[CHG] Device 48:10:D6:F8:24:C5 RSSI: 0xffffffce (-50)
[CHG] Device 48:10:D6:F8:24:C5 ManufacturerData.Key: 0x004c (76)
[CHG] Device 48:10:D6:F8:24:C5 ManufacturerData.Value:
  0c 0e 08 18 b6 a7 ca f0 dc c5 40 31 32 63 2e a5  ..........@12c..
  10 06 40 1d bf a6 6a 48                          ..@...jH
[CHG] Device 52:14:E6:69:44:1A RSSI: 0xffffffc4 (-60)
[CHG] Device 50:54:7B:81:F4:CC RSSI: 0xffffffc7 (-57)
[DEL] Device 5A:82:D9:B5:43:18 5A-82-D9-B5-43-18
[CHG] Device 73:6E:D8:C6:55:D4 RSSI: 0xffffffc5 (-59)
[NEW] Device 5A:82:D9:B5:43:18 5A-82-D9-B5-43-18
hci0 type 7 discovering off
```

## Bug-5 — Order of questions in configure.sh · Priority: Medium

Screen blank timeout was asked mid-way through the "Writing config files" section instead of in the "Display" section before writing begins.

**Fix:** Moved all display questions (touch device path, blank timeout) into a dedicated "Display" section before the "Writing config files" header. Removed the duplicate questions from the architecture-specific branches.

---

## Bug-6 — Solar charger card shows no overlay when device is out of reach · Priority: Medium

Solar charger card was shown with no overlay and no values while the device was out of reach. Previously the card was hidden underneath the "Scanning…" overlay. The issue appeared after the starter battery was introduced. When the starter battery is not configured, the solar overlay worked correctly.

Hint: `May 13 18:56:13 CamperMonitor node[2398]: [solar] connected`

**Fix:** Two issues found.

*React web UI (root cause):* The `SolarCard` overlay condition was `!connected && !solar` — the solar BLE reader emits `connected` immediately when noble starts scanning (it is a passive scanner, never establishes a GATT connection), leaving `connected=true` and `solar=null` with no overlay. Changed the condition to `!solar` so "Scanning…" appears whenever no Victron advertisement has been received yet, regardless of noble state. The fix was applied in commit `73b5591` but the React UI `dist/` was not rebuilt and committed — the browser was still serving the old bundle with the broken condition. Rebuilt and committed in this session.

*Framebuffer renderer (ui-fb):* Same logic error in `renderer.js` `drawSolarCard`. Fixed separately.

---

## Bug-7 — `[solar] connected` logged on every boot regardless of charger presence · Priority: Low

The server log showed `[solar] connected` immediately on boot even when the Victron solar charger was nowhere near the Pi. This was caused by the solar BLE reader emitting `connected` when the Bluetooth adapter powered on rather than when a Victron advertisement was actually received. It also incorrectly set `solarConnected = true` in the server state on every boot.

**Fix:** Removed the `events.emit('connected')` calls from the BT adapter `poweredOn` handler in `reader-solar/src/ble.js`. Added an `everConnected` flag; `connected` is now emitted once, on the first successfully decrypted Victron advertisement. The log and the server state now accurately reflect whether the charger is in range.

---

## Bug-8 — Starter battery BLE slow to connect or never connects · Priority: High

The starter battery (BM6) sometimes took a very long time to connect or failed entirely. Root cause: `@abandonware/noble` is a singleton shared by all readers in the same process. When the battery reader (`reader-battery`) found the JBD BMS and called `noble.stopScanning()`, scanning stopped for all readers including the starter reader. The starter reader had no mechanism to detect this and would simply wait indefinitely for a discover event that never arrived.

**Fix:** After the GATT connection is successfully established in both `reader-battery/src/ble.js` and `reader-starter/src/ble.js`, `noble.startScanning([], false)` is called immediately. This resumes scanning so the other reader's discover handler can still receive advertisements. A connected device does not require active scanning, so restarting the scan has no effect on the established connection.
---

## Bug-9 — `kiosk` service restart times out · Priority: Medium

`sudo systemctl restart kiosk` hung for ~90 seconds before completing, sometimes failing entirely. Root cause: systemd's default `TimeoutStopSec` is 90 s. When kiosk is stopped, systemd sends SIGTERM to the `startx` process group and waits up to 90 s for Firefox and Xorg to exit gracefully. Firefox ESR on the Pi Zero 2 W routinely takes longer than a few seconds to shut down, causing the timeout.

**Fix:** Added `TimeoutStopSec=10` to the `[Service]` section of `kiosk.service` in `configure.sh`. After 10 s systemd sends SIGKILL to the remaining processes, which always succeeds immediately. `configure.sh` writes this automatically; existing installs can apply it with:

```sh
sudo sed -i '/^RestartSec=5/a TimeoutStopSec=10' /etc/systemd/system/kiosk.service
sudo systemctl daemon-reload
```

---

## Bug-10 — Ctrl+Alt+F1 / VT switching hangs · Priority: Medium

Pressing Ctrl+Alt+F1 (or running `sudo chvt 1` over SSH) caused the cursor to blink once and then hang indefinitely. Root cause: on Raspberry Pi OS Bookworm the kiosk systemd service does not register a logind session, so Xorg has no D-Bus channel to receive the kernel's VT-release signal. Xorg holds the DRM master and never calls `VT_RELDISP`, so `VT_WAITACTIVE` blocks forever. `loginctl session-status` confirmed only the SSH session existed — no kiosk session.

**Fix:** Install `xserver-xorg-legacy` (provides the setuid Xorg wrapper) and write `needs_root_rights=yes` to `/etc/X11/Xwrapper.config`. This makes Xorg run with root privileges so it can handle VT ioctls directly via the kernel, bypassing logind entirely. `configure.sh` now does both steps automatically; existing installs:

```sh
sudo apt-get install -y xserver-xorg-legacy
printf 'allowed_users=anybody\nneeds_root_rights=yes\n' | sudo tee /etc/X11/Xwrapper.config
sudo reboot
```
