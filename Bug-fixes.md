# Bug Fixes

During fixing, all edits are approved. Fixed bugs are annotated with their resolution.

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
