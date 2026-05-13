'use strict'

const path    = require('path')
const fs      = require('fs')
const express = require('express')
const yaml    = require('js-yaml')

const UI_DIST = path.resolve(__dirname, '../../ui/dist')

// ── setup page ───────────────────────────────────────────────────────────────

function setupPageHtml() {
  return /* html */`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Camper Monitor — Setup</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#020817;color:#f1f5f9;font-family:system-ui,sans-serif;min-height:100vh;padding:2rem 1rem}
  .wrap{max-width:520px;margin:0 auto}
  h1{font-size:1.4rem;font-weight:700;margin-bottom:1.5rem}
  h1 span{color:#34d399}
  .card{background:rgba(30,41,59,.95);border:1px solid #334155;border-radius:12px;padding:1.25rem;margin-bottom:1rem}
  .card h2{font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:1rem}
  .field{margin-bottom:.85rem}
  .field label{display:block;font-size:.8rem;color:#94a3b8;margin-bottom:.35rem}
  .field input,.field select{width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#f1f5f9;font-size:.9rem;padding:.5rem .75rem}
  .field input:focus,.field select:focus{outline:none;border-color:#34d399}
  .hidden{display:none}
  .hint{font-size:.75rem;color:#475569;margin-top:.3rem}
  button{width:100%;background:#34d399;color:#020817;border:none;border-radius:8px;font-size:1rem;font-weight:700;padding:.75rem;cursor:pointer;margin-top:.5rem}
  button:disabled{opacity:.5;cursor:default}
  .msg{text-align:center;margin-top:1.25rem;font-size:.9rem;color:#94a3b8}
  .msg.ok{color:#34d399} .msg.err{color:#f87171}
</style>
</head><body>
<div class="wrap">
  <h1>Camper <span>Monitor</span> &mdash; Setup</h1>
  <form id="f">

    <div class="card">
      <h2>Battery &mdash; JBD BMS</h2>
      <div class="field">
        <label>Driver</label>
        <select name="batteryDriver" onchange="tog('bat-ble',this.value==='ble')">
          <option value="ble">BLE (Bluetooth)</option>
          <option value="mock">Mock (no hardware)</option>
        </select>
      </div>
      <div id="bat-ble">
        <div class="field">
          <label>BLE MAC Address</label>
          <input name="batteryMac" placeholder="AA:BB:CC:DD:EE:FF">
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Solar Charger &mdash; Victron SmartSolar 75/15</h2>
      <div class="field">
        <label>Driver</label>
        <select name="solarDriver" onchange="solarMode(this.value)">
          <option value="vedirect">VE.Direct (USB cable)</option>
          <option value="ble">BLE (Bluetooth)</option>
          <option value="mock">Mock (no hardware)</option>
        </select>
      </div>
      <div id="sol-vedirect">
        <div class="field">
          <label>Serial Port</label>
          <input name="solarPort" value="/dev/ttyUSB0">
        </div>
      </div>
      <div id="sol-ble" class="hidden">
        <div class="field">
          <label>BLE MAC Address</label>
          <input name="solarMac" placeholder="AA:BB:CC:DD:EE:FF">
        </div>
        <div class="field">
          <label>Advertisement Key</label>
          <input name="solarKey" placeholder="32-char hex" maxlength="32">
          <p class="hint">VictronConnect app &rarr; tap device &rarr; Product info &rarr; Advertisement key</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Server</h2>
      <div class="field">
        <label>HTTP Port</label>
        <input name="port" type="number" value="3000" min="1" max="65535">
      </div>
    </div>

    <button type="submit" id="btn">Save &amp; Start Dashboard</button>
  </form>
  <p class="msg" id="msg"></p>
</div>
<script>
  function tog(id,show){document.getElementById(id).classList.toggle('hidden',!show)}
  function solarMode(v){tog('sol-vedirect',v==='vedirect');tog('sol-ble',v==='ble')}

  document.getElementById('f').addEventListener('submit',async e=>{
    e.preventDefault()
    const body=Object.fromEntries(new FormData(e.target))
    const msg=document.getElementById('msg')
    const btn=document.getElementById('btn')
    msg.className='msg'; msg.textContent='Saving…'
    try{
      const r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      if(!r.ok)throw new Error(await r.text())
      msg.className='msg ok'; msg.textContent='Saved! Server is restarting…'
      btn.disabled=true
      const poll=setInterval(async()=>{
        try{const x=await fetch('/state');if(x.ok){clearInterval(poll);location.href='/'}}catch{}
      },2000)
    }catch(err){msg.className='msg err';msg.textContent='Error: '+err.message}
  })
</script>
</body></html>`
}

// ── api factory ──────────────────────────────────────────────────────────────

function createApi(state, { setupMode = false, settingsPath, getDiagnostics } = {}) {
  const app     = express()
  const clients = new Set()

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    next()
  })

  // ── setup mode ────────────────────────────────────────────────────────────
  if (setupMode) {
    app.get('/',      (_req, res) => res.redirect('/setup'))
    app.get('/setup', (_req, res) => res.send(setupPageHtml()))

    app.post('/api/setup', express.json(), (req, res) => {
      const d = req.body
      const cfg = {
        readers: {
          battery: {
            driver:       d.batteryDriver ?? 'mock',
            macAddress:   d.batteryMac    ?? '',
            pollInterval: 5000,
          },
          solar: {
            driver:           d.solarDriver ?? 'mock',
            port:             d.solarPort   ?? '/dev/ttyUSB0',
            macAddress:       d.solarMac    ?? '',
            advertisementKey: d.solarKey    ?? '',
            pollInterval:     2000,
          },
        },
        server: { port: parseInt(d.port ?? '3000', 10) },
      }
      fs.writeFileSync(settingsPath, yaml.dump(cfg), 'utf8')
      res.json({ ok: true })
      setTimeout(() => process.exit(0), 300)
    })

    return { app, push: () => {} }
  }

  // ── normal mode ───────────────────────────────────────────────────────────

  if (fs.existsSync(UI_DIST)) {
    app.use(express.static(UI_DIST))
  }

  function push(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`
    for (const res of clients) res.write(payload)
  }

  app.get('/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection',    'keep-alive')
    res.flushHeaders()
    res.write(`data: ${JSON.stringify(state.toJSON())}\n\n`)
    clients.add(res)
    // Heartbeat keeps the socket alive when no sensor data arrives
    const hb = setInterval(() => res.write(': heartbeat\n\n'), 8000)
    req.on('close', () => { clients.delete(res); clearInterval(hb) })
  })

  app.get('/state', (_req, res) => res.json(state.toJSON()))

  app.get('/diagnostics', (_req, res) => {
    const d = getDiagnostics ? getDiagnostics() : {}
    res.json({ ts: Date.now(), battery: d.battery ?? null, solar: d.solar ?? null, starter: d.starter ?? null })
  })

  // Allow re-accessing setup at any time
  app.get('/setup', (_req, res) => res.send(setupPageHtml()))
  app.post('/api/setup', express.json(), (req, res) => {
    const d = req.body
    const cfg = {
      readers: {
        battery: {
          driver:       d.batteryDriver ?? 'mock',
          macAddress:   d.batteryMac    ?? '',
          pollInterval: 5000,
        },
        solar: {
          driver:           d.solarDriver ?? 'mock',
          port:             d.solarPort   ?? '/dev/ttyUSB0',
          macAddress:       d.solarMac    ?? '',
          advertisementKey: d.solarKey    ?? '',
          pollInterval:     2000,
        },
      },
      server: { port: parseInt(d.port ?? '3000', 10) },
    }
    fs.writeFileSync(settingsPath || path.resolve(__dirname, '../../../settings.yaml'), yaml.dump(cfg), 'utf8')
    res.json({ ok: true })
    setTimeout(() => process.exit(0), 300)
  })

  if (fs.existsSync(UI_DIST)) {
    app.get('*', (_req, res) => res.sendFile(path.join(UI_DIST, 'index.html')))
  }

  return { app, push }
}

module.exports = { createApi }
